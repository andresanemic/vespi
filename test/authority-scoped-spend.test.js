'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sufficient } = require('../src/authority.js');
const { createOperation } = require('../src/operation.js');

test('a scoped spend grant cannot authorize another network or resource', () => {
  const requirement = { asset: 'USDC', amount: '1', to: 'recipient', network: 'stellar:testnet', resource: 'https://example.test/pay' };
  const grant = { ...requirement, maxAmount: '1' };
  for (const mismatch of [{ network: 'stellar:pubnet' }, { resource: 'https://other.test/pay' }]) {
    assert.equal(sufficient([requirement], { spend: [{ ...grant, ...mismatch }] }).ok, false);
  }
  assert.equal(sufficient([requirement], { spend: [grant] }).ok, true);
  assert.equal(sufficient([requirement], { spend: [{ asset: 'USDC', maxAmount: '1', to: 'recipient' }] }).ok, true);
  assert.equal(sufficient([{ asset: 'USDC', amount: '1', to: 'recipient' }], { spend: [grant] }).ok, false);
});

test('creating an operation preserves grant scope instead of widening it', () => {
  const op = createOperation({ goal: 'scoped payment', authority: { spend: [{ asset: 'USDC', maxAmount: '1', to: 'recipient', network: 'stellar:testnet', resource: 'https://a.test/pay' }] } });
  assert.equal(sufficient([{ asset: 'USDC', amount: '1', to: 'recipient', network: 'stellar:pubnet', resource: 'https://b.test/pay' }], op.authority).ok, false);
  assert.equal(op.authority.spend[0].network, 'stellar:testnet');
  assert.equal(op.authority.spend[0].resource, 'https://a.test/pay');
});
