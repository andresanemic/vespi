'use strict';
// K2 hardening (orchestrator review, R42): only approvals that arrive through the human gate count;
// the multi-approver gate keeps the legacy array shape of io.ask; messages are in one language.
const { test } = require('node:test');
const assert = require('node:assert');
const { createOperation, runOperation, STATES } = require('../src/operation.js');
const { sufficient } = require('../src/authority.js');

const verifierOk = async () => ({ verified: true, checks: { mock: true }, reason: 'mock ok' });
const REQ = { asset: 'USDC:test', amount: '100000', to: 'RECEIVER' };
const cap = () => {
  let calls = 0;
  return { id: 'h', required: () => ({ spend: [REQ] }), perform: async () => { calls++; return { ok: true, evidence: { tx: 'X' } }; }, calls: () => calls };
};

test('K2-H1: approvals pre-loaded into the authority never count as approvers', async () => {
  const c = cap();
  const op = createOperation({
    goal: 'demo',
    agent: 'agent-1',
    authority: { spend: [{ asset: 'USDC:test', maxAmount: '100000', to: 'RECEIVER' }], signers: { required: 2, allowed: ['ana', 'bob'], approvals: ['ana', 'bob'] }, approval: { approvals: ['ana', 'bob'] } },
  });
  const res = await runOperation(op, c, { verify: verifierOk, ask: async () => ({ approved: false }) });
  assert.equal(c.calls(), 0, 'perform must not run on pre-loaded approvals');
  assert.equal(res.status, STATES.NEEDS_DECISION);
});

test('K2-H2: the multi-approver gate still hands io.ask an array of requirements', async () => {
  const c = cap();
  let seen;
  const op = createOperation({ goal: 'demo', authority: { spend: [], signers: { required: 1, allowed: ['ana'] } } });
  await runOperation(op, c, { verify: verifierOk, ask: async (reqs) => { seen = reqs; return { approved: false }; } });
  assert.ok(Array.isArray(seen));
  assert.deepStrictEqual(seen.map((r) => r.to), ['RECEIVER']);
  assert.deepStrictEqual(seen.signers, { required: 1, allowed: ['ana'] });
  assert.strictEqual(seen.publicByDefault, false);
});

test('K2-H3: kernel messages are in English only', async () => {
  const expired = sufficient([REQ], { spend: [{ asset: 'USDC:test', maxAmount: '100000', to: 'RECEIVER', expiresAt: '2024-01-01T00:00:00.000Z' }] }, { now: '2025-01-01T00:00:00.000Z' });
  assert.doesNotMatch(expired.reason, /venci/);
  assert.match(expired.reason, /expired at 2024-01-01T00:00:00\.000Z/);
  const c = cap();
  const op = createOperation({ goal: 'demo', authority: { spend: [], signers: { required: 2, allowed: ['ana', 'bob'] } } });
  const res = await runOperation(op, c, { verify: verifierOk, ask: async () => ({ approved: true, by: 'ana' }) });
  assert.doesNotMatch(res.receipt.detail, /faltan|firmas/);
  assert.match(res.receipt.detail, /missing 1 approval/);
});
