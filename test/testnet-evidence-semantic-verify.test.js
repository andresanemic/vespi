'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const verifierModule = import('../scripts/verify-testnet-evidence.mjs');

const CAPTURED_AT = '2040-01-01T00:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const SOROBAN_EXPECTED = {
  operation: 'invoke_host_function',
  memo: null,
  asset: { type: 'credit_alphanum4', code: 'USDC', issuer: 'GISSUER' },
  amount: '0.0100000',
  recipient: 'GRECIPIENT',
};

function transfer(patch = {}) {
  return { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GISSUER', type: 'transfer', from: 'GFROM', to: 'GRECIPIENT', amount: '0.0100000', ...patch };
}

function sorobanResponse(changes = [transfer()], transaction = { successful: true }) {
  return { transaction, operations: [{ type: 'invoke_host_function', asset_balance_changes: changes }] };
}

const CLASSIC_EXPECTED = { operation: 'payment', memo: null, asset: { type: 'native' }, amount: '2.5000000', recipient: 'GRECIPIENT' };

test('F1b-V1: a Soroban token transfer verifies against the balance change it carries', async () => {
  const { verifyTransactionEvidence } = await verifierModule;
  const result = verifyTransactionEvidence(sorobanResponse(), SOROBAN_EXPECTED, CAPTURED_AT);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.historical_response.classification, 'historical_readback');
});

test('F1b-V2: a Soroban transfer of another asset, amount or recipient still fails on that field', async () => {
  const { verifyTransactionEvidence } = await verifierModule;
  const cases = [
    ['asset', sorobanResponse([transfer({ asset_code: 'EUR', asset_issuer: 'GOTHER' })])],
    ['amount', sorobanResponse([transfer({ amount: '9.0000000' })])],
    ['recipient', sorobanResponse([transfer({ to: 'GNOTTHERE' })])],
    ['asset', sorobanResponse([transfer({ asset_issuer: 'GOTHER' })])],
  ];
  for (const [field, response] of cases) {
    const result = verifyTransactionEvidence(response, SOROBAN_EXPECTED, CAPTURED_AT);
    assert.equal(result.ok, false, `${field} mismatch must fail`);
    assert.equal(result.field, field);
  }
});

test('F1b-V3: a balance change for a different account cannot satisfy the expected recipient', async () => {
  const { verifyTransactionEvidence } = await verifierModule;
  const response = sorobanResponse([transfer({ to: 'GSOMEONEELSE' }), transfer({ to: 'GSOMEONEELSE2' })]);
  const result = verifyTransactionEvidence(response, SOROBAN_EXPECTED, CAPTURED_AT);
  assert.equal(result.ok, false);
  assert.equal(result.field, 'recipient');
});

test('F1b-V4: classic payment operations keep verifying exactly as before', async () => {
  const { verifyTransactionEvidence } = await verifierModule;
  const ok = verifyTransactionEvidence({
    transaction: { successful: true, memo: null },
    operations: [{ type: 'payment', asset_type: 'native', amount: '2.5000000', to: 'GRECIPIENT' }],
  }, CLASSIC_EXPECTED, CAPTURED_AT);
  assert.equal(ok.ok, true);
  const wrong = verifyTransactionEvidence({
    transaction: { successful: true, memo: null },
    operations: [{ type: 'payment', asset_type: 'native', amount: '2.5000000', to: 'GOTHER' }],
  }, CLASSIC_EXPECTED, CAPTURED_AT);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.field, 'recipient');
});

test('F1b-V5: a mixed evidence file verifies the declared case and reports the rest as not semantically verified', async () => {
  const { verifyEvidenceSet } = await verifierModule;
  const results = await verifyEvidenceSet([
    { hash: HASH_A, expected: CLASSIC_EXPECTED },
    { hash: HASH_B, expectedFrom: null },
  ], async (hash) => (hash === HASH_A
    ? { transaction: { successful: true, memo: null }, operations: [{ type: 'payment', asset_type: 'native', amount: '2.5000000', to: 'GRECIPIENT' }] }
    : { transaction: { successful: true, memo: 'other' }, operations: [{ type: 'payment', asset_type: 'native', amount: '1.0000000', to: 'GANY' }] }), CAPTURED_AT);

  assert.equal(results.length, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, null, 'a case with no local expectation is not verified and not failed either');
  assert.equal(results[1].field, 'expected');
  assert.match(results[1].reason, /local|record|expected/i);
  assert.equal(results[1].historical_response.classification, 'historical_readback', 'its readback is still kept for review');
});

test('F1b-V6: a readback that cannot be fetched marks that case unread and leaves the others verified', async () => {
  const { verifyEvidenceSet } = await verifierModule;
  const results = await verifyEvidenceSet([
    { hash: HASH_A, expected: CLASSIC_EXPECTED },
    { hash: HASH_B, expected: CLASSIC_EXPECTED },
  ], async (hash) => {
    if (hash === HASH_B) throw new Error('Horizon 504');
    return { transaction: { successful: true, memo: null }, operations: [{ type: 'payment', asset_type: 'native', amount: '2.5000000', to: 'GRECIPIENT' }] };
  }, CAPTURED_AT);

  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, null);
  assert.equal(results[1].field, 'readback');
  assert.match(results[1].reason, /Horizon 504/);
  assert.equal(results[1].historical_response, null);
});