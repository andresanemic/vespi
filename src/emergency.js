'use strict';

const { createHash } = require('node:crypto');
const { computeDigest } = require('./receipt.js');
const { parseTime } = require('./time.js');

// Emergency access (decision 27): authority a person grants IN ADVANCE, with a declared trigger,
// exercised against a signal somebody other than the exercising agent verified, sealed in an
// immediate receipt, and always leaving a post-use review that only a declared reviewer can close.
//
// Everything a grant binds lives outside the values, because every one of them is an identity claim
// the kernel cannot check on its own and must therefore receive from the host exactly once. One
// private binding per permission carries all of it:
//   · snapshot  — the normalized grant, read once and frozen, which is both what the host was asked
//                to authorize and what the kernel binds. Never read back from a caller afterwards.
//   · verifiers — the independent verifier of each declared trigger, bound when the person granted.
//   · approver  — the host callback that has to answer again before the clock may be extended.
//   · family    : the private identity of this one grant. Records are kept by the public id, which is
//                not an identity, so this is what says a counter, a review or a revocation belongs
//                to this grant and not to another person who happened to use the same id.
// A permission that did not come out of `createEmergencyPermission` is not in this table, so it
// carries no authority at all: its shape proves nothing, and nothing in this module may treat a
// readable object as a granted one.
//
// What the kernel does NOT do, and says so: it cannot tell a real host from a lying one. Whoever
// supplies `authorizeGrantor`, `resolveVerifier` and `authorizeRenewal` decides who may grant, what
// counts as the independent signal, and whether the clock may grow. The kernel's part is that an
// agent exercising the permission can never be the source of any of them, that a permission which
// did not come through this path holds nothing, and that a caller cannot get the kernel to bind one
// value and seal another by answering twice. Every field it hands over, nested triggers included,
// is read once, and what is validated is what gets bound. A barrier against the common forgery, not
// a proof against a Proxy that lies about its own descriptors.

const BINDINGS = new WeakMap();

const CAPABILITY = 'emergency-access';
const DEFAULT_GOAL = 'emergency access under prior authority';
const PENDING_ANCHOR = { status: 'pending', network: 'stellar:testnet' };
const MAX_REASON = 512;
// A subject reaches a receipt, so it has to be a reference and not content: letters, digits and
// separators, bounded. What this kernel will not do is seal a piece of the patient's record into an
// object that travels.
const REFERENCE = /^[A-Za-z0-9._:-]{1,64}$/;
const NOT_REPRESENTABLE = Symbol('not-representable');
// The widest interval the calendar in time.js can hold, measured with the same strings that parser
// accepts at its two ends. A deadline longer than this cannot be stamped at any instant of it, so
// no clock will ever satisfy it and not one use of such a grant could reach the verifier.
const CALENDAR_SPAN_MS = Date.parse('9999-12-31T23:59:59.999Z') - Date.parse('0000-01-01T00:00:00.000Z');

function text(value) {
  return typeof value === 'string' && value.length > 0;
}

function safeText(value, max = MAX_REASON) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

function reference(value) {
  return text(value) && REFERENCE.test(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

// The canonical form of data this kernel is willing to hash and seal: JSON primitives, plain objects
// and arrays, keys sorted. Anything else — a function, a symbol, a bigint, an infinite number, a
// cycle, a class instance, a sparse hole — is refused rather than half-copied, because a receipt
// whose fingerprint cannot be recomputed is a receipt nobody can check later.
function canonical(value, seen) {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return value;
  if (kind === 'number') return Number.isFinite(value) ? value : NOT_REPRESENTABLE;
  if (kind !== 'object') return NOT_REPRESENTABLE;
  const path = seen || new Set();
  if (path.has(value)) return NOT_REPRESENTABLE;
  path.add(value);
  let out;
  if (Array.isArray(value)) {
    out = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = canonical(value[index], path);
      if (item === NOT_REPRESENTABLE) { path.delete(value); return NOT_REPRESENTABLE; }
      out.push(item);
    }
    if (Object.keys(value).length !== value.length) { path.delete(value); return NOT_REPRESENTABLE; }
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) { path.delete(value); return NOT_REPRESENTABLE; }
    // The copy is built without a prototype on purpose. Assigning to `{}` runs the inherited
    // `__proto__` setter, so a JSON body carrying that key either changed this copy's prototype and
    // lost the key, or made the copy unrepresentable a second time, which is how a verified signal
    // used to be sealed with a null fingerprint (R209, R210). With no prototype there is no
    // inherited setter: every key of the body becomes exactly the data property it was, and the
    // string this returns for an ordinary body is byte for byte the one a plain object gave.
    out = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const item = canonical(value[key], path);
      if (item === NOT_REPRESENTABLE) { path.delete(value); return NOT_REPRESENTABLE; }
      out[key] = item;
    }
  }
  path.delete(value);
  return out;
}

// A fingerprint of exactly what travels: unkeyed SHA-256, like the receipt digest itself. It proves
// binding, not authenticity: it says two receipts were made from different inputs, and anybody able
// to rewrite a receipt can recompute it. The independent evidence that would let a host check the
// binding again stays with the host.
function fingerprint(value) {
  const canonicalValue = canonical(value);
  if (canonicalValue === NOT_REPRESENTABLE) return null;
  return createHash('sha256').update(JSON.stringify(canonicalValue), 'utf8').digest('hex');
}

// A caller object that carries its own accessors cannot be read exactly once: the kernel reads each
// field one time and has no second look, so a getter that answers `read` and then something else is
// a shape it refuses rather than a shape it trusts. Prototype getters are untouched — only accessors
// the caller put on the object itself are refused. This is a barrier against the common forgery, not
// a proof against a Proxy that lies about its own descriptors.
function ownDataOnly(value) {
  try {
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') return false;
    }
    return true;
  } catch {
    return false;
  }
}

// The same rule for the options of the seven public entry points, read once as a whole. Every field
// this module asks a host for lives in the descriptors of one object, so that object is read exactly
// once and nothing else: a `ledger`, a `by`, a `now` or an `authorizeGrantor` whose getter throws, or
// answers twice, is not a shape this kernel reads. A failure returns null and every caller answers
// with its own fixed sentence, so an exception raised inside a caller's options never reaches the
// caller's caller (R301). Prototype getters are untouched: a host that puts its callbacks on a class
// is a host this kernel can still talk to.
function readOptions(options, fields) {
  try {
    if (options === undefined || options === null) return Object.fromEntries(fields.map((field) => [field, undefined]));
    if (typeof options !== 'object' || Array.isArray(options)) return null;
    if (!ownDataOnly(options)) return null;
    const out = {};
    for (const field of fields) out[field] = options[field];
    return out;
  } catch {
    return null;
  }
}

// The one sentence every refused options object gets, in each of the three places this module can
// answer: a grant and its administration throw (a grant was never created, so there is nothing to
// receipt), and an exercise or a state blocks or fails closed. It says what happened, not what the
// hostile object said while it happened.
const UNREADABLE_OPTIONS = 'the options this call was given could not be read safely';

// A non-empty list of unique non-empty strings, or null. Null is what every reader below treats as
// "this permission cannot be trusted with anything".
function stringList(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = [];
  for (const item of value) {
    if (!text(item)) return null;
    out.push(item);
  }
  return new Set(out).size === out.length ? out : null;
}

// Nested structures get the same treatment as the top level: `id` and `verifierId` are read once
// each into variables, and the copy that ends up bound is built from those variables. Validating
// one value and binding another is how a grant ended up carrying a trigger whose id was undefined
// and could not produce a valid fingerprint (R211).
function triggerList(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = [];
  const ids = new Set();
  for (const trigger of value) {
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return null;
    let id;
    let verifierId;
    try {
      id = trigger.id;
      verifierId = trigger.verifierId;
    } catch {
      return null;
    }
    if (!text(id) || !text(verifierId)) return null;
    if (ids.has(id)) return null;
    ids.add(id);
    out.push({ id, verifierId });
  }
  return out;
}

// The kernel reads a value it did not write from a caller that may be hostile, so every read of the
// permission goes through here, one read per field, nested triggers included, which `triggerList`
// handles the same way, and the result is normalized. A permission nobody can read safely returns
// the reason it could not be read, and every caller fails closed on it: it exercises nothing.
function snapshotPermission(permission) {
  try {
    if (!permission || typeof permission !== 'object' || Array.isArray(permission)) {
      return { ok: false, reason: 'the emergency permission is not an object' };
    }
    if (!ownDataOnly(permission)) {
      return { ok: false, reason: 'it carries its own accessors, and this kernel reads each field only once' };
    }
    const id = permission.id;
    const owner = permission.owner;
    const grantee = permission.grantee;
    const destination = permission.destination;
    const purpose = permission.purpose;
    const actions = stringList(permission.actions);
    const scope = stringList(permission.scope);
    const triggers = triggerList(permission.triggers);
    const reviewers = stringList(permission.reviewers);
    const pausers = stringList(permission.pausers);
    const maxUses = permission.maxUses;
    const reviewDueMs = permission.reviewDueMs;
    const startsAt = parseTime(permission.startsAt);
    const expiresAt = parseTime(permission.expiresAt);
    if (!text(id)) return { ok: false, reason: 'it has no id' };
    if (!text(owner)) return { ok: false, reason: 'it names no person who granted it' };
    if (!text(grantee)) return { ok: false, reason: 'it names nobody allowed to exercise it' };
    if (!text(destination)) return { ok: false, reason: 'it names no destination' };
    if (!text(purpose)) return { ok: false, reason: 'it declares no motive, and an emergency without a declared motive is not a grant' };
    if (!actions) return { ok: false, reason: 'its actions must be a non-empty list of unique strings' };
    if (!scope) return { ok: false, reason: 'its scope must be a non-empty list of unique strings' };
    if (!triggers) return { ok: false, reason: 'its triggers must be a non-empty list, each naming a trigger and its independent verifier' };
    if (!reviewers) return { ok: false, reason: 'its reviewers must be a non-empty list of unique strings' };
    if (!pausers) return { ok: false, reason: 'its pausers must be a non-empty list of unique strings' };
    // Safe integers, not merely integers: a deadline or a cap past the range a Date can hold is not
    // a permission this kernel can schedule, and accepting it would move the failure to the moment
    // the review falls due.
    if (!Number.isSafeInteger(maxUses) || maxUses < 1) return { ok: false, reason: 'maxUses must be a positive safe integer' };
    if (!Number.isSafeInteger(reviewDueMs) || reviewDueMs < 1) return { ok: false, reason: 'reviewDueMs must be a positive safe integer' };
    // And shorter than the whole calendar, which is the last value a safe integer can hold and still
    // be a deadline somebody could stamp. A grant that declares one is authorized, sealed as
    // verified and then refused at every single use, because `now + reviewDueMs` is not an instant:
    // a signature on a permission that can never be exercised is refused here instead (H02).
    if (reviewDueMs > CALENDAR_SPAN_MS) return { ok: false, reason: `reviewDueMs is longer than the whole calendar (${CALENDAR_SPAN_MS} ms), so no use of this permission could ever stamp its review` };
    if (startsAt === null || expiresAt === null || expiresAt <= startsAt) return { ok: false, reason: 'it needs a valid clock interval' };
    // The signal has to come from somebody who is neither the agent that will exercise the
    // permission nor the person who granted it. Independence is structural, not a promise.
    for (const trigger of triggers) {
      if (trigger.verifierId === grantee || trigger.verifierId === owner) {
        return { ok: false, reason: `the verifier of trigger ${trigger.id} must be independent: it cannot be the grantee (${grantee}) or the owner (${owner})` };
      }
    }
    if (!pausers.includes(owner)) return { ok: false, reason: 'the person who granted it must be allowed to pause it' };
    return {
      ok: true,
      snapshot: {
        id, owner, grantee, destination, purpose, actions, scope, triggers, reviewers, pausers,
        maxUses, reviewDueMs, startsAt, expiresAt, approval: null,
      },
    };
  } catch {
    return { ok: false, reason: 'it could not be read safely' };
  }
}

function readPermission(permission) {
  const read = snapshotPermission(permission);
  return read.ok ? read.snapshot : null;
}

function clone(value) {
  const copied = canonical(value);
  return copied === NOT_REPRESENTABLE ? null : copied;
}

// One read per field, and the signal copied exactly once: the id and source that get checked against
// the declaration, and the body the verifier receives, all come out of that single copy. Reading the
// caller's signal twice is how a receipt ends up naming a signal the verifier never saw.
function snapshotRequest(request) {
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
    if (!ownDataOnly(request)) return null;
    const useId = request.useId;
    const actor = request.actor;
    const action = request.action;
    const subject = request.subject;
    const destination = request.destination;
    const triggerId = request.triggerId;
    const signal = request.triggerSignal;
    let body = null;
    if (signal && typeof signal === 'object' && !Array.isArray(signal)) {
      body = ownDataOnly(signal) ? canonical(signal) : NOT_REPRESENTABLE;
      if (body === NOT_REPRESENTABLE) body = null;
    }
    return {
      useId: text(useId) ? useId : null,
      actor: text(actor) ? actor : null,
      action: text(action) ? action : null,
      subject: reference(subject) ? subject : null,
      subjectRejected: text(subject) && !reference(subject),
      destination: text(destination) ? destination : null,
      triggerId: text(triggerId) ? triggerId : null,
      signal: body ? { id: text(body.id) ? body.id : null, source: text(body.source) ? body.source : null, body: freeze(body) } : null,
    };
  } catch {
    return null;
  }
}

// An injected clock is a synchronous contract: an asynchronous clock cannot authorize an effect, and
// an unreadable one blocks instead of throwing, because a caller with a bad clock still gets a receipt.
function readClock(now) {
  let value = now;
  if (value === undefined || value === null) value = Date.now();
  try {
    if (typeof value === 'object' || typeof value === 'function') {
      if (typeof value.then === 'function') {
        // Consume the eventual rejection while refusing to wait for it.
        Promise.resolve(value).catch(() => {});
        return { ok: false, reason: 'the injected emergency clock is asynchronous and cannot authorize a use' };
      }
      return { ok: false, reason: 'the injected emergency clock is not a time' };
    }
  } catch {
    return { ok: false, reason: 'the injected emergency clock could not be read' };
  }
  const parsed = parseTime(value);
  if (parsed === null) return { ok: false, reason: 'the injected emergency clock is not a time' };
  return { ok: true, now: parsed };
}

function iso(ms) {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid emergency clock');
  return date.toISOString();
}

function readRecords(ledger) {
  try {
    return LEDGER.get(ledger) || null;
  } catch {
    return null;
  }
}

const LEDGER = new WeakMap();

function newRecord() {
  return {
    family: null, uses: 0, paused: false, revoked: false, stopped: false, rejectedUse: null,
    pending: null, useIds: new Set(), signalIds: new Set(), receipts: new Map(), busy: false,
  };
}

// The public id is not an identity. Two different people may hold two real grants that happen to
// share an id, and one person's reviewer must not close the other's review nor one person's owner
// revoke the other's authority. So every record remembers the private family that opened it, and
// only that family may read or move it. The token never travels and cannot be built by a caller,
// so a collision fails closed: nothing is spent, nothing changes and nothing is revealed (R201,
// R202). A renewal keeps the same token, because a longer clock is the same grant, not a new one.
const FOREIGN_RECORD = 'the emergency record under this id was opened by a different grant, so this kernel neither reads nor changes it';

// Opens the record for this family, or refuses: this is the only path that creates one, and it
// refuses rather than letting a second family take an id that is already in use.
function claimRecord(records, id, family) {
  const existing = records.get(id);
  if (!existing) {
    const record = newRecord();
    record.family = family;
    records.set(id, record);
    return { ok: true, record };
  }
  return existing.family === family ? { ok: true, record: existing } : { ok: false, reason: FOREIGN_RECORD };
}

// Reading is not claiming: a record nobody opened yet stays absent instead of being created, and a
// record that belongs to another family is not read at all.
function readRecord(records, id, family) {
  const existing = records.get(id);
  if (!existing) return { ok: true, record: null };
  return existing.family === family ? { ok: true, record: existing } : { ok: false, reason: FOREIGN_RECORD };
}

function assetOf(id) {
  return `emergency-use:${id}`;
}

function grantOf(snapshot) {
  if (!snapshot) return [];
  return [{
    asset: assetOf(snapshot.id),
    maxAmount: String(snapshot.maxUses),
    to: snapshot.destination,
    expiresAt: iso(snapshot.expiresAt),
  }];
}

// Coverage is read the way receipt.js reads it: a check counts only when it passed.
function coverageOf(checks) {
  const covered = [];
  for (const key of Object.keys(checks)) if (checks[key] === true) covered.push(key);
  return covered;
}

// And a check that did not pass is not covered, which is the other half of the same rule and what
// receipt.js puts at the head of `notCovered`. A blocked receipt used to name `trigger_verified` and
// stay silent about a `grantor_authority` that came back false, so a consumer reading `notCovered`
// to learn what was not proven was told nothing about the grant (H01).
function failedChecks(checks) {
  const failed = [];
  for (const key of Object.keys(checks)) if (checks[key] !== true) failed.push(key);
  return failed;
}

function seal(receipt) {
  const next = { ...receipt };
  delete next.digest;
  next.digest = computeDigest(next);
  return freeze(next);
}

// The normalized grant as the host and the permission see it: the same object shape, with the clock
// as the ISO strings a receipt can carry. Everything the kernel compares stays in milliseconds.
function grantView(snapshot) {
  return {
    id: snapshot.id,
    owner: snapshot.owner,
    grantee: snapshot.grantee,
    destination: snapshot.destination,
    purpose: snapshot.purpose,
    actions: [...snapshot.actions],
    scope: [...snapshot.scope],
    startsAt: iso(snapshot.startsAt),
    expiresAt: iso(snapshot.expiresAt),
    maxUses: snapshot.maxUses,
    triggers: snapshot.triggers.map((trigger) => ({ ...trigger })),
    reviewers: [...snapshot.reviewers],
    reviewDueMs: snapshot.reviewDueMs,
    pausers: [...snapshot.pausers],
  };
}

// What was authorized and what was asked for, sealed next to the digest. Without it a receipt said
// which permission it spent but not whose authority, not which agent, and not which subject was
// touched: two different uses of the same permission sealed the same body. Only normalized values
// go in, and the subject only as the operational reference it was validated to be.
function authorizationOf(snapshot, asked) {
  if (!snapshot) return null;
  return {
    owner: snapshot.owner,
    grantee: snapshot.grantee,
    destination: snapshot.destination,
    action: asked && asked.action ? asked.action : null,
    subject: asked && asked.subject ? asked.subject : null,
    grantDigest: fingerprint(grantView(snapshot)),
  };
}

function blockedReceipt({ snapshot, authority, action, signalId, reason, at }) {
  // `grantor_authority` is read from the binding that was actually checked, never from the shape of
  // an object: a forged permission that happens to be well formed claims nothing.
  const checks = { grantor_authority: authority === true, trigger_verified: false };
  const receipt = {
    status: 'blocked',
    operation: { id: snapshot ? snapshot.id : 'unknown', goal: snapshot ? snapshot.purpose : DEFAULT_GOAL },
    ...(action ? { action } : {}),
    capability: CAPABILITY,
    authority: {
      grants: grantOf(snapshot),
      exercised: [],
      ...(snapshot && snapshot.approval ? { approval: snapshot.approval } : {}),
    },
    outcome: 'blocked',
    evidence: signalId ? { signalId } : null,
    verification: { verified: false, checks, reason },
    coverage: coverageOf(checks),
    notCovered: [...failedChecks(checks), 'effect_verified', 'external anchor', 'exact_state'],
    anchor: { ...PENDING_ANCHOR },
    ...(authority === true ? { authorization: authorizationOf(snapshot, action ? { action } : null) } : {}),
    detail: reason,
    at,
  };
  return seal(receipt);
}

// The receipt is built here rather than through buildReceipt because the two facts this capability
// has to carry — which trigger verified the signal, and the review that is still open — have no
// field in the common shape. Everything buildReceipt guarantees is kept: status, capability,
// authority grants and exercised amounts, declared coverage, a pending anchor, and a digest that
// verifyReceipt recomputes. The effect itself is never claimed verified: the exercise is a grant
// spent, not an effect proven, and the operation goes back to the person (decision 27).
function useReceipt(snapshot, asked, trigger, checked, dueAtMs, signalDigest) {
  const signalId = asked.signal.id;
  const checks = { grantor_authority: true, trigger_verified: true, effect_verified: false };
  const receipt = {
    status: 'not_verified',
    operation: { id: snapshot.id, goal: snapshot.purpose },
    action: asked.action,
    capability: CAPABILITY,
    authority: {
      grants: grantOf(snapshot),
      exercised: [{ asset: assetOf(snapshot.id), maxAmount: '1', to: snapshot.destination }],
      ...(snapshot.approval ? { approval: snapshot.approval } : {}),
    },
    outcome: 'not_verified',
    evidence: { signalId },
    verification: {
      verified: false,
      checks,
      reason: 'trigger verified by an independent signal; the effect is unverified and the post-use review is open',
    },
    coverage: coverageOf(checks),
    // `exact_state` is named here because this module cannot see it: it never reads the repository,
    // the disk or the network, so decision 22 stays open and the receipt says so out loud.
    notCovered: ['effect_verified', 'post_use_review', 'external anchor', 'exact_state'],
    anchor: { ...PENDING_ANCHOR },
    authorization: authorizationOf(snapshot, asked),
    trigger: {
      id: trigger.id,
      verifierId: trigger.verifierId,
      signalId,
      // A digest of the very body the verifier received, so the receipt is bound to that signal and
      // not merely to an id anybody could reuse. The body itself never travels. The digest was
      // computed and checked before the verifier was asked, so it is a hash or this call never got
      // here: there is no path left that seals a null fingerprint next to a verified trigger.
      signalDigest,
      signalSource: asked.signal.source,
      verification: { verified: true, reason: checked.reason },
    },
    review: { status: 'pending', reviewers: [...snapshot.reviewers], dueAt: iso(dueAtMs) },
    useId: asked.useId,
    at: asked.at,
  };
  return seal(receipt);
}

// ─── The grant ────────────────────────────────────────────────────────────────────────────────

async function createEmergencyPermission(grant, options = {}) {
  const deps = readOptions(options, ['authorizeGrantor', 'resolveVerifier', 'authorizeRenewal']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  const { authorizeGrantor, resolveVerifier, authorizeRenewal } = deps;
  const read = snapshotPermission(grant);
  if (!read.ok) throw new Error(`emergency permission is malformed: ${read.reason}`);
  const snapshot = read.snapshot;
  if (typeof authorizeGrantor !== 'function') throw new Error('an injected grantor authority check is required: the kernel cannot see who granted this');
  // The candidate is read once, frozen, and is the single source from here on: the host authorizes
  // this object and the permission is built from this object. A second read of the caller's grant
  // would let the grantor answer about one scope while the kernel binds another (ADV05).
  const candidate = freeze(grantView(snapshot));
  const grantDigest = fingerprint(candidate);
  let granted;
  try {
    granted = await authorizeGrantor(candidate);
  } catch {
    throw new Error('the grantor authority could not be verified');
  }
  // The host's answer is read once per field and inside one error boundary. An answer whose
  // `verified` or `grantor` cannot be read has authorized nothing, and the text of whatever it threw
  // on the way belongs to the host: the caller is told a fixed sentence and nothing else (R204,
  // R205). A failing read never leaves a half-granted permission behind, because nothing has been
  // bound yet.
  let verified;
  let grantor;
  let rawReason;
  try {
    const answered = granted && typeof granted === 'object' ? granted : null;
    verified = answered ? answered.verified : undefined;
    grantor = answered ? answered.grantor : undefined;
    rawReason = answered ? answered.reason : undefined;
  } catch {
    throw new Error('the grantor authority answer could not be read safely');
  }
  if (verified !== true) {
    throw new Error('the grantor authority check did not verify this grant');
  }
  if (grantor !== snapshot.owner) {
    throw new Error(`grantor authority does not name the owner of this emergency permission (${snapshot.owner})`);
  }
  if (typeof resolveVerifier !== 'function') throw new Error('an injected trigger verifier resolver is required: the kernel cannot know what verifies a signal');
  const verifiers = new Map();
  for (const trigger of snapshot.triggers) {
    let verifier;
    try {
      verifier = await resolveVerifier(trigger.verifierId);
    } catch {
      throw new Error(`the independent verifier for trigger ${trigger.id} could not be resolved`);
    }
    // Same rule for the resolved verifier: read `id` and `verify` once each, validate those
    // variables, and bind exactly those. A getter that answers a good id first and a different
    // `verify` afterwards must not leave the kernel validating one function and calling another
    // (R203).
    let verifierId;
    let verify;
    try {
      const resolved = verifier && typeof verifier === 'object' ? verifier : null;
      verifierId = resolved ? resolved.id : undefined;
      verify = resolved ? resolved.verify : undefined;
    } catch {
      throw new Error(`the resolved verifier for trigger ${trigger.id} could not be read safely`);
    }
    if (verifierId !== trigger.verifierId || typeof verify !== 'function') {
      throw new Error(`the resolved verifier is not the independent verifier ${trigger.verifierId} declared for trigger ${trigger.id}`);
    }
    verifiers.set(trigger.id, { id: verifierId, verify });
  }
  const bound = {
    snapshot: { ...snapshot, approval: safeText(rawReason) || 'the grantor authority check named the owner of this permission' },
    verifiers,
    // A renewal grows the authority a person signed, so it needs a fresh answer from the host. The
    // approver is bound here and never chosen by whoever renews; when the host supplies none, the
    // clock simply cannot be extended (ADV04).
    approver: typeof authorizeRenewal === 'function' ? authorizeRenewal : null,
    grantDigest,
    // The private family of this one grant, born here and kept by every renewal of it.
    family: Object.freeze({}),
  };
  const permission = freeze({
    ...candidate,
    grantVerification: {
      verified: true,
      reason: bound.snapshot.approval,
    },
  });
  BINDINGS.set(permission, bound);
  return permission;
}

function createEmergencyLedger() {
  const ledger = Object.freeze({});
  LEDGER.set(ledger, new Map());
  return ledger;
}

function bindingOf(permission) {
  try {
    return BINDINGS.get(permission) || null;
  } catch {
    return null;
  }
}

function boundVerifier(bound, triggerId) {
  try {
    return bound ? bound.verifiers.get(triggerId) || null : null;
  } catch {
    return null;
  }
}

// ─── The exercise ─────────────────────────────────────────────────────────────────────────────

// The options of every entry point above are read through `options || {}`. A destructuring default
// only answers for `undefined`, so a caller who passed `null` used to get a raw `TypeError` out of
// six public functions, while `0`, `'x'` and `true` in the same place were already handled: this
// module promises to fail closed on a missing or unusable input, and `null` is one (H19).

// Everything a nested call could have changed while the verifier ran: what the person decided about
// this permission, and what this very call already spent.
function pendingBlock(record, snapshot, asked) {
  if (record.revoked) return 'this emergency permission was revoked by the person who granted it';
  if (record.stopped) return `this emergency permission was stopped: the post-use review of ${record.rejectedUse} was rejected, and it needs a new grant`;
  if (record.paused) return 'this emergency permission is paused';
  if (record.uses >= snapshot.maxUses) return `the emergency use limit is exhausted (${record.uses} of ${snapshot.maxUses})`;
  if (record.useIds.has(asked.useId)) return `emergency use ${asked.useId} was already used; a replay under another request key is refused`;
  if (asked.signal && record.signalIds.has(asked.signal.id)) return `trigger signal ${asked.signal.id} already opened a use; one signal opens one use`;
  if (record.pending) return `the post-use review of ${record.pending.useId} is still pending, so no second use is allowed`;
  return null;
}

// The verdict is read once per field and inside the same error boundary as the call itself. A
// verifier whose `verified` or `reason` cannot be read has not verified anything, and the reason
// that travels to the receipt is the bounded primitive this function produced — never an object,
// never the text of an exception raised by a getter (ADV08, ADV09, ADV25).
function verifySignal(verifier, trigger, signal, signalDigest) {
  // Both copies are made, and the fingerprint of the body is required, before the verifier is
  // called: this kernel never hands a body it could not hash, and never reserves a use it could not
  // seal. NOT_REPRESENTABLE is an internal marker and never reaches the callback.
  let triggerCopy;
  let bodyCopy;
  let checked;
  try {
    triggerCopy = canonical(trigger);
    bodyCopy = canonical(signal.body);
    if (!signalDigest || triggerCopy === NOT_REPRESENTABLE || bodyCopy === NOT_REPRESENTABLE) {
      return { ok: false, reason: 'the trigger signal has no representation this kernel can hand over and seal, so nothing was verified' };
    }
    // The verifier gets copies: it may do whatever it likes with them, and the body the kernel seals a
    // digest of is the one it actually handed over.
    checked = verifier.verify(triggerCopy, bodyCopy);
  } catch {
    return { ok: false, reason: 'the independent trigger verification failed' };
  }
  try {
    if (checked && (typeof checked === 'object' || typeof checked === 'function') && typeof checked.then === 'function') {
      Promise.resolve(checked).catch(() => {});
      return { ok: false, reason: 'the independent trigger verification answered asynchronously, which this kernel does not wait for' };
    }
  } catch {
    return { ok: false, reason: 'the independent trigger verification could not be read' };
  }
  let verified;
  let rawReason;
  try {
    verified = checked && typeof checked === 'object' ? checked.verified : undefined;
    rawReason = checked && typeof checked === 'object' ? checked.reason : undefined;
  } catch {
    return { ok: false, reason: 'the independent trigger verification could not be read' };
  }
  if (verified !== true) return { ok: false, reason: 'the trigger signal was not independently verified' };
  return { ok: true, reason: safeText(rawReason) || 'verified by the injected independent verifier' };
}

function exerciseEmergency(permission, request, options = {}) {
  const read = snapshotPermission(permission);
  const snapshot = read.ok ? read.snapshot : null;
  const asked = snapshotRequest(request);
  const deps = readOptions(options, ['ledger', 'now']);
  const ledger = deps ? deps.ledger : undefined;
  const clock = deps ? readClock(deps.now) : { ok: false, reason: UNREADABLE_OPTIONS };
  const bound = bindingOf(permission);
  const authority = bound !== null;
  const fail = (reason, at, signalId) => ({
    state: 'blocked',
    reason,
    nextUse: 'blocked',
    receipt: blockedReceipt({
      snapshot, authority, at, reason, signalId,
      action: asked ? asked.action : null,
    }),
  });
  if (!clock.ok) return fail(clock.reason, iso(Date.now()));
  const at = iso(clock.now);
  if (!snapshot) return fail(`the emergency permission could not be read safely: ${read.reason}`, at);
  if (!asked) return fail('the emergency request could not be read safely', at);
  const records = readRecords(ledger);
  if (!records) return fail('a kernel emergency ledger is required to exercise emergency access', at, asked.signal ? asked.signal.id : null);
  // Readable is not granted: only the object the grant path produced carries authority.
  if (!bound) return fail('no grant is bound to this emergency permission: an object that did not come through the grant path exercises nothing', at, asked.signal ? asked.signal.id : null);
  const claimed = claimRecord(records, snapshot.id, bound.family);
  if (!claimed.ok) return fail(claimed.reason, at, asked.signal ? asked.signal.id : null);
  const record = claimed.record;

  // Order matters twice over. Replay is checked before the pending review, so a caller replaying a
  // use is told it is a replay instead of being told the review is open. And revocation, pause and
  // the clock are checked before the signal is looked at, so a permission the person already stopped
  // never spends a verifier call.
  const blocked = pendingBlock(record, snapshot, asked);
  if (blocked) return fail(blocked, at, asked.signal ? asked.signal.id : null);
  if (clock.now < snapshot.startsAt) return fail(`this emergency permission is not valid before ${iso(snapshot.startsAt)}`, at, asked.signal ? asked.signal.id : null);
  if (clock.now >= snapshot.expiresAt) return fail(`this emergency permission expired at ${iso(snapshot.expiresAt)}`, at, asked.signal ? asked.signal.id : null);
  if (!asked.useId) return fail('the emergency request carries no stable use id, so it could not be told apart from a replay', at, asked.signal ? asked.signal.id : null);
  if (asked.actor !== snapshot.grantee) return fail(`the actor is outside the granted authority (${snapshot.grantee})`, at, asked.signal ? asked.signal.id : null);
  if (asked.subjectRejected) {
    return fail('the subject is not an operational reference, and this kernel will not seal record content into a receipt', at, asked.signal ? asked.signal.id : null);
  }
  if (!snapshot.actions.includes(asked.action) || !snapshot.scope.includes(asked.subject)
    || asked.destination !== snapshot.destination) {
    return fail('the requested action, subject or destination is outside the granted scope', at, asked.signal ? asked.signal.id : null);
  }
  const trigger = snapshot.triggers.find((item) => item.id === asked.triggerId);
  if (!trigger) return fail('the trigger was not declared in advance by the person who granted this permission', at, asked.signal ? asked.signal.id : null);
  if (!asked.signal) return fail('the emergency request carries no trigger signal, or one this kernel cannot read safely', at);
  if (asked.signal.source !== trigger.verifierId) return fail(`the trigger signal does not come from the declared verifier ${trigger.verifierId}`, at, asked.signal.id);
  if (!asked.signal.id) return fail('the trigger signal carries no id, so it could not be told apart from a replay', at);
  const verifier = boundVerifier(bound, trigger.id);
  if (!verifier) return fail(`no independent verifier is bound to this emergency permission for trigger ${trigger.id}; a permission that did not go through the grant path exercises nothing`, at, asked.signal.id);
  // The review deadline is checked before the verifier is asked and before anything is reserved: a
  // deadline no calendar can hold must not spend a verifier call and then fail to stamp a review.
  const dueAtMs = clock.now + snapshot.reviewDueMs;
  if (parseTime(dueAtMs) === null) {
    return fail('the post-use review deadline falls outside the calendar this kernel can hold, so the use spends nothing', at, asked.signal.id);
  }
  // The fingerprint of the signal is taken and required before anything is verified or reserved. A
  // body this kernel cannot hash faithfully is refused while it still costs nothing, rather than
  // being verified and then sealed with no evidence at all.
  const signalDigest = fingerprint(asked.signal.body);
  if (!signalDigest) {
    return fail('the trigger signal has no representation this kernel can hash and seal, so the use spends nothing', at, asked.signal.id);
  }

  // Synchronous is not the same as unreentrant. The verifier is caller code running inside this
  // call: a verifier that re-enters `exerciseEmergency` on the same permission would otherwise find
  // the cap unspent and open a second use out of one signal. The record is held for the whole run
  // and released in `finally`, so a nested call is blocked and spends nothing.
  if (record.busy) {
    return fail('a use of this emergency permission is already being checked in this same run; one signal opens one use', at, asked.signal.id);
  }
  record.busy = true;
  try {
    const checked = verifySignal(verifier, trigger, asked.signal, signalDigest);
    if (!checked.ok) return fail(checked.reason, at, asked.signal.id);
    // Everything the verifier could have changed with a side effect gets read again: a person who
    // revoked the permission while the sensor was thinking has already said no (ADV07).
    const changed = pendingBlock(record, snapshot, asked);
    if (changed) return fail(`${changed} while the signal was being verified`, at, asked.signal.id);
    // The receipt is sealed before the cap moves. A receipt that cannot be built spends nothing, and
    // the slot it would have taken stays available to the next honest caller.
    let receipt;
    try {
      receipt = useReceipt({ ...snapshot, approval: bound.snapshot.approval }, { ...asked, at }, trigger, checked, dueAtMs, signalDigest);
    } catch {
      return fail('the receipt for this use could not be sealed, so nothing was spent', at, asked.signal.id);
    }
    record.uses += 1;
    record.useIds.add(asked.useId);
    record.signalIds.add(asked.signal.id);
    record.pending = { useId: asked.useId, triggerId: trigger.id, dueAtMs };
    record.receipts.set(asked.useId, receipt);
    return { state: 'review_pending', reason: null, nextUse: 'blocked_until_review', receipt };
  } finally {
    record.busy = false;
  }
}

// ─── The post-use review ─────────────────────────────────────────────────────────────────────

function requireBinding(permission, bound, verb) {
  if (bound) return bound;
  throw new Error(`this emergency permission carries no grant: no authority is bound to it, so it cannot be ${verb}`);
}

function reviewEmergencyUse(permission, useId, options = {}) {
  const deps = readOptions(options, ['ledger', 'by', 'decision', 'now']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  const { ledger, by, decision, now } = deps;
  const bound = requireBinding(permission, bindingOf(permission), 'reviewed');
  // Owner, reviewers and pausers are read from the grant that was actually authorized, not from the
  // object this caller happens to be holding.
  const snapshot = bound.snapshot;
  if (!text(useId)) throw new Error('a review names the use it closes');
  if (!text(by)) throw new Error('a review names who closed it');
  if (decision !== 'accept' && decision !== 'reject') throw new Error('review decision must be accept or reject');
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to close an emergency review');
  const found = readRecord(records, snapshot.id, bound.family);
  if (!found.ok) throw new Error(found.reason);
  const record = found.record;
  if (!record || !record.pending || record.pending.useId !== useId) throw new Error('no matching pending emergency review');
  if (!snapshot.reviewers.includes(by)) {
    throw new Error(`not authorized to close this emergency review: reviewers are [${snapshot.reviewers.join(', ')}]`);
  }
  // Read before anything moves: a review closed with a clock nobody injected would be stamped with
  // wall time and would look like the person decided at a moment she was never asked about.
  const clock = readClock(now);
  if (!clock.ok) throw new Error(clock.reason);
  const reviewedAt = iso(clock.now);
  const original = record.receipts.get(useId);
  if (!original || !original.review) throw new Error('the receipt for this use is not in the record, so nothing can be closed over it');
  // A review cannot predate the use it closes. A clock that walked backwards would stamp the
  // decision before the event, and the ledger and the open review stay exactly as they were.
  const usedAt = parseTime(original.at);
  if (usedAt === null || clock.now < usedAt) {
    throw new Error('a post-use review cannot be dated before the use it closes: the injected clock went backwards');
  }
  // Closing the review is a transition that actually happened, so the receipt says it happened: the
  // check is derived from this call, the reason stops saying the review is open, and the effect
  // stays unverified either way. Accepting a review does not claim anybody read the document.
  const checks = { ...original.verification.checks, post_use_review: true };
  const closed = seal({
    ...original,
    verification: {
      ...original.verification,
      checks,
      reason: decision === 'accept'
        ? 'trigger verified by an independent signal; the post-use review was closed by a declared reviewer; the effect is unverified'
        : 'trigger verified by an independent signal; the post-use review was rejected by a declared reviewer; the effect is unverified',
    },
    coverage: coverageOf(checks),
    notCovered: original.notCovered.filter((key) => key !== 'post_use_review'),
    review: { ...original.review, status: 'reviewed', decision, by, reviewedAt },
  });
  record.receipts.set(useId, closed);
  record.pending = null;
  // A rejection is the person saying the use was not hers. It stops the permission: it cannot be
  // resumed, and undoing the effect is not something this kernel can do.
  if (decision === 'reject') {
    record.stopped = true;
    record.rejectedUse = useId;
  }
  return closed;
}

// ─── Pause, revocation and renewal (decision 16: the agreement says who may pause) ──────────────

// The state these three answer with is read with the clock the caller injected. It used to be read
// with `{ ledger }` alone, so a `now` in the options was dropped on the floor and the state was
// decided against the wall clock: a caller that had been working with a fixed clock all along got
// an answer about a moment nobody asked about, and the existing suite already passed a `now` to
// `revokeEmergencyPermission` without ever seeing it arrive (H03).
function pauseEmergencyPermission(permission, options = {}) {
  const deps = readOptions(options, ['ledger', 'by', 'now']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  const { ledger, by, now } = deps;
  const bound = requireBinding(permission, bindingOf(permission), 'paused');
  const snapshot = bound.snapshot;
  if (!snapshot.pausers.includes(by)) throw new Error(`not authorized to pause: pausers are [${snapshot.pausers.join(', ')}]`);
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to pause an emergency permission');
  const claimed = claimRecord(records, snapshot.id, bound.family);
  if (!claimed.ok) throw new Error(claimed.reason);
  claimed.record.paused = true;
  return getEmergencyState(permission, { ledger, now });
}

function resumeEmergencyPermission(permission, options = {}) {
  const deps = readOptions(options, ['ledger', 'by', 'now']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  const { ledger, by, now } = deps;
  const bound = requireBinding(permission, bindingOf(permission), 'resumed');
  const snapshot = bound.snapshot;
  if (!snapshot.pausers.includes(by)) throw new Error(`not authorized to resume: pausers are [${snapshot.pausers.join(', ')}]`);
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to resume an emergency permission');
  const claimed = claimRecord(records, snapshot.id, bound.family);
  if (!claimed.ok) throw new Error(claimed.reason);
  const record = claimed.record;
  if (record.revoked) throw new Error('a revoked emergency permission cannot be resumed');
  if (record.stopped) throw new Error(`this emergency permission was stopped by the rejected review of ${record.rejectedUse}; resuming it is not what the person decided, so it needs a new grant`);
  record.paused = false;
  return getEmergencyState(permission, { ledger, now });
}

function revokeEmergencyPermission(permission, options = {}) {
  const deps = readOptions(options, ['ledger', 'by', 'now']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  const { ledger, by, now } = deps;
  const bound = requireBinding(permission, bindingOf(permission), 'revoked');
  const snapshot = bound.snapshot;
  if (by !== snapshot.owner) throw new Error('only the person who granted this emergency permission may revoke it');
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to revoke an emergency permission');
  const claimed = claimRecord(records, snapshot.id, bound.family);
  if (!claimed.ok) throw new Error(claimed.reason);
  claimed.record.revoked = true;
  return getEmergencyState(permission, { ledger, now });
}

// Renewal moves the clock and nothing else. The grant a person signed does not grow because time
// passed, and the record of what was already spent stays with the same id. The clock growing is
// still a growth of authority, so it needs the approver the host bound at grant time: nobody holding
// the object can hand the kernel its own approval, and a host that bound no approver cannot have the
// clock extended at all.
function renewEmergencyPermission(permission, changes) {
  const bound = requireBinding(permission, bindingOf(permission), 'renewed');
  const snapshot = bound.snapshot;
  let keys;
  try {
    keys = changes && typeof changes === 'object' && !Array.isArray(changes) ? Object.keys(changes) : [];
  } catch {
    keys = [];
  }
  if (keys.length !== 1 || keys[0] !== 'expiresAt') {
    throw new Error('renewal cannot widen or alter the grant: only expiresAt may change, because the person signed the rest');
  }
  // One read. The value that was validated is the value that gets stored: a second read is how a
  // renewal stamps a clock nobody approved (ADV18).
  let rawExpiresAt;
  try {
    rawExpiresAt = changes.expiresAt;
  } catch {
    throw new Error('a renewal must extend the existing clock, and never shorten it');
  }
  const expiresAt = parseTime(rawExpiresAt);
  if (expiresAt === null || expiresAt <= snapshot.expiresAt) {
    throw new Error('a renewal must extend the existing clock, and never shorten it');
  }
  if (!bound.approver) {
    throw new Error(`no renewal approver is bound to this emergency permission: extending the clock needs a fresh authorization from ${snapshot.owner}, and this kernel cannot stand in for it`);
  }
  const candidate = freeze(grantView({ ...snapshot, expiresAt }));
  let answer;
  try {
    answer = bound.approver(candidate);
  } catch {
    throw new Error('the renewal authorization could not be read');
  }
  // Whether this host answered asynchronously is a fact about this call, not a word to look for in
  // somebody else's exception: a private error that happens to contain `asynchronously` used to be
  // recognized, republished and escape to the caller (R207). An internal flag decides it, and the
  // promise is drained and refused rather than awaited.
  let asynchronous = false;
  try {
    asynchronous = Boolean(answer) && (typeof answer === 'object' || typeof answer === 'function')
      && typeof answer.then === 'function';
  } catch {
    throw new Error('the renewal authorization could not be read');
  }
  if (asynchronous) {
    try {
      Promise.resolve(answer).catch(() => {});
    } catch {
      // A thenable that throws on the second read is still a refusal, not a reason to keep waiting.
    }
    throw new Error('the renewal authorization answered asynchronously, which this kernel does not wait for');
  }
  // One read per field, inside one error boundary, and one reason: the sentence that seals the
  // public permission and the one the private binding remembers are the same value, read once. A
  // read that throws refuses the renewal and leaves the original grant exactly as usable as it was
  // (R206, R208).
  let verified;
  let grantor;
  let rawReason;
  try {
    const answered = answer && typeof answer === 'object' ? answer : null;
    verified = answered ? answered.verified : undefined;
    grantor = answered ? answered.grantor : undefined;
    rawReason = answered ? answered.reason : undefined;
  } catch {
    throw new Error('the renewal authorization could not be read');
  }
  if (verified !== true) {
    throw new Error(`the renewal authorization did not approve extending this emergency permission`);
  }
  if (grantor !== snapshot.owner) {
    throw new Error(`the renewal authorization does not name the owner of this emergency permission (${snapshot.owner})`);
  }
  const approval = safeText(rawReason) || snapshot.approval;
  const renewed = freeze({ ...clone(candidate), grantVerification: { verified: true, reason: approval } });
  BINDINGS.set(renewed, { ...bound, snapshot: { ...snapshot, expiresAt, approval } });
  return renewed;
}

// ─── What the operation says about itself ─────────────────────────────────────────────────────

function getEmergencyState(permission, options = {}) {
  const deps = readOptions(options, ['ledger', 'now']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  const { ledger, now } = deps;
  const snapshot = readPermission(permission);
  if (!snapshot) throw new Error('emergency permission is malformed and has no state');
  const bound = bindingOf(permission);
  const records = readRecords(ledger);
  // A ledger that exists but has never seen this id is a permission nobody has touched yet, not a
  // missing one: the reads below need a record either way. A record that belongs to another family
  // is not read at all, so this call can neither reveal nor answer for it.
  const found = !records || !bound ? { ok: true, record: null } : readRecord(records, snapshot.id, bound.family);
  const foreign = !found.ok;
  const record = found.ok ? (found.record || newRecord()) : null;
  const uses = record ? record.uses : 0;
  const clock = readClock(now);
  // A clock nobody injected and nobody could read is not replaced with wall time to decide whether
  // the permission is available: the honest answer is that this kernel does not know.
  const at = clock.ok ? clock.now : null;
  const pending = record && record.pending ? record.pending : null;
  const expired = at !== null && at >= snapshot.expiresAt;
  const exhausted = uses >= snapshot.maxUses;
  let status = 'active';
  let nextUse = 'allowed';
  // Without the ledger the exercise is blocked, so the state that says "available" would be a lie.
  if (!records) {
    status = 'no_ledger';
    nextUse = 'blocked_no_ledger';
  } else if (!bound) {
    status = 'unbound';
    nextUse = 'blocked_unbound';
  } else if (foreign) {
    // The id belongs to another grant. The honest answer is that this kernel cannot answer for it,
    // and it says so instead of reporting another person's availability.
    status = 'record_conflict';
    nextUse = 'blocked_record_conflict';
  } else if (record.revoked) {
    status = 'revoked';
    nextUse = 'blocked_revoked';
  } else if (record.stopped) {
    status = 'stopped_by_review';
    nextUse = 'blocked_stopped';
  } else if (record.paused) {
    status = 'paused';
    nextUse = 'blocked_paused';
  } else if (pending) {
    status = 'review_pending';
    nextUse = 'blocked_until_review';
  } else if (record.busy) {
    // A use of this permission is being checked in this very run. A nested call would be refused
    // for that, and a state that answered `allowed` in the middle of it would be advertising a
    // slot the kernel is about to close. What the person revoked, stopped, paused or left pending
    // still outranks it.
    status = 'verifying';
    nextUse = 'blocked_verifying';
  } else if (!clock.ok) {
    status = 'unknown_clock';
    nextUse = 'blocked_unknown_clock';
  } else if (at < snapshot.startsAt) {
    status = 'not_yet_valid';
    nextUse = 'blocked_not_started';
  } else if (expired) {
    status = 'expired';
    nextUse = 'blocked_expired';
  } else if (exhausted) {
    status = 'exhausted';
    nextUse = 'blocked_exhausted';
  }
  return {
    id: snapshot.id,
    status,
    uses,
    maxUses: snapshot.maxUses,
    remainingUses: Math.max(0, snapshot.maxUses - uses),
    expiresAt: iso(snapshot.expiresAt),
    paused: Boolean(record && record.paused),
    revoked: Boolean(record && record.revoked),
    pendingReview: pending ? pending.useId : null,
    reviewDueAt: pending ? iso(pending.dueAtMs) : null,
    reviewOverdue: pending !== null && at !== null && at > pending.dueAtMs,
    rejectedUse: record && record.rejectedUse ? record.rejectedUse : null,
    nextUse,
  };
}

module.exports = {
  createEmergencyPermission,
  createEmergencyLedger,
  exerciseEmergency,
  reviewEmergencyUse,
  pauseEmergencyPermission,
  resumeEmergencyPermission,
  revokeEmergencyPermission,
  getEmergencyState,
  renewEmergencyPermission,
};