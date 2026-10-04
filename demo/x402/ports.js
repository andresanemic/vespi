// Reference bridge: the only place that knows x402, Stellar and USDC.
//
// The kernel ships the CONTRACT of the paid effect (src/x402.js) with the network, the signer and
// the settlement reader injected as ports. This file implements those ports on top of the same SDK
// calls the historical adapter (capability.js) makes, and the demo runner consumes the contract
// through them.
//
// PARTIALLY VERIFIED, AND ONLY IN ITS SHAPE. The demo package has its own dependencies (Stellar SDK,
// four x402 packages, Express) and they are not installed in this checkout, so nothing that touches
// the SDK, XDR, HTTP or Horizon was run: not the demo suite, not the runner, not a payment. What the
// kernel suite does run, with the SDK replaced by stubs, is the composition: the object this factory
// returns is the object src/x402.js accepts (test/k4-x402-advisor.test.js, case ADV15). Everything
// below the ports is transcribed from capability.js and settlement.js, and the behaviours the
// contract claims are covered by the kernel suite through simulated ports (test/x402.test.js).
// Treat the payment path as unverified until the demo suite runs where its dependencies exist.
import { Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { createEd25519Signer, getNetworkPassphrase } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { requirePublicKey } from './config.js';
import { authDigestFromEnvelope, verifyPreparedTransaction, verifySettlement } from './settlement.js';

const require = createRequire(import.meta.url);
const { createX402Payment } = require('../../src/x402.js');

const NETWORK = 'stellar:testnet';
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const USDC_CONTRACT = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const PRICE_ATOMIC = '100000';
const MAX_SIGNATURE_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 1024 * 1024;
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

export { NETWORK, PRICE_ATOMIC, USDC_CONTRACT, ISSUER };

function errorText(error) {
  try {
    if (error && typeof error.message === 'string') return error.message;
    return String(error);
  } catch {
    return 'unknown error';
  }
}

function isMarketingPlan(plan) {
  return plan !== null && typeof plan === 'object' && !Array.isArray(plan)
    && typeof plan.title === 'string' && plan.title.length > 0
    && typeof plan.summary === 'string' && plan.summary.length > 0
    && Array.isArray(plan.deliverables) && plan.deliverables.every((item) => typeof item === 'string')
    && Array.isArray(plan.nextSteps) && plan.nextSteps.every((item) => typeof item === 'string');
}

// The body is read with a bound before it is parsed, and nothing from it is logged.
async function readBodyWithLimit(response, signal) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error('paid response body is too large');
  const text = await response.text();
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new Error('paid response body is too large');
  }
  return JSON.parse(text);
}

function abortError(label) {
  const error = new Error(`${label} aborted`);
  error.code = 'VESPI_ABORTED';
  return error;
}

function throwIfAborted(signal, label) {
  try {
    if (signal?.aborted) throw abortError(label);
  } catch (error) {
    if (error?.code === 'VESPI_ABORTED') throw error;
    throw abortError(label);
  }
}

// One HTTP exchange, bounded by the engine's signal and by its own timer. A redirect is an error:
// the paid effect goes to the url that was declared and nowhere else.
async function fetchBounded(url, options, externalSignal) {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  let removeExternalListener = () => {};
  try {
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        removeExternalListener = () => externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  } catch {
    controller.abort();
  }
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
  } catch (err) {
    if (externalSignal?.aborted) throw abortError('http');
    if (controller.signal.aborted) throw new Error(`request timeout after ${REQUEST_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
    try {
      removeExternalListener();
    } catch {
    }
  }
}

// The ports for one paid effect. `serviceUrl` is the canonical url the declaration fixed; the
// resource the server names has to match it exactly, and the kernel refuses it when it does not.
//
// The object returned here is the shape src/x402.js `readPorts` admits: the two network ports under
// `http`, the signer under `signer`, the three host-owned ports at the root and the optional claims
// store beside them. Each one is a closure over the same signer, client and prepared authorization,
// so grouping them changes nothing about what they do.
export function createStellarPorts({ serviceUrl, payTo, secret, issuer = ISSUER, network = NETWORK, rpcUrl = RPC_URL, horizonUrl, claims } = {}) {
  const recipient = requirePublicKey(payTo);
  if (!secret) throw new Error('CLIENT_SECRET is required for the payment path');
  const signer = createEd25519Signer(secret, network);
  const client = new x402Client().register('stellar:*', new ExactStellarScheme(signer, { url: rpcUrl }));
  const httpClient = new x402HTTPClient(client);
  const payer = Keypair.fromSecret(secret).publicKey();
  const passphrase = getNetworkPassphrase(network);
  // The payload built for the authorization that was just prepared. Kept so the paid request can
  // encode exactly the transaction the kernel inspected, never a freshly built one.
  let prepared = null;

  const discover = async ({ url, method, redirect, signal }) => {
    if (redirect !== 'error' || method !== 'GET') throw new Error('discovery is a GET without redirects');
    const response = await fetchBounded(url, { method: 'GET' }, signal);
    if (response.status !== 402) return { status: response.status };
    let paymentRequired;
    try {
      paymentRequired = httpClient.getPaymentRequiredResponse((name) => response.headers.get(name));
    } catch {
      return { status: response.status };
    }
    return { status: response.status, paymentRequired };
  };

  const prepare = async ({ terms, expected, signal }) => {
    throwIfAborted(signal, 'prepare');
    let payload = await client.createPaymentPayload({
      x402Version: 2,
      resource: { url: serviceUrl },
      accepts: [terms],
    });
    const transaction = new Transaction(payload.payload.transaction, passphrase);
    const sorobanData = transaction.toEnvelope().v1()?.tx()?.ext()?.sorobanData();
    if (sorobanData) {
      payload = {
        ...payload,
        payload: {
          ...payload.payload,
          transaction: TransactionBuilder
            .cloneFrom(transaction, { fee: '1', sorobanData, networkPassphrase: passphrase })
            .build()
            .toXDR(),
        },
      };
    }
    throwIfAborted(signal, 'prepare');
    prepared = { payload, authorization: payload.payload.transaction, expected };
    return { authorization: payload.payload.transaction };
  };

  const inspectPrepared = async (authorization, { expected, signal }) => {
    throwIfAborted(signal, 'inspect');
    const authDigest = authDigestFromEnvelope(authorization, network);
    const transaction = new Transaction(authorization, passphrase);
    // The names are adapted on purpose: the kernel speaks network/asset/payer/payTo/amount, the
    // settlement code speaks assetContract and issuer.
    const verdict = verifyPreparedTransaction(transaction, {
      payer: expected.payer,
      payTo: expected.payTo,
      amount: expected.amount,
      assetContract: expected.asset,
      authDigest,
    });
    if (!verdict.verified) {
      return { verified: false, authDigest: authDigest || undefined, checks: verdict.checks || {}, reason: verdict.reason };
    }
    return {
      verified: true,
      authDigest,
      effect: {
        network,
        asset: expected.asset,
        payer: expected.payer,
        payTo: expected.payTo,
        amount: expected.amount,
      },
      checks: verdict.checks || { prepared: true },
      reason: verdict.reason || 'prepared transaction matches declared effect',
    };
  };

  const sendPaid = async ({ url, authorization, idempotencyKey, signal }) => {
    throwIfAborted(signal, 'send');
    if (!prepared || prepared.authorization !== authorization) {
      throw new Error('the paid request does not carry the authorization that was inspected');
    }
    const headers = {
      ...httpClient.encodePaymentSignatureHeader(prepared.payload),
      // Only a hint: a provider that does not honour it is not made to honour it here.
      'idempotency-key': idempotencyKey,
    };
    const response = await fetchBounded(url, { headers }, signal);
    throwIfAborted(signal, 'send');
    let settlement = null;
    try {
      settlement = httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
    } catch {
      settlement = null;
    }
    return {
      status: response.status,
      settlement: settlement ? { ...settlement } : null,
      readBody: (innerSignal) => readBodyWithLimit(response, innerSignal || signal),
    };
  };

  const verifySettlement = async (evidence, { expected, authDigest, signal }) => {
    throwIfAborted(signal, 'verify settlement');
    const verdict = await verifySettlement({ ...evidence, authDigest }, {
      horizon: new (await import('@stellar/stellar-sdk')).Horizon.Server(horizonUrl || 'https://horizon-testnet.stellar.org'),
      payer: expected.payer,
      payTo: expected.payTo,
      amount: expected.amount,
      issuer,
      assetContract: expected.asset,
      network,
      requireAuthDigest: true,
    });
    return { verified: verdict.verified === true, checks: verdict.checks || {}, reason: verdict.reason || 'settlement did not match' };
  };

  // The same shape the historical adapter checked: a marketing plan, not any JSON at all. The digest
  // is required by the contract: a body nobody hashed is not a covered delivery.
  const validateOutput = (body) => {
    if (!isMarketingPlan(body)) return { ok: false };
    let serialized;
    try {
      serialized = JSON.stringify(body);
    } catch {
      return { ok: false };
    }
    return { ok: true, output: body, digest: createHash('sha256').update(serialized).digest('hex') };
  };

  return {
    http: { discover, sendPaid },
    signer: { prepare },
    inspectPrepared,
    verifySettlement,
    validateOutput,
    ...(claims ? { claims } : {}),
  };
}

// The reference endpoint serves one operation; the query says which, as it always has.
function serviceEndpoint(base) {
  const url = new URL(base);
  url.searchParams.set('service', 'marketing-plan');
  return url.toString();
}

// The declaration and the ports together are the whole capability: the kernel owns the fixed effect,
// the order, the deduplication and the receipt verdict, and this adapter owns Stellar, x402 and HTTP.
export function createMarketingPlanPayment({ serviceUrl, payTo, secret, claims } = {}) {
  const recipient = requirePublicKey(payTo);
  const payer = secret ? Keypair.fromSecret(secret).publicKey() : '';
  const endpoint = serviceEndpoint(serviceUrl);
  return createX402Payment({
    id: 'x402-marketing-plan',
    url: endpoint,
    method: 'GET',
    network: NETWORK,
    asset: USDC_CONTRACT,
    grantAsset: `USDC:${USDC_CONTRACT}`,
    payer,
    payTo: recipient,
    amount: PRICE_ATOMIC,
    maxTimeoutSeconds: MAX_SIGNATURE_SECONDS,
  }, createStellarPorts({ serviceUrl: endpoint, payTo: recipient, secret, claims }));
}

export { createX402Payment };