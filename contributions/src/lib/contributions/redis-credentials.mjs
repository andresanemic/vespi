/** @param {Record<string, string | undefined>} env */
export function contributionsRedisCredentials(env) {
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
