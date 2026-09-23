// Kernel acceptance tests. Zero dependencies: node:test + node:assert only.
// RED first: these must fail before src/ exists, pass after the minimal kernel.
const { test } = require('node:test');
const assert = require('node:assert');

const { createOperation, runOperation, STATES } = require('../src/operation.js');
const { sufficient, grantSpend } = require('../src/authority.js');
const { buildReceipt } = require('../src/receipt.js');

function fakeCapability(outcome) {
  let calls = 0;
  return {
    id: 'fake-cap',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '100000', to: 'RECEIVER' }] }),
    perform: async () => {
      calls++;
      return outcome;
    },
    calls: () => calls,
  };
}

const verifierOk = async () => ({ verified: true, checks: { mock: true }, reason: 'mock ok' });
const verifierNo = async () => ({ verified: false, checks: {}, reason: 'mock bad evidence' });
const silentAsk = async () => ({ approved: false });

test('A: without authority, no side effect, NEEDS_HUMAN_DECISION', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(cap.calls(), 0);
  assert.equal(res.receipt.status, 'needs_human_decision');
});

test('B: sufficient authority continues to verified receipt', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(res.status, STATES.SUCCEEDED);
  assert.equal(cap.calls(), 1);
  assert.equal(res.receipt.status, 'verified');
  assert.equal(res.receipt.capability, 'fake-cap');
});

test('capability failure never yields success receipt', async () => {
  const cap = fakeCapability({ ok: false, error: 'broke' });
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.notEqual(res.receipt.status, 'verified');
  assert.equal(res.status, STATES.FAILED);
});

test('verification failure is never presented as verified', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const res = await runOperation(op, cap, { verify: verifierNo, ask: silentAsk });
  assert.notEqual(res.receipt.status, 'verified');
});

test('gate-approved grant keeps the destination (no counterparty-blind grant)', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => ({ approved: true }),
  });
  assert.equal(res.status, STATES.SUCCEEDED);
  assert.equal(res.receipt.authority.exercised[0].to, 'RECEIVER');
});

test('grant naming another destination does not cover', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const op = createOperation({ goal: 'demo', authority: { spend: [{ asset: 'USDC:test', maxAmount: '500000', to: 'OTHER' }] } });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(cap.calls(), 0);
  assert.equal(res.status, STATES.NEEDS_DECISION);
});

test('kernel needs no specific capability to load', () => {
  // Runs inside C:\Vespi, which has no node_modules/@x402. If src required it, this file would not even load.
  assert.ok(typeof runOperation === 'function');
  assert.ok(typeof sufficient === 'function');
  assert.ok(typeof buildReceipt === 'function');
});

test('insufficient grant asks once, then stops without paying', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  let asks = 0;
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '1') });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => {
      asks++;
      return { approved: false };
    },
  });
  assert.equal(asks, 1);
  assert.equal(cap.calls(), 0);
  assert.equal(res.status, STATES.NEEDS_DECISION);
});
