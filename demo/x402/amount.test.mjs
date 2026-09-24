import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsdc } from './amount.js';

test('converts decimal USDC to exact atomic units', () => {
  assert.equal(parseUsdc('0'), '0');
  assert.equal(parseUsdc('0.05'), '500000');
  assert.equal(parseUsdc('0.0100000'), '100000');
});

test('rejects invalid monetary CLI values', () => {
  for (const value of ['', 'abc', '-1', '1e-2', '0.00000001', '1'.repeat(33)]) {
    assert.throws(() => parseUsdc(value), /max USDC/);
  }
});
