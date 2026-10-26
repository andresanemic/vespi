'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { runTestnetPayment } = require('./testnet.cjs');
const { verifyReceiptAnchor, verifyPollarMainnet, RECEIPT_ANCHOR, POLLAR_PAYMENT } = require('./mainnet.cjs');

const FROM = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const TO = 'GDS6AO6UEHXO6SFG7R4HQS5KN7RMFUPMAQLHJA7CD7ZFNELWACINCO36';
const HASH = 'b'.repeat(64);

const ledger = (over = {}) => async (url) => {
  const isOps = url.endsWith('/operations');
  const body = isOps
    ? { _embedded: { records: [{ type: 'payment', to: over.to || TO, asset_type: 'native', amount: over.amount || '1.0000000' }] } }
    : { hash: over.hash || HASH, successful: true };
  return { ok: true, status: 200, json: async () => body };
};

function prepared(over = {}) {
  const state = { signed: 0, hash: HASH };
  return {
    state,
    value: {
      hash: HASH, from: FROM, to: TO, amount: '1',
      currentHash: () => state.hash,
      signAndSubmit: async () => { state.signed += 1; return { hash: over.submittedHash || state.hash }; },
    },
  };
}

const approve = async (payload) => ({ approved: true, by: 'judge', request: payload.approvalRequest.digest });

test('approved exact transaction and matching ledger -> verified receipt, signed once', async () => {
  const p = prepared();
  let seen = null;
  const res = await runTestnetPayment({ prepared: p.value, fetchImpl: ledger(), ask: async (payload, context) => { seen = context; return approve(payload); } });
  assert.equal(res.status, 'verified');
  assert.equal(res.receipt.status, 'verified');
  assert.equal(p.state.signed, 1);
  assert.equal(seen.manifestDigest, HASH, 'the person is shown the transaction hash');
  assert.equal(res.receipt.verification.checks.approvedTxOnLedger, true);
});

test('declined -> nothing signed or submitted', async () => {
  const p = prepared();
  const res = await runTestnetPayment({ prepared: p.value, fetchImpl: ledger(), ask: async () => ({ approved: false }) });
  assert.equal(p.state.signed, 0);
  assert.equal(res.submitted, false);
  assert.notEqual(res.receipt.status, 'verified');
});

test('approval that does not echo the approval request -> nothing signed', async () => {
  const p = prepared();
  const res = await runTestnetPayment({ prepared: p.value, fetchImpl: ledger(), ask: async () => ({ approved: true, by: 'judge', request: 'f'.repeat(64) }) });
  assert.equal(p.state.signed, 0);
  assert.notEqual(res.receipt.status, 'verified');
});

test('transaction changed after the yes -> blocked before signing', async () => {
  const p = prepared();
  const res = await runTestnetPayment({ prepared: p.value, fetchImpl: ledger(), ask: async (payload) => { p.state.hash = 'c'.repeat(64); return approve(payload); } });
  assert.equal(p.state.signed, 0);
  assert.notEqual(res.receipt.status, 'verified');
});

test('ledger shows another transaction than the approved one -> not verified', async () => {
  const other = 'd'.repeat(64);
  const p = prepared({ submittedHash: other });
  const res = await runTestnetPayment({ prepared: p.value, fetchImpl: ledger({ hash: other }), ask: approve });
  assert.notEqual(res.receipt.status, 'verified');
  assert.equal(res.receipt.verification.checks.approvedTxOnLedger, false);
});

test('ledger shows a different amount -> not verified', async () => {
  const p = prepared();
  const res = await runTestnetPayment({ prepared: p.value, fetchImpl: ledger({ amount: '5.0000000' }), ask: approve });
  assert.notEqual(res.receipt.status, 'verified');
});

test('mainnet re-verification reads the recorded Pollar payment and anchor', async () => {
  const digestB64 = Buffer.from(RECEIPT_ANCHOR.digest, 'hex').toString('base64');
  const fetchImpl = async (url) => {
    let body;
    if (url.includes(RECEIPT_ANCHOR.hash)) {
      body = url.endsWith('/operations')
        ? { _embedded: { records: [{ type: 'manage_data', value: digestB64 }] } }
        : { hash: RECEIPT_ANCHOR.hash, successful: true, memo_type: 'hash', memo: digestB64 };
    } else {
      body = url.endsWith('/operations')
        ? { _embedded: { records: [{ type: 'payment', to: POLLAR_PAYMENT.destination, asset_type: 'native', amount: '0.0001000' }] } }
        : { hash: POLLAR_PAYMENT.hash, successful: true };
    }
    return { ok: true, status: 200, json: async () => body };
  };
  assert.equal((await verifyPollarMainnet({ fetchImpl })).verified, true);
  assert.equal((await verifyReceiptAnchor({ fetchImpl })).verified, true);
  const wrong = async (url) => ({ ok: true, status: 200, json: async () => (url.endsWith('/operations') ? { _embedded: { records: [] } } : { hash: RECEIPT_ANCHOR.hash, successful: true, memo_type: 'text', memo: 'x' }) });
  assert.equal((await verifyReceiptAnchor({ fetchImpl: wrong })).verified, false);
});
