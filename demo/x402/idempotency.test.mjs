import test from 'node:test';
import assert from 'node:assert/strict';
import { claimPayment } from './idempotency.js';

test('claims a payment header only once in the current process', () => {
  const header = `payment-${Date.now()}-${Math.random()}`;
  assert.equal(claimPayment(header), 'claimed');
  assert.equal(claimPayment(header), 'duplicate');
});

test('rejects oversized payment headers without claiming them', () => {
  assert.equal(claimPayment('x'.repeat(16_385)), 'invalid');
});

test('does not claim requests without a payment header', () => {
  assert.equal(claimPayment(undefined), 'absent');
  assert.equal(claimPayment(''), 'absent');
});
