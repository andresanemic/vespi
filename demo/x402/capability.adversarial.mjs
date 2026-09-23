import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { x402Client } from '@x402/fetch';
import { x402Capability, USDC_CONTRACT } from './capability.js';

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
const grant = (maxAmount) => ({ spend: [{ asset, maxAmount }] });

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