import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalBytes } from './kernel/contributions.js';

import './test-imports.mjs';

const receiptRoute: typeof import('../../app/api/contributions/receipts/[digest]/route') =
  await import(new URL('../../app/api/contributions/receipts/[digest]/route.ts', import.meta.url).href);
const indexRoute: typeof import('../../app/api/contributions/receipts/index/route') =
  await import(new URL('../../app/api/contributions/receipts/index/route.ts', import.meta.url).href);

const chainRoute: typeof import('../../app/api/contributions/chains/[digest]/route') =
  await import(new URL('../../app/api/contributions/chains/[digest]/route.ts', import.meta.url).href);

test('the public routes hide pending records and serve confirmed canonical bytes and index', async t => {
  const digest = 'a'.repeat(64);
  const index = { version: 1, network: 'stellar:testnet', digest, txHash: 'b'.repeat(64),
    ledger: 100, envelopeXdr: 'dGVzdA==', rehearsal: true };
  const bytes = '{"actor":"demo","version":1}';
  let confirmed = false;
  const before = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
  t.after(() => {
    if (before.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = before.url;
    if (before.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = before.token;
  });
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://example.test');
    const args = JSON.parse(String(init.body));
    if (args[0] === 'HGET') {
      assert.equal(args[2], `receipt:${digest}`);
      return Response.json({ result: JSON.stringify({ intent: { digest, bytes }, index: confirmed ? index : undefined }) });
    }
    assert.deepEqual(args.slice(2), ['0', 'MATCH', 'index:*', 'COUNT', 50]);
    return Response.json({ result: [0, confirmed ? [`index:${digest}`, JSON.stringify(index)] : []] });
  });

  const receipt = new Request(`https://example.test/api/contributions/receipts/${digest}`);
  const context = { params: Promise.resolve({ digest }) };
  const listing = new Request('https://example.test/api/contributions/receipts/index');
  assert.equal((await receiptRoute.GET(receipt, context)).status, 404);
  assert.deepEqual(await (await indexRoute.GET(listing)).json(), { cursor: '0', entries: [] });
  confirmed = true;
  const response = await receiptRoute.GET(receipt, context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), bytes);
  assert.deepEqual(await (await indexRoute.GET(listing)).json(), { cursor: '0', entries: [index] });
});

test('chain status exposes only confirmed steps and accepts only a request as its root', async t => {
  const request = 'a'.repeat(64);
  const contribution = 'b'.repeat(64);
  const actor = 'GAMIRSHHIDJH3DPEEUPW3M74ZXLESMZGSLXFLJNLMFULB46AM6S5T5GR';
  const common = { actor, statement: 'Ensayo', comment: null, evidence: null, createdAt: '2026-11-17T18:00:00.000Z' };
  const record = (digest: string, bytes: string, confirmed = true) => ({
    intent: { digest, chain: request, bytes },
    index: confirmed ? { version: 1, network: 'stellar:testnet', digest, txHash: 'c'.repeat(64),
      ledger: 100, envelopeXdr: 'dGVzdA==', rehearsal: true } : undefined,
  });
  const root = canonicalBytes({ ...common, kind: 'REQUEST', role: 'requester', chain: null, prev: null, subject: null });
  const delivered = canonicalBytes({ ...common, kind: 'CONTRIBUTE', role: 'contributor',
    chain: request, prev: request, subject: null });
  let latest = request;
  let confirmed = false;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const [, , key] = JSON.parse(String(init.body));
    if (key === `head:${request}`) return Response.json({ result: latest });
    if (key === `receipt:${request}`) return Response.json({ result: JSON.stringify(record(request, root, confirmed)) });
    if (key === `receipt:${contribution}`) return Response.json({ result: JSON.stringify(record(contribution, delivered)) });
    return Response.json({ result: null });
  });
  const original = { url: process.env.CONTRIB_KV_REST_API_URL, token: process.env.CONTRIB_KV_REST_API_TOKEN };
  process.env.CONTRIB_KV_REST_API_URL = 'https://example.test';
  process.env.CONTRIB_KV_REST_API_TOKEN = 'fixture';
  t.after(() => {
    if (original.url === undefined) delete process.env.CONTRIB_KV_REST_API_URL;
    else process.env.CONTRIB_KV_REST_API_URL = original.url;
    if (original.token === undefined) delete process.env.CONTRIB_KV_REST_API_TOKEN;
    else process.env.CONTRIB_KV_REST_API_TOKEN = original.token;
  });
  const get = (digest: string) => chainRoute.GET(new Request('https://example.test'), { params: Promise.resolve({ digest }) });
  assert.equal((await get(request)).status, 404);
  confirmed = true;
  assert.deepEqual(await (await get(request)).json(), { request, head: request, kind: 'REQUEST' });
  latest = contribution;
  assert.deepEqual(await (await get(request)).json(), { request, head: contribution, kind: 'CONTRIBUTE' });
  assert.equal((await get(contribution)).status, 404);
});
