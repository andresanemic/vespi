import { randomUUID } from 'node:crypto';
import { contributionRedisPrefix, type ContributionNetwork } from './network';
import { contributionsRedisCredentials } from './redis-credentials.mjs';

// The channel stays leased through maxTime plus clock margin, including on an uncertain Horizon result.
const ACQUIRE = `
local key, now, untilUnix, ip, cap, id = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), ARGV[3], tonumber(ARGV[4]), ARGV[5]
local leases = redis.call('HGETALL', key)
local busy, count = {}, 0
for i = 1, #leases, 2 do
  local lease = cjson.decode(leases[i + 1])
  local channel = leases[i]
  if lease.untilUnix < now then redis.call('HDEL', key, channel)
  else
    busy[channel] = true
    if lease.ip == ip then count = count + 1 end
  end
end
if count >= cap then return false end
for i = 6, #ARGV do
  local channel = ARGV[i]
  if not busy[channel] then
    redis.call('HSET', key, channel, cjson.encode({id = id, ip = ip, untilUnix = untilUnix}))
    return channel
  end
end
return false
`;

const UPDATE = `
local key, channel, id, hash = KEYS[1], ARGV[1], ARGV[2], ARGV[3]
local value = redis.call('HGET', key, channel)
if not value then return 0 end
local lease = cjson.decode(value)
if lease.id ~= id then return 0 end
if hash == '' then return redis.call('HDEL', key, channel) end
if lease.untilUnix < tonumber(ARGV[4]) then return 0 end
lease.id = hash
redis.call('HSET', key, channel, cjson.encode(lease))
return 1
`;

export function createSharedChannelLeases(env: Record<string, string | undefined>, network: ContributionNetwork, request = fetch) {
  const key = `${contributionRedisPrefix(network)}:channel-leases`;
  async function command(script: string, ...args: Array<string | number>) {
    const { url, token } = contributionsRedisCredentials(env, network);
    if (!url || new URL(url).protocol !== 'https:' || !token) throw new Error('Channel leases unavailable');
    const response = await request(url.replace(/\/$/, ''), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', script, 1, key, ...args]), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Channel lease request failed');
    const { result, error } = await response.json() as { result?: unknown; error?: unknown };
    if (error || result === undefined) throw new Error('Invalid channel lease response');
    return result;
  }
  return {
    async acquire(channels: string[], ip: string, cap: number, now: number, until: number) {
      const leaseId = randomUUID();
      const result = await command(ACQUIRE, now, until, ip, cap, leaseId, ...channels);
      if (result === null) return null;
      if (typeof result !== 'string' || !channels.includes(result)) throw new Error('Invalid leased channel');
      return { channel: result, leaseId };
    },
    async bind(channel: string, leaseId: string, hash: string, now: number) {
      return await command(UPDATE, channel, leaseId, hash, now) === 1;
    },
    async release(channel: string, tag: string) {
      await command(UPDATE, channel, tag, '');
    },
  };
}

export type SharedChannelLeases = ReturnType<typeof createSharedChannelLeases>;
