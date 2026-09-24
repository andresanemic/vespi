import test from 'node:test';
import assert from 'node:assert/strict';
import { claimSettlement, claimTransaction, classifySettlement } from './capability.js';

const valid = {
  success: true,
  transaction: 'tx-1',
  payer: 'PAYER',
  network: 'stellar:testnet',
  amount: '100000',
};

test('classifies a complete exact settlement response', () => {
  const result = classifySettlement(valid);
  assert.equal(result.status, 'settled');
  assert.deepEqual(result.evidence, {
    txHash: 'tx-1',
    payer: 'PAYER',
    network: 'stellar:testnet',
    amount: '100000',
  });
});

test('does not classify incomplete or mismatched settlement as settled', () => {
  for (const response of [
    { ...valid, network: 'stellar:pubnet' },
    { ...valid, amount: '200000' },
    { ...valid, transaction: '' },
    { ...valid, payer: '' },
    { ...valid, success: false },
  ]) {
    assert.equal(classifySettlement(response).status, 'unknown');
  }
});

test('claims an incomplete settlement hash to prevent retrying a submitted payment', () => {
  const hash = `tx-incomplete-${Date.now()}-${Math.random()}`;
  assert.equal(claimSettlement({ transaction: hash }), true);
  assert.equal(claimSettlement({ transaction: hash }), false);
});

test('claims a transaction hash only once in the current process', () => {
  const hash = `tx-guard-${Date.now()}-${Math.random()}`;
  assert.equal(claimTransaction(hash), true);
  assert.equal(claimTransaction(hash), false);
});
