'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const verifierModule = import('../scripts/verify-testnet-evidence.mjs');

const expected = {
  operation: 'payment',
  memo: 'vespi-case-1',
  asset: { type: 'native' },
  amount: '2.5000000',
  recipient: 'GRECIPIENT',
};

function horizonTransaction(patch = {}) {
  return {
    successful: true,
    memo: expected.memo,
    ...patch,
  };
}

function horizonResponse(transaction = horizonTransaction(), operations = [{ type: 'payment', asset_type: 'native', amount: expected.amount, to: expected.recipient }]) {
  return { transaction, operations };
}

test('evidence verifier rejects a successful transaction with a different operation, memo, asset, amount, or recipient', async () => {
  const { verifyTransactionEvidence } = await verifierModule;
  const cases = [
    ['operation', horizonResponse(horizonTransaction(), [{ type: 'create_account', asset_type: 'native', amount: expected.amount, to: expected.recipient }])],
    ['memo', horizonResponse(horizonTransaction({ memo: 'other' }))],
    ['asset', horizonResponse(horizonTransaction(), [{ type: 'payment', asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: 'GISSUER', amount: expected.amount, to: expected.recipient }])],
    ['amount', horizonResponse(horizonTransaction(), [{ type: 'payment', asset_type: 'native', amount: '9', to: expected.recipient }])],
    ['recipient', horizonResponse(horizonTransaction(), [{ type: 'payment', asset_type: 'native', amount: expected.amount, to: 'GOTHER' }])],
  ];

  for (const [field, response] of cases) {
    const result = verifyTransactionEvidence(response, expected, '2040-01-01T00:00:00.000Z');
    assert.equal(result.ok, false, `${field} mismatch must fail semantic verification`);
    assert.equal(result.field, field);
  }
});

test('evidence verifier accepts exact expected transaction facts and marks stored response as historical', async () => {
  const { verifyTransactionEvidence } = await verifierModule;
  const result = verifyTransactionEvidence(horizonResponse(), expected, '2040-01-01T00:00:00.000Z');
  assert.equal(result.ok, true);
  assert.equal(result.historical_response.classification, 'historical_readback');
  assert.equal(result.historical_response.captured_at, '2040-01-01T00:00:00.000Z');
});

test('network reads are injected so evidence verification tests never reach Horizon', async () => {
  const { verifyEvidence } = await verifierModule;
  const calls = [];
  const results = await verifyEvidence([{ hash: 'a'.repeat(64), expected }], async (hash) => {
    calls.push(hash);
    return horizonResponse();
  }, '2040-01-01T00:00:00.000Z');

  assert.deepEqual(calls, ['a'.repeat(64)]);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].historical_response.classification, 'historical_readback');
});

test('cases without declared expected facts are rejected before any network read', async () => {
  const { verifyEvidence } = await verifierModule;
  let reads = 0;
  await assert.rejects(
    verifyEvidence([{ hash: 'b'.repeat(64) }], async () => { reads += 1; return horizonResponse(); }),
    /expected.*operation.*memo.*asset.*amount.*recipient/i,
  );
  assert.equal(reads, 0);
});
