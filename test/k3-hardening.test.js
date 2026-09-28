'use strict';
// K3 hardening (orchestrator review, R42, principle 7 of Vespi): an anchor is only "anchored" once a verifier
// confirmed it on the network; a failed check never counts as coverage; async adapters (real networks) work.
const { test } = require('node:test');
const assert = require('node:assert');
const receiptMod = require('../src/receipt.js');

const spec = (checks) => ({
  operation: { id: 'op-1', goal: 'g' }, capabilityId: 'c', authority: { spend: [] },
  outcome: { status: 'verified', exercised: [] }, evidence: { txHash: 'x' },
  verification: { verified: true, checks, reason: 'ok' },
});

test('K3-H1: a txHash without on-chain verification is "submitted", never "anchored"', () => {
  const out = receiptMod.anchorReceipt(receiptMod.buildReceipt(spec({ a: true })), () => ({ network: 'stellar-testnet', txHash: 'tx1' }));
  assert.equal(out.anchor.status, 'submitted');
  assert.ok(out.notCovered.includes('external anchor'));
  assert.equal(receiptMod.verifyReceipt(out).ok, true);
});

test('K3-H2: "anchored" only when the verifier confirms the digest in that transaction', () => {
  const r = receiptMod.buildReceipt(spec({ a: true }));
  const ok = receiptMod.anchorReceipt(r, () => ({ network: 'stellar-testnet', txHash: 'tx1' }), (txHash, digest) => txHash === 'tx1' && digest === r.digest);
  assert.equal(ok.anchor.status, 'anchored');
  assert.ok(!ok.notCovered.includes('external anchor'));
  const bad = receiptMod.anchorReceipt(r, () => ({ network: 'stellar-testnet', txHash: 'tx1' }), () => false);
  assert.equal(bad.anchor.status, 'submitted');
});

test('K3-H3: failed checks are not coverage; they are listed as not covered', () => {
  const r = receiptMod.buildReceipt(spec({ signature: true, amount: false }));
  assert.deepEqual(r.coverage, ['signature']);
  assert.ok(r.notCovered.includes('amount'));
});

test('K3-H4: an async adapter (a real network) can anchor through anchorReceiptAsync', async () => {
  const r = receiptMod.buildReceipt(spec({ a: true }));
  const out = await receiptMod.anchorReceiptAsync(r, async () => ({ network: 'stellar-testnet', txHash: 'tx2' }), async () => true);
  assert.equal(out.anchor.status, 'anchored');
  const pending = await receiptMod.anchorReceiptAsync(r, async () => { throw new Error('network down'); });
  assert.equal(pending.anchor.status, 'pending');
});
