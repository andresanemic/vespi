import { test } from 'node:test';
import assert from 'node:assert/strict';
import './test-imports.mjs';

const { createSponsorBudget }: typeof import('./sponsor-budget') = await import(new URL('./sponsor-budget.ts', import.meta.url).href);

const env = {
  CONTRIB_SPONSOR_BUDGET_STROOPS: '1200',
  KV_REST_API_URL: 'https://example.test/',
  KV_REST_API_TOKEN: 'test-only',
};
const claim = { sponsor: 'test-sponsor', hash: 'a'.repeat(64), txHash: 'b'.repeat(64), stroops: 300 };

test('budget uses one Redis script with the sponsor, hash, amount and cap', async () => {
  const expected = [{ state: 'reserved' }, { state: 'duplicate', txHash: 'c'.repeat(64) }, { state: 'exhausted' }];
  const replies = ['reserved', ['duplicate', expected[1].txHash], 'exhausted'];
  let calls = 0;
  const reserve = createSponsorBudget(env, async (url, init) => {
    calls++;
    assert.equal(url, 'https://example.test');
    assert.ok(init);
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-only');
    const [command, script, keys, key, ...args] = JSON.parse(String(init.body));
    assert.equal(command, 'EVAL');
    assert.equal(keys, 1);
    assert.equal(key, 'contributions:testnet:sponsor-budget:test-sponsor');
    assert.equal(typeof script, 'string');
    assert.deepEqual(args, [claim.hash, 300, 1200, claim.txHash]);
    return Response.json({ result: replies[calls - 1] });
  });
  for (const outcome of expected) assert.deepEqual(await reserve(claim), outcome);
  assert.equal(calls, 3);
});

test('budget prefers the dedicated Redis connection and refuses a partial pair', async () => {
  const dedicated = { ...env, CONTRIB_KV_REST_API_URL: 'https://dedicated.test', CONTRIB_KV_REST_API_TOKEN: 'fixture' };
  const reserve = createSponsorBudget(dedicated, async (url, init) => {
    assert.equal(url, 'https://dedicated.test');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture');
    return Response.json({ result: 'reserved' });
  });
  assert.deepEqual(await reserve(claim), { state: 'reserved' });
  const partial = createSponsorBudget({ ...dedicated, CONTRIB_KV_REST_API_TOKEN: undefined },
    async () => assert.fail('must not mix dedicated and legacy credentials'));
  await assert.rejects(partial(claim), /Invalid sponsor budget configuration/);
});

test('legacy Redis settings use a complete pair from the same integration', async () => {
  const stale = { ...env, UPSTASH_REDIS_REST_URL: 'https://stale.test' };
  const reserve = createSponsorBudget(stale, async (url, init) => {
    assert.equal(url, 'https://example.test');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-only');
    return Response.json({ result: 'reserved' });
  });
  assert.deepEqual(await reserve(claim), { state: 'reserved' });
  const mixed = createSponsorBudget({ ...stale, KV_REST_API_URL: undefined },
    async () => assert.fail('must not mix legacy credentials'));
  await assert.rejects(mixed(claim), /Invalid sponsor budget configuration/);
});

test('missing cap and amounts outside safe integer range are refused without network', async () => {
  const noNetwork = async () => assert.fail('should not request Redis');
  await assert.rejects(createSponsorBudget({ ...env, CONTRIB_SPONSOR_BUDGET_STROOPS: '' }, noNetwork)(claim),
    /Invalid sponsor budget configuration/);
  await assert.rejects(createSponsorBudget(env, noNetwork)({ ...claim, stroops: 1.01 }),
    /Invalid sponsor budget configuration/);
});

test('Redis errors and unexpected responses reject the reservation', async () => {
  for (const reply of [new Response('', { status: 502 }), Response.json({ error: 'down' }),
    Response.json({ result: 'unexpected' })]) {
    await assert.rejects(createSponsorBudget(env, async () => reply)(claim), /Sponsor budget|sponsor budget/);
  }
});
