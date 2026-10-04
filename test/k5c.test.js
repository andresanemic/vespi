'use strict';
// K5c (orchestrator, Raven review + K6): corrections requested by R1 before kernel 0.1.4.
// Every test here was written first and watched fail.
const { test } = require('node:test');
const assert = require('node:assert');

const { buildReceipt, verifyReceipt, anchorReceipt, anchorReceiptAsync } = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');

const SPANISH = /[áéíóúüñ¿¡]|\bretoma\b|\bdescartados\b|\bdescarte\b|\breanuda\b|\bpersonas\b|\bnecesita\b/i;

// The operation id is the action name here so this file isolates the message language; the
// matching by action has its own test below, with receipts the kernel really produces.
const verifiedReceipt = (action) => buildReceipt({
  operation: { id: action, goal: 'demo', action },
  capabilityId: 'cap-k5c',
  authority: { spend: [] },
  outcome: { status: 'verified', exercised: [], detail: 'ok' },
  evidence: { txHash: `tx-${action}` },
  verification: { verified: true, checks: { mock: true }, reason: 'mock ok' },
});

// 1. The happy path of resumeFromReceipts speaks English like every other kernel message.
test('K5c-1: the resume happy path answers in English', () => {
  const out = resumeFromReceipts(
    [verifiedReceipt('step-1')],
    { approved: [{ action: 'step-1', localReversible: true }, { action: 'step-2' }] },
    { verifyLocal: () => true },
  );
  assert.equal(out.nextAction.action, 'step-2');
  assert.equal(out.needsPerson, false);
  assert.doesNotMatch(out.reason, SPANISH);
  assert.match(out.reason, /step-2/);
});

// 2. The anchor names the network the way Stellar names it (CAIP-2), and only those two.
const CAIP = { TESTNET: 'stellar:testnet', PUBNET: 'stellar:pubnet' };
const anchorable = () => buildReceipt({
  operation: { id: 'op-2', goal: 'demo' },
  capabilityId: 'cap-k5c',
  authority: { spend: [] },
  outcome: { status: 'verified', exercised: [], detail: 'ok' },
  evidence: { txHash: 'tx-2' },
  verification: { verified: true, checks: { mock: true }, reason: 'mock ok' },
});

test('K5c-2: a receipt that reached no network waits as pending on stellar:testnet', () => {
  const out = anchorReceipt(anchorable());
  assert.equal(out.anchor.status, 'pending');
  assert.equal(out.anchor.network, CAIP.TESTNET);
  assert.ok(out.notCovered.includes('external anchor'));
});

test('K5c-3: mainnet is a network the kernel accepts', () => {
  const out = anchorReceipt(anchorable(), () => ({ network: CAIP.PUBNET, txHash: 'tx-main' }), () => true);
  assert.equal(out.anchor.status, 'anchored');
  assert.equal(out.anchor.network, CAIP.PUBNET);
  assert.equal(verifyReceipt(out).ok, true);
});

test('K5c-4: a network that is not a Stellar CAIP-2 id never leaves pending', () => {
  for (const network of ['stellar-testnet', 'soroban:testnet', 'horizon-testnet', 'testnet', 'stellar:futurenet', '']) {
    const out = anchorReceipt(anchorable(), () => ({ network, txHash: 'tx-x' }), () => true);
    assert.equal(out.anchor.status, 'pending', `network=${JSON.stringify(network)}`);
    assert.equal(out.anchor.network, CAIP.TESTNET, `network=${JSON.stringify(network)}`);
    assert.ok(out.notCovered.includes('external anchor'), `network=${JSON.stringify(network)}`);
  }
});

// 3. The anchor verification confirms the network too: the network passphrase is part of what
// Stellar signs, so a testnet anchor cannot be presented as a mainnet one.
test('K5c-5: a verifier that confirms only the testnet anchors the testnet, never mainnet', () => {
  const confirmsTestnetOnly = (txHash, digest, network) => network === CAIP.TESTNET && txHash === 'tx-t';
  const onTestnet = anchorReceipt(anchorable(), () => ({ network: CAIP.TESTNET, txHash: 'tx-t' }), confirmsTestnetOnly);
  assert.equal(onTestnet.anchor.status, 'anchored');
  const onMainnet = anchorReceipt(anchorable(), () => ({ network: CAIP.PUBNET, txHash: 'tx-t' }), confirmsTestnetOnly);
  assert.equal(onMainnet.anchor.status, 'submitted');
  assert.notEqual(onMainnet.anchor.status, 'anchored');
  assert.ok(onMainnet.notCovered.includes('external anchor'));
  assert.equal(verifyReceipt(onMainnet).ok, true);
});

test('K5c-7: the async path holds the same network contract', async () => {
  const ok = await anchorReceiptAsync(anchorable(), async () => ({ network: CAIP.PUBNET, txHash: 'tx-main' }), async (txHash, digest, network) => network === CAIP.PUBNET);
  assert.equal(ok.anchor.status, 'anchored');
  const wrong = await anchorReceiptAsync(anchorable(), async () => ({ network: CAIP.PUBNET, txHash: 'tx-main' }), async (txHash, digest, network) => network === CAIP.TESTNET);
  assert.equal(wrong.anchor.status, 'submitted');
  const bad = await anchorReceiptAsync(anchorable(), async () => ({ network: 'stellar-testnet', txHash: 'tx-x' }), async () => true);
  assert.equal(bad.anchor.status, 'pending');
});

// A1: the exercised amount has to survive into the receipt; it is the only number that says how
// much was spent.
const { createOperation, runOperation, pauseOperation } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');

const SPEND_CAP = {
  id: 'cap-spend',
  required: () => ({ spend: [{ asset: 'USDC:test', amount: '100000', to: 'RECEIVER' }] }),
  perform: async () => ({ ok: true, evidence: { txHash: 'tx-9' } }),
};
const verifyOk = async () => ({ verified: true, checks: { txExists: true }, reason: 'mock ok' });

test('K5c-8: a preauthorized receipt records how much was exercised', async () => {
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000', 'RECEIVER') });
  const res = await runOperation(op, SPEND_CAP, { verify: verifyOk });
  assert.equal(res.status, 'verified');
  assert.deepEqual(res.receipt.authority.exercised, [
    { asset: 'USDC:test', maxAmount: '100000', to: 'RECEIVER' },
  ]);
});

test('K5c-9: a gate-approved receipt records how much was exercised too', async () => {
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, SPEND_CAP, { verify: verifyOk, ask: async () => ({ approved: true, by: 'ana' }) });
  assert.equal(res.status, 'verified');
  assert.deepEqual(res.receipt.authority.exercised, [
    { asset: 'USDC:test', maxAmount: '100000', to: 'RECEIVER' },
  ]);
  assert.deepEqual(res.receipt.authority.grants, [
    { asset: 'USDC:test', maxAmount: '100000', to: 'RECEIVER' },
  ]);
});

// A2: continuity has to be able to pair a receipt the kernel really produces with an agreement
// that names the step. The receipt is what carries the action.
test('K5c-10: a receipt from runOperation resumes the agreement it names', async () => {
  const op = createOperation({ goal: 'demo', action: 'pay-invoice', authority: grantSpend('USDC:test', '500000', 'RECEIVER') });
  const res = await runOperation(op, SPEND_CAP, { verify: verifyOk });
  const out = resumeFromReceipts(
    [anchorReceipt(res.receipt, () => ({ network: 'stellar:testnet', txHash: 'tx-pay' }), () => true)],
    { approved: [{ action: 'pay-invoice' }, { action: 'send-report' }] },
    { verifyExternal: (txHash, digest, network) => txHash === 'tx-pay' && typeof digest === 'string' && network === 'stellar:testnet' },
  );
  assert.equal(out.discarded, 0);
  assert.equal(out.needsPerson, false);
  assert.equal(out.nextAction.action, 'send-report');
  assert.equal(out.lastState, 'verified');
});

test('K5c-11: an operation that declares no action cannot be paired, and says so', async () => {
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000', 'RECEIVER') });
  const res = await runOperation(op, SPEND_CAP, { verify: verifyOk });
  const out = resumeFromReceipts(
    [res.receipt],
    { approved: [{ action: 'pay-invoice' }] },
  );
  assert.equal(out.needsPerson, true);
  assert.equal(out.nextAction, null);
});

// M1: a receipt that says a human gate approved has to say who approved.
test('K5c-12: the receipt names the person whose approval let the operation run', async () => {
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, SPEND_CAP, { verify: verifyOk, ask: async () => ({ approved: true, by: 'ana' }) });
  assert.equal(res.status, 'verified');
  assert.equal(res.receipt.authority.approval, 'human_gate_approved');
  assert.equal(res.receipt.decidedBy, 'ana');
});

test('K5c-13: the multi-signer gate names every person who approved', async () => {
  const op = createOperation({ goal: 'demo', authority: { spend: [], signers: { required: 2, allowed: ['ana', 'bob'] } } });
  const res = await runOperation(op, SPEND_CAP, {
    verify: verifyOk,
    ask: async () => ({ approved: true, approvals: [{ by: 'ana' }, { by: 'bob' }] }),
  });
  assert.equal(res.status, 'verified');
  assert.equal(res.receipt.decidedBy, 'ana, bob');
});

test('K5c-14: one identity is still one identity when the gate claims otherwise', async () => {
  const op = createOperation({ goal: 'demo', authority: { spend: [], signers: { required: 2, allowed: ['ana', 'bob'] } } });
  const res = await runOperation(op, SPEND_CAP, {
    verify: verifyOk,
    ask: async () => ({ approved: true, approvals: [{ by: 'ana' }, { by: 'ana' }] }),
  });
  assert.equal(res.status, 'needs_human_decision');
  assert.match(res.receipt.detail, /missing 1 approval/);
  assert.equal(res.receipt.decidedBy, 'ana');
});

// M4: the gate rewrites the granted spend, and it must not take the rest of the authority with it.
test('K5c-15: a gate approval does not erase who can pause', async () => {
  const op = createOperation({ goal: 'demo', authority: { spend: [], pausers: ['ana', 'beto'] } });
  const res = await runOperation(op, SPEND_CAP, { verify: verifyOk, ask: async () => ({ approved: true, by: 'carla' }) });
  assert.equal(res.status, 'verified');
  assert.deepEqual(op.authority.pausers, ['ana', 'beto']);
  assert.deepEqual(op.authority.spend, [{ asset: 'USDC:test', maxAmount: '100000', to: 'RECEIVER' }]);
});

test('K5c-16: a multi-signer approval does not erase who can pause either', async () => {
  const op = createOperation({
    goal: 'demo',
    authority: { spend: [], pausers: ['ana', 'beto'], signers: { required: 2, allowed: ['ana', 'bob'] } },
  });
  const res = await runOperation(op, SPEND_CAP, {
    verify: verifyOk,
    ask: async () => ({ approved: true, approvals: [{ by: 'ana' }, { by: 'bob' }] }),
  });
  assert.equal(res.status, 'verified');
  assert.deepEqual(op.authority.pausers, ['ana', 'beto']);
  assert.deepEqual(op.authority.signers, { required: 2, allowed: ['ana', 'bob'] });
});

// M2: the written contract and the code disagreed about when the gate opens. The code is the one
// K2 pins (a declared multi-signer authority is always asked for), so this test states the
// contract the kernel actually keeps, in the only language that cannot drift silently.
test('K5c-17: a covering grant runs silently; a declared signers authority is always asked for', async () => {
  let silentAsks = 0;
  const covered = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000', 'RECEIVER') });
  const ran = await runOperation(covered, SPEND_CAP, { verify: verifyOk, ask: async () => { silentAsks++; return { approved: true, by: 'ana' }; } });
  assert.equal(ran.status, 'verified');
  assert.equal(silentAsks, 0, 'a grant that already covers the spend is not put to the person');

  let signedAsks = 0;
  const declared = createOperation({
    goal: 'demo',
    authority: { spend: [{ asset: 'USDC:test', maxAmount: '500000', to: 'RECEIVER' }], signers: { required: 1, allowed: ['ana'] } },
  });
  const gated = await runOperation(declared, SPEND_CAP, { verify: verifyOk, ask: async () => { signedAsks++; return { approved: true }; } });
  assert.equal(signedAsks, 1, 'a declared signers authority asks even when the grant covers it');
  assert.equal(gated.status, 'needs_human_decision', 'and an approval that names nobody is not one');
});
