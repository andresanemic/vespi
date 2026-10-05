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
// Two of those ports carry the weight of this module and have to be passed by whoever builds the
// contract. The `claims` store is where deduplication lives: there is no process-wide store, because a
// shared one couples operations nobody decided to couple and gives the host a set it cannot inspect.
// The operation identity is what deduplication is about: the effect key names the operation, so two
// operations that want the same thing are two effects and a retry of one operation is its duplicate.
// The idempotency key handed to the provider is only a hint: it is a function of the declared effect,
// it is the same for two different operations, and no claim here rests on it. The exported key version
// lets a host that stores the keys its claims store receives tell which version they were built
// under; it does not let a host recompute a key it never saw, because the idempotency key this
// module hashes is not exported.
//
// Every port is trusted host code, not a sandbox. A port that ignores its signal can keep acting
// after this module gave up, and a port that lies is believed only after an independent check
// returned true; that limit belongs to whoever writes the ports.
//
// Known limits. The claims store has to be synchronous, because the reservation is indivisible: there
// is no await between deciding and inserting, so two concurrent runs cannot both win. A durable store
// therefore needs a synchronous primitive, and a durable adapter is work this version does not have.
// `createMemoryPaymentClaims()` lives in the memory of one process: a restart empties it and a second
// attempt at the same payment becomes possible. Releasing a reservation is not offered either, so a
// run refused before the wire keeps its key until the store is gone. The delivery validator is awaited
// like the other five ports, but it is the one port that is not handed the abort signal: a validator
// that never settles is stopped by the run's own budget (`performTimeoutMs`), and the run then ends
// with the effect on the wire and an unknown outcome, not as a failure with nothing exercised.
// Every deadline a timer is armed for on this payment's behalf (`verifyTimeoutMs`,
// `performTimeoutMs`, `askTimeoutMs`, `decideTimeoutMs`) is a deadline a timer cannot hold, since a
// timer is 32-bit: a budget above 2^31-1 ms is refused when the run options are built, never clamped,
// because a payment is not sent under a deadline the module shortened by itself. What a validator
// hands back as `output` has to be a plain body or nothing: it is read by descriptors, not copied, so
// a list, a class instance, an accessor and a proxy are a refused delivery rather than a body in the
// host's hands. This is checked at the top level only: values nested inside the body are handed back
// as the validator returned them.

const { sufficient } = require('./authority.js');
const { runOperation } = require('./operation.js');
const { parseTime } = require('./time.js');
const { createHash } = require('node:crypto');
const { types: utilTypes } = require('node:util');

// A canonical positive decimal amount, at most 78 digits, no sign, no exponent, no leading zero.
const ATOMIC = /^[1-9][0-9]{0,77}$/;
const HASH = /^[0-9a-f]{64}$/;
// The control names the settlement reader is allowed to report, and they are the names the one
// reader in this tree emits (demo/x402/settlement.js): invocation, authorization, prepared, transfer,
// payer, source, exactAmount. A control name is host-written text that ends up on a sealed receipt,
// and an identifier shape is not enough as a gate: it admits a 64-character token with the shape of
// a Stellar seed, and that text was sealed in as `settlement_<name>`. With a closed catalog, anything
// else a port invents is refused instead of carried. A new control is a change to this catalog and to
// the receipt that carries it, not something a host may add at run time.
const SETTLEMENT_CONTROLS = new Set([
  'invocation', 'authorization', 'prepared', 'transfer', 'payer', 'source', 'exactAmount',
]);
// A frozen copy of the catalog's names, exported so a host that writes the settlement port can learn
// the vocabulary without reading this repository. A copy and not the set the gate reads: what a host
// can read then cannot become what the gate accepts, and the closed catalog stays closed in here.
const SETTLEMENT_CONTROL_NAMES = Object.freeze([...SETTLEMENT_CONTROLS]);
const MAX_TEXT = 512;
const MIN_WINDOW_SECONDS = 1;
const MAX_WINDOW_SECONDS = 300;
const DEFAULT_CLAIM_CAPACITY = 10_000;
const MIN_CLAIM_CAPACITY = 1;
const MAX_CLAIM_CAPACITY = 10_000;
const MAX_ACCEPTS = 64;
const MAX_BODY_BYTES = 1024 * 1024;
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
  OPERATION_IDENTITY: 'OPERATION_IDENTITY',
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

// Deduplication lives wherever the host put it, and the host has to say so. A contract with no claims
// store is not built: there is no store this module may reach for on its own, because a store nobody
// chose couples operations nobody agreed to couple and reads as deduplication where there is none.
function claimsRequiredError() {
  const error = new Error('x402 requires an explicit claims store: pass ports.claims (createMemoryPaymentClaims() is a factory for tests and demos, and it lives in the memory of one process, so a restart allows a second attempt)');
  error.code = 'VESPI_X402_CLAIMS_REQUIRED';
  return error;
}

// The run options are host code too. Options that cannot be read are a refused run, not a run
// without them: a payment whose human gate, clock or budget could not even be copied away has no
// business going out.
function ioError() {
  const error = new Error('x402 run options are invalid');
  error.code = 'VESPI_X402_INVALID_IO';
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
    // The store is read first, before anything else about the ports is judged: a contract with no store
    // is refused as a contract with no store, and not as whatever else about it is also wrong. There is
    // no store this module may reach for on its own, because a store nobody chose couples operations
    // nobody agreed to couple and reads as deduplication where there is none.
    const claimsRaw = raw.claims;
    if (claimsRaw === undefined || claimsRaw === null) throw claimsRequiredError();
    // A store is plain data with two methods: no proxy, no accessor of its own, no symbol key. The
    // check reads descriptors, never values, so a store whose methods are getters is refused before
    // one of them is ever called, and a proxy is refused before it is asked anything.
    if (!isPlainContainer(claimsRaw)) throw portError();
    if (typeof claimsRaw.reserveEffect !== 'function' || typeof claimsRaw.claimTransaction !== 'function') {
      throw portError();
    }
    // Read once here, already validated, and then bound to the store it came from. Copied out and
    // called detached, the simplest durable store in the world, a plain object with two methods
    // that use `this`, answered on a receiver that carries no state at all.
    const claims = {
      reserveEffect: claimsRaw.reserveEffect.bind(claimsRaw),
      claimTransaction: claimsRaw.claimTransaction.bind(claimsRaw),
    };
    const http = raw.http;
    const signer = raw.signer;
    if (!isPlainObject(http) || typeof http.discover !== 'function' || typeof http.sendPaid !== 'function') throw portError();
    if (!isPlainObject(signer) || typeof signer.prepare !== 'function') throw portError();
    if (typeof raw.inspectPrepared !== 'function') throw portError();
    if (typeof raw.verifySettlement !== 'function') throw portError();
    if (typeof raw.validateOutput !== 'function') throw portError();
    ports = {
      // The same for the http container and for the signer: read once, then bound.
      discover: http.discover.bind(http),
      sendPaid: http.sendPaid.bind(http),
      prepare: signer.prepare.bind(signer),
      inspectPrepared: raw.inspectPrepared,
      verifySettlement: raw.verifySettlement,
      validateOutput: raw.validateOutput,
      claims,
    };
  } catch (error) {
    if (error instanceof Error && (error.code === 'VESPI_X402_INVALID_PORT' || error.code === 'VESPI_X402_CLAIMS_REQUIRED')) throw error;
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

// A getter, a setter, a proxy or a symbol key can answer differently to the check and to the use: a
// trap can answer by throwing, and a container that carries `Symbol.iterator` is its own list. A
// container is plain only when it is an array or a plain object, carries no accessor of its own, no
// symbol key and is not a proxy. The check reads descriptors, never values, so an accessor is
// refused before it is ever called.
function isPlainContainer(value) {
  if (value === null || typeof value !== 'object') return false;
  if (utilTypes.isProxy(value)) return false;
  if (!isPlainObject(value) && !Array.isArray(value)) return false;
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) return false;
    }
  } catch {
    return false;
  }
  return true;
}

// The same question at every level: the deepest reachable value has to be plain data too, and a
// cycle is refused because a cyclic offer cannot be frozen, compared or signed.
function isPlainData(value, depth = 0, seen = new Set()) {
  if (value === null || typeof value !== 'object') return true;
  if (depth >= MAX_SPEC_DEPTH || seen.has(value) || !isPlainContainer(value)) return false;
  seen.add(value);
  let plain = true;
  try {
    for (const key of Object.keys(value)) {
      if (!isPlainData(value[key], depth + 1, seen)) {
        plain = false;
        break;
      }
    }
  } catch {
    plain = false;
  }
  seen.delete(value);
  return plain;
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
// compared as a canonical decimal, never as a bound. The signing window has to fit inside the one
// the declaration asked for, so a declared ceiling governs something and not only the global bounds.
function offerIsExact(offer, spec) {
  if (!isPlainObject(offer)) return false;
  if (offer.scheme !== SUPPORTED_SCHEME) return false;
  if (offer.network !== spec.network) return false;
  if (offer.asset !== spec.asset) return false;
  if (offer.payTo !== spec.payTo) return false;
  if (typeof offer.amount !== 'string' || !ATOMIC.test(offer.amount) || offer.amount !== spec.amount) return false;
  if (!Number.isInteger(offer.maxTimeoutSeconds)) return false;
  if (offer.maxTimeoutSeconds < MIN_WINDOW_SECONDS || offer.maxTimeoutSeconds > MAX_WINDOW_SECONDS) return false;
  if (offer.maxTimeoutSeconds > spec.maxTimeoutSeconds) return false;
  return extraIsSupported(offer.extra);
}

// The offer becomes a frozen plain copy read once, and that same copy is what gets validated and
// what gets returned. The candidate's own fields are copied rather than the declaration's, so a
// candidate that disagrees with the declaration is still refused by the validation below instead of
// being corrected into agreement. An absent `extra` field stays absent: writing it as an explicit
// undefined would change what the terms say to whoever signs them.
function copyTerms(offer) {
  if (!isPlainData(offer)) return null;
  let extra;
  let window;
  try {
    window = offer.maxTimeoutSeconds;
    extra = {};
    for (const key of Object.keys(offer.extra)) {
      if (offer.extra[key] === undefined) continue;
      extra[key] = offer.extra[key];
    }
  } catch {
    return null;
  }
  return Object.freeze({
    scheme: offer.scheme,
    network: offer.network,
    asset: offer.asset,
    payTo: offer.payTo,
    amount: offer.amount,
    maxTimeoutSeconds: window,
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
// somewhere, not to pay this particular counterparty, so it does not authorize this payment. The
// authority has to be plain data too: a getter or a proxy there could answer once to the check and
// once to the spend, and the check is the only thing standing between the two.
//
// Coverage is a question about one entry, never about the list. An authority usually carries the old
// grant next to the renewal that replaced it, and one expired entry used to end the loop for all of
// them, so renewing a permission could not unblock a payment the person had already renewed. What is
// left after the loop is only about entries that name this recipient: if one of them covers, the
// payment is authorized; if none covers and some named entry had expired, the answer is that the
// permission ran out; otherwise the terms were never authorized.
function liveGrant(authority, spec, now) {
  if (!isPlainData(authority)) return { ok: false, code: CODES.TERMS_REJECTED };
  const requirement = requirementOf(spec);
  const grants = Array.isArray(authority?.spend) ? authority.spend : [];
  let named = false;
  let expired = false;
  for (const entry of grants) {
    if (!isPlainObject(entry)) continue;
    if (entry.asset !== requirement.asset || entry.to !== requirement.to) continue;
    named = true;
    const live = entry.expiresAt === undefined || (parseTime(entry.expiresAt) !== null && parseTime(entry.expiresAt) > now);
    // A ceiling that no longer reaches the declared amount is not a grant for this payment, however
    // generously it reads: an amount is compared as a canonical decimal, never as a bound. An expired
    // ceiling covers nothing either, so this entry only counts when it is live and wide enough.
    if (!live) {
      expired = true;
      continue;
    }
    try {
      if (ATOMIC.test(String(entry.maxAmount)) && BigInt(String(entry.maxAmount)) >= BigInt(requirement.amount)) {
        return { ok: true };
      }
    } catch {
    }
  }
  if (!named) return { ok: false, code: CODES.TERMS_REJECTED };
  if (expired) return { ok: false, code: CODES.AUTHORITY_EXPIRED };
  return { ok: false, code: CODES.TERMS_REJECTED };
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
  if (!Array.isArray(accepts)) return null;
  // The list has to be plain data before a single property of it is read. An offer that is not plain
  // is refused later, as a refusal of terms; a list that is a proxy or that carries its own iterator
  // is a malformed declaration, and nothing is read out of it either way.
  if (!isPlainContainer(accepts)) throw specError();
  if (accepts.length === 0 || accepts.length > MAX_ACCEPTS) return null;
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

  // Everything from here to the return speaks to the outside: the authority, the list of offers and
  // the copy of one offer. Each of those is either refused here or guarded where it is read, so a
  // host that lies with a getter or a trap gets a public code instead of a throw that would carry
  // whatever it wrote.
  try {
    const cover = liveGrant(authority, spec, moment);
    if (!cover.ok) return cover;
    const check = sufficient([requirementOf(spec)], authority, { now: moment });
    if (!check || check.ok !== true) return { ok: false, code: CODES.TERMS_REJECTED };

    for (const candidate of accepts) {
      const terms = copyTerms(candidate);
      if (terms === null) continue;
      let exact = false;
      try {
        exact = offerIsExact(terms, spec);
      } catch {
        exact = false;
      }
      if (exact) return { ok: true, terms };
    }
  } catch {
    return { ok: false, code: CODES.TERMS_REJECTED };
  }
  return { ok: false, code: CODES.TERMS_REJECTED };
}

// The effect key is a hash over the canonical effect, the identity of the operation that asked for it
// and the operation's own idempotency key, and nothing else: no renewable permission, no time, no
// signature. The identity is what makes two operations two effects, so the legitimate second payment
// (the same donor, the same amount, the same action) is not a duplicate, while a retry of one
// operation, rebuilt with the identity it had, is. The idempotency key stays in the hash because it
// binds the goal and the action: the same operation id with a different intent is a different effect.
// Two different networks, payers or resources that share one grant do not collide either way.
// The version is a name and not a literal inside the hash, because a host that keeps these keys
// outside the process (a register, a reconciliation table) has to compare them and can only do that
// with the version in hand. Version 2 is the second form of the canonical content; a key of any
// other version is a different key, so an old stored key never collides with a new effect.
const EFFECT_KEY_VERSION = 2;

function effectKey(ctx, spec) {
  const content = canonicalize({
    version: EFFECT_KEY_VERSION,
    operation: ctx.operationId,
    operationKey: ctx.operationKey,
    request: { url: spec.url, method: spec.method },
    expected: expectedEffect(spec),
  });
  return sha256(JSON.stringify(content));
}

// The identity of the operation, read once and read here: a payment that cannot say which operation it
// is cannot say which effect it is claiming, so nothing is reserved and nothing goes out. The value
// is read inside a guard, once, and that answer is the one the key is built from. An operation is
// host code and the engine cannot tell a proxy from a plain one, so an identity that lies is still the
// identity this payment runs under; refusing an unreadable one is what the kernel can do.
function readOperationIdentity(operation) {
  let id;
  try {
    id = operation?.id;
  } catch {
    return null;
  }
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_TEXT) return null;
  return id;
}

// A claims store has to answer synchronously. A store that answers with a promise is not a claim,
// and its rejection is consumed here so it cannot reach the host process as an unhandled rejection.
// Consuming it is not believing it: the answer below still has to be the word the store uses.
function consumeThenable(value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
  try {
    if (typeof value.then === 'function') Promise.resolve(value).catch(() => {});
  } catch {
  }
}

// Claims live wherever the host put them; this factory is one explicit choice of store, kept for tests
// and demos, and it lives in the memory of one process. The reservation is synchronous and indivisible:
// there is no await between deciding and inserting, so two concurrent runs cannot both win. There is
// no release and no eviction: a reserved effect that never reached the wire stays reserved, and a
// person reconciles it. A restart empties the store, so a second attempt at the same payment becomes
// possible: that is a limit, not a guarantee, and a durable store is the answer this version does not
// ship yet.
function createMemoryPaymentClaims(options = {}) {
  const effects = new Set();
  const transactions = new Set();
  const capacity = readClaimCapacity(options);
  return {
    reserveEffect(rawKey) {
      // The key is normalized once, the same way a transaction hash is: a key that differs only in
      // case is the same effect, not a new one.
      const key = typeof rawKey === 'string' ? rawKey.trim().toLowerCase() : '';
      if (!HASH.test(key)) return 'capacity';
      if (effects.has(key)) return 'duplicate';
      if (effects.size >= capacity) return 'capacity';
      effects.add(key);
      return 'claimed';
    },
    claimTransaction(network, txHash) {
      if (typeof network !== 'string' || network.length === 0) return 'capacity';
      if (typeof txHash !== 'string' || !HASH.test(txHash.trim().toLowerCase())) return 'capacity';
      const key = `${network}:${txHash.trim().toLowerCase()}`;
      if (transactions.has(key)) return 'duplicate';
      if (transactions.size >= capacity) return 'capacity';
      transactions.add(key);
      return 'claimed';
    },
  };
}

function readClaimCapacity(options) {
  try {
    const value = options?.capacity;
    if (!Number.isInteger(value) || value < MIN_CLAIM_CAPACITY || value > MAX_CLAIM_CAPACITY) return DEFAULT_CLAIM_CAPACITY;
    return value;
  } catch {
    return DEFAULT_CLAIM_CAPACITY;
  }
}

// The verifier belongs to this contract and to nobody else. It is separate from `perform`: it runs
// after the effect, it reads the private expectation and digest instead of trusting the settlement
// answer, and it has its own budget and its own cancellation.
async function verifySettlementEffect(ctx, evidence) {
  const expected = ctx.expected;
  const checks = {
    terms: ctx.terms !== null && ctx.terms !== undefined,
    prepared: ctx.prepared === true && typeof ctx.authDigest === 'string' && HASH.test(ctx.authDigest),
    settlement: false,
    delivery: ctx.delivery === true,
    transactionUnique: ctx.transactionUnique === true,
  };
  let settlementReason = `the settlement evidence does not match the declared effect (${CODES.SETTLEMENT_REJECTED})`;

  // What can be compared here is compared here: a settlement answer that contradicts the declaration
  // is refused without asking the port, so a port cannot be handed a contradiction to rubber-stamp.
  const own = ctx.settlement;
  if (own && own.ok && isPlainObject(evidence)) {
    const declared = evidence.txHash === own.txHash
      && (evidence.payer === undefined || evidence.payer === expected.payer)
      && (evidence.network === undefined || evidence.network === expected.network)
      && (evidence.amount === undefined || evidence.amount === expected.amount);
    if (declared && typeof ctx.authDigest === 'string' && evidence.authDigest === ctx.authDigest) {
      const verdict = readVerdict(await callSettlementPort(ctx, evidence));
      for (const [key, value] of Object.entries(verdict.checks)) checks[`settlement_${key}`] = value;
      checks.settlement = verdict.ok;
      if (!verdict.ok) {
        settlementReason = `the settlement port did not verify the declared effect (${CODES.VERIFIER_FAILED})`;
      }
    }
  }

  // One reason, in the order a reader needs it. It names a code from the catalog and never a string
  // a port wrote: a raw SDK message, a url or a body does not travel into a receipt.
  let reason = 'the paid effect is verified';
  if (!checks.terms) reason = `the paid terms were not the authorized ones (${CODES.TERMS_REJECTED})`;
  else if (!checks.prepared) reason = `the authorization was not independently inspected (${CODES.PREPARED_REJECTED})`;
  else if (!checks.settlement) reason = settlementReason;
  else if (!checks.transactionUnique) reason = `the settled transaction was not unique in this process (${ctx.claimCode || CODES.DUPLICATE_TRANSACTION})`;
  else if (!checks.delivery) reason = `the paid response did not deliver a validated body (${CODES.DELIVERY_REJECTED})`;

  const verified = checks.terms === true
    && checks.prepared === true
    && checks.settlement === true
    && checks.delivery === true
    && checks.transactionUnique === true;
  return { verified, checks, reason };
}

// A settlement verdict is admitted whole or not at all. It has to be a plain object, `verified`
// exactly true, a reason in words, and at least one control, every control a boolean and every
// control true. An invalid control is never dropped: a dropped control leaves a shorter set, and a
// shorter set that happens to be empty reads as complete. A control name is host-written text and
// this receipt admits no free text, so only a name of the closed catalog travels (SETTLEMENT_CONTROLS).
// Everything is read once inside the guard, so a getter cannot answer twice and the verdict returned
// here is the verdict that was validated.
function readVerdict(verdict) {
  const out = { ok: false, checks: {} };
  try {
    if (!isPlainObject(verdict)) return out;
    if (verdict.verified !== true) return out;
    if (typeof verdict.reason !== 'string' || verdict.reason.length === 0) return out;
    const controls = verdict.checks;
    if (!isPlainObject(controls)) return out;
    const keys = Object.keys(controls);
    if (keys.length === 0) return out;
    for (const key of keys) {
      if (!SETTLEMENT_CONTROLS.has(key)) return out;
      const value = controls[key];
      if (typeof value !== 'boolean') return out;
      out.checks[key] = value;
    }
    out.ok = keys.every((key) => out.checks[key] === true);
  } catch {
    return { ok: false, checks: {} };
  }
  return out;
}

// The private verifier brings its own AbortController and its own budget. The engine does not hand
// it a signal, so a port that hangs is cancelled here, and the timer is cleared as soon as the port
// answers so a finished run leaves nothing pending.
async function callSettlementPort(ctx, evidence) {
  const budget = readVerifyTimeout({ verifyTimeoutMs: ctx.verifyTimeoutMs });
  const controller = new AbortController();
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {
      }
      resolve({ verified: false, checks: {}, reason: 'the settlement port did not answer within its budget' });
    }, budget);
  });
  try {
    const call = Promise.resolve().then(() => ctx.ports.verifySettlement(evidence, {
      expected: ctx.expected,
      authDigest: ctx.authDigest,
      signal: controller.signal,
    }));
    const settled = await Promise.race([call.catch(() => ({ verified: false, checks: {}, reason: 'the settlement port failed' })), timeout]);
    return settled;
  } finally {
    clearTimeout(timer);
  }
}

function readVerifyTimeout(io) {
  try {
    const value = io?.verifyTimeoutMs;
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
  }
  return DEFAULT_VERIFY_TIMEOUT_MS;
}

// Only these options reach the engine. `verify` is deliberately absent: this contract installs its
// own verifier, so a host cannot hand the payment a verifier that trusts the signer.
const ALLOWED_IO_KEYS = [
  'ask', 'decide', 'decideThreshold', 'decideTimeoutMs', 'now',
  'askTimeoutMs', 'performTimeoutMs', 'verifyTimeoutMs',
];
// Node's timers are 32-bit and a delay of 2^31 ms or more is armed as 1 ms, so a budget a host meant
// as a long wait aborts the settlement reader on the spot and seals a paid effect as not_verified.
// The module does not clamp it: a clamp answers with a budget the host did not ask for, and the
// payment would carry a verdict produced under a deadline that was never agreed. The budget is
// refused instead, when the run options are built, with the same fixed code as options that cannot
// be read. The engine arms timers for `performTimeoutMs`, `askTimeoutMs` and `decideTimeoutMs` on
// this payment's behalf, so they are refused the same way.
const MAX_TIMER_MS = 2 ** 31 - 1;
const TIMER_DEADLINES = ['verifyTimeoutMs', 'performTimeoutMs', 'askTimeoutMs', 'decideTimeoutMs'];
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

async function discoverRequired(ctx, spec) {
  let discovered;
  try {
    discovered = await ctx.ports.discover({ url: spec.url, method: spec.method, redirect: 'error', signal: ctx.signal });
  } catch {
    return { ok: false, code: CODES.DISCOVERY_FAILED };
  }
  if (aborted(ctx)) return { ok: false, code: CODES.ABORTED };
  // `status` and `paymentRequired` are read once, inside the guard, and the copy that was read is the
  // copy that is judged and the one handed on. Read outside it, a getter answered the check and threw
  // at the use, and whatever it wrote travelled into the receipt as the run's detail.
  let status;
  let paymentRequired;
  try {
    if (!isPlainObject(discovered)) return { ok: false, code: CODES.DISCOVERY_FAILED };
    status = discovered.status;
    paymentRequired = discovered.paymentRequired;
  } catch {
    return { ok: false, code: CODES.DISCOVERY_FAILED };
  }
  if (status !== 402 || !isPlainObject(paymentRequired)) {
    return { ok: false, code: CODES.DISCOVERY_FAILED };
  }
  return { ok: true, paymentRequired };
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
  if (aborted(ctx)) return { ok: false, code: CODES.ABORTED };
  let authorization = null;
  // The value is read once and the copy that was read is what the inspector and the wire get: a
  // getter that answered a string to the check could otherwise hand an object to the payment.
  let value = null;
  try {
    value = prepared?.authorization;
  } catch {
    value = null;
  }
  if (typeof value === 'string' && value.trim().length > 0) authorization = value;
  if (!authorization) return { ok: false, code: CODES.PREPARE_FAILED };
  return { ok: true, authorization };
}

// The inspection has to be a positive, complete, boolean-only verdict about the authorization that
// exists right now: `prepared` true, a reason in words, an authorization digest computed from the
// authorization bytes, and the very effect that was declared. Every control it reports has to be
// exactly `true`: one false or non-boolean control stops the send, because an inspector that says
// "the authorization was not what I checked" has not cleared the payment.
function inspectionIsAcceptable(result, expected) {
  if (!isPlainObject(result)) return null;
  if (result.verified !== true) return null;
  if (typeof result.reason !== 'string' || result.reason.length === 0) return null;
  // Read once, inside the guard, and handed back to the caller: a getter that answers the check with
  // one digest and the use with another must not decide what the receipt carries.
  const authDigest = result.authDigest;
  if (typeof authDigest !== 'string' || !HASH.test(authDigest)) return null;
  const controls = result.checks;
  if (!isPlainObject(controls)) return null;
  if (controls.prepared !== true) return null;
  const keys = Object.keys(controls);
  for (const key of keys) {
    if (controls[key] !== true) return null;
  }
  if (!sameEffect(result.effect, expected)) return null;
  return { authDigest };
}

async function inspectAuthorization(ctx, authorization) {
  let result;
  try {
    result = await ctx.ports.inspectPrepared(authorization, { expected: ctx.expected, signal: ctx.signal });
  } catch {
    // An inspector that cannot read the authorization is a failed run, not a refusal of terms.
    return { ok: false, code: CODES.PREPARED_REJECTED, failure: true };
  }
  if (aborted(ctx)) return { ok: false, code: CODES.ABORTED, failure: true };
  let accepted = null;
  try {
    accepted = inspectionIsAcceptable(result, ctx.expected);
  } catch {
    accepted = null;
  }
  if (accepted === null) return { ok: false, code: CODES.PREPARED_REJECTED };
  return { ok: true, authDigest: accepted.authDigest };
}

// A settlement answer is read apart from the body it carries, and only the parts the receipt admits
// are kept: the transaction hash, who paid, on which network, how much, in which asset and to whom.
// A hash is normalized once (trimmed, lowercased) and has to be a hash; a missing or malformed one
// is never claimed. Whatever the protocol chooses to declare is compared strictly: a field that is
// absent is left to the settlement port, which reads it from the ledger, and a field that is present
// and different is a contradiction this module refuses on its own.
function readSettlement(settlement, expected) {
  const answer = {
    ok: false,
    checks: { success: false, payer: false, network: false, amount: true, asset: true, payTo: true, transaction: false },
    evidence: {},
    txHash: null,
  };
  if (!isPlainObject(settlement)) return answer;
  try {
    // Every field is read once, into a local, and that local is both what the evidence records and
    // what the comparison is made against: an answer that differs between the check and the use has
    // nothing left to differ with.
    const success = settlement.success;
    const payer = settlement.payer;
    const network = settlement.network;
    const amount = settlement.amount;
    const asset = settlement.asset;
    const payTo = settlement.payTo;
    const transaction = settlement.transaction;
    answer.checks.success = success === true;
    if (typeof payer === 'string' && payer.length > 0) answer.evidence.payer = payer;
    if (typeof network === 'string' && network.length > 0) answer.evidence.network = network;
    if (typeof amount === 'string' && amount.length > 0) answer.evidence.amount = amount;
    answer.checks.payer = payer === expected.payer;
    answer.checks.network = network === expected.network;
    answer.checks.amount = amount === undefined ? true : amount === expected.amount;
    if (asset !== undefined) answer.checks.asset = asset === expected.asset;
    if (payTo !== undefined) answer.checks.payTo = payTo === expected.payTo;
    const txHash = typeof transaction === 'string' ? transaction.trim().toLowerCase() : '';
    if (HASH.test(txHash)) {
      answer.txHash = txHash;
      answer.evidence.txHash = txHash;
      answer.checks.transaction = true;
    }
    answer.ok = answer.checks.success && answer.checks.payer && answer.checks.network
      && answer.checks.amount && answer.checks.asset && answer.checks.payTo && answer.checks.transaction;
  } catch {
    return answer;
  }
  return answer;
}

// The body is validated on a plain JSON copy: getters, prototypes and functions cannot reach the
// port, and nothing from the body travels into the receipt but its digest.
function jsonCopy(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function exceedsBodyLimit(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return true;
  }
  if (typeof serialized !== 'string') return true;
  return Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES;
}

// Delivery is covered only when the validator says the body is acceptable AND hands back a SHA-256
// digest of it. Without the digest there is nothing to put on the receipt and nothing for a later run
// to compare against. The digest is the validator's word: this module checks its shape, records it,
// and neither recomputes it nor compares it with `output`. The validator's answer is read once inside
// the guard: a getter cannot answer twice.
//
// The `output` it hands back has to be a plain body, the same rule every other port answers to, and
// it is not copied with JSON. A copy would be a second reading of host-written data by this module
// and would hand back something the port never said; instead an output that is not plain data — a
// list, a class instance, an accessor, a proxy — refuses the delivery like any other malformed
// answer. A validator that reports no body at all is not malformed: nothing to hand back is an
// answer, and the delivery stays covered.
//
// The validator is awaited, like the other five ports and like `readBody`. This is the choice, and it
// is the other one that was available: a port could be declared synchronous instead. Awaiting wins
// because the shape of a port is host code and this module cannot enforce either shape — a promise
// is refused by the guard below exactly as silently as a port that answered wrongly, and the payment
// then ends in DELIVERY_REJECTED blaming a delivery that was never the problem. Awaiting a plain
// value costs nothing, so the ports already written synchronously keep the receipts they have today,
// and a port written async, the natural form when five neighbours are async, is answered instead of
// discarded. A port that rejects lands in the same catch as a port that throws.
async function readDelivery(response, ctx) {
  let raw;
  try {
    raw = typeof response.readBody === 'function' ? await response.readBody(ctx.signal) : null;
  } catch {
    return { ok: false, output: null, digest: null };
  }
  const copy = jsonCopy(raw);
  if (copy === null || copy === undefined) return { ok: false, output: null, digest: null };
  if (exceedsBodyLimit(copy)) return { ok: false, output: null, digest: null };
  let validated;
  try {
    validated = await ctx.ports.validateOutput(copy);
  } catch {
    return { ok: false, output: null, digest: null };
  }
  let ok;
  let digest;
  let output;
  try {
    ok = isPlainObject(validated) && validated.ok === true;
    // Read once: the digest that was checked for shape is the digest that goes on the receipt.
    const reported = validated.digest;
    digest = typeof reported === 'string' && HASH.test(reported) ? reported : null;
    const body = validated.output;
    output = body === undefined || body === null ? null : body;
  } catch {
    return { ok: false, output: null, digest: null };
  }
  if (!ok || digest === null) return { ok: false, output: null, digest: null };
  // Plainness here is stricter than the container check the ports answer to: a body has to be a
  // plain object, and its own top-level descriptors have to be plain as well; nested values are not
  // inspected. A list is not a body, an accessor is refused without ever being called, and a proxy is
  // refused without being asked anything. Both checks read descriptors and never values.
  if (output !== null && (!isPlainObject(output) || !isPlainContainer(output))) {
    return { ok: false, output: null, digest: null };
  }
  return { ok: true, output, digest };
}

// Once the send is on the wire the effect may exist. A failure from here on is never reported as a
// plain failure with nothing exercised, and it is never retried: the receipt carries the digest, the
// settlement evidence and the code that stopped it.
function unknownAfterSend(ctx, code) {
  return {
    ok: false,
    settlementUnknown: true,
    error: code,
    evidence: { ...ctx.evidence, settlementUnknown: true },
  };
}

// The engine owns the signal, and a host may also signal through it. Watching the event as well as
// the flag keeps the contract honest with either, and the listener is removed when the run ends.
function watchAbort(ctx) {
  const signal = ctx.signal;
  if (!signal || typeof signal.addEventListener !== 'function') return () => {};
  const onAbort = () => { ctx.aborted = true; };
  try {
    signal.addEventListener('abort', onAbort, { once: true });
  } catch {
    return () => {};
  }
  return () => {
    try {
      signal.removeEventListener('abort', onAbort);
    } catch {
    }
  };
}

function aborted(ctx) {
  if (ctx.aborted === true) return true;
  return abortedRead(ctx.signal);
}

async function perform(ctx) {
  const spec = ctx.spec;
  const stopWatching = watchAbort(ctx);
  try {
    return await performStages(ctx, spec);
  } finally {
    stopWatching();
  }
}

async function performStages(ctx, spec) {
  const now = ctx.now;
  const cover = liveGrant(ctx.authority, spec, now);
  if (!cover.ok) return blocked(cover.code);

  // Before discovery, before a single port: an operation whose identity cannot be read cannot claim
  // its effect, and a payment nobody can deduplicate is not one this kernel makes.
  const identity = readOperationIdentity(ctx.operation);
  if (identity === null) return blocked(CODES.OPERATION_IDENTITY);
  ctx.operationId = identity;

  const discovered = await discoverRequired(ctx, spec);
  if (!discovered.ok) return failed(discovered.code);

  const chosen = selectX402Terms(discovered.paymentRequired, spec, ctx.authority, now);
  if (!chosen.ok) return blocked(chosen.code);
  ctx.terms = chosen.terms;

  const afterDiscovery = liveGrant(ctx.authority, spec, now);
  if (!afterDiscovery.ok) return blocked(afterDiscovery.code);

  // A store that cannot answer is a run that cannot deduplicate, so nothing goes out.
  let reserved;
  try {
    reserved = ctx.claims.reserveEffect(effectKey(ctx, spec));
    consumeThenable(reserved);
  } catch {
    return failed(CODES.CLAIMS_CAPACITY);
  }
  if (reserved === 'duplicate') return blocked(CODES.DUPLICATE_EFFECT);
  if (reserved !== 'claimed') return blocked(CODES.CLAIMS_CAPACITY);

  const prepared = await prepareAuthorization(ctx);
  if (!prepared.ok) return failed(prepared.code);

  const inspected = await inspectAuthorization(ctx, prepared.authorization);
  if (!inspected.ok) {
    if (inspected.failure) return failed(inspected.code);
    return blocked(inspected.code);
  }
  ctx.authDigest = inspected.authDigest;
  ctx.prepared = true;

  // Immediately before the send, on a clock read again and on the permission the operation still
  // carries. Preparing and inspecting took time, so the moment that authorized this payment may
  // have passed, and whoever holds the operation may have replaced its authority while a port was
  // busy: an expired grant, an authority that is no longer the one that was checked, or a clock
  // that cannot be read stops the payment here, with nothing exercised and nothing sent.
  const beforeSend = revalidateBeforeSend(ctx);
  if (!beforeSend.ok) return beforeSend.result;

  ctx.evidence = { authDigest: ctx.authDigest };
  // The send is on the wire from this line on. Nothing below may report a plain failure with nothing
  // exercised, nothing below may send a second time, and no message a port wrote may travel into
  // the receipt: every remaining step lives inside this one guard.
  try {
    const response = await ctx.ports.sendPaid({
      url: spec.url,
      method: spec.method,
      redirect: 'error',
      authorization: prepared.authorization,
      terms: ctx.terms,
      // A hint, not a claim: the provider may use it to recognise its own retry, and two different
      // operations with the same goal, action and requirements send the same hint. Nothing this module
      // deduplicates rests on it; the effect key does, and the effect key never leaves the process.
      idempotencyKey: ctx.operationKey,
      signal: ctx.signal,
    });
    if (!isPlainObject(response)) return unknownAfterSend(ctx, CODES.SEND_UNKNOWN);

    const settlement = readSettlement(response.settlement, ctx.expected);
    ctx.settlement = settlement;
    ctx.evidence = { ...ctx.evidence, ...settlement.evidence };
    // Without a usable transaction hash there is nothing to verify and nothing to reconcile
    // against: the outcome is unknown, and the receipt says so instead of calling it a failure.
    if (settlement.txHash === null) return unknownAfterSend(ctx, CODES.SEND_UNKNOWN);
    // The transaction is claimed as soon as there is a hash to claim, before anything is exposed: a
    // settlement the run then refuses is still a transaction this process has already seen.
    const claim = ctx.claims.claimTransaction(ctx.expected.network, settlement.txHash);
    consumeThenable(claim);
    ctx.transactionUnique = claim === 'claimed';
    if (!ctx.transactionUnique) ctx.claimCode = claim === 'duplicate' ? CODES.DUPLICATE_TRANSACTION : CODES.CLAIMS_CAPACITY;

    // A hash that contradicts the declaration keeps its evidence on the receipt: the person
    // reconciles it. It is not verified and no output is exposed.
    if (!settlement.ok) return { ok: true, evidence: ctx.evidence, output: null };

    const delivery = await readDelivery(response, ctx);
    // A delivery on a cancelled run is not a delivery: the answer arrived after the run was called
    // off, so the settlement may still be verified while the delivery stays uncovered.
    ctx.delivery = delivery.ok && response.status === 200 && !aborted(ctx);
    if (!ctx.delivery) return { ok: true, evidence: ctx.evidence, output: null };
    ctx.evidence = { ...ctx.evidence, planDigest: delivery.digest };
    return { ok: true, evidence: ctx.evidence, output: delivery.output };
  } catch {
    // A property of the answer that throws, a claims store that throws, a body that cannot be
    // read: whatever it was, the effect may be on the wire. The run reports uncertainty, keeps the
    // evidence it already has and the permission it already spent, and a person reconciles.
    return unknownAfterSend(ctx, CODES.SEND_UNKNOWN);
  }
}

// The last gate before the wire. A permission is only good for the moment it was checked, and the
// operation is the object that carries it: the clock is read again here, the authority the operation
// holds right now has to be the very one that was checked, and the grant has to cover the declared
// amount at this new moment. Any of the three returns a public code and sends nothing.
function revalidateBeforeSend(ctx) {
  const spec = ctx.spec;
  const moment = readRunNow(ctx.io);
  if (moment === null) return { ok: false, result: failed(CODES.INVALID_CLOCK) };
  let current;
  try {
    current = ctx.operation === null || ctx.operation === undefined ? ctx.authority : ctx.operation.authority;
  } catch {
    return { ok: false, result: blocked(CODES.TERMS_REJECTED) };
  }
  // A different object is a different permission: whoever holds the operation replaced what was
  // authorized while a port was busy, and nothing that was checked applies to what is there now.
  if (current !== ctx.authority) return { ok: false, result: blocked(CODES.TERMS_REJECTED) };
  const cover = liveGrant(current, spec, moment);
  if (!cover.ok) return { ok: false, result: blocked(cover.code) };
  let enough;
  try {
    enough = sufficient([requirementOf(spec)], current, { now: moment });
  } catch {
    return { ok: false, result: blocked(CODES.TERMS_REJECTED) };
  }
  if (!enough || enough.ok !== true) return { ok: false, result: blocked(CODES.TERMS_REJECTED) };
  ctx.now = moment;
  return { ok: true };
}

function buildRunIo(io, ctx) {
  let runIo = {};
  if (io !== null && typeof io === 'object') {
    // Copying the options reads every own key of a host object. If that read throws, the run is
    // refused with a fixed code: the trap's own message never reaches the caller, and a payment is
    // never sent with the host hooks silently missing.
    try {
      runIo = { ...io };
    } catch {
      throw ioError();
    }
  }
  for (const key of Object.keys(runIo)) {
    if (!ALLOWED_IO_KEYS.includes(key)) delete runIo[key];
  }
  // A deadline this module cannot arm is refused here, before the discovery and before the
  // reservation, so a payment is never sent under a budget the module was going to shorten by
  // itself. Only a readable number is judged: anything else keeps the fallback below, as it always did.
  for (const key of TIMER_DEADLINES) {
    const budget = runIo[key];
    if (typeof budget === 'number' && Number.isFinite(budget) && budget > MAX_TIMER_MS) throw ioError();
  }
  // The budget the ceiling was judged on is the one the timer is armed with. Holding the value on
  // the run's own context closes the gap between the copy that was checked and a host options object
  // that changed while the payment was in flight: reading the raw options again would arm a timer
  // nobody judged. This is the only verifier this module installs, so the value has one writer.
  ctx.verifyTimeoutMs = runIo.verifyTimeoutMs;
  runIo.verify = (evidence) => verifySettlementEffect(ctx, evidence);
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
      // Private to this run: nothing here is shared with another run of the same payment, so an
      // authDigest from one run can never stand in for another.
      const ctx = {
        spec,
        ports,
        io,
        expected: expectedEffect(spec),
        now: null,
        authority: null,
        operation: null,
        operationId: null,
        operationKey: null,
        signal: null,
        claims: ports.claims,
        terms: null,
        authDigest: null,
        prepared: false,
        delivery: false,
        transactionUnique: false,
        evidence: null,
        settlement: null,
        claimCode: null,
        aborted: false,
      };
      const capability = {
        id: spec.id,
        required: (operation) => requiredFor(spec, operation),
        perform: async (performCtx) => {
          ctx.authority = performCtx?.authority ?? null;
          // The operation is kept so the gate before the send can read the authority the operation
          // carries right now and compare it with the one that was checked.
          ctx.operation = performCtx?.operation ?? null;
          ctx.operationKey = performCtx?.idempotencyKey ?? null;
          ctx.signal = performCtx?.signal ?? null;
          const now = readRunNow(io);
          if (now === null) return failed(CODES.INVALID_CLOCK);
          ctx.now = now;
          return perform(ctx);
        },
      };
      return runOperation(op, capability, buildRunIo(io, ctx));
    },
  };
}

module.exports = { createX402Payment, selectX402Terms, createMemoryPaymentClaims, SETTLEMENT_CONTROL_NAMES, EFFECT_KEY_VERSION };