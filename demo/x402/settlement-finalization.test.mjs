import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeSettlement, withAuthDigest } from './capability.js';

const settle = {
  success: true,
  transaction: 'tx-1',
  payer: 'PAYER',
  network: 'stellar:testnet',
  amount: '100000',
};

test('keeps a settled response verifiable when the HTTP body is unavailable', async () => {
  const result = await finalizeSettlement({
    settle,
    status: 200,
    readBody: async () => { throw new Error('malformed body'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.settlementUnknown, true);
  assert.deepEqual(result.evidence, { txHash: 'tx-1', payer: 'PAYER', network: 'stellar:testnet', amount: '100000' });
});

test('retains settlement evidence for a non-200 paid response', async () => {
  const result = await finalizeSettlement({ settle, status: 503, readBody: async () => ({}) });
  assert.equal(result.ok, false);
  assert.equal(result.settlementUnknown, true);
  assert.equal(result.evidence.txHash, 'tx-1');
});

test('keeps the auth digest when merging settlement evidence', () => {
  assert.deepEqual(withAuthDigest({ txHash: 'tx-1' }, 'auth-digest'), {
    txHash: 'tx-1',
    authDigest: 'auth-digest',
  });
});

const plan = {
  title: 'AI BORA Marketing Plan',
  summary: 'A test plan.',
  deliverables: ['Landing page'],
  nextSteps: ['Launch'],
  secret: 'do-not-retain',
};

test('returns only a digest for a successfully delivered body', async () => {
  const result = await finalizeSettlement({ settle, status: 200, readBody: async () => plan });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.txHash, 'tx-1');
  assert.match(result.evidence.planDigest, /^[a-f0-9]{64}$/);
  assert.equal('plan' in result.evidence, false);
  assert.deepEqual(result.output, plan);
});

test('rejects a null or malformed marketing plan', async () => {
  for (const body of [null, {}, { title: 'only' }]) {
    const result = await finalizeSettlement({ settle, status: 200, readBody: async () => body });
    assert.equal(result.ok, false);
    assert.equal(result.settlementUnknown, true);
  }
});
