import { buildIndexEntry, parseContribution } from './kernel/contributions.js';
import { contributionsRedisCredentials } from './redis-credentials.mjs';

export type ReceiptIndex = ReturnType<typeof buildIndexEntry>;
export type ReceiptIntent = { digest: string; bytes: string; hash: string; deadline: number;
  chain: string | null; prev: string | null; rehearsal?: boolean; photo?: string };
export type RegisteredReceipt = { intent: ReceiptIntent; index?: ReceiptIndex };
export type Registry = {
  get(digest: string): Promise<RegisteredReceipt | null>;
  pending(chain: string): Promise<RegisteredReceipt | null>;
  reserve(intent: ReceiptIntent): Promise<'reserved' | 'exists' | 'conflict'>;
  confirm(intent: ReceiptIntent, index: ReceiptIndex): Promise<boolean>;
  release(intent: ReceiptIntent): Promise<boolean>;
};

export type ActivityEntry = {
  root: string;
  digest: string;
  action: 'REQUEST' | 'CONTRIBUTE' | 'ACCEPT' | 'ATTEST';
  head: string;
  state: 'REQUEST' | 'CONTRIBUTE' | 'ACCEPT';
  statement: string;
  context: string;
  createdAt: string;
};

const KEY = 'contributions:testnet:receipts';

// An intent and its chain lock live in one Redis hash. Confirmation advances the head
// and makes the receipt public in one write; no other sibling can take the same head.
const UPDATE = `
local key, action, digest, hash = KEYS[1], ARGV[1], ARGV[2], ARGV[3]
local field = 'receipt:' .. digest
local current = redis.call('HGET', key, field)
local chain = ARGV[4]
local head, lock = 'head:' .. chain, 'lock:' .. chain

if action == 'reserve' then
  if current then return 'exists' end
  if chain ~= '' and ((redis.call('HGET', key, head) or '') ~= ARGV[5] or
      (redis.call('HGET', key, lock) or '') ~= '') then return 'conflict' end
  if chain == '' then redis.call('HSET', key, field, ARGV[6])
  else redis.call('HSET', key, field, ARGV[6], lock, digest) end
  return 'reserved'
end

if not current then return 0 end
local record = cjson.decode(current)
if record.intent.hash ~= hash then return 0 end
if record.index then
  if action == 'confirm' then return 1 end
  return 0
end
if chain ~= '' and redis.call('HGET', key, lock) ~= digest then return 0 end
if action == 'confirm' then
  local writes = {key, field, ARGV[6], 'index:' .. digest, ARGV[7]}
  if chain ~= '' then
    table.insert(writes, head)
    table.insert(writes, digest)
    table.insert(writes, lock)
    table.insert(writes, '')
  end
  if ARGV[8] ~= '' then
    table.insert(writes, 'photo:' .. ARGV[8])
    table.insert(writes, digest)
  end
  redis.call('HSET', unpack(writes))
elseif action == 'release' then
  if chain ~= '' then redis.call('HSET', key, lock, '') end
  redis.call('HDEL', key, field)
end
return 1
`;

// A previously reserved digest reuses the same quota after transport failures.
const PHOTO_QUOTA = `
local key, actor, hash, size = KEYS[1], ARGV[1], ARGV[2], tonumber(ARGV[3])
local file = 'file:' .. actor .. ':' .. hash
if redis.call('HEXISTS', key, file) == 1 then return 1 end
local actorBytes, actorFiles = 'bytes:' .. actor, 'files:' .. actor
local values = redis.call('HMGET', key, 'bytes', 'files', actorBytes, actorFiles)
local bytes, files = tonumber(values[1] or '0'), tonumber(values[2] or '0')
local userBytes, userFiles = tonumber(values[3] or '0'), tonumber(values[4] or '0')
if bytes + size > 251658240 or files >= 160 or userBytes + size > 12582912 or userFiles >= 8 then return 0 end
redis.call('HSET', key, file, '1', 'bytes', bytes + size, 'files', files + 1,
  actorBytes, userBytes + size, actorFiles, userFiles + 1)
return 1
`;

export function createReceiptRegistry(env: Record<string, string | undefined>, request = fetch): Registry & {
  list(cursor: string): Promise<{ cursor: string; entries: ReceiptIndex[] }>;
  activity(account: string, cursor: string): Promise<{ cursor: string; entries: ActivityEntry[] }>;
  head(slot: string): Promise<RegisteredReceipt | null>;
  photoReceipt(sha256: string): Promise<RegisteredReceipt | null>;
  reservePhoto(actor: string, sha256: string, bytes: number): Promise<boolean>;
} {
  async function command(args: unknown[]): Promise<unknown> {
    const { url: raw, token } = contributionsRedisCredentials(env);
    if (!raw || !token || new URL(raw).protocol !== 'https:') throw new Error('Receipt store unavailable');
    const response = await request(raw.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Receipt store request failed');
    const { result, error } = await response.json() as { result?: unknown; error?: unknown };
    if (error || result === undefined) throw new Error('Unexpected receipt store response');
    return result;
  }

  function update(action: 'reserve' | 'confirm' | 'release', intent: ReceiptIntent, index?: ReceiptIndex) {
    return command(['EVAL', UPDATE, 1, KEY, action, intent.digest, intent.hash,
      intent.chain ?? '', intent.prev ?? '', JSON.stringify({ intent, index }), JSON.stringify(index ?? null), intent.photo ?? '']);
  }

  const registry = {
    async get(digest: string): Promise<RegisteredReceipt | null> {
      const value = await command(['HGET', KEY, `receipt:${digest}`]);
      if (value === null) return null;
      if (typeof value !== 'string') throw new Error('Invalid receipt record');
      const record = JSON.parse(value) as RegisteredReceipt;
      if (record.intent.digest !== digest || (record.index && buildIndexEntry(record.index).digest !== digest)) {
        throw new Error('Wrong receipt record');
      }
      return record;
    },
    async head(slot: string): Promise<RegisteredReceipt | null> {
      const digest = await command(['HGET', KEY, `head:${slot}`]);
      if (digest === null) return null;
      if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid receipt head');
      return registry.get(digest);
    },
    async reservePhoto(actor: string, sha256: string, bytes: number) {
      return await command(['EVAL', PHOTO_QUOTA, 1, 'contributions:testnet:photo-quota:2026-11-19', actor, sha256, bytes]) === 1;
    },
    async photoReceipt(sha256: string): Promise<RegisteredReceipt | null> {
      const digest = await command(['HGET', KEY, `photo:${sha256}`]);
      if (digest === null) return null;
      if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid photo receipt');
      const record = await registry.get(digest);
      return record?.index && record.intent.photo === sha256 ? record : null;
    },
    async pending(chain: string) {
      const digest = await command(['HGET', KEY, `lock:${chain}`]);
      if (digest === null || digest === '') return null;
      if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid receipt lock');
      const record = await registry.get(digest);
      return record?.intent.chain === chain && !record.index ? record : null;
    },
    async list(cursor: string) {
      const result = await command(['HSCAN', KEY, cursor, 'MATCH', 'index:*', 'COUNT', 50]);
      if (!Array.isArray(result) || (typeof result[0] !== 'string' && !Number.isSafeInteger(result[0])) ||
        !/^\d+$/.test(String(result[0])) || !Array.isArray(result[1]) || result[1].length % 2 !== 0) {
        throw new Error('Invalid receipt index page');
      }
      const entries: ReceiptIndex[] = [];
      for (let i = 0; i < result[1].length; i += 2) {
        const entry = buildIndexEntry(JSON.parse(result[1][i + 1]));
        if (result[1][i] !== `index:${entry.digest}`) throw new Error('Wrong receipt index entry');
        entries.push(entry);
      }
      return { cursor: String(result[0]), entries };
    },
    async activity(account: string, cursor: string) {
      const result = await command(['HSCAN', KEY, cursor, 'MATCH', 'receipt:*', 'COUNT', 50]);
      if (!Array.isArray(result) || !/^\d+$/.test(String(result[0])) ||
        !Array.isArray(result[1]) || result[1].length % 2 !== 0) throw new Error('Invalid receipt activity page');
      const matching: { root: string; digest: string; action: ActivityEntry['action']; createdAt: string; statement: string }[] = [];
      for (let i = 0; i < result[1].length; i += 2) {
        const record = JSON.parse(result[1][i + 1]) as RegisteredReceipt;
        if (!record.index || result[1][i] !== 'receipt:' + record.index.digest) continue;
        const receipt = parseContribution(record.intent.bytes);
        if (receipt.actor !== account) continue;
        const action = receipt.kind;
        if (action !== 'REQUEST' && action !== 'CONTRIBUTE' && action !== 'ACCEPT' && action !== 'ATTEST') continue;
        matching.push({ root: receipt.chain ?? record.index.digest, digest: record.index.digest, action, createdAt: receipt.createdAt, statement: receipt.statement });
      }
      const byRoot = new Map([...new Set(matching.map(item => item.root))].map(root => [root, Promise.all([registry.get(root), registry.head(root)])]));
      const entries: ActivityEntry[] = [];
      await Promise.all(matching.map(async item => {
        const found = await byRoot.get(item.root);
        if (!found) return;
        const [root, head] = found;
        if (!root?.index || !head?.index) return;
        const state = parseContribution(head.intent.bytes).kind;
        const request = parseContribution(root.intent.bytes);
        if (request.kind !== 'REQUEST' || (state !== 'REQUEST' && state !== 'CONTRIBUTE' && state !== 'ACCEPT')) return;
        entries.push({ ...item, head: head.index.digest, state, context: request.statement });
      }));
      return { cursor: String(result[0]), entries };
    },
    async reserve(intent: ReceiptIntent): Promise<'reserved' | 'exists' | 'conflict'> {
      const value = await update('reserve', intent);
      if (value === 'reserved' || value === 'exists' || value === 'conflict') return value;
      throw new Error('Invalid receipt reservation response');
    },
    async confirm(intent: ReceiptIntent, index: ReceiptIndex) { return await update('confirm', intent, index) === 1; },
    async release(intent: ReceiptIntent) { return await update('release', intent) === 1; },
  };
  return registry;
}
