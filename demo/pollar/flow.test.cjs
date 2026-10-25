'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { runPollarPayment } = require('./flow.cjs');

const DEST = 'GDS6AO6UEHXO6SFG7R4HQS5KN7RMFUPMAQLHJA7CD7ZFNELWACINCO36';
const HASH = 'a'.repeat(64);
const ledger = (over = {}) => async (url) => {
  const isOps = url.endsWith('/operations');
  const body = isOps
    ? { _embedded: { records: [{ type: 'payment', to: over.to || DEST, asset_type: over.asset || 'native', amount: over.amount || '0.0001000' }] } }
    : { hash: HASH, successful: over.successful !== false };
  return { ok: true, status: 200, json: async () => body };
};

test('approved and matching ledger -> verified with a verified receipt', async () => {
  let asked = 0;
  const res = await runPollarPayment({
    destination: DEST, amountStroops: '1000',
    ask: async () => { asked++; return { approved: true, by: 'andres' }; },
    waitForPayment: async () => ({ hash: HASH, status: 'success' }),
    fetchImpl: ledger(),
  });
  assert.equal(asked, 1);
  assert.equal(res.status, 'verified');
  assert.ok(res.receipt);
});

test('gate declined -> payment never awaited', async () => {
  let waited = false;
  const res = await runPollarPayment({
    destination: DEST, amountStroops: '1000',
    ask: async () => ({ approved: false }),
    waitForPayment: async () => { waited = true; return { hash: HASH }; },
    fetchImpl: ledger(),
  });
  assert.equal(waited, false);
  assert.notEqual(res.status, 'verified');
});

test('ledger shows a different amount -> not verified', async () => {
  const res = await runPollarPayment({
    destination: DEST, amountStroops: '1000',
    ask: async () => ({ approved: true, by: 'andres' }),
    waitForPayment: async () => ({ hash: HASH }),
    fetchImpl: ledger({ amount: '5.0000000' }),
  });
  assert.notEqual(res.status, 'verified');
});

test('ledger shows a different destination -> not verified', async () => {
  const res = await runPollarPayment({
    destination: DEST, amountStroops: '1000',
    ask: async () => ({ approved: true, by: 'andres' }),
    waitForPayment: async () => ({ hash: HASH }),
    fetchImpl: ledger({ to: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' }),
  });
  assert.notEqual(res.status, 'verified');
});

test('failed transaction on the ledger -> not verified', async () => {
  const res = await runPollarPayment({
    destination: DEST, amountStroops: '1000',
    ask: async () => ({ approved: true, by: 'andres' }),
    waitForPayment: async () => ({ hash: HASH }),
    fetchImpl: ledger({ successful: false }),
  });
  assert.notEqual(res.status, 'verified');
});

test('browser reports no valid hash -> failed, ledger not read', async () => {
  let read = false;
  const res = await runPollarPayment({
    destination: DEST, amountStroops: '1000',
    ask: async () => ({ approved: true, by: 'andres' }),
    waitForPayment: async () => ({ hash: 'nope' }),
    fetchImpl: async () => { read = true; return ledger()(); },
  });
  assert.equal(read, false);
  assert.notEqual(res.status, 'verified');
});

test('a human who answers after the kernel default of 15 s is still heard', async () => {
  const realSetTimeout = global.setTimeout;
  const res = await runPollarPayment({
    destination: DEST, amountStroops: '1000',
    ask: () => new Promise((resolve) => realSetTimeout(() => resolve({ approved: true, by: 'andres' }), 16_000)),
    waitForPayment: async () => ({ hash: HASH }),
    fetchImpl: ledger(),
  });
  assert.equal(res.status, 'verified');
});
