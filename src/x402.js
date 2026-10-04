'use strict';

// The x402 paid-effect contract, promoted into the kernel with the network, the signer and the
// settlement reader left as injected ports.
//
// What this module governs: the fixed declaration of the paid effect, the selection of authorized
// terms, the order (discover, reserve, prepare, inspect, recheck, send, deliver, verify), the
// association with the prepared authorization, local deduplication of the effect and of the settled
// transaction, and the receipt verdict. What it never does: implement Stellar signing, XDR, HTTP,
// facilitation or Horizon reads. Without ports there is no payment: importing this module performs
// no I/O and produces no receipt.
//
// Every port is trusted host code, not a sandbox. A port that ignores its signal can keep acting
// after this module gave up, and a port that lies is believed only after an independent check
// returned true; that limit belongs to whoever writes the ports.

const { sufficient } = require('./authority.js');
const { runOperation } = require('./operation.js');
const { parseTime } = require('./time.js');
const { createHash } = require('node:crypto');

// A canonical positive decimal amount, at most 78 digits, no sign, no exponent, no leading zero.
const ATOMIC = /^[1-9][0-9]{0,77}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_TEXT = 512;
const MIN_WINDOW_SECONDS = 1;
const MAX_WINDOW_SECONDS = 300;
const DEFAULT_CLAIM_CAPACITY = 10_000;
const MIN_CLAIM_CAPACITY = 1;
const MAX_ACCEPTS = 64;
const MAX_SPEC_DEPTH = 8;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SUPPORTED_SCHEME = 'exact';
const SUPPORTED_VERSION = 2;
const ALLOWED_EXTRA_KEYS = new Set(['areFeesSponsored', 'paymentFlow']);
const SUPPORTED_PAYMENT_FLOWS = new Set(['authorization']);

// Public codes. The catalog is fixed: every rejection a receipt can carry comes from here, so a
// reader never has to interpret a free text written by a port.
const CODES = {
  INVALID_SPEC: 'INVALID_SPEC',
  INVALID_PORT: 'INVALID_PORT',
  INVALID_CLOCK: 'INVALID_CLOCK',
  DISCOVERY_FAILED: 'DISCOVERY_FAILED',
  TERMS_REJECTED: 'TERMS_REJECTED',
  AUTHORITY_EXPIRED: 'AUTHORITY_EXPIRED',
  PREPARE_FAILED: 'PREPARE_FAILED',
  PREPARED_REJECTED: 'PREPARED_REJECTED',
  ABORTED: 'ABORTED',
  DUPLICATE_EFFECT: 'DUPLICATE_EFFECT',
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
  CLAIMS_CAPACITY: 'CLAIMS_CAPACITY',
  SEND_UNKNOWN: 'SEND_UNKNOWN',
  SETTLEMENT_REJECTED: 'SETTLEMENT_REJECTED',
  DELIVERY_REJECTED: 'DELIVERY_REJECTED',
  VERIFIER_FAILED: 'VERIFIER_FAILED',
};

const EXIT = 'return to the person: change the agreement or cancel';

function specError() {
  const error = new Error('x402 spec is invalid');
  error.code = 'VESPI_X402_INVALID_SPEC';
  return error;
}

function portError() {
  const error = new Error('x402 ports are invalid');
  error.code = 'VESPI_X402_INVALID_PORT';
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

// A spec that carries its own cycle cannot be canonicalized, frozen or hashed later. Refusing it
// here keeps every later read of the declaration total.
function hasCycle(value, depth = 0, seen = new Set()) {
  if (depth > MAX_SPEC_DEPTH) return true;
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  let cyclic = false;
  try {
    for (const key of Object.keys(value)) {
      if (hasCycle(value[key], depth + 1, seen)) {
        cyclic = true;
        break;
      }
    }
  } catch {
    return true;
  }
  seen.delete(value);
  return cyclic;
}

function readText(source, key) {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT) throw specError();
  return value;
}

// HTTPS anywhere, or HTTP only on the loopback host: a paid effect never leaves in the clear.
function readUrl(source) {
  const raw = readText(source, 'url');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw specError();
  }
  if (parsed.hash !== '' || parsed.username !== '' || parsed.password !== '') throw specError();
  if (parsed.protocol === 'https:') return parsed.toString();
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return parsed.toString();
  throw specError();
}

function readAmount(source) {
  const value = source.amount;
  if (typeof value !== 'string' || !ATOMIC.test(value)) throw specError();
  return value;
}

function readWindow(source) {
  const value = source.maxTimeoutSeconds;
  if (!Number.isInteger(value) || value < MIN_WINDOW_SECONDS || value > MAX_WINDOW_SECONDS) throw specError();
  return value;
}

function readSpec(raw) {
  if (!isPlainObject(raw)) throw specError();
  if (hasCycle(raw)) throw specError();
  let frozen;
  try {
    frozen = Object.freeze({
      id: readText(raw, 'id'),
      url: readUrl(raw),
      method: readText(raw, 'method'),
      network: readText(raw, 'network'),
      asset: readText(raw, 'asset'),
      grantAsset: readText(raw, 'grantAsset'),
      payer: readText(raw, 'payer'),
      payTo: readText(raw, 'payTo'),
      amount: readAmount(raw),
      maxTimeoutSeconds: readWindow(raw),
    });
  } catch (error) {
    if (error instanceof Error && error.code === 'VESPI_X402_INVALID_SPEC') throw error;
    throw specError();
  }
  if (frozen.method !== 'GET') throw specError();
  return frozen;
}

function readPorts(raw) {
  if (!isPlainObject(raw)) throw portError();
  let ports;
  try {
    const http = raw.http;
    const signer = raw.signer;
    if (!isPlainObject(http) || typeof http.discover !== 'function' || typeof http.sendPaid !== 'function') throw portError();
    if (!isPlainObject(signer) || typeof signer.prepare !== 'function') throw portError();
    if (typeof raw.inspectPrepared !== 'function') throw portError();
    if (typeof raw.verifySettlement !== 'function') throw portError();
    if (typeof raw.validateOutput !== 'function') throw portError();
    let claims = null;
    if (raw.claims !== undefined && raw.claims !== null) {
      if (!isPlainObject(raw.claims) || typeof raw.claims.reserveEffect !== 'function' || typeof raw.claims.claimTransaction !== 'function') {
        throw portError();
      }
      claims = { reserveEffect: raw.claims.reserveEffect, claimTransaction: raw.claims.claimTransaction };
    }
    ports = {
      discover: http.discover,
      sendPaid: http.sendPaid,
      prepare: signer.prepare,
      inspectPrepared: raw.inspectPrepared,
      verifySettlement: raw.verifySettlement,
      validateOutput: raw.validateOutput,
      claims,
    };
  } catch (error) {
    if (error instanceof Error && error.code === 'VESPI_X402_INVALID_PORT') throw error;
    throw portError();
  }
  return ports;
}

// The expected effect a settlement has to match, built from the declaration and never from what the
// server said. The grant asset is the authority identifier and may differ from the protocol asset.
function expectedEffect(spec) {
  return Object.freeze({
    network: spec.network,
    asset: spec.asset,
    payer: spec.payer,
    payTo: spec.payTo,
    amount: spec.amount,
  });
}

function requirementOf(spec) {
  return Object.freeze({ asset: spec.grantAsset, amount: spec.amount, to: spec.payTo });
}

function sameEffect(effect, expected) {
  if (!isPlainObject(effect)) return false;
  for (const key of Object.keys(expected)) {
    if (effect[key] !== expected[key]) return false;
  }
  return true;
}

// The set of keys allowed inside `extra`. A server that adds an economic field the kernel does not
// understand is refused instead of being silently ignored: an unknown key is a possible new flow.
function extraIsSupported(extra) {
  if (extra === undefined) return false;
  if (!isPlainObject(extra)) return false;
  for (const key of Object.keys(extra)) {
    if (!ALLOWED_EXTRA_KEYS.has(key)) return false;
  }
  if (extra.areFeesSponsored !== true) return false;
  if (extra.paymentFlow !== undefined && !SUPPORTED_PAYMENT_FLOWS.has(extra.paymentFlow)) return false;
  return true;
}

// One offer is acceptable only when it is the declared effect, exactly. A smaller amount is not a
// discount this kernel accepts, and a larger one is not covered by the ceiling: the amount is
// compared as a canonical decimal, never as a bound.
function offerIsExact(offer, spec) {
  if (!isPlainObject(offer)) return false;
  if (offer.scheme !== SUPPORTED_SCHEME) return false;
  if (offer.network !== spec.network) return false;
  if (offer.asset !== spec.asset) return false;
  if (offer.payTo !== spec.payTo) return false;
  if (typeof offer.amount !== 'string' || !ATOMIC.test(offer.amount) || offer.amount !== spec.amount) return false;
  if (!Number.isInteger(offer.maxTimeoutSeconds)) return false;
  if (offer.maxTimeoutSeconds < MIN_WINDOW_SECONDS || offer.maxTimeoutSeconds > MAX_WINDOW_SECONDS) return false;
  return extraIsSupported(offer.extra);
}

function copyTerms(spec, offer) {
  const extra = {};
  for (const key of Object.keys(offer.extra)) {
    // An absent field stays absent: writing it as an explicit undefined would change what the terms
    // say to whoever signs them.
    if (offer.extra[key] === undefined) continue;
    extra[key] = offer.extra[key];
  }
  return Object.freeze({
    scheme: SUPPORTED_SCHEME,
    network: spec.network,
    asset: spec.asset,
    payTo: spec.payTo,
    amount: spec.amount,
    maxTimeoutSeconds: offer.maxTimeoutSeconds,
    extra: Object.freeze(extra),
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// The authority on hand has to name this recipient: a wildcard grant is a permission to spend
// somewhere, not to pay this particular counterparty, so it does not authorize this payment.
function liveGrant(authority, spec, now) {
  const requirement = requirementOf(spec);
  const grants = Array.isArray(authority?.spend) ? authority.spend : [];
  let named = false;
  let expired = false;
  let wideEnough = false;
  for (const entry of grants) {
    if (!isPlainObject(entry)) continue;
    if (entry.asset !== requirement.asset || entry.to !== requirement.to) continue;
    named = true;
    const live = entry.expiresAt === undefined || (parseTime(entry.expiresAt) !== null && parseTime(entry.expiresAt) > now);
    if (!live) expired = true;
    // A ceiling that no longer reaches the declared amount is not a grant for this payment, however
    // generously it reads: an amount is compared as a canonical decimal, never as a bound.
    try {
      if (ATOMIC.test(String(entry.maxAmount)) && BigInt(String(entry.maxAmount)) >= BigInt(requirement.amount)) {
        wideEnough = true;
      }
    } catch {
    }
  }
  if (expired) return { ok: false, code: CODES.AUTHORITY_EXPIRED };
  if (!named || !wideEnough) return { ok: false, code: CODES.TERMS_REJECTED };
  return { ok: true };
}

function readAccepts(required, spec) {
  // A payload that is not an object at all is a malformed declaration, not a mismatch of terms.
  if (!isPlainObject(required)) throw specError();
  if (required.x402Version !== SUPPORTED_VERSION) return null;
  if (!isPlainObject(required.resource)) return null;
  // The resource has to be exactly the canonical url the declaration fixed. A relative resource, a
  // fragment, a different host or an uncanonical spelling is not the same resource.
  if (required.resource.url !== spec.url) return null;
  const accepts = required.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0 || accepts.length > MAX_ACCEPTS) return null;
  return accepts;
}

function selectX402Terms(required, rawSpec, authority, now) {
  let spec;
  try {
    spec = readSpec(rawSpec);
  } catch {
    return { ok: false, code: CODES.INVALID_SPEC };
  }
  let accepts;
  try {
    accepts = readAccepts(required, spec);
  } catch {
    return { ok: false, code: CODES.INVALID_SPEC };
  }
  if (accepts === null) return { ok: false, code: CODES.TERMS_REJECTED };

  const moment = parseTime(now === undefined || now === null ? Date.now() : now);
  if (moment === null) return { ok: false, code: CODES.INVALID_CLOCK };

  const cover = liveGrant(authority, spec, moment);
  if (!cover.ok) return cover;
  try {
    const check = sufficient([requirementOf(spec)], authority, { now: moment });
    if (!check || check.ok !== true) return { ok: false, code: CODES.TERMS_REJECTED };
  } catch {
    return { ok: false, code: CODES.TERMS_REJECTED };
  }

  for (const candidate of accepts) {
    let exact = false;
    try {
      exact = offerIsExact(candidate, spec);
    } catch {
      exact = false;
    }
    if (exact) return { ok: true, terms: copyTerms(spec, candidate) };
  }
  return { ok: false, code: CODES.TERMS_REJECTED };
}

function createMemoryPaymentClaims() {
  return { reserveEffect: () => 'capacity', claimTransaction: () => 'capacity' };
}

// Only these options reach the engine. `verify` is deliberately absent: this contract installs its
// own verifier, so a host cannot hand the payment a verifier that trusts the signer.
const ALLOWED_IO_KEYS = [
  'ask', 'decide', 'decideThreshold', 'decideTimeoutMs', 'now',
  'askTimeoutMs', 'performTimeoutMs', 'verifyTimeoutMs',
];
const DEFAULT_VERIFY_TIMEOUT_MS = 15_000;

// The run clock is a synchronous contract, the same one the engine uses. An injected clock that is
// invalid or asynchronous cannot authorize an effect, so the run stops before any port is called.
function readRunNow(io) {
  let clock;
  try {
    clock = io?.now;
  } catch {
    return null;
  }
  if (typeof clock !== 'function') return Date.now();
  let value;
  try {
    value = clock.call(io);
  } catch {
    return null;
  }
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    try {
      if (typeof value.then === 'function') {
        Promise.resolve(value).catch(() => {});
        return null;
      }
    } catch {
      return null;
    }
  }
  const parsed = parseTime(value);
  return parsed === null ? null : parsed;
}

// A required() that names an asset the authority mentions for somebody else is not a request for
// permission: it is a payment this agreement cannot make, so it comes back blocked with its exit.
// An authority that says nothing about the asset is left to the human gate, which may still say yes.
function requiredFor(spec, op) {
  const declared = { spend: [{ asset: spec.grantAsset, amount: spec.amount, to: spec.payTo }] };
  let granted;
  try {
    granted = Array.isArray(op?.authority?.spend) ? op.authority.spend : [];
  } catch {
    return declared;
  }
  let mentionsAsset = false;
  let namesRecipient = false;
  for (const entry of granted) {
    if (!isPlainObject(entry) || entry.asset !== spec.grantAsset) continue;
    mentionsAsset = true;
    if (entry.to === spec.payTo) namesRecipient = true;
  }
  if (mentionsAsset && !namesRecipient) {
    return { impossible: true, reason: CODES.TERMS_REJECTED, exit: EXIT };
  }
  return declared;
}

function blocked(code) {
  return { ok: false, impossible: true, reason: code, exit: EXIT };
}

function failed(code) {
  return { ok: false, error: code };
}

function abortedRead(signal) {
  try {
    return Boolean(signal?.aborted);
  } catch {
    return false;
  }
}

async function discoverRequired(ports, spec, signal) {
  let discovered;
  try {
    discovered = await ports.discover({ url: spec.url, method: spec.method, redirect: 'error', signal });
  } catch {
    return { ok: false, code: CODES.DISCOVERY_FAILED };
  }
  if (abortedRead(signal)) return { ok: false, code: CODES.ABORTED };
  if (!isPlainObject(discovered) || discovered.status !== 402 || !isPlainObject(discovered.paymentRequired)) {
    return { ok: false, code: CODES.DISCOVERY_FAILED };
  }
  return { ok: true, paymentRequired: discovered.paymentRequired };
}

// The signer is trusted to produce an authorization and nothing else. What that authorization
// contains is read by a different port, so a signer that says "verified" about its own output buys
// nothing here.
async function prepareAuthorization(ctx) {
  let prepared;
  try {
    prepared = await ctx.ports.prepare({ terms: ctx.terms, expected: ctx.expected, signal: ctx.signal });
  } catch {
    return { ok: false, code: CODES.PREPARE_FAILED };
  }
  if (abortedRead(ctx.signal)) return { ok: false, code: CODES.ABORTED };
  let authorization = null;
  try {
    authorization = typeof prepared?.authorization === 'string' && prepared.authorization.trim().length > 0
      ? prepared.authorization : null;
  } catch {
    authorization = null;
  }
  if (!authorization) return { ok: false, code: CODES.PREPARE_FAILED };
  return { ok: true, authorization };
}

// The inspection has to be a positive, complete, boolean-only verdict about the authorization that
// exists right now: `prepared` true, a reason in words, an authorization digest computed from the
// authorization bytes, and the very effect that was declared. One missing or false control stops
// the send.
function inspectionIsAcceptable(result, expected) {
  if (!isPlainObject(result)) return false;
  if (result.verified !== true) return false;
  if (typeof result.reason !== 'string' || result.reason.length === 0) return false;
  if (typeof result.authDigest !== 'string' || !HASH.test(result.authDigest)) return false;
  if (!isPlainObject(result.checks)) return false;
  let booleanOnly = true;
  for (const key of Object.keys(result.checks)) {
    if (typeof result.checks[key] !== 'boolean') booleanOnly = false;
  }
  if (!booleanOnly) return false;
  if (result.checks.prepared !== true) return false;
  return sameEffect(result.effect, expected);
}

async function inspectAuthorization(ctx, authorization) {
  let result;
  try {
    result = await ctx.ports.inspectPrepared(authorization, { expected: ctx.expected, signal: ctx.signal });
  } catch {
    // An inspector that cannot read the authorization is a failed run, not a refusal of terms.
    return { ok: false, code: CODES.PREPARED_REJECTED, failure: true };
  }
  if (abortedRead(ctx.signal)) return { ok: false, code: CODES.ABORTED, failure: true };
  let acceptable = false;
  try {
    acceptable = inspectionIsAcceptable(result, ctx.expected);
  } catch {
    acceptable = false;
  }
  if (!acceptable) return { ok: false, code: CODES.PREPARED_REJECTED };
  let digest = null;
  try {
    digest = HASH.test(result.authDigest) ? result.authDigest : null;
  } catch {
    digest = null;
  }
  return { ok: true, authDigest: digest };
}

// Group D stops here on purpose: the send, the delivery and the settlement verifier are built by
// the group that tests them. Nothing past this point reaches a receipt yet.
async function perform(ctx, spec, ports, io) {
  const now = ctx.now;
  const cover = liveGrant(ctx.authority, spec, now);
  if (!cover.ok) return blocked(cover.code);

  const discovered = await discoverRequired(ports, spec, ctx.signal);
  if (!discovered.ok) return failed(discovered.code);

  const chosen = selectX402Terms(discovered.paymentRequired, spec, ctx.authority, now);
  if (!chosen.ok) return blocked(chosen.code);
  ctx.terms = chosen.terms;

  const afterDiscovery = liveGrant(ctx.authority, spec, now);
  if (!afterDiscovery.ok) return blocked(afterDiscovery.code);

  const prepared = await prepareAuthorization(ctx);
  if (!prepared.ok) return prepared.code === CODES.ABORTED ? failed(prepared.code) : failed(prepared.code);

  const inspected = await inspectAuthorization(ctx, prepared.authorization);
  if (!inspected.ok) {
    if (inspected.failure) return failed(inspected.code);
    return blocked(inspected.code);
  }
  ctx.authDigest = inspected.authDigest;

  const beforeSend = liveGrant(ctx.authority, spec, now);
  if (!beforeSend.ok) return blocked(beforeSend.code);

  ctx.trace.push('recheck');
  throw new Error('x402 contract: the send stage is not built yet');
}

// Installed by this contract, not by the host. Replaced by the settlement verifier in group E.
function privateVerifier(ctx) {
  return { verified: false, checks: {}, reason: `settlement evidence for ${ctx.expected.payTo} is not verified by this build` };
}

function buildRunIo(io, ctx) {
  let runIo = {};
  if (io !== null && typeof io === 'object') runIo = { ...io };
  for (const key of Object.keys(runIo)) {
    if (!ALLOWED_IO_KEYS.includes(key)) delete runIo[key];
  }
  runIo.verify = (evidence) => privateVerifier(ctx, evidence);
  return runIo;
}

function createX402Payment(rawSpec, rawPorts) {
  const spec = readSpec(rawSpec);
  const ports = readPorts(rawPorts);
  return {
    id: spec.id,
    required: (op) => requiredFor(spec, op),
    run: async (op, io) => {
      if (!isPlainObject(op)) throw specError();
      // Every run owns its capability and its private context: no authDigest and no expectation is
      // ever shared between two concurrent runs of the same payment.
      const ctx = {
        spec,
        ports,
        io,
        expected: expectedEffect(spec),
        requirement: requirementOf(spec),
        now: null,
        authority: null,
        trace: [],
        authDigest: null,
        sendStarted: false,
      };
      const capability = {
        id: spec.id,
        required: (operation) => requiredFor(spec, operation),
        perform: async (performCtx) => {
          ctx.authority = performCtx?.authority ?? null;
          ctx.operationKey = performCtx?.idempotencyKey ?? null;
          ctx.signal = performCtx?.signal ?? null;
          const now = readRunNow(io);
          if (now === null) return failed(CODES.INVALID_CLOCK);
          ctx.now = now;
          return perform(ctx, spec, ports, io);
        },
      };
      return runOperation(op, capability, buildRunIo(io, ctx));
    },
  };
}

module.exports = { createX402Payment, selectX402Terms, createMemoryPaymentClaims };