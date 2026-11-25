import { contributionRedisPrefix, DEFAULT_NETWORK } from './network';
import { contributionsRedisCredentials } from './redis-credentials.mjs';
import type { Decision, EncounterDraft, Person } from './encounters';

export type StoredEncounter = {
  id: string;
  draft: EncounterDraft;
  createdAt: string;
  revision?: number;
  proposalSignature: string;
  decision?: { choice: Decision; note: string; signature: string; person: Person };
  anchor?: string;
  receiptToken?: string;
};

const create = `
local field = 'record:' .. ARGV[1]
if redis.call('HEXISTS', KEYS[1], field) == 1 then return 0 end
redis.call('HSET', KEYS[1], field, ARGV[2], 'member:' .. ARGV[3] .. ':' .. ARGV[1], ARGV[1])
if ARGV[4] ~= '' then redis.call('HSET', KEYS[1], 'member:' .. ARGV[4] .. ':' .. ARGV[1], ARGV[1]) end
return 1
`;
const update = `
local field = 'record:' .. ARGV[1]
local value = redis.call('HGET', KEYS[1], field)
if not value then return 0 end
local row = cjson.decode(value)
if row[ARGV[2]] then return 0 end
if KEYS[2] then
  local indexType = redis.call('TYPE', KEYS[2])
  if type(indexType) == 'table' then indexType = indexType.ok end
  if indexType ~= 'none' and indexType ~= 'zset' then return redis.error_reply('Invalid encounter index') end
end
row[ARGV[2]] = cjson.decode(ARGV[3])
if ARGV[2] == 'anchor' then
  row.receiptToken = ARGV[4]
  redis.call('HSET', KEYS[1], 'proof:' .. ARGV[4], ARGV[1])
end
redis.call('HSET', KEYS[1], field, cjson.encode(row))
if ARGV[2] == 'decision' then
  local recipient = row.decision.person.account
  redis.call('HSET', KEYS[1], 'member:' .. recipient .. ':' .. ARGV[1], ARGV[1])
  if KEYS[2] then
    redis.call('ZADD', KEYS[2], 0, row.draft.a.account .. ':' .. ARGV[1], 0, recipient .. ':' .. ARGV[1])
  end
end
return 1
`;
const publicPageSize = 12;

export function createEncounterRegistry(env: Record<string, string | undefined>, request = fetch, network = DEFAULT_NETWORK) {
  const key = `${contributionRedisPrefix(network)}:encounters:v1`;
  // The public index shares the existing registry's Redis slot.
  const publicKey = key + ':{' + key + '}:public';
  async function command(args: unknown[]) {
    const { url, token } = contributionsRedisCredentials(env, network);
    if (!url || !token || new URL(url).protocol !== 'https:') throw new Error('Encounter store unavailable');
    const response = await request(url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Encounter request failed');
    const { result, error } = await response.json();
    if (error || result === undefined) throw new Error('Encounter result invalid');
    return result;
  }
  async function get(id: string): Promise<StoredEncounter | null> {
    const result = await command(['HGET', key, 'record:' + id]);
    const record: StoredEncounter | null = result === null ? null : JSON.parse(result);
    if (record && record.id !== id) throw new Error('Wrong encounter record');
    return record;
  }
  return {
    get,
    async listPublicCandidates(account: string, cursor: string) {
      const prefix = account + ':';
      const start = cursor === '0' ? '[' + prefix : '(' + prefix + cursor;
      const result: unknown = await command(['ZRANGEBYLEX', publicKey, start, '[' + prefix + 'g', 'LIMIT', 0, publicPageSize + 1]);
      if (!Array.isArray(result) || result.length > publicPageSize + 1 ||
        result.some(member => typeof member !== 'string' || !member.startsWith(prefix) ||
          !/^[a-f0-9]{32}$/.test(member.slice(prefix.length)))) throw new Error('Invalid public encounter page');
      const ids: string[] = result.slice(0, publicPageSize).map(member => member.slice(prefix.length));
      if (!ids.length) return { cursor: '0', entries: [] };
      const batch = await command(['HMGET', key, ...ids.map(id => 'record:' + id)]);
      if (!Array.isArray(batch) || batch.length !== ids.length) throw new Error('Invalid public encounter batch');
      const entries = batch.map((raw, index) => {
        try {
          const row = JSON.parse(raw) as StoredEncounter | null;
          return row?.id === ids[index] ? row : null;
        } catch { return null; }
      });
      return { cursor: result.length > publicPageSize ? ids[publicPageSize - 1] : '0', entries };
    },
    async create(record: StoredEncounter) {
      return await command(['EVAL', create, 1, key, record.id, JSON.stringify(record),
        record.draft.a.account, record.draft.b?.account ?? '']) === 1;
    },
    async respond(id: string, decision: NonNullable<StoredEncounter['decision']>, publish: boolean) {
      const keys = publish ? [key, publicKey] : [key];
      return await command(['EVAL', update, keys.length, ...keys, id, 'decision', JSON.stringify(decision)]) === 1;
    },
    async anchor(id: string, digest: string, proof: string) {
      return await command(['EVAL', update, 1, key, id, 'anchor', JSON.stringify(digest), proof]) === 1;
    },
    async proof(token: string) {
      const id = await command(['HGET', key, 'proof:' + token]);
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) return null;
      const row = await get(id);
      return row?.receiptToken === token && row.anchor ? row : null;
    },
    async list(account: string, cursor: string) {
      const result = await command(['HSCAN', key, cursor, 'MATCH', 'member:' + account + ':*', 'COUNT', 40]);
      if (!Array.isArray(result) || !/^\d+$/.test(String(result[0])) || !Array.isArray(result[1]) ||
        result[1].length % 2 !== 0) throw new Error('Invalid encounter page');
      const ids = result[1].filter((_, index) => index % 2 !== 0) as string[];
      if (!ids.length) return { cursor: String(result[0]), entries: [] };
      const batch = await command(['HMGET', key, ...ids.map(id => 'record:' + id)]);
      if (!Array.isArray(batch) || batch.length !== ids.length) throw new Error('Invalid encounter batch');
      const entries = batch.map(raw => JSON.parse(raw) as StoredEncounter | null)
        .filter(entry => entry && [entry.draft.a.account, entry.draft.b?.account, entry.decision?.person.account].includes(account)) as StoredEncounter[];
      return { cursor: String(result[0]), entries };
    },
  };
}
