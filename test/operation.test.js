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

test('F1: verifier throw after success keeps evidence, no rerun, not_verified receipt', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const boom = async () => {
    throw new Error('verifier exploded');
  };
  const res = await runOperation(op, cap, { verify: boom, ask: silentAsk });
  assert.equal(cap.calls(), 1);
  assert.notEqual(res.status, STATES.RUNNING);
  assert.notEqual(res.status, STATES.SUCCEEDED);
  assert.equal(res.status, STATES.NOT_VERIFIED);
  assert.deepEqual(res.receipt.evidence, { tx: 'X' });
  assert.equal(res.receipt.verification.verified, false);
  assert.match(res.receipt.verification.reason, /verifier exploded/);
});

test('F2: split requirements on same grant cannot exceed its max', async () => {
  const cap = {
    id: 'split-cap',
    required: () => ({
      spend: [
        { asset: 'USDC:test', amount: '400000', to: 'SAME' },
        { asset: 'USDC:test', amount: '400000', to: 'SAME' },
      ],
    }),
    perform: async () => {
      calls++;
      return { ok: true, evidence: {} };
    },
    calls: () => calls,
  };
  let calls = 0;
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(cap.calls(), 0);
  assert.equal(res.status, STATES.NEEDS_DECISION);
});

test('F2: same totals to different destinations stay separate groups', async () => {
  const cap = {
    id: 'split-cap-2',
    required: () => ({
      spend: [
        { asset: 'USDC:test', amount: '400000', to: 'AAA' },
        { asset: 'USDC:test', amount: '400000', to: 'BBB' },
      ],
    }),
    perform: async () => ({ ok: true, evidence: {} }),
  };
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(res.status, STATES.SUCCEEDED);
});

test('F3: receipt distinguishes preauthorized vs gate-approved vs gate-rejected', async () => {
  const pre = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const r1 = await runOperation(pre, fakeCapability({ ok: true, evidence: {} }), { verify: verifierOk, ask: silentAsk });
  assert.equal(r1.receipt.authority.approval, 'preauthorized');

  const gate = createOperation({ goal: 'demo', authority: { spend: [] } });
  const r2 = await runOperation(gate, fakeCapability({ ok: true, evidence: {} }), {
    verify: verifierOk,
    ask: async () => ({ approved: true }),
  });
  assert.equal(r2.receipt.authority.approval, 'human_gate_approved');

  const rej = createOperation({ goal: 'demo', authority: { spend: [] } });
  const r3 = await runOperation(rej, fakeCapability({ ok: true, evidence: {} }), { verify: verifierOk, ask: silentAsk });
  assert.equal(r3.status, STATES.NEEDS_DECISION);
  assert.equal(r3.receipt.authority.approval, 'human_gate_rejected');
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
