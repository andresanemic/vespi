import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { x402Client } from '@x402/fetch';
import { x402Capability, claimTransaction, USDC_CONTRACT } from './capability.js';

const expectedPayTo = Keypair.random().publicKey();
const otherPayTo = Keypair.random().publicKey();
const secret = Keypair.random().secret();
const asset = 'USDC:' + USDC_CONTRACT;
const base = {
  scheme: 'exact',
  network: 'stellar:testnet',
  asset: USDC_CONTRACT,
  amount: '100000',
  payTo: expectedPayTo,
  maxTimeoutSeconds: 60,
  extra: { areFeesSponsored: true },
};
const grant = (maxAmount) => ({ spend: [{ asset, maxAmount, to: expectedPayTo }] });

async function probe(offer, authority) {
  const originalFetch = globalThis.fetch;
  const originalCreate = x402Client.prototype.createPaymentPayload;
  let payloadCalls = 0;
  let seenOffers = [];
  const pr = {
    x402Version: 2,
    resource: { url: 'http://example.test/api/agent-service' },
    accepts: Array.isArray(offer) ? offer : [offer],
  };
  globalThis.fetch = async () => ({
    status: 402,
    headers: new Headers({ 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(pr)).toString('base64') }),
  });
  x402Client.prototype.createPaymentPayload = async (selected) => {
    seenOffers = selected.accepts;
    payloadCalls++;
    throw new Error('PAYLOAD_BOUNDARY');
  };
  let result;
  let error;
  try {
    result = await x402Capability({ serviceUrl: 'http://example.test/api/agent-service', payTo: expectedPayTo, secret }).perform({ authority });
  } catch (e) {
    error = e;
  } finally {
    globalThis.fetch = originalFetch;
    x402Client.prototype.createPaymentPayload = originalCreate;
  }
  return { result, error, payloadCalls, seenOffers };
}

test('effective 402 terms are bound before payment payload creation', async () => {
  const narrow = grant('500000'); // 0.05 USDC, above declared 0.01 but below hostile 0.50.
  for (const [name, offer] of [
    ['amount above grant', { ...base, amount: '5000000' }],
    ['amount within grant but not declared for receipt', { ...base, amount: '400000' }],
    ['different token', { ...base, asset: otherPayTo }],
    ['different recipient', { ...base, payTo: otherPayTo }],
    ['different network', { ...base, network: 'stellar:pubnet' }],
    ['different scheme', { ...base, scheme: 'other' }],
    ['longer signature window', { ...base, maxTimeoutSeconds: 3600 }],
    ['different payment flow', { ...base, extra: { areFeesSponsored: true, paymentFlow: 'escrow' } }],
  ]) {
    const checked = await probe(offer, narrow);
    assert.equal(checked.payloadCalls, 0, name + ': payment payload creation was reached');
    assert.equal(checked.result?.ok, false, name + ': expected a rejected capability result');
  }

  const gateApproved = await probe({ ...base, amount: '400000' }, grant('100000'));
  assert.equal(gateApproved.payloadCalls, 0, 'gate-approved 0.01 grant must not cover 0.04');
  assert.equal(gateApproved.result?.ok, false);

  const exactDeclared = await probe(base, narrow);
  assert.equal(exactDeclared.payloadCalls, 1, 'declared 0.01 fits the effective 0.05 grant');
  assert.match(exactDeclared.error?.message || '', /PAYLOAD_BOUNDARY/);

  const mixedOffers = await probe([{ ...base, amount: '5000000' }, base], narrow);
  assert.equal(mixedOffers.payloadCalls, 1, 'a valid offer can be selected without exposing the higher offer');
  assert.deepEqual(mixedOffers.seenOffers.map((r) => r.amount), ['100000'], 'only authorized terms may reach the x402 selector');
  assert.match(mixedOffers.error?.message || '', /PAYLOAD_BOUNDARY/);
});

test('malformed prepared transaction is rejected before the paid request', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreate = x402Client.prototype.createPaymentPayload;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return {
      status: 402,
      headers: new Headers({ 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify({
        x402Version: 2,
        resource: { url: 'http://example.test/api/agent-service' },
        accepts: [base],
      })).toString('base64') }),
    };
  };
  x402Client.prototype.createPaymentPayload = async () => ({ payload: { transaction: 'not-xdr' } });
  let result;
  try {
    result = await x402Capability({ serviceUrl: 'http://example.test/api/agent-service', payTo: expectedPayTo, secret }).perform({ authority: grant('500000') });
  } finally {
    globalThis.fetch = originalFetch;
    x402Client.prototype.createPaymentPayload = originalCreate;
  }
  assert.equal(result.ok, false);
  assert.match(result.error, /preflight/);
  assert.equal(fetchCalls, 1);
});

test('transaction replay claims canonicalize surrounding whitespace', () => {
  const hash = `tx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  assert.equal(claimTransaction(`  ${hash}  `), true);
  assert.equal(claimTransaction(hash), false);
});

test('wildcard authority cannot redirect a destination-bound payment', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; return { status: 500 }; };
  let result;
  try {
    result = await x402Capability({ serviceUrl: 'http://example.test/api/agent-service', payTo: expectedPayTo, secret }).perform({
      authority: { spend: [{ asset, maxAmount: '500000' }] },
      signal: new AbortController().signal,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(result.ok, false);
  assert.match(result.error, /recipient/);
  assert.equal(fetchCalls, 0);
});

test('aborting the kernel signal stops x402 before a paid request', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreate = x402Client.prototype.createPaymentPayload;
  let fetchCalls = 0;
  const controller = new AbortController();
  globalThis.fetch = async () => {
    fetchCalls++;
    return { status: 402, headers: new Headers({ 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify({
      x402Version: 2,
      resource: { url: 'http://example.test/api/agent-service' },
      accepts: [base],
    })).toString('base64') }) };
  };
  x402Client.prototype.createPaymentPayload = async () => new Promise((resolve) => setTimeout(() => resolve({}), 50));
  let result;
  try {
    const pending = x402Capability({ serviceUrl: 'http://example.test/api/agent-service', payTo: expectedPayTo, secret }).perform({
      authority: grant('500000'),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 5);
    result = await pending;
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    globalThis.fetch = originalFetch;
    x402Client.prototype.createPaymentPayload = originalCreate;
  }
  assert.equal(result.ok, false);
  assert.equal(result.settlementUnknown, true);
  assert.equal(fetchCalls, 1);
});

test('payment path refuses a missing secret before network access', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return { status: 500 };
  };
  let result;
  let error;
  try {
    result = await x402Capability({ serviceUrl: 'http://example.test/api/agent-service', payTo: expectedPayTo, secret: '' }).perform({ authority: grant('500000') });
  } catch (e) {
    error = e;
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(error, undefined);
  assert.equal(result?.ok, false);
  assert.match(result?.error || '', /CLIENT_SECRET/);
  assert.equal(fetchCalls, 0);
});

test('recipient validation rejects secret-shaped configuration before networking', () => {
  assert.throws(
    () => x402Capability({ serviceUrl: 'http://example.test/api/agent-service', payTo: secret, secret: secret }),
    (error) => error.message.includes('public key') && !error.message.includes(secret),
  );
});
