'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperation, runOperation } = require('../src/operation.js');
const manifest = () => ({ manifestDigest: 'c'.repeat(64), scope: 'nc1', sources: [{ ref: 'rule', owner: 'a', revision: '1', state: 'approved' }] });
for (const asyncReader of [false, true]) {
  test(`NC1: ${asyncReader ? 'native Promise' : 'sync'} reader supplies an approved manifest`, async () => {
    let effects = 0;
    const op = createOperation({ goal: 'noop', context: manifest(), authority: { spend: [{ asset: 'USDC', to: 'G1', maxAmount: '5' }] } });
    const out = await runOperation(op, { id: 'nc1', required: () => ({ spend: [{ asset: 'USDC', to: 'G1', amount: '5' }] }), perform: () => { effects++; return { ok: true, evidence: {} }; } }, {
      readContext: () => asyncReader ? Promise.resolve(manifest()) : manifest(),
      verify: () => ({ verified: true, checks: { local: true }, reason: 'local proof' }),
    });
    assert.equal(out.status, 'verified');
    assert.equal(effects, 1);
  });
}
test('NC1: reject sync own then accessor without executing it', async () => {
  let reads = 0; let effects = 0;
  const value = manifest();
  Object.defineProperty(value, 'then', { get() { reads++; return undefined; } });
  const op = createOperation({ goal: 'noop', context: manifest(), authority: { spend: [{ asset: 'USDC', to: 'G1', maxAmount: '5' }] } });
  const out = await runOperation(op, { id: 'nc1', required: () => ({ spend: [{ asset: 'USDC', to: 'G1', amount: '5' }] }), perform: () => { effects++; return { ok: true }; } }, { readContext: () => value });
  assert.equal(out.status, 'blocked');
  assert.equal(effects, 0);
  assert.equal(reads, 0);
});
