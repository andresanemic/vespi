import { Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { createEd25519Signer, getNetworkPassphrase } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { requirePublicKey } from './config.js';
import { authDigestFromEnvelope, verifyPreparedTransaction } from './settlement.js';

// Demo adapter: the ONLY place that knows x402/Stellar/USDC.
// The kernel sees { id, required(), perform() } and nothing else.
const NETWORK = 'stellar:testnet';
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const USDC_CONTRACT = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const PRICE_ATOMIC = '100000'; // 0.01 USDC
const MAX_SIGNATURE_SECONDS = 300; // reference endpoint's x402 default
const REQUEST_TIMEOUT_MS = 15_000;
const require = createRequire(import.meta.url);
const { sufficient } = require('../../src/authority.js');
const consumedTransactions = new Set();
const responseControllers = new WeakMap();
const responseReaders = new WeakMap();

function errorText(error) {
  try {
    if (error && typeof error.message === 'string') return error.message;
    return String(error);
  } catch {
    return 'unknown error';
  }
}

function serviceEndpoint(base) {
  const url = new URL(base);
  url.searchParams.set('service', 'marketing-plan');
  return url.toString();
}

function hasDestinationAuthority(authority, recipient) {
  try {
    const grants = authority?.spend;
    return Array.isArray(grants) && grants.some((grant) => grant && grant.to === recipient && grant.asset === `USDC:${USDC_CONTRACT}`);
  } catch {
    return false;
  }
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

function awaitWithSignal(value, signal, label) {
  if (!signal) return Promise.resolve(value);
  try {
    if (signal.aborted) return Promise.reject(abortError(label));
  } catch {
    return Promise.reject(abortError(label));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      try { signal.removeEventListener('abort', onAbort); } catch {}
      reject(abortError(label));
    };
    try { signal.addEventListener('abort', onAbort, { once: true }); } catch { onAbort(); return; }
    Promise.resolve(value).then(
      (result) => {
        if (settled) return;
        settled = true;
        try { signal.removeEventListener('abort', onAbort); } catch {}
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        try { signal.removeEventListener('abort', onAbort); } catch {}
        reject(error);
      },
    );
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal) {
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
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, redirect: options.redirect || 'error', signal: controller.signal });
    responseControllers.set(response, controller);
    return response;
  } catch (err) {
    if (externalSignal?.aborted) throw new Error('request aborted');
    if (controller.signal.aborted) throw new Error(`request timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
    try {
      removeExternalListener();
    } catch {
    }
  }
}

function claimTransaction(txHash) {
  const canonical = typeof txHash === 'string' ? txHash.trim().toLowerCase() : '';
  if (!canonical || consumedTransactions.has(canonical)) return false;
  consumedTransactions.add(canonical);
  return true;
}

function abortResponseBody(response) {
  try {
    responseControllers.get(response)?.abort();
  } catch {
    return;
  }
  try {
    const reader = responseReaders.get(response);
    if (reader && typeof reader.cancel === 'function') {
      const canceled = reader.cancel();
      if (canceled && typeof canceled.catch === 'function') canceled.catch(() => {});
    }
    const body = response?.body;
    if (body && typeof body.cancel === 'function') {
      const canceled = body.cancel();
      if (canceled && typeof canceled.catch === 'function') canceled.catch(() => {});
    }
    if (body && typeof body.destroy === 'function') body.destroy();
  } catch {
    return;
  }
}

async function readResponseJson(response) {
  const body = response?.body;
  if (!body || typeof body.getReader !== 'function') return response.json();
  const reader = body.getReader();
  responseReaders.set(response, reader);
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    responseReaders.delete(response);
    reader.releaseLock();
  }
}

async function readJsonWithTimeout(response, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal) {
  const body = Promise.resolve().then(() => readResponseJson(response));
  let timer;
  let removeExternalListener = () => {};
  const timeout = new Promise((_, reject) => {
    const onAbort = () => {
      abortResponseBody(response);
      reject(abortError('response body'));
    };
    if (externalSignal) {
      try {
        if (externalSignal.aborted) onAbort();
        else {
          externalSignal.addEventListener('abort', onAbort, { once: true });
          removeExternalListener = () => externalSignal.removeEventListener('abort', onAbort);
        }
      } catch {
        onAbort();
      }
    }
    timer = setTimeout(() => {
      abortResponseBody(response);
      reject(new Error(`response body timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([body, timeout]);
  } finally {
    clearTimeout(timer);
    try { removeExternalListener(); } catch {}
  }
}

function claimSettlement(settle) {
  const txHash = typeof settle?.transaction === 'string' ? settle.transaction : '';
  return !txHash || claimTransaction(txHash);
}

function classifySettlement(settle) {
  const txHash = typeof settle?.transaction === 'string' ? settle.transaction : '';
  const payer = typeof settle?.payer === 'string' ? settle.payer : '';
  const network = typeof settle?.network === 'string' ? settle.network : '';
  const amount = typeof settle?.amount === 'string' ? settle.amount : '';
  const evidence = {};
  if (txHash) evidence.txHash = txHash;
  if (payer) evidence.payer = payer;
  if (network) evidence.network = network;
  if (amount) evidence.amount = amount;
  const valid = settle?.success === true && txHash && payer && network === NETWORK && (!amount || amount === PRICE_ATOMIC);
  return { status: valid ? 'settled' : 'unknown', evidence };
}

function withAuthDigest(evidence, authDigest) {
  return { ...evidence, ...(authDigest ? { authDigest } : {}) };
}

function isMarketingPlan(plan) {
  return plan !== null && typeof plan === 'object' && !Array.isArray(plan) &&
    typeof plan.title === 'string' && plan.title.length > 0 &&
    typeof plan.summary === 'string' && plan.summary.length > 0 &&
    Array.isArray(plan.deliverables) && plan.deliverables.every((item) => typeof item === 'string') &&
    Array.isArray(plan.nextSteps) && plan.nextSteps.every((item) => typeof item === 'string');
}

async function finalizeSettlement({ settle, status, readBody, authDigest }) {
  const classified = classifySettlement(settle);
  const evidence = withAuthDigest(classified.evidence, authDigest);
  if (classified.status !== 'settled') {
    return {
      ok: false,
      error: `payment settlement response incomplete or mismatched${settle?.errorReason ? ` (${settle.errorReason})` : ''}`,
      settlementUnknown: true,
      evidence,
    };
  }
  if (status !== 200) {
    return { ok: false, error: `paid request failed (${status})`, settlementUnknown: true, evidence };
  }
  let plan;
  try {
    plan = await readBody();
  } catch {
    return { ok: false, error: 'paid response body unavailable', settlementUnknown: true, evidence };
  }
  if (!isMarketingPlan(plan)) {
    return { ok: false, error: 'paid response body does not match the marketing plan schema', settlementUnknown: true, evidence };
  }
  let serialized;
  try {
    serialized = JSON.stringify(plan);
    if (serialized === undefined) throw new Error('empty body');
  } catch {
    return { ok: false, error: 'paid response body invalid', settlementUnknown: true, evidence };
  }
  return {
    ok: true,
    evidence: { ...evidence, planDigest: createHash('sha256').update(serialized).digest('hex') },
    output: plan,
  };
}

export function x402Capability({ serviceUrl, payTo, secret }) {
  const recipient = requirePublicKey(payTo);
  return {
    id: 'x402-marketing-plan',
    required: () => ({ spend: [{ asset: `USDC:${USDC_CONTRACT}`, amount: PRICE_ATOMIC, to: recipient }] }),
    perform: async ({ authority, signal }) => {
      if (!hasDestinationAuthority(authority, recipient)) return { ok: false, error: 'authority is not bound to the payment recipient' };
      if (!secret) return { ok: false, error: 'CLIENT_SECRET is required for the payment path' };
      throwIfAborted(signal, 'x402 capability');
      const endpoint = serviceEndpoint(serviceUrl);
      const signer = createEd25519Signer(secret, NETWORK);
      const client = new x402Client().register('stellar:*', new ExactStellarScheme(signer, { url: RPC_URL }));
      const httpClient = new x402HTTPClient(client);
      const first = await fetchWithTimeout(endpoint, {}, REQUEST_TIMEOUT_MS, signal);
      throwIfAborted(signal, 'x402 discovery');
      if (first.status !== 402) return { ok: false, error: `expected 402, got ${first.status}` };
      const pr = httpClient.getPaymentRequiredResponse((n) => first.headers.get(n));
      // The kernel records required() as the exercised effect. With this fixed-price
      // capability, an authorized grant may be wider, but the signed 402 must match
      // the declared 0.01 effect exactly or the receipt would misstate what happened.
      // Keep only offers inside both the declared effect and the effective grant.
      const authorized = pr.x402Version === 2 && Array.isArray(pr.accepts) ? pr.accepts.filter((r) =>
        r.scheme === 'exact' &&
        r.network === NETWORK &&
        r.asset === USDC_CONTRACT &&
        r.payTo === recipient &&
        r.amount === PRICE_ATOMIC &&
        Number.isSafeInteger(r.maxTimeoutSeconds) &&
        r.maxTimeoutSeconds > 0 &&
        r.maxTimeoutSeconds <= MAX_SIGNATURE_SECONDS &&
        r.extra?.areFeesSponsored === true &&
        (r.extra.paymentFlow === undefined || r.extra.paymentFlow === 'authorization') &&
        sufficient([{ asset: 'USDC:' + r.asset, amount: r.amount, to: r.payTo }], authority).ok
      ) : [];
      if (authorized.length === 0) return { ok: false, error: '402 terms outside declared effect or operation authority' };
      let payload;
      try {
        payload = await awaitWithSignal(
          Promise.resolve().then(() => client.createPaymentPayload({ ...pr, accepts: authorized })),
          signal,
          'payment payload',
        );
      } catch (err) {
        if (signal?.aborted || err?.code === 'VESPI_ABORTED') {
          return { ok: false, error: 'payment creation aborted', settlementUnknown: true };
        }
        throw err;
      }
      throwIfAborted(signal, 'payment payload');
      let tx;
      try {
        tx = new Transaction(payload.payload.transaction, getNetworkPassphrase(NETWORK));
        const sd = tx.toEnvelope().v1()?.tx()?.ext()?.sorobanData();
        if (sd) {
          payload = { ...payload, payload: { ...payload.payload, transaction: TransactionBuilder.cloneFrom(tx, { fee: '1', sorobanData: sd, networkPassphrase: getNetworkPassphrase(NETWORK) }).build().toXDR() } };
        }
      } catch (err) {
        return { ok: false, error: `payment payload preflight failed (${errorText(err)})`, settlementUnknown: true };
      }
      const authDigest = authDigestFromEnvelope(payload.payload.transaction, NETWORK);
      let prepared;
      try {
        const preparedTransaction = new Transaction(payload.payload.transaction, getNetworkPassphrase(NETWORK));
        prepared = verifyPreparedTransaction(preparedTransaction, {
          payer: Keypair.fromSecret(secret).publicKey(),
          payTo: recipient,
          amount: PRICE_ATOMIC,
          assetContract: USDC_CONTRACT,
          authDigest,
        });
      } catch (err) {
        return { ok: false, error: `payment payload preflight failed (${errorText(err)})`, settlementUnknown: true };
      }
      if (!prepared.verified) {
        return { ok: false, error: `payment payload preflight failed: ${prepared.reason}`, settlementUnknown: true };
      }
      throwIfAborted(signal, 'payment payload');
      let paid;
      try {
        paid = await fetchWithTimeout(endpoint, { headers: httpClient.encodePaymentSignatureHeader(payload) }, REQUEST_TIMEOUT_MS, signal);
      } catch (err) {
        return { ok: false, error: `paid request failed (${errorText(err)})`, settlementUnknown: true };
      }
      let settle;
      try {
        settle = httpClient.getPaymentSettleResponse((n) => paid.headers.get(n));
      } catch {
        settle = null;
      }
      try {
        throwIfAborted(signal, 'paid response');
      } catch (err) {
        return { ok: false, error: errorText(err), settlementUnknown: true };
      }
      const classified = classifySettlement(settle);
      if (!claimSettlement(settle)) {
        return {
          ok: false,
          error: 'transaction already consumed',
          settlementUnknown: true,
          evidence: withAuthDigest(classified.evidence, authDigest),
        };
      }
      return finalizeSettlement({
        settle,
        status: paid.status,
        readBody: () => readJsonWithTimeout(paid, REQUEST_TIMEOUT_MS, signal),
        authDigest,
      });
    },
  };
}

export { claimSettlement, claimTransaction, classifySettlement, fetchWithTimeout, finalizeSettlement, readJsonWithTimeout, serviceEndpoint, withAuthDigest, USDC_CONTRACT, PRICE_ATOMIC, NETWORK };
