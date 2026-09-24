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

test('authority predicate rejects non-array requirements', () => {
  for (const requirements of [null, false, 0, '']) {
    assert.equal(sufficient(requirements, { spend: [] }).ok, false);
  }
});

test('A: without authority, perform is not called, NEEDS_HUMAN_DECISION', async () => {
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

test('a terminal operation is not replayed', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const io = { verify: verifierOk, ask: silentAsk };
  const first = await runOperation(op, cap, io);
  const second = await runOperation(op, cap, io);
  assert.equal(cap.calls(), 1);
  assert.deepEqual(second.receipt, first.receipt);
  assert.equal(second.status, first.status);
});

test('concurrent runs cannot double-execute one operation', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const first = runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => {
      await gate;
      return { approved: true };
    },
  });
  await assert.rejects(runOperation(op, cap, { verify: verifierOk, ask: silentAsk }), /already running/);
  release();
  const result = await first;
  assert.equal(result.status, STATES.SUCCEEDED);
  assert.equal(cap.calls(), 1);
});

test('settlement uncertainty keeps evidence and cannot be replayed', async () => {
  const cap = fakeCapability({
    ok: false,
    error: 'payment response lost after submit',
    settlementUnknown: true,
    evidence: { txHash: 'tx-unknown', payer: 'PAYER' },
  });
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const io = { verify: verifierOk, ask: silentAsk };
  const first = await runOperation(op, cap, io);
  assert.equal(first.status, STATES.NOT_VERIFIED);
  assert.deepEqual(first.receipt.evidence, { txHash: 'tx-unknown', payer: 'PAYER' });
  assert.equal(first.receipt.verification.verified, false);
  const second = await runOperation(op, cap, io);
  assert.deepEqual(second.receipt, first.receipt);
  assert.equal(cap.calls(), 1);
});

test('returns capability output separately from receipt evidence', async () => {
  const cap = fakeCapability({ ok: true, evidence: { txHash: 'X' }, output: { plan: 'delivered' } });
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const first = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.deepEqual(first.output, { plan: 'delivered' });
  assert.equal(first.receipt.evidence.output, undefined);
  const second = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.deepEqual(second.output, first.output);
});

test('missing capability evidence cannot become verified', async () => {
  let verified = 0;
  const cap = fakeCapability({ ok: true, evidence: null, output: { secret: true } });
  const res = await runOperation(createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') }), cap, {
    verify: async () => { verified++; return verifierOk(); },
    ask: silentAsk,
  });
  assert.equal(res.status, STATES.NOT_VERIFIED);
  assert.equal(res.receipt.verification.verified, false);
  assert.equal(res.output, null);
  assert.equal(verified, 0);
});

test('capability timeout becomes terminal not_verified without replay', async () => {
  let performs = 0;
  const cap = {
    id: 'timeout-cap',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '100000', to: 'RECEIVER' }] }),
    perform: async () => { performs++; return new Promise(() => {}); },
  };
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const io = { performTimeoutMs: 5, verify: verifierOk, ask: silentAsk };
  const first = await runOperation(op, cap, io);
  const second = await runOperation(op, cap, io);
  assert.equal(first.status, STATES.NOT_VERIFIED);
  assert.equal(first.receipt.verification.verified, false);
  assert.equal(second.receipt, first.receipt);
  assert.equal(performs, 1);
});

test('verifier timeout becomes terminal not_verified without replay', async () => {
  let performs = 0;
  const cap = {
    id: 'verify-timeout-cap',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '100000', to: 'RECEIVER' }] }),
    perform: async () => { performs++; return { ok: true, evidence: { tx: 'X' } }; },
  };
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const io = { verifyTimeoutMs: 5, verify: async () => new Promise(() => {}), ask: silentAsk };
  const first = await runOperation(op, cap, io);
  const second = await runOperation(op, cap, io);
  assert.equal(first.status, STATES.NOT_VERIFIED);
  assert.equal(first.receipt.verification.verified, false);
  assert.equal(second.receipt, first.receipt);
  assert.equal(performs, 1);
});

test('does not expose capability output before verification', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' }, output: { plan: 'unverified' } });
  const res = await runOperation(createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') }), cap, {
    verify: verifierNo,
    ask: silentAsk,
  });
  assert.equal(res.status, STATES.NOT_VERIFIED);
  assert.equal(res.output, null);
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

test('malformed verifier results fail closed and still produce a receipt', async () => {
  for (const result of [null, {}, { verified: 'yes' }]) {
    const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
    const res = await runOperation(createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') }), cap, {
      verify: async () => result,
      ask: silentAsk,
    });
    assert.equal(res.status, STATES.NOT_VERIFIED);
    assert.equal(res.receipt.status, 'not_verified');
    assert.equal(res.receipt.verification.verified, false);
    assert.equal(cap.calls(), 1);
  }
});

test('verified claims with malformed reasons fail closed', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const res = await runOperation(createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') }), cap, {
    verify: async () => ({ verified: true, reason: { secret: 'not-a-reason' }, checks: {} }),
    ask: silentAsk,
  });
  assert.equal(res.status, STATES.NOT_VERIFIED);
  assert.equal(res.receipt.verification.verified, false);
});

test('hostile capability metadata still produces a terminal receipt and blocks replay', async () => {
  let performs = 0;
  const cap = {
    get id() { throw new Error('id getter exploded'); },
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '100000', to: 'RECEIVER' }] }),
    perform: async () => { performs++; return { ok: true, evidence: { tx: 'X' } }; },
  };
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const first = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  const second = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(first.status, STATES.SUCCEEDED);
  assert.ok(first.receipt);
  assert.equal(second.receipt, first.receipt);
  assert.equal(performs, 1);
});

test('receipt metadata failure cannot expose verified state or output', async () => {
  let performs = 0;
  const cap = {
    id: 'metadata-cap',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '100000', to: 'RECEIVER' }] }),
    perform: async () => { performs++; return { ok: true, evidence: { tx: 'X' }, output: { secret: 'unverified' } }; },
  };
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  Object.defineProperty(op, 'id', { get() { throw new Error('operation id getter exploded'); } });
  const first = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  const second = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(first.status, STATES.NOT_VERIFIED);
  assert.equal(first.receipt.verification.verified, false);
  assert.equal(first.output, null);
  assert.equal(second.receipt, first.receipt);
  assert.equal(performs, 1);
});

test('hostile authority and requirement getters fail before side effects', async () => {
  const authority = new Proxy({}, { get() { throw new Error('authority getter exploded'); } });
  const requirement = new Proxy({}, { get() { throw new Error('requirement getter exploded'); } });
  let performs = 0;
  const cap = {
    id: 'hostile-input',
    required: () => ({ spend: [requirement] }),
    perform: async () => { performs++; return { ok: true, evidence: {} }; },
  };
  const res = await runOperation(createOperation({ goal: 'demo', authority }), cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(res.status, STATES.FAILED);
  assert.ok(res.receipt);
  assert.equal(performs, 0);
});

test('adversarial capability results fail closed with a terminal receipt', async () => {
  const badResult = new Proxy({}, { get() { throw new Error('result getter exploded'); } });
  const cap = {
    id: 'bad-result',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '100000', to: 'RECEIVER' }] }),
    perform: async () => badResult,
  };
  const res = await runOperation(createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') }), cap, {
    verify: verifierOk,
    ask: silentAsk,
  });
  assert.ok([STATES.FAILED, STATES.NOT_VERIFIED].includes(res.status));
  assert.ok(res.receipt);
  assert.match(res.receipt.detail || '', /result getter exploded|unknown error/);
});

test('hostile verifier errors do not escape receipt construction', async () => {
  const badError = new Proxy({}, { get() { throw new Error('error getter exploded'); } });
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const res = await runOperation(createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') }), cap, {
    verify: async () => { throw badError; },
    ask: silentAsk,
  });
  assert.equal(res.status, STATES.NOT_VERIFIED);
  assert.equal(res.receipt.verification.verified, false);
  assert.equal(res.receipt.verification.reason, 'verifier error: unknown error');
});

test('adversarial verifier getters fail closed with a terminal receipt', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const adversarial = new Proxy({}, { get() { throw new Error('verified getter exploded'); } });
  const res = await runOperation(createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') }), cap, {
    verify: async () => adversarial,
    ask: silentAsk,
  });
  assert.equal(res.status, STATES.NOT_VERIFIED);
  assert.equal(res.receipt.status, 'not_verified');
  assert.equal(res.receipt.verification.verified, false);
  assert.equal(cap.calls(), 1);
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

test('F2b: wildcard grant is not renewed per destination (400+400 vs 500 → insufficient)', async () => {
  let calls = 0;
  const cap = {
    id: 'split-cap-2',
    required: () => ({
      spend: [
        { asset: 'USDC:test', amount: '400000', to: 'AAA' },
        { asset: 'USDC:test', amount: '400000', to: 'BBB' },
      ],
    }),
    perform: async () => {
      calls++;
      return { ok: true, evidence: {} };
    },
  };
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(calls, 0);
  assert.equal(res.status, STATES.NEEDS_DECISION);
});

test('F2c: two destination-specific grants keep separate budgets', async () => {
  const cap = {
    id: 'split-cap-3',
    required: () => ({
      spend: [
        { asset: 'USDC:test', amount: '400000', to: 'AAA' },
        { asset: 'USDC:test', amount: '400000', to: 'BBB' },
      ],
    }),
    perform: async () => ({ ok: true, evidence: {} }),
  };
  const op = createOperation({
    goal: 'demo',
    authority: {
      spend: [
        { asset: 'USDC:test', maxAmount: '500000', to: 'AAA' },
        { asset: 'USDC:test', maxAmount: '500000', to: 'BBB' },
      ],
    },
  });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(res.status, STATES.SUCCEEDED);
});

test('F2d: exact boundary total == max stays sufficient', async () => {
  const cap = {
    id: 'split-cap-4',
    required: () => ({
      spend: [
        { asset: 'USDC:test', amount: '250000', to: 'AAA' },
        { asset: 'USDC:test', amount: '250000', to: 'BBB' },
      ],
    }),
    perform: async () => ({ ok: true, evidence: {} }),
  };
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(res.status, STATES.SUCCEEDED);
});

test('F3b: approval survives capability failure and throw', async () => {
  const pre = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const r1 = await runOperation(pre, fakeCapability({ ok: false, error: 'broke' }), { verify: verifierOk, ask: silentAsk });
  assert.equal(r1.status, STATES.FAILED);
  assert.equal(r1.receipt.authority.approval, 'preauthorized');

  const gate = createOperation({ goal: 'demo', authority: { spend: [] } });
  const r2 = await runOperation(gate, fakeCapability({ ok: false, error: 'broke' }), {
    verify: verifierOk,
    ask: async () => ({ approved: true }),
  });
  assert.equal(r2.status, STATES.FAILED);
  assert.equal(r2.receipt.authority.approval, 'human_gate_approved');

  const throwing = {
    id: 'throw-cap',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '100', to: 'T' }] }),
    perform: async () => {
      throw new Error('capability exploded');
    },
  };
  const gate2 = createOperation({ goal: 'demo', authority: { spend: [] } });
  const r3 = await runOperation(gate2, throwing, {
    verify: verifierOk,
    ask: async () => ({ approved: true }),
  });
  assert.equal(r3.status, STATES.FAILED);
  assert.equal(r3.receipt.authority.approval, 'human_gate_approved');
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

test('adversarial mix: zero-amount, three-way split, wildcard+specific interplay', async () => {
  // Zero-amount against a zero-max grant: covered (0 <= 0). Against NO grant at all: gate.
  const zero = {
    id: 'zero-cap',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '0', to: 'T' }] }),
    perform: async () => ({ ok: true, evidence: {} }),
  };
  const r0 = await runOperation(createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '0') }), zero, { verify: verifierOk, ask: silentAsk });
  assert.equal(r0.status, STATES.SUCCEEDED);
  const r0b = await runOperation(createOperation({ goal: 'demo', authority: { spend: [] } }), zero, { verify: verifierOk, ask: silentAsk });
  assert.equal(r0b.status, STATES.NEEDS_DECISION);

  // Three-way split 200+200+200 against wildcard 500 → insufficient (600 > 500).
  let calls = 0;
  const three = {
    id: 'three-cap',
    required: () => ({
      spend: [
        { asset: 'USDC:test', amount: '200', to: 'A' },
        { asset: 'USDC:test', amount: '200', to: 'B' },
        { asset: 'USDC:test', amount: '200', to: 'C' },
      ],
    }),
    perform: async () => {
      calls++;
      return { ok: true, evidence: {} };
    },
  };
  const r3 = await runOperation(createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500') }), three, {
    verify: verifierOk,
    ask: silentAsk,
  });
  assert.equal(calls, 0);
  assert.equal(r3.status, STATES.NEEDS_DECISION);

  // Wildcard 500 + specific-to-A 500, requirements A400 + B400:
  // A400 assigns to the specific grant, B400 to the wildcard — both covered.
  const mixed = {
    id: 'mixed-cap',
    required: () => ({
      spend: [
        { asset: 'USDC:test', amount: '400', to: 'A' },
        { asset: 'USDC:test', amount: '400', to: 'B' },
      ],
    }),
    perform: async () => ({ ok: true, evidence: {} }),
  };
  const rm = await runOperation(
    createOperation({
      goal: 'demo',
      authority: { spend: [{ asset: 'USDC:test', maxAmount: '500' }, { asset: 'USDC:test', maxAmount: '500', to: 'A' }] },
    }),
    mixed,
    { verify: verifierOk, ask: silentAsk }
  );
  assert.equal(rm.status, STATES.SUCCEEDED);
});

test('malformed authority becomes a decision boundary instead of throwing', async () => {
  const cases = [
    { spend: [{ asset: 'USDC:test', maxAmount: '', to: 'RECEIVER' }] },
    { spend: [{ asset: 'USDC:test', maxAmount: '-1', to: 'RECEIVER' }] },
    { spend: [{ asset: '', maxAmount: '500000', to: 'RECEIVER' }] },
    { spend: [{ asset: 'USDC:test', maxAmount: '500000', to: '' }] },
  ];
  for (const authority of cases) {
    const cap = fakeCapability({ ok: true, evidence: {} });
    const res = await runOperation(createOperation({ goal: 'demo', authority }), cap, { verify: verifierOk, ask: silentAsk });
    assert.equal(res.status, STATES.NEEDS_DECISION);
    assert.equal(cap.calls(), 0);
  }
});

test('malformed authority shape still returns a receipt', async () => {
  const cap = fakeCapability({ ok: true, evidence: {} });
  const res = await runOperation(
    createOperation({ goal: 'demo', authority: { spend: 'not-an-array' } }),
    cap,
    { verify: verifierOk, ask: silentAsk },
  );
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.deepEqual(res.receipt.authority.grants, []);
  assert.equal(cap.calls(), 0);
});

test('human approval cannot authorize an invalid requirement', async () => {
  const cap = {
    id: 'invalid-effect',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '-1', to: 'RECEIVER' }] }),
    perform: async () => ({ ok: true, evidence: {} }),
  };
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: async () => ({ approved: true }) });
  assert.equal(res.status, STATES.FAILED);
  assert.match(res.receipt.detail, /invalid spend/);
});

test('approved invalid requirements return a failed receipt without throwing', async () => {
  let performed = 0;
  const cap = {
    id: 'null-requirement',
    required: () => ({ spend: [null] }),
    perform: async () => { performed++; return { ok: true, evidence: {} }; },
  };
  const res = await runOperation(createOperation({ goal: 'demo', authority: { spend: [] } }), cap, {
    verify: verifierOk,
    ask: async () => ({ approved: true }),
  });
  assert.equal(res.status, STATES.FAILED);
  assert.equal(res.receipt.status, 'failed');
  assert.equal(performed, 0);
});

test('adversarial human gate getters return a terminal decision receipt', async () => {
  const cap = fakeCapability({ ok: true, evidence: {} });
  const gate = new Proxy({}, { get() { throw new Error('approved getter exploded'); } });
  const res = await runOperation(createOperation({ goal: 'demo', authority: { spend: [] } }), cap, {
    verify: verifierOk,
    ask: async () => gate,
  });
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(res.receipt.status, 'needs_human_decision');
  assert.equal(cap.calls(), 0);
});

test('async or missing required contracts fail closed', async () => {
  for (const required of [async () => ({ spend: [] }), () => ({})]) {
    let performed = 0;
    const cap = { id: 'bad-required', required, perform: async () => { performed++; return { ok: true, evidence: {} }; } };
    const res = await runOperation(createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') }), cap, { verify: verifierOk, ask: silentAsk });
    assert.equal(res.status, STATES.FAILED);
    assert.equal(performed, 0);
    assert.match(res.receipt.detail, /spend/);
  }
});

test('a non-array spend requirement returns a failed receipt before the gate', async () => {
  const cap = {
    id: 'bad-shape',
    required: () => ({ spend: 'not-an-array' }),
    perform: async () => ({ ok: true, evidence: {} }),
  };
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(res.status, STATES.FAILED);
  assert.match(res.receipt.detail, /spend array|requirements must be an array/);
});

test('empty spend requirements cannot execute an undeclared capability', async () => {
  let performs = 0;
  const cap = {
    id: 'empty-effect',
    required: () => ({ spend: [] }),
    perform: async () => { performs++; return { ok: true, evidence: {} }; },
  };
  const res = await runOperation(createOperation({ goal: 'demo', authority: {} }), cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(performs, 0);
});

test('a capability contract error returns a failed receipt before execution', async () => {
  const cap = {
    id: 'broken-cap',
    required: () => { throw new Error('invalid contract'); },
    perform: async () => ({ ok: true, evidence: {} }),
  };
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: silentAsk });
  assert.equal(res.status, STATES.FAILED);
  assert.match(res.receipt.detail, /invalid contract/);
});

test('receipts drop unrecognized evidence fields', () => {
  const receipt = buildReceipt({
    operation: { id: 'op-1', goal: 'demo' },
    capabilityId: 'cap',
    authority: { spend: [] },
    outcome: { status: 'verified', exercised: [], detail: 'ok' },
    evidence: { secret: 'DO_NOT_PERSIST', txHash: 'tx-1' },
    verification: { verified: true, checks: {}, reason: 'ok' },
  });
  assert.deepEqual(receipt.evidence, { txHash: 'tx-1' });
});

test('kernel needs no specific capability to load', () => {
  // Runs inside C:\Vespi, which has no node_modules/@x402. If src required it, this file would not even load.
  assert.ok(typeof runOperation === 'function');
  assert.ok(typeof sufficient === 'function');
  assert.ok(typeof buildReceipt === 'function');
});

test('human gate exceptions return a decision boundary receipt', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const res = await runOperation(createOperation({ goal: 'demo', authority: { spend: [] } }), cap, {
    verify: verifierOk,
    ask: async () => { throw new Error('gate unavailable'); },
  });
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(res.receipt.status, 'needs_human_decision');
  assert.match(res.receipt.detail, /gate unavailable/);
  assert.equal(cap.calls(), 0);
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

test('provenance: missing human decider records no human decision', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, cap, { verify: verifierOk });
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(res.receipt.authority.approval, 'human_gate_no_decision');
  const undecided = await runOperation(createOperation({ goal: 'demo', authority: { spend: [] } }), cap, { ask: async () => ({}) });
  assert.equal(undecided.receipt.authority.approval, 'human_gate_no_decision');
  assert.notEqual(res.receipt.authority.approval, 'human_gate_rejected');
  assert.equal(cap.calls(), 0);
});

test('provenance: explicit human rejection remains a rejection', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  let asks = 0;
  const res = await runOperation(op, cap, {
    ask: async () => {
      asks++;
      return { approved: false };
    },
  });
  assert.equal(asks, 1);
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(res.receipt.authority.approval, 'human_gate_rejected');
  assert.equal(cap.calls(), 0);
});

test('provenance: explicit human approval survives final verification outcome', async () => {
  const cap = fakeCapability({ ok: true, evidence: { tx: 'X' } });
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  let asks = 0;
  const res = await runOperation(op, cap, {
    ask: async () => {
      asks++;
      return { approved: true };
    },
    verify: verifierNo,
  });
  assert.equal(asks, 1);
  assert.equal(cap.calls(), 1);
  assert.equal(res.status, STATES.NOT_VERIFIED);
  assert.equal(res.receipt.authority.approval, 'human_gate_approved');
});
