import { contributionRedisPrefix, DEFAULT_NETWORK } from './network';
import { sponsorSetting } from './sponsor-policy';
import { contributionsRedisCredentials } from './redis-credentials.mjs';

type Env = Record<string, string | undefined>;
type Reservation = { state: 'reserved' | 'exhausted' } | { state: 'duplicate'; txHash: string };
export type SponsorBudget =
  (claim: { sponsor: string; hash: string; txHash: string; stroops: number }) => Promise<Reservation>;

const DIGEST = /^[a-f0-9]{64}$/;

// One Redis hash holds the running total and each accepted transaction hash. A single write
// records both, so another function instance cannot reserve against a stale total.
const RESERVE = `
local key = KEYS[1]
local hash = ARGV[1]
local amount = tonumber(ARGV[2])
local cap = tonumber(ARGV[3])
local used = tonumber(redis.call('HGET', key, 'used') or '0')
if not used or used < 0 or used ~= math.floor(used) or used > 9007199254740991 then
  return redis.error_reply('invalid sponsor budget counter')
end
local prior = redis.call('HGET', key, hash)
if prior then return {'duplicate', prior} end
if amount > cap - used then return 'exhausted' end
redis.call('HSET', key, 'used', string.format('%.0f', used + amount), hash, ARGV[4])
return 'reserved'
`;

export function readSponsorBudgetCap(env: Env, network = DEFAULT_NETWORK): number {
  const raw = sponsorSetting(env, 'CONTRIB_SPONSOR_BUDGET_STROOPS', network) ?? '';
  const cap = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(cap) || cap <= 0) {
    throw new Error('Invalid sponsor budget configuration');
  }
  return cap;
}

export function createSponsorBudget(env: Env, request: typeof fetch = fetch, network = DEFAULT_NETWORK): SponsorBudget {
  return async ({ sponsor, hash, txHash, stroops }) => {
    const cap = readSponsorBudgetCap(env, network);
    const { url, token } = contributionsRedisCredentials(env, network);
    if (!Number.isSafeInteger(stroops) || stroops <= 0 || !DIGEST.test(hash) || !DIGEST.test(txHash) ||
      !url || new URL(url).protocol !== 'https:' || !token) {
      throw new Error('Invalid sponsor budget configuration');
    }
    const response = await request(url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', RESERVE, 1, `${contributionRedisPrefix(network)}:sponsor-budget:${sponsor}`, hash, stroops, cap, txHash]),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Sponsor budget storage rejected the request');
    const { result, error } = await response.json() as { result?: unknown; error?: unknown };
    if (!error && (result === 'reserved' || result === 'exhausted')) return { state: result };
    if (!error && Array.isArray(result) && result.length === 2 && result[0] === 'duplicate' &&
      typeof result[1] === 'string' && DIGEST.test(result[1])) {
      return { state: 'duplicate', txHash: result[1] };
    }
    throw new Error('Unexpected sponsor budget response');
  };
}
