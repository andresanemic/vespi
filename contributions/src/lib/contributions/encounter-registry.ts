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

const key = 'contributions:testnet:encounters:v1';
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
row[ARGV[2]] = cjson.decode(ARGV[3])
if ARGV[2] == 'anchor' then
  row.receiptToken = ARGV[4]
  redis.call('HSET', KEYS[1], 'proof:' .. ARGV[4], ARGV[1])
end
redis.call('HSET', KEYS[1], field, cjson.encode(row))
if ARGV[2] == 'decision' then
  redis.call('HSET', KEYS[1], 'member:' .. row.decision.person.account .. ':' .. ARGV[1], ARGV[1])
end
return 1
`;

export function createEncounterRegistry(env: Record<string, string | undefined>, request = fetch) {
  async function command(args: unknown[]) {
    const { url, token } = contributionsRedisCredentials(env);
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
    async create(record: StoredEncounter) {
      return await command(['EVAL', create, 1, key, record.id, JSON.stringify(record),
        record.draft.a.account, record.draft.b?.account ?? '']) === 1;
    },
    async update(id: string, field: 'decision' | 'anchor', value: StoredEncounter[typeof field], proof = '') {
      return await command(['EVAL', update, 1, key, id, field, JSON.stringify(value), proof]) === 1;
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
