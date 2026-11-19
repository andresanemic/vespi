import { contributionsRedisCredentials } from './redis-credentials.mjs';

const KEY = 'contributions:testnet:profiles';
const WRITE = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current then
  if current == ARGV[2] then return 'same' end
  return 'exists'
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
return 'created'
`;

export type PublicProfile = { account: string; displayName: string };

export function createProfileRegistry(env: Record<string, string | undefined>, request = fetch) {
  async function command(args: unknown[]): Promise<unknown> {
    const { url, token } = contributionsRedisCredentials(env);
    if (!url || !token || new URL(url).protocol !== 'https:') throw new Error('Profile store unavailable');
    const response = await request(url.replace(/\/$/, ''), { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Profile store request failed');
    const body = await response.json() as { result?: unknown; error?: unknown };
    if (body.error || body.result === undefined) throw new Error('Unexpected profile store response');
    return body.result;
  }
  return {
    async get(account: string): Promise<PublicProfile | null> {
      const value = await command(['HGET', KEY, account]);
      if (value === null) return null;
      if (typeof value !== 'string' || value.length > 80) throw new Error('Invalid profile record');
      return { account, displayName: value };
    },
    async create(account: string, displayName: string): Promise<'created' | 'same' | 'exists'> {
      const result = await command(['EVAL', WRITE, 1, KEY, account, displayName]);
      if (result === 'created' || result === 'same' || result === 'exists') return result;
      throw new Error('Invalid profile write response');
    },
    async list(cursor: string) {
      const result = await command(['HSCAN', KEY, cursor, 'COUNT', 50]);
      if (!Array.isArray(result) || !/^\d+$/.test(String(result[0])) || !Array.isArray(result[1]) || result[1].length % 2) {
        throw new Error('Invalid profile page');
      }
      const entries: PublicProfile[] = [];
      for (let i = 0; i < result[1].length; i += 2) {
        if (typeof result[1][i] !== 'string' || typeof result[1][i + 1] !== 'string') throw new Error('Invalid profile entry');
        entries.push({ account: result[1][i], displayName: result[1][i + 1] });
      }
      return { cursor: String(result[0]), entries };
    },
  };
}
