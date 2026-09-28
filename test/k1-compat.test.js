'use strict';
// K1: io.ask keeps the legacy array shape (demo/x402 maps over it) while carrying the four gate gestures.
const test = require('node:test');
const assert = require('node:assert');
const { createOperation, runOperation } = require('../src/operation.js');

test('K1-compat: legacy ask receives an array of requirements that also carries cost, exit and publicByDefault', async () => {
  const op = createOperation({ goal: 'pay', authority: { spend: [] } });
  let seen;
  const cap = { id: 'c', required: () => ({ spend: [{ asset: 'USDC', amount: '5', to: 'G1' }] }), perform: async () => ({ ok: true, evidence: { txHash: 'h' } }) };
  await runOperation(op, cap, {
    ask: async (reqs) => { seen = reqs; return { approved: false }; },
    verify: () => ({ verified: true, checks: ['x'] }),
  });
  assert.ok(Array.isArray(seen), 'ask must still receive an array');
  assert.deepStrictEqual(seen.map((r) => `${r.amount} of ${r.asset} to ${r.to}`), ['5 of USDC to G1']);
  assert.ok(Array.isArray(seen.requirements) && seen.requirements.length === 1);
  assert.ok(Array.isArray(seen.cost));
  assert.strictEqual(seen.publicByDefault, false);
  assert.strictEqual(typeof seen.exit, 'string');
});
