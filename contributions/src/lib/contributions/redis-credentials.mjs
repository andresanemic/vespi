// Testnet keeps its historical lookup (dedicated CONTRIB_KV_*, then the shared Upstash/KV store). Mainnet reads
// only its own store and never falls back to a shared or testnet one: missing or reused credentials throw.

/** @param {Record<string, string | undefined>} env */
function testnetRedisCredentials(env) {
  const dedicatedUrl = env.CONTRIB_KV_REST_API_URL;
  const dedicatedToken = env.CONTRIB_KV_REST_API_TOKEN;
  if (dedicatedUrl !== undefined || dedicatedToken !== undefined) {
    return { url: dedicatedUrl, token: dedicatedToken };
  }
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN };
  }
  return { url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN };
}

/** Same store regardless of case, spaces, default port or a trailing slash; unparsable values compare as text.
 * @param {string | undefined} value */
function storeKey(value) {
  const text = (value ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol + '//' + url.host.toLowerCase() + url.pathname.replace(/\/+$/, '');
  } catch { return text.toLowerCase(); }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {'testnet' | 'mainnet'} [network]
 */
export function contributionsRedisCredentials(env, network = 'testnet') {
  if (network === 'testnet') return testnetRedisCredentials(env);
  if (network !== 'mainnet') throw new Error('contributions: unknown network');
  // The Vercel Upstash integration with prefix CONTRIB_KV_MAINNET names them CONTRIB_KV_MAINNET_KV_REST_API_*.
  // Both spellings are mainnet-only; neither falls back to a testnet or shared store.
  // URL and token always come from the same spelling, so a stale half of one pair never mixes with the other.
  const direct = env.CONTRIB_KV_MAINNET_REST_API_URL !== undefined || env.CONTRIB_KV_MAINNET_REST_API_TOKEN !== undefined;
  const url = direct ? env.CONTRIB_KV_MAINNET_REST_API_URL : env.CONTRIB_KV_MAINNET_KV_REST_API_URL;
  const token = direct ? env.CONTRIB_KV_MAINNET_REST_API_TOKEN : env.CONTRIB_KV_MAINNET_KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error('contributions: mainnet needs CONTRIB_KV_MAINNET_REST_API_URL and _TOKEN (or the integration names CONTRIB_KV_MAINNET_KV_REST_API_URL and _TOKEN)');
  }
  const testnet = testnetRedisCredentials(env);
  const sharedUrls = [testnet.url, env.UPSTASH_REDIS_REST_URL, env.KV_REST_API_URL].map(storeKey).filter(Boolean);
  // An Upstash token belongs to one store, so a reused token reaches the same data through any alias.
  const sharedTokens = [testnet.token, env.UPSTASH_REDIS_REST_TOKEN, env.KV_REST_API_TOKEN]
    .map(value => (value ?? '').trim()).filter(Boolean);
  if (sharedUrls.includes(storeKey(url)) || sharedTokens.includes(token.trim())) {
    throw new Error('contributions: mainnet must not share a Redis store with testnet');
  }
  return { url, token };
}

/**
 * Key for invitation and onboarding tokens. Testnet keeps CONTRIB_TOKEN_KEY as it is, so existing links keep
 * working; mainnet requires its own key of at least 32 bytes, distinct from the testnet one.
 * @param {Record<string, string | undefined>} env
 * @param {'testnet' | 'mainnet'} [network]
 */
export function contributionsTokenKey(env, network = 'testnet') {
  if (network === 'testnet') return env.CONTRIB_TOKEN_KEY;
  if (network !== 'mainnet') throw new Error('contributions: unknown network');
  const key = env.CONTRIB_TOKEN_KEY_MAINNET;
  if (!tokenKeyHasMinimumBytes(key)) {
    throw new Error('contributions: mainnet needs CONTRIB_TOKEN_KEY_MAINNET of at least 32 bytes');
  }
  if (key.trim() === (env.CONTRIB_TOKEN_KEY ?? '').trim()) throw new Error('contributions: mainnet must not reuse the testnet token key');
  return key;
}

/** @param {string | undefined} key */
export function tokenKeyHasMinimumBytes(key) {
  return Buffer.byteLength(key ?? '', 'utf8') >= 32;
}
