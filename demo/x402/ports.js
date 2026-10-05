// The x402 paid-effect bridge: the kernel CONTRACT (src/x402.js) on one side, Stellar, the x402
// HTTP client and Horizon on the other. The kernel owns the fixed declaration, the order, the
// deduplication and the receipt verdict; this file owns the network, the signer and the ledger.
//
// EXECUTED BY demo/x402/bridge.test.mjs, which runs every port below against real Stellar SDK 16
// objects (Keypair, Address, TransactionBuilder, Operation, xdr), a real Ed25519 authorization
// signature from `basicNodeSigner`, real base64 XDR envelopes, the real `@x402/fetch` client and
// the real `Horizon.Server` parsing real Horizon JSON, all served from loopback. What those tests
// do NOT cover, and what no test in this tree covers: a live payment, a second provider, and a
// durable claims store. The Soroban RPC of `ExactStellarScheme` cannot be emulated without a
// ledger, so `createPaymentPayload` is the one injection point: by default it is the real scheme,
// and a caller (or a test) may pass its own.
//
// KNOWN LIMITS, unchanged from the contract: ports are trusted host code; the claims store has to be
// synchronous; the default store lives in one process, so a restart allows a second attempt; and a
// run refused before the wire keeps its effect key.
//
// WHAT THIS BRIDGE ITSELF GUARANTEES, and where each is written below: one reserved record per
// authorization identity, never overwritten and never resurrected (the fall-off and `spent`); pending
// records that can no longer be sent are removed, with the fall-off written at MAX_PENDING_AUTHORIZATIONS;
// the authorization shape is closed to one entry, checked before anything else (closedAuthorizationShape);
// every JSON body goes through one bounded, cancellable door, and a refusal before the reader still
// cancels the body (readBoundedJson); and the abort is carried into the ledger read and into the
// settlement reader, which checks it before every Horizon read.
//
// WHAT NOBODY HAS PROVEN HERE: that the closed form admits every authorization a real `ExactStellarScheme`
// produces for a legitimate multi-entry transaction (it admits exactly one, by design, and a provider
// that needs more is not served by this bridge); that the fall-off's ledger read is affordable under the
// per-payment budget when the injected reader is slow; and nothing at all about mainnet.
import { Address, Horizon, Keypair, StrKey, Transaction, TransactionBuilder, buildAuthorizationEntryPreimage } from '@stellar/stellar-sdk';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { createEd25519Signer, getNetworkPassphrase } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { requirePublicKey } from './config.js';
// Aliased on purpose: the port below is also called `verifySettlement`, and an unaliased import
// would be shadowed by it, which is exactly the defect that used to make the bridge call itself.
import { authDigestFromEnvelope, verifyPreparedTransaction, verifySettlement as readSettlementFromLedger } from './settlement.js';

const require = createRequire(import.meta.url);
const { createX402Payment } = require('../../src/x402.js');

const NETWORK = 'stellar:testnet';
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const USDC_CONTRACT = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const PRICE_ATOMIC = '100000';
const MAX_SIGNATURE_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 15_000;
// The body of a paid answer has its own budget: a service that keeps the connection open without
// sending a byte must not hold the port (and the engine's signal) for as long as it likes.
const BODY_READ_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 1024 * 1024;
// A settlement read is three Horizon round trips and must not become a walk of redirects. This bounds
// the Horizon client the same way the body of a paid answer is bounded above; see `horizonFor`.
const MAX_REDIRECTS = 5;
// The policy that turns a wall-clock ceiling into a ledger window. Both are named and validated here,
// never inferred from a value that arrived from the network: Soroban targets a five second ledger,
// and two ledgers of tolerance cover the next close.
const LEDGER_SECONDS = 5;
const LEDGER_TOLERANCE = 2;
// At most this many prepared authorizations are kept, and each one is dropped by the send that
// carries it: a port that never sends does not become a store of pending payments.
const MAX_PENDING_AUTHORIZATIONS = 4;
// THE FALL-OFF, written down where the port is written down. A reserved record can die without ever
// being sent: the ledger advances past the expiration ledger its authorization names, and what the
// ledger will accept is decided by the ledger. Such a record is DELETED from `prepared`, and it is
// not a resend, because it was never sent: nothing left this port on its account, the kernel never
// read a body through it, and no receipt names it. Deleting it gives the reservation back; keeping
// it would only fill the bound, and a bound filled with dead records refuses live payments that are
// entirely payable. A record whose expiration ledger cannot be read is NOT deleted on that ground:
// an unreadable record is kept until a ledger says otherwise, so an unreadable ledger empties
// nothing. The identity of a deleted record is also forgotten: the set of spent identities is what
// keeps a payment from being sent twice, and a record that never left has nothing to protect.
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
  return hasDataField(plan, 'title') && hasDataField(plan, 'summary')
    && hasDataField(plan, 'deliverables') && hasDataField(plan, 'nextSteps');
}

// A shape is read through descriptors, so a getter on a body a service produced is never invoked:
// whatever a getter would have returned is irrelevant to a delivery this port refuses anyway.
function hasDataField(source, key) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return false;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(source, key);
  } catch {
    return false;
  }
  if (!descriptor || !('value' in descriptor)) return false;
  const value = descriptor.value;
  if (typeof value === 'string') return value.length > 0;
  if (!Array.isArray(value)) return false;
  return value.every((item) => typeof item === 'string');
}

// The same discipline for the answer of the payload builder, which is host code: only the two
// protocol fields are read, only as plain data properties, and each one is read once.
function readDataField(source, key) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(source, key);
  } catch {
    throw new Error(`the payment payload field ${key} cannot be read`);
  }
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new Error(`the payment payload field ${key} is not a plain value`);
  return descriptor.value;
}

// What goes on the wire is this copy and nothing else. The builder's object is read once, closed into
// two protocol fields, and dropped: a field it carried that the protocol does not admit (a debug
// value, a secret, a method that would serialize itself) cannot reach the header, and no later
// mutation of the builder's object can change what is sent.
function closedPaymentPayload(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('the payment payload is not an object');
  }
  let proto;
  try {
    proto = Object.getPrototypeOf(raw);
  } catch {
    throw new Error('the payment payload cannot be inspected');
  }
  if (proto !== Object.prototype && proto !== null) {
    throw new Error('the payment payload is not a plain object');
  }
  const version = readDataField(raw, 'x402Version');
  if (version !== undefined && version !== 2 && version !== '2') {
    throw new Error('the payment payload is not x402 version 2');
  }
  const inner = readDataField(raw, 'payload');
  if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) {
    throw new Error('the payment payload carries no payload object');
  }
  const transaction = readDataField(inner, 'transaction');
  if (typeof transaction !== 'string' || transaction.length === 0) {
    throw new Error('the payment payload carries no transaction');
  }
  return { x402Version: version === undefined ? 2 : version, payload: { transaction } };
}

// The ledger an authorization expires at, read out of the envelope itself. A record carries this so
// that a record which can no longer be sent can be recognized as such: an expiration ledger the
// network has already passed is a fact about the record, not about the service that answered.
function expirationLedgerOf(authorization) {
  try {
    const entries = new Transaction(authorization, getNetworkPassphrase(NETWORK)).operations?.[0]?.auth;
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
      const credentials = entry.credentials();
      if (credentials.switch().name !== 'sorobanCredentialsAddress') continue;
      const ledger = credentials.address().signatureExpirationLedger();
      if (Number.isSafeInteger(ledger) && ledger > 0) return ledger;
    }
  } catch {
    return null;
  }
  return null;
}

// The declared ceiling, read from the declaration and, when the terms that produced this
// authorization named one, from those terms as well: the smaller of the two is the window.
function readWindowSeconds(expected, preparedWindowSeconds) {
  const candidates = [MAX_SIGNATURE_SECONDS, expected?.maxTimeoutSeconds, preparedWindowSeconds];
  const valid = candidates.filter((value) => Number.isInteger(value) && value > 0);
  return Math.min(...valid);
}

// THE CLOSED FORM. This bridge declares one effect: one transfer, one payer, one authorization
// entry. An envelope that carries more than that is not this effect, whatever each entry says on its
// own: a second entry signed by the same payer is a second authorization the ledger would honor, and
// an entry for somebody else is an authorization this payer never gave. Both are refused here, at the
// bridge's own gate, before the settlement reader is ever reached. The check is on the shape, not on
// the values: a shape this port does not admit is not narrowed by reading it and liking what it finds.
//
// It runs FIRST, before anything is read as structure or as a signature. What is refused has to be
// refused for the reason this port admits: a reader that walks a list of entries finds something
// wrong inside the first one and reports that instead, which answers a question nobody asked.
function closedAuthorizationShape(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return 'payer authorization entry is missing';
  }
  if (entries.length !== 1) {
    return `this bridge declares one authorization entry and this envelope carries ${entries.length}`;
  }
  return null;
}

// One real Ed25519 check over the entry that is about to be authorized: the SDK's own authorization
// preimage for this network, hashed the way the SDK hashes it, verified with the public key the
// signature carries. A signature that is merely present is not a signature that was verified, and a
// signature made for another network fails here because the network is part of the preimage.
function verifyAuthorizationSignature(transaction, expected, passphrase) {
  const entries = transaction?.operations?.[0]?.auth;
  const shapeError = closedAuthorizationShape(entries);
  if (shapeError) return { verified: false, reason: shapeError };
  let sawPayer = false;
  for (const entry of entries) {
    let node;
    let address;
    let expiration;
    let signature;
    try {
      const credentials = entry.credentials();
      if (credentials.switch().name !== 'sorobanCredentialsAddress') continue;
      node = credentials.address();
    } catch {
      return { verified: false, reason: 'payer authorization entry is invalid' };
    }
    try {
      address = node.address();
      expiration = node.signatureExpirationLedger();
      signature = node.signature();
    } catch {
      return { verified: false, reason: 'payer authorization entry is invalid' };
    }
    try {
      address = Address.fromScAddress(address).toString();
    } catch {
      return { verified: false, reason: 'payer authorization entry is invalid' };
    }
    if (address !== expected.payer) continue;
    sawPayer = true;
    let vector = null;
    try {
      vector = signature.switch().name === 'scvVec' && typeof signature.vec === 'function' ? signature.vec() : null;
    } catch {
      vector = null;
    }
    if (!Array.isArray(vector) || vector.length === 0) {
      return { verified: false, reason: 'authorization signature is missing or unsupported' };
    }
    const first = vector[0];
    let publicKey = null;
    let raw = null;
    try {
      if (first.switch().name !== 'scvMap') throw new Error('not a map');
      for (const item of first.map()) {
        const name = item.key().sym().toString();
        if (name === 'public_key') publicKey = item.val().bytes();
        if (name === 'signature') raw = item.val().bytes();
      }
    } catch {
      return { verified: false, reason: 'authorization signature is not an Ed25519 account signature' };
    }
    let signer = null;
    try {
      if (publicKey && publicKey.length === 32) signer = StrKey.encodeEd25519PublicKey(publicKey);
    } catch {
      signer = null;
    }
    if (!signer || signer !== expected.payer || !raw || raw.length !== 64) {
      return { verified: false, reason: 'authorization signature does not carry the payer public key' };
    }
    let ok = false;
    try {
      const preimage = buildAuthorizationEntryPreimage(entry, expiration, passphrase);
      const payload = createHash('sha256').update(preimage.toXDR()).digest();
      ok = Keypair.fromPublicKey(signer).verify(payload, raw);
    } catch {
      ok = false;
    }
    if (!ok) return { verified: false, reason: 'authorization signature does not verify over this network' };
    return { verified: true, expiration };
  }
  return sawPayer
    ? { verified: false, reason: 'payer authorization entry is missing' }
    : { verified: false, reason: 'payer authorization entry is missing' };
}

// The validity window is checked against the ledger that exists now, not against infinity: an
// authorization that outlives the ceiling this effect declared would still be disclosed to the
// service, so it is refused before the send rather than by the ledger afterwards.
function expirationWithinWindow(expiration, currentLedger, windowSeconds) {
  if (!Number.isSafeInteger(expiration) || expiration <= 0) return false;
  if (!Number.isSafeInteger(currentLedger) || currentLedger < 0) return false;
  if (expiration <= currentLedger) return false;
  return expiration <= currentLedger + Math.ceil(windowSeconds / LEDGER_SECONDS) + LEDGER_TOLERANCE;
}

// A JSON body read through one door, with a bound on bytes, on time and on cancellation. `text()` and
// `json()` were both the wrong door: each materialises whatever the other end chose to send before
// anything counts it, and each ignores the signal the engine handed down. Every refusal below leaves
// the stream cancelled, including the ones that happen before the reader is acquired: a body nobody
// read is a body nobody released, and the other end keeps writing into it.
//
// The caller supplies the label and the byte bound, and the signal is honoured twice: while the
// stream is being read, and once more on the way back, because an abort that arrives during the last
// chunk is an answer nobody is waiting for.
async function readBoundedJson(response, { label, maxBytes, timeoutMs, signal }) {
  throwIfAborted(signal, label);
  const body = response?.body;
  // No stream: this reader cannot bound what it cannot count, and it cannot cancel what it never
  // acquired. The body is refused rather than read whole.
  if (!body || typeof body.getReader !== 'function') {
    throw new Error(`${label} body is not a readable stream`);
  }
  // A declared length over the bound is refused before a single byte is pulled, and the stream is
  // cancelled here too: the refusal is about the body, and the body is what has to be released.
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelBody(body);
    throw new Error(`${label} body is too large`);
  }
  const reader = body.getReader();
  let timer = null;
  let deadline = false;
  const onAbort = () => {
    // Cancelling the reader is what stops the other end from still writing into us.
    Promise.resolve(reader.cancel()).catch(() => {});
  };
  try {
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { deadline = true; onAbort(); }, timeoutMs);
  } catch {
    onAbort();
  }
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      throwIfAborted(signal, label);
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error(`${label} body is too large`);
      chunks.push(Buffer.from(chunk));
    }
  } finally {
    if (timer !== null) clearTimeout(timer);
    try {
      if (signal) signal.removeEventListener('abort', onAbort);
    } catch {
    }
    try {
      // A body nobody finished reading is released here rather than left open.
      await reader.cancel();
    } catch {
    }
  }
  throwIfAborted(signal, label);
  if (deadline) throw new Error(`${label} body did not finish within ${timeoutMs}ms`);
  return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
}

// Cancel a body this reader never took a reader for. Declaring the length over the bound, or finding
// no stream at all, both end here: the refusal is not a reason to leave the connection open.
async function cancelBody(body) {
  try {
    if (body && typeof body.cancel === 'function') await body.cancel();
    else if (body && typeof body.getReader === 'function') await body.getReader().cancel();
  } catch {
    // A stream that refuses to be cancelled is already gone as far as this port is concerned.
  }
}

// The ledger of the configured network, read through the same bounded door as everything else. It is
// the injection point `readCurrentLedger` replaces, so a host (or a test) can supply its own. The
// signal is passed down to the exchange and revalidated when the answer arrives: a ledger read nobody
// is waiting for did not check a window.
function rpcLedgerReader(url) {
  return async (signal) => {
    const response = await fetchBounded(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
    }, signal);
    if (!response || response.ok === false) throw new Error('the ledger could not be read');
    let answer = null;
    try {
      answer = await readBoundedJson(response, {
        label: 'ledger response',
        maxBytes: MAX_BODY_BYTES,
        timeoutMs: BODY_READ_TIMEOUT_MS,
        signal,
      });
    } catch (error) {
      throwIfAborted(signal, 'ledger read');
      throw error;
    }
    throwIfAborted(signal, 'ledger read');
    const sequence = answer?.result?.sequence;
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('the ledger reader returned no sequence');
    return sequence;
  };
}

// The paid body, through the same door and with the same two refusals the paid answer can end on.
async function readBodyWithLimit(response, signal) {
  return readBoundedJson(response, {
    label: 'paid response',
    maxBytes: MAX_BODY_BYTES,
    timeoutMs: BODY_READ_TIMEOUT_MS,
    signal,
  });
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
export function createStellarPorts({ serviceUrl, payTo, secret, issuer = ISSUER, network = NETWORK, rpcUrl = RPC_URL, horizonUrl, claims, readCurrentLedger, createPaymentPayload } = {}) {
  const recipient = requirePublicKey(payTo);
  if (!secret) throw new Error('CLIENT_SECRET is required for the payment path');
  // The claims store is the host's, and the host has to say so. A store fabricated here would be one
  // store per construction: two bridges in one process, or one bridge rebuilt after a restart, would
  // each deduplicate on their own and the same operation could be paid twice. Refused before any I/O.
  if (!claims || typeof claims.reserveEffect !== 'function' || typeof claims.claimTransaction !== 'function') {
    throw new Error('the reference bridge requires an explicit claims store: pass claims (createMemoryPaymentClaims() lives in the memory of one process, so a recoverable application needs a durable atomic store of its own)');
  }
  // Building this object performs no I/O. `new x402Client()` reaches the network to read the
  // facilitator kinds, so the client is built on first use and only when the payload builder is the
  // real scheme: a bridge assembled with its own payload builder never opens a socket.
  let client = null;
  let httpClient = null;
  const http = () => {
    if (httpClient === null) {
      client = new x402Client().register('stellar:*', new ExactStellarScheme(createEd25519Signer(secret, network), { url: rpcUrl }));
      httpClient = new x402HTTPClient(client);
    }
    return httpClient;
  };
  const payer = Keypair.fromSecret(secret).publicKey();
  const passphrase = getNetworkPassphrase(network);
  // One record per prepared authorization, keyed by the authorization itself, holding the closed
  // payload copy that goes on the wire. A second preparation cannot overwrite the first one, and the
  // send that carries an authorization consumes its record, so what was inspected is what is sent.
  const prepared = new Map();
  // What left on the wire, kept as an identity and not as a payload. A record consumed by a send is
  // deleted from `prepared` so it cannot be read twice, and this set is why it cannot be prepared
  // again either: the same bytes coming back from the builder are the same authorization, and a
  // second send of them would be a second payment for one preparation. The set holds digests, not
  // envelopes, so nothing that was signed is kept in memory twice.
  const spent = new Set();
  // One authorization digest names one identity. A digest is read from the closed envelope, once,
  // and it is what both `prepared` and `spent` are keyed by: an identity is a fact about the bytes,
  // not about the object the builder happened to hand over this time.
  const identityOf = (authorization) => {
    try {
      return createHash('sha256').update(authorization, 'utf8').digest('hex');
    } catch {
      return null;
    }
  };
  // The ledger of this network, read before every inspection. Nothing is inspected as verified
  // against a window nobody measured.
  const ledgerReader = readCurrentLedger || rpcLedgerReader(rpcUrl);
  // The fall-off (see the header): before the bound is consulted, the records that can no longer be
  // sent are removed. A record dies when the ledger of right now has already passed the expiration
  // ledger its authorization names; that comparison needs a ledger, so an unreadable one removes
  // nothing and the bound answers as it always did. Dropping a record is not a resend: it never
  // left this port, and its identity is not added to `spent`, so the reservation it held is simply
  // given back and the identity can be prepared again from fresh bytes.
  const dropUnsendable = (currentLedger) => {
    if (!Number.isSafeInteger(currentLedger) || currentLedger < 0) return 0;
    let dropped = 0;
    for (const [identity, record] of [...prepared]) {
      const expiration = record?.expirationLedger;
      if (!Number.isSafeInteger(expiration) || expiration <= 0) continue;
      if (expiration > currentLedger) continue;
      prepared.delete(identity);
      dropped++;
    }
    return dropped;
  };
  // The port's own deadline over a ledger read. `fetchBounded` bounds the exchange this port builds for
// itself, but a reader the host injected is host code: one that never answers would otherwise hold a
// paid run open with nobody waiting for it. The deadline is short and it ends in a refusal, never in
// a number: a window this port did not measure is not a window it checked.
const LEDGER_READ_TIMEOUT_MS = 10_000;
// The read is bounded on the way out and revalidated on the way back, so the two answers a ledger
// can give (a sequence, or nothing) are the only two this port accepts.
const readLedgerBounded = async (signal) => {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  try {
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  } catch {
    controller.abort();
  }
  let timer = null;
  try {
    timer = setTimeout(() => controller.abort(), LEDGER_READ_TIMEOUT_MS);
    const ledger = await ledgerReader(controller.signal);
    // The answer arrived; the caller may have given up while it was reading. An answer nobody is
    // waiting for did not check a window.
    throwIfAborted(signal, 'ledger read');
    return ledger;
  } finally {
    if (timer !== null) clearTimeout(timer);
    try {
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    } catch {
    }
  }
};

// Read the ledger and drop what died. Never throws: this runs on the path of a payment and a
// failed read must leave the records alone rather than empty the map on a guess.
const sweepUnsendable = async (signal) => {
  try {
    return dropUnsendable(await readLedgerBounded(signal));
  } catch {
    return 0;
  }
};

  const discover = async ({ url, method, redirect, signal }) => {
    if (redirect !== 'error' || method !== 'GET') throw new Error('discovery is a GET without redirects');
    const response = await fetchBounded(url, { method: 'GET' }, signal);
    if (response.status !== 402) return { status: response.status };
    let paymentRequired;
    try {
      paymentRequired = http().getPaymentRequiredResponse((name) => response.headers.get(name));
    } catch {
      return { status: response.status };
    }
    return { status: response.status, paymentRequired };
  };

  const prepare = async ({ terms, expected, signal }) => {
    throwIfAborted(signal, 'prepare');
    const request = { x402Version: 2, resource: { url: serviceUrl }, accepts: [terms] };
    const raw = await (createPaymentPayload || ((req) => client.createPaymentPayload(req)))(request);
    throwIfAborted(signal, 'prepare');
    let closed = closedPaymentPayload(raw);
    const transaction = new Transaction(closed.payload.transaction, passphrase);
    const sorobanData = transaction.toEnvelope().v1()?.tx()?.ext()?.sorobanData();
    if (sorobanData) {
      closed = {
        x402Version: closed.x402Version,
        payload: {
          transaction: TransactionBuilder
            .cloneFrom(transaction, { fee: '1', sorobanData, networkPassphrase: passphrase })
            .build()
            .toXDR(),
        },
      };
    }
    throwIfAborted(signal, 'prepare');
    // The identity of this authorization is read once, here, and it decides what happens below: an
    // identity already reserved is not reserved again, and an identity already spent is refused
    // outright. Both refusals happen before a byte is signed twice and before any record is written.
    const identity = identityOf(closed.payload.transaction);
    if (identity === null) throw new Error('the prepared authorization has no readable identity');
    if (spent.has(identity)) {
      throw new Error('this authorization already went on the wire: preparing it again would pay the same authorization twice');
    }
    if (prepared.has(identity)) {
      throw new Error('this authorization is already reserved by an earlier preparation: a second record would overwrite the one the send reads');
    }
    // The fall-off runs before the bound: records that can no longer be sent are removed, so a bound
    // filled with dead authorizations does not refuse a payment that is entirely payable. Only a
    // bound still full of live records refuses, and it refuses with the bound in the message.
    if (prepared.size >= MAX_PENDING_AUTHORIZATIONS) {
      await sweepUnsendable(signal);
    }
    if (prepared.size >= MAX_PENDING_AUTHORIZATIONS) {
      throw new Error(`prepared authorizations are not being sent: this port keeps ${MAX_PENDING_AUTHORIZATIONS} at most`);
    }
    prepared.set(identity, {
      authorization: closed.payload.transaction,
      payload: closed,
      windowSeconds: terms?.maxTimeoutSeconds,
      expirationLedger: expirationLedgerOf(closed.payload.transaction),
    });
    return { authorization: closed.payload.transaction };
  };

  const inspectPrepared = async (authorization, { expected, signal }) => {
    throwIfAborted(signal, 'inspect');
    const authDigest = authDigestFromEnvelope(authorization, network);
    const transaction = new Transaction(authorization, passphrase);
    // The closed form comes first, before anything is read as structure or as a signature: an
    // envelope this port does not admit is refused for the shape, not for whatever a reader finds
    // while walking an envelope it was never meant to walk.
    const shapeError = closedAuthorizationShape(transaction?.operations?.[0]?.auth);
    if (shapeError) {
      return { verified: false, authDigest: authDigest || undefined, checks: {}, reason: shapeError };
    }
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
    // The structure matched. Now the two things a structure cannot tell: that the payer's signature
    // really is an Ed25519 signature over this network's authorization preimage, and that the
    // authorization is inside a window that still exists against the ledger of right now.
    const signature = verifyAuthorizationSignature(transaction, expected, passphrase);
    if (!signature.verified) {
      return { verified: false, authDigest: authDigest || undefined, checks: verdict.checks || {}, reason: signature.reason };
    }
    let currentLedger;
    try {
      currentLedger = await readLedgerBounded(signal);
    } catch {
      return {
        verified: false,
        authDigest: authDigest || undefined,
        checks: verdict.checks || {},
        reason: 'the current ledger could not be read, so the authorization window was not checked',
      };
    }
    const identity = identityOf(authorization);
    const record = identity === null ? undefined : prepared.get(identity);
    const windowSeconds = readWindowSeconds(expected, record?.windowSeconds);
    if (!expirationWithinWindow(signature.expiration, currentLedger, windowSeconds)) {
      return {
        verified: false,
        authDigest: authDigest || undefined,
        checks: verdict.checks || {},
        reason: `payer authorization expiration ${signature.expiration} is outside the ${windowSeconds}s window that ledger ${currentLedger} leaves open`,
      };
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
      checks: { ...(verdict.checks || { prepared: true }), signature: true, window: true },
      reason: verdict.reason || 'prepared transaction matches declared effect',
    };
  };

  const sendPaid = async ({ url, authorization, idempotencyKey, signal }) => {
    throwIfAborted(signal, 'send');
    // The record is taken, not read, and only for the authorization this request carries: what the
    // kernel inspected is what leaves, and an authorization that already left cannot leave again.
    // The identity is the digest of the bytes this request carries, so a caller cannot name a record
    // it did not prepare, and a record it already consumed is gone from the map and from here.
    const identity = typeof authorization === 'string' ? identityOf(authorization) : null;
    const record = identity === null ? undefined : prepared.get(identity);
    if (!record || record.authorization !== authorization) {
      throw new Error('the paid request does not carry the authorization that was inspected');
    }
    // Consumed before the wire, not after: whatever the answer turns out to be, these bytes have
    // left this port once and only once, and `spent` is what says so for the rest of the process.
    prepared.delete(identity);
    spent.add(identity);
    const headers = {
      ...http().encodePaymentSignatureHeader(record.payload),
      // Only a hint: a provider that does not honour it is not made to honour it here.
      'idempotency-key': idempotencyKey,
    };
    const response = await fetchBounded(url, { headers }, signal);
    throwIfAborted(signal, 'send');
    let settlement = null;
    try {
      settlement = http().getPaymentSettleResponse((name) => response.headers.get(name));
    } catch {
      settlement = null;
    }
    return {
      status: response.status,
      settlement: settlement ? { ...settlement } : null,
      readBody: (innerSignal) => readBodyWithLimit(response, innerSignal || signal),
    };
  };

  // HTTPS anywhere, plain HTTP only on loopback: the same rule the kernel applies to the service
  // url, so a Horizon read cannot be pointed at a cleartext host that is not the local machine.
  const horizonTarget = horizonUrl || 'https://horizon-testnet.stellar.org';
  const horizonHost = (() => { try { return new URL(horizonTarget).hostname; } catch { return ''; } })();
  const allowHorizonHttp = horizonHost === 'localhost' || horizonHost === '127.0.0.1' || horizonHost === '[::1]';

  // A Horizon whose reads carry this run's signal all the way to `fetch`.
  //
  // The reader already passed the signal down, and already checked it before every read, and that was
  // not enough: the checks only see an abort that arrives between reads, so a read already in flight
  // ran to its answer and the abort was noticed one round trip later. The SDK gives a call builder no
  // place to put a signal — `call()` takes no arguments, and its request path overwrites the signal on
  // the config it is given — so the only channel left is the client's own fetch options, which is
  // what the adapter ends up passing to `fetch`.
  //
  // It is installed per settlement read, on a Horizon built for that read, so two verifications
  // running at once carry their own signals instead of whichever registered last. `maxRedirects` and
  // `maxContentLength` are set because that is what engages this client's own bounded adapter, which
  // is the path that honours `fetchOptions` and the bounds; the default one is not this port's to
  // trust with an unbounded settlement read.
  const horizonFor = (signal) => {
    const server = new Horizon.Server(horizonTarget, { allowHttp: allowHorizonHttp });
    if (signal && server.httpClient && server.httpClient.interceptors) {
      server.httpClient.interceptors.request.use((config) => ({
        ...config,
        maxRedirects: MAX_REDIRECTS,
        maxContentLength: MAX_BODY_BYTES,
        fetchOptions: { ...(config.fetchOptions || {}), signal },
      }));
    }
    return server;
  };

  const verifySettlement = async (evidence, { expected, authDigest, signal }) => {
    throwIfAborted(signal, 'verify settlement');
    // The reader from settlement.js, reached through the alias: this port used to be named after it
    // and called itself, so every real payment ended `not_verified` without consulting the ledger.
    // The evidence is passed as the kernel wrote it. Overwriting `authDigest` here would hide a
    // disagreement between what the engine holds and what it is verifying.
    const verdict = await readSettlementFromLedger(evidence, {
      horizon: horizonFor(signal),
      payer: expected.payer,
      payTo: expected.payTo,
      amount: expected.amount,
      issuer,
      assetContract: expected.asset,
      network,
      requireAuthDigest: true,
      // The signal travels with the evidence, and the Horizon above carries it to `fetch`. A
      // settlement read is three Horizon round trips, and a run that gave up while the first one was
      // in flight has to stop that read as well as the other two: the reader checks the signal before
      // every read and once more after the answer, and the read itself ends when the abort arrives.
      signal,
    });
    throwIfAborted(signal, 'verify settlement');
    return { verified: verdict.verified === true, checks: verdict.checks || {}, reason: verdict.reason || 'settlement did not match' };
  };

  // The same shape the historical adapter checked: a marketing plan, not any JSON at all. The digest
  // is what the kernel contract would require of a delivery: a body nobody hashed is not a covered
  // delivery. Unverified here, see the header.
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
    claims,
  };
}

// The reference endpoint serves one operation; the query says which, as it always has.
function serviceEndpoint(base) {
  const url = new URL(base);
  url.searchParams.set('service', 'marketing-plan');
  return url.toString();
}

// The declaration and the ports together would be the whole capability: the kernel would own the
// fixed effect, the order, the deduplication and the receipt verdict, and this adapter would own
// Stellar, x402 and HTTP. Nothing calls this yet, see the header.
export function createMarketingPlanPayment({ serviceUrl, payTo, secret, claims, horizonUrl, rpcUrl, network, issuer, readCurrentLedger, createPaymentPayload } = {}) {
  const recipient = requirePublicKey(payTo);
  const payer = secret ? Keypair.fromSecret(secret).publicKey() : '';
  // This factory declares one network and one asset. A caller that names another one is not
  // configuring a variant: it is opening a payment that no terms of this reference could describe,
  // and the contradiction is refused here, before any key is used.
  if (network !== undefined && network !== NETWORK) {
    throw new Error(`this reference factory declares ${NETWORK} and refuses a bridge on ${network}`);
  }
  if (issuer !== undefined && issuer !== ISSUER) {
    throw new Error(`this reference factory declares issuer ${ISSUER} and refuses another issuer`);
  }
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
  }, createStellarPorts({
    serviceUrl: endpoint,
    payTo: recipient,
    secret,
    claims,
    horizonUrl,
    rpcUrl,
    network: NETWORK,
    issuer: ISSUER,
    readCurrentLedger,
    createPaymentPayload,
  }));
}

export { createX402Payment };
