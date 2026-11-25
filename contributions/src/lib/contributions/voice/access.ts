import { StrKey } from '@stellar/stellar-sdk/base';
import { contributionRedisPrefix, type ContributionNetwork } from '../network';
import { contributionsRedisCredentials } from '../redis-credentials.mjs';
import { VOICE_AUTH_SECONDS } from './contract';

type Env = Record<string, string | undefined>;

export function voiceAccounts(env: Env) {
  const accounts = env.CONTRIB_VOICE_ACCOUNTS?.split(',').map(account => account.trim());
  return accounts?.length && accounts.every(account => StrKey.isValidEd25519PublicKey(account))
    ? new Set(accounts) : null;
}

const RESERVE = `
local key = KEYS[1]
local account = ARGV[1]
local total = tonumber(redis.call('HGET', key, 'total') or '0')
local used = tonumber(redis.call('HGET', key, account) or '0')
if not total or not used or used < 0 or total < used or total ~= math.floor(total) or used ~= math.floor(used) then
  return redis.error_reply('invalid voice quota')
end
if total >= tonumber(ARGV[2]) or used >= tonumber(ARGV[3]) then return 'exhausted' end
redis.call('HSET', key, 'total', total + 1, account, used + 1)
redis.call('EXPIREAT', key, ARGV[4])
return 'reserved'
`;

function cap(raw: string | undefined, fallback: number) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1) throw new Error('invalid voice quota');
  return value;
}

export async function reserveVoice(env: Env, network: ContributionNetwork, account: string, now: number,
  proofId: string, signal: AbortSignal, request: typeof fetch, accountMax?: number) {
  const { url, token } = contributionsRedisCredentials(env, network);
  if (!url || new URL(url).protocol !== 'https:' || !token?.trim()) throw new Error('invalid voice storage');
  const endpoint = url.replace(/\/$/, '');
  const daily = cap(env.CONTRIB_VOICE_DAILY_MAX, 30);
  const configured = cap(env.CONTRIB_VOICE_ACCOUNT_DAILY_MAX, 15);
  const perAccount = accountMax === undefined ? configured : Math.min(configured, accountMax);
  const prefix = `${contributionRedisPrefix(network)}:voice-draft`;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  async function command(...args: (string | number)[]) {
    const response = await request(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: deadline, redirect: 'error',
    });
    if (!response.ok) throw new Error('voice storage unavailable');
    const { result, error } = await response.json() as { result?: unknown; error?: unknown };
    if (error) throw new Error('invalid voice storage response');
    return result;
  }
  // A full authorization window covers UTC day changes and clock skew with Redis.
  const claimed = await command('SET', `${prefix}:used:${proofId}`, '1', 'NX', 'EX', VOICE_AUTH_SECONDS);
  if (claimed === null) return 'replayed';
  if (claimed !== 'OK') throw new Error('invalid voice storage response');
  const date = new Date(now).toISOString().slice(0, 10);
  const expiry = Date.parse(date) / 1000 + 2 * 86_400;
  const result = await command('EVAL', RESERVE, 1, `${prefix}:${date}`, account, daily, perAccount, expiry);
  if (result === 'reserved' || result === 'exhausted') return result;
  throw new Error('invalid voice storage response');
}
