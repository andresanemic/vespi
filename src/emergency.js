'use strict';

const { computeDigest } = require('./receipt.js');
const { parseTime } = require('./time.js');

// Emergency access (decision 27): authority a person grants IN ADVANCE, with a declared trigger,
// exercised against a signal somebody other than the exercising agent verified, sealed in an
// immediate receipt, and always leaving a post-use review that only a declared reviewer can close.
//
// Two bindings live outside the values, because both are identity claims the kernel cannot check
// on its own and must therefore receive from the host exactly once:
//   · LEDGER   — the mutable record of a permission (uses, pause, revocation, pending review).
//   · VERIFIERS — the independent verifier bound to a permission when the person granted it.
// The verifier is bound at grant time on purpose. If the exercising call could name its own
// verifier, "the emergency was independently verified" would be a sentence the agent writes about
// itself, which is the one thing this module exists to refuse (K1).
//
// What the kernel does NOT do, and says so: it cannot tell a real host from a lying one. Whoever
// supplies `authorizeGrantor` and `resolveVerifier` decides who may grant and what counts as the
// independent signal. The kernel's part is that an agent exercising the permission can never be
// the source of either, and that a permission which did not come through this path holds nothing.

const LEDGER = new WeakMap();
const VERIFIERS = new WeakMap();

const CAPABILITY = 'emergency-access';
const DEFAULT_GOAL = 'emergency access under prior authority';
const PENDING_ANCHOR = { status: 'pending', network: 'stellar:testnet' };
const MAX_REASON = 512;

function text(value) {
  return typeof value === 'string' && value.length > 0;
}

function safeText(value, max = MAX_REASON) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = clone(value[key]);
    return out;
  }
  return value;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

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

function triggerList(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = [];
  const ids = new Set();
  for (const trigger of value) {
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return null;
    if (!text(trigger.id) || !text(trigger.verifierId)) return null;
    if (ids.has(trigger.id)) return null;
    ids.add(trigger.id);
    out.push({ id: trigger.id, verifierId: trigger.verifierId });
  }
  return out;
}

// The kernel reads a value it did not write from a caller that may be hostile, so every read of the
// permission and the request goes through here. A permission nobody can read safely returns the
// reason it could not be read, and every caller fails closed on it: it exercises nothing.
function snapshotPermission(permission) {
  try {
    if (!permission || typeof permission !== 'object' || Array.isArray(permission)) {
      return { ok: false, reason: 'the emergency permission is not an object' };
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
    if (!Number.isInteger(maxUses) || maxUses < 1) return { ok: false, reason: 'maxUses must be a positive integer' };
    if (!Number.isInteger(reviewDueMs) || reviewDueMs < 1) return { ok: false, reason: 'reviewDueMs must be a positive integer' };
    if (startsAt === null || expiresAt === null || expiresAt <= startsAt) return { ok: false, reason: 'it needs a valid clock interval' };
    // The signal has to come from somebody who is neither the agent that will exercise the
    // permission nor the person who granted it. Independence is structural, not a promise.
    for (const trigger of triggers) {
      if (trigger.verifierId === grantee || trigger.verifierId === owner) {
        return { ok: false, reason: `the verifier of trigger ${trigger.id} must be independent: it cannot be the grantee (${grantee}) or the owner (${owner})` };
      }
    }
    if (!pausers.includes(owner)) return { ok: false, reason: 'the person who granted it must be allowed to pause it' };
    const verification = permission.grantVerification;
    const approval = verification && typeof verification === 'object' ? safeText(verification.reason) : null;
    return {
      ok: true,
      snapshot: {
        id, owner, grantee, destination, purpose, actions, scope, triggers, reviewers, pausers,
        maxUses, reviewDueMs, startsAt, expiresAt, approval,
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

function snapshotRequest(request) {
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
    const signal = request.triggerSignal;
    return {
      useId: text(request.useId) ? request.useId : null,
      actor: text(request.actor) ? request.actor : null,
      action: text(request.action) ? request.action : null,
      subject: text(request.subject) ? request.subject : null,
      destination: text(request.destination) ? request.destination : null,
      triggerId: text(request.triggerId) ? request.triggerId : null,
      signal: signal && typeof signal === 'object' && !Array.isArray(signal)
        ? { id: text(signal.id) ? signal.id : null, source: text(signal.source) ? signal.source : null, body: clone(signal) }
        : null,
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

function newRecord() {
  return {
    uses: 0, paused: false, revoked: false, stopped: false, rejectedUse: null,
    pending: null, useIds: new Set(), signalIds: new Set(), receipts: new Map(),
  };
}

function ensureRecord(records, id) {
  let record = records.get(id);
  if (!record) {
    record = newRecord();
    records.set(id, record);
  }
  return record;
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

function seal(receipt) {
  const next = { ...receipt };
  delete next.digest;
  next.digest = computeDigest(next);
  return freeze(next);
}

function blockedReceipt(snapshot, action, reason, at, signalId) {
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
    verification: {
      verified: false,
      checks: { grantor_authority: snapshot !== null, trigger_verified: false },
      reason,
    },
    coverage: coverageOf({ grantor_authority: snapshot !== null, trigger_verified: false }),
    notCovered: ['trigger_verified', 'effect_verified', 'external anchor'],
    anchor: { ...PENDING_ANCHOR },
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
function useReceipt(snapshot, request, trigger, checked, at) {
  const signalId = request.signal.id;
  const checks = { grantor_authority: true, trigger_verified: true, effect_verified: false };
  const receipt = {
    status: 'not_verified',
    operation: { id: snapshot.id, goal: snapshot.purpose },
    action: request.action,
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
    notCovered: ['effect_verified', 'post_use_review', 'external anchor'],
    anchor: { ...PENDING_ANCHOR },
    trigger: {
      id: trigger.id,
      verifierId: trigger.verifierId,
      signalId,
      verification: { verified: true, reason: safeText(checked.reason) || 'verified by the injected independent verifier' },
    },
    review: { status: 'pending', reviewers: [...snapshot.reviewers], dueAt: iso(at + snapshot.reviewDueMs) },
    useId: request.useId,
    at,
  };
  return seal(receipt);
}

// ─── The grant ────────────────────────────────────────────────────────────────────────────────

async function createEmergencyPermission(grant, { authorizeGrantor, resolveVerifier } = {}) {
  const read = snapshotPermission(grant);
  if (!read.ok) throw new Error(`emergency permission is malformed: ${read.reason}`);
  const snapshot = read.snapshot;
  if (typeof authorizeGrantor !== 'function') throw new Error('an injected grantor authority check is required: the kernel cannot see who granted this');
  let granted;
  try {
    granted = await authorizeGrantor(clone(grant));
  } catch {
    throw new Error('the grantor authority could not be verified');
  }
  if (!granted || typeof granted !== 'object' || granted.verified !== true || granted.grantor !== snapshot.owner) {
    throw new Error(`grantor authority does not name the owner of this emergency permission (${snapshot.owner})`);
  }
  if (typeof resolveVerifier !== 'function') throw new Error('an injected trigger verifier resolver is required: the kernel cannot know what verifies a signal');
  const bound = new Map();
  for (const trigger of snapshot.triggers) {
    let verifier;
    try {
      verifier = await resolveVerifier(trigger.verifierId);
    } catch {
      throw new Error(`the independent verifier for trigger ${trigger.id} could not be resolved`);
    }
    if (!verifier || typeof verifier !== 'object' || verifier.id !== trigger.verifierId || typeof verifier.verify !== 'function') {
      throw new Error(`the resolved verifier is not the independent verifier ${trigger.verifierId} declared for trigger ${trigger.id}`);
    }
    bound.set(trigger.id, { id: verifier.id, verify: verifier.verify });
  }
  const permission = freeze(clone({
    id: snapshot.id,
    owner: snapshot.owner,
    grantee: snapshot.grantee,
    destination: snapshot.destination,
    purpose: snapshot.purpose,
    actions: snapshot.actions,
    scope: snapshot.scope,
    startsAt: iso(snapshot.startsAt),
    expiresAt: iso(snapshot.expiresAt),
    maxUses: snapshot.maxUses,
    triggers: snapshot.triggers.map((trigger) => ({ ...trigger })),
    reviewers: snapshot.reviewers,
    reviewDueMs: snapshot.reviewDueMs,
    pausers: snapshot.pausers,
    grantVerification: {
      verified: true,
      reason: safeText(granted.reason) || 'the grantor authority check named the owner of this permission',
    },
  }));
  VERIFIERS.set(permission, bound);
  return permission;
}

function createEmergencyLedger() {
  const ledger = Object.freeze({});
  LEDGER.set(ledger, new Map());
  return ledger;
}

function boundVerifier(permission, triggerId) {
  try {
    const bound = VERIFIERS.get(permission);
    return bound ? bound.get(triggerId) || null : null;
  } catch {
    return null;
  }
}

// ─── The exercise ─────────────────────────────────────────────────────────────────────────────

function exerciseEmergency(permission, request, { ledger, now } = {}) {
  const read = snapshotPermission(permission);
  const snapshot = read.ok ? read.snapshot : null;
  const asked = snapshotRequest(request);
  const clock = readClock(now);
  const fail = (reason, at, signalId) => ({
    state: 'blocked',
    reason,
    nextUse: 'blocked',
    receipt: blockedReceipt(snapshot, asked ? asked.action : null, reason, at, signalId),
  });
  if (!clock.ok) return fail(clock.reason, iso(Date.now()));
  const at = iso(clock.now);
  if (!snapshot) return fail(`the emergency permission could not be read safely: ${read.reason}`, at);
  if (!asked) return fail('the emergency request could not be read safely', at);
  const records = readRecords(ledger);
  if (!records) return fail('a kernel emergency ledger is required to exercise emergency access', at, asked.signal ? asked.signal.id : null);
  const record = ensureRecord(records, snapshot.id);

  // Order matters twice over. Replay is checked before the pending review, so a caller replaying a
  // use is told it is a replay instead of being told the review is open. And revocation, pause and
  // the clock are checked before the signal is looked at, so a permission the person already stopped
  // never spends a verifier call.
  if (record.revoked) return fail('this emergency permission was revoked by the person who granted it', at, asked.signal ? asked.signal.id : null);
  if (record.stopped) return fail(`this emergency permission was stopped: the post-use review of ${record.rejectedUse} was rejected, and it needs a new grant`, at, asked.signal ? asked.signal.id : null);
  if (record.paused) return fail('this emergency permission is paused', at, asked.signal ? asked.signal.id : null);
  if (clock.now < snapshot.startsAt) return fail(`this emergency permission is not valid before ${iso(snapshot.startsAt)}`, at, asked.signal ? asked.signal.id : null);
  if (clock.now >= snapshot.expiresAt) return fail(`this emergency permission expired at ${iso(snapshot.expiresAt)}`, at, asked.signal ? asked.signal.id : null);
  if (record.uses >= snapshot.maxUses) return fail(`the emergency use limit is exhausted (${record.uses} of ${snapshot.maxUses})`, at, asked.signal ? asked.signal.id : null);
  if (!asked.useId) return fail('the emergency request carries no stable use id, so it could not be told apart from a replay', at, asked.signal ? asked.signal.id : null);
  if (record.useIds.has(asked.useId)) return fail(`emergency use ${asked.useId} was already used; a replay under another request key is refused`, at, asked.signal ? asked.signal.id : null);
  if (record.pending) return fail(`the post-use review of ${record.pending.useId} is still pending, so no second use is allowed`, at, asked.signal ? asked.signal.id : null);
  if (asked.actor !== snapshot.grantee) return fail(`the actor is outside the granted authority (${snapshot.grantee})`, at, asked.signal ? asked.signal.id : null);
  if (!snapshot.actions.includes(asked.action) || !snapshot.scope.includes(asked.subject)
    || asked.destination !== snapshot.destination) {
    return fail('the requested action, subject or destination is outside the granted scope', at, asked.signal ? asked.signal.id : null);
  }
  const trigger = snapshot.triggers.find((item) => item.id === asked.triggerId);
  if (!trigger) return fail('the trigger was not declared in advance by the person who granted this permission', at, asked.signal ? asked.signal.id : null);
  if (!asked.signal) return fail('the emergency request carries no trigger signal', at);
  if (asked.signal.source !== trigger.verifierId) return fail(`the trigger signal does not come from the declared verifier ${trigger.verifierId}`, at, asked.signal.id);
  if (!asked.signal.id) return fail('the trigger signal carries no id, so it could not be told apart from a replay', at);
  if (record.signalIds.has(asked.signal.id)) return fail(`trigger signal ${asked.signal.id} already opened a use; one signal opens one use`, at, asked.signal.id);
  const verifier = boundVerifier(permission, trigger.id);
  if (!verifier) return fail(`no independent verifier is bound to this emergency permission for trigger ${trigger.id}; a permission that did not go through the grant path exercises nothing`, at, asked.signal.id);
  let checked;
  try {
    checked = verifier.verify(clone(trigger), asked.signal.body);
  } catch {
    return fail('the independent trigger verification failed', at, asked.signal.id);
  }
  try {
    if (checked && (typeof checked === 'object' || typeof checked === 'function') && typeof checked.then === 'function') {
      Promise.resolve(checked).catch(() => {});
      return fail('the independent trigger verification answered asynchronously, which this kernel does not wait for', at, asked.signal.id);
    }
  } catch {
    return fail('the independent trigger verification could not be read', at, asked.signal.id);
  }
  if (!checked || typeof checked !== 'object' || checked.verified !== true) {
    return fail('the trigger signal was not independently verified', at, asked.signal.id);
  }

  // The reservation happens after every check and in one synchronous run, so two callers in one
  // tick cannot spend the same slot of the cap. A host that runs workers in parallel still has to
  // serialize this ledger itself; the kernel only guarantees this within one process.
  record.uses += 1;
  record.useIds.add(asked.useId);
  record.signalIds.add(asked.signal.id);
  record.pending = { useId: asked.useId, triggerId: trigger.id, dueAtMs: clock.now + snapshot.reviewDueMs };
  const receipt = useReceipt(snapshot, asked, trigger, checked, clock.now);
  record.receipts.set(asked.useId, receipt);
  return { state: 'review_pending', reason: null, nextUse: 'blocked_until_review', receipt };
}

// ─── The post-use review ─────────────────────────────────────────────────────────────────────

function reviewEmergencyUse(permission, useId, { ledger, by, decision, now } = {}) {
  const snapshot = readPermission(permission);
  if (!snapshot) throw new Error('emergency permission is malformed and cannot carry a review');
  if (!text(useId)) throw new Error('a review names the use it closes');
  if (!text(by)) throw new Error('a review names who closed it');
  if (decision !== 'accept' && decision !== 'reject') throw new Error('review decision must be accept or reject');
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to close an emergency review');
  const record = records.get(snapshot.id);
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
  const closed = seal({
    ...original,
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

function pauseEmergencyPermission(permission, { ledger, by } = {}) {
  const snapshot = readPermission(permission);
  if (!snapshot) throw new Error('emergency permission is malformed and cannot be paused');
  if (!snapshot.pausers.includes(by)) throw new Error(`not authorized to pause: pausers are [${snapshot.pausers.join(', ')}]`);
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to pause an emergency permission');
  ensureRecord(records, snapshot.id).paused = true;
  return getEmergencyState(permission, { ledger });
}

function resumeEmergencyPermission(permission, { ledger, by } = {}) {
  const snapshot = readPermission(permission);
  if (!snapshot) throw new Error('emergency permission is malformed and cannot be resumed');
  if (!snapshot.pausers.includes(by)) throw new Error(`not authorized to resume: pausers are [${snapshot.pausers.join(', ')}]`);
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to resume an emergency permission');
  const record = ensureRecord(records, snapshot.id);
  if (record.revoked) throw new Error('a revoked emergency permission cannot be resumed');
  if (record.stopped) throw new Error(`this emergency permission was stopped by the rejected review of ${record.rejectedUse}; resuming it is not what the person decided, so it needs a new grant`);
  record.paused = false;
  return getEmergencyState(permission, { ledger });
}

function revokeEmergencyPermission(permission, { ledger, by } = {}) {
  const snapshot = readPermission(permission);
  if (!snapshot) throw new Error('emergency permission is malformed and cannot be revoked');
  if (by !== snapshot.owner) throw new Error('only the person who granted this emergency permission may revoke it');
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to revoke an emergency permission');
  ensureRecord(records, snapshot.id).revoked = true;
  return getEmergencyState(permission, { ledger });
}

// Renewal moves the clock and nothing else. The grant a person signed does not grow because time
// passed, and the record of what was already spent stays with the same id.
function renewEmergencyPermission(permission, changes) {
  const snapshot = readPermission(permission);
  if (!snapshot) throw new Error('emergency permission is malformed and cannot be renewed');
  let keys;
  try {
    keys = changes && typeof changes === 'object' && !Array.isArray(changes) ? Object.keys(changes) : [];
  } catch {
    keys = [];
  }
  if (keys.length !== 1 || keys[0] !== 'expiresAt') {
    throw new Error('renewal cannot widen or alter the grant: only expiresAt may change, because the person signed the rest');
  }
  const expiresAt = parseTime(changes.expiresAt);
  if (expiresAt === null || expiresAt <= snapshot.expiresAt) {
    throw new Error('a renewal must extend the existing clock, and never shorten it');
  }
  const bound = VERIFIERS.get(permission);
  const renewed = freeze({ ...clone(permission), expiresAt: changes.expiresAt });
  if (bound) VERIFIERS.set(renewed, new Map(bound));
  return renewed;
}

// ─── What the operation says about itself ─────────────────────────────────────────────────────

function getEmergencyState(permission, { ledger, now } = {}) {
  const snapshot = readPermission(permission);
  if (!snapshot) throw new Error('emergency permission is malformed and has no state');
  const records = readRecords(ledger);
  // A ledger that exists but has never seen this id is a permission nobody has touched yet, not a
  // missing one: the reads below need a record either way.
  const record = records ? (records.get(snapshot.id) || newRecord()) : null;
  const uses = record ? record.uses : 0;
  const clock = readClock(now);
  const at = clock.ok ? clock.now : Date.now();
  const pending = record && record.pending ? record.pending : null;
  const expired = at >= snapshot.expiresAt;
  const exhausted = uses >= snapshot.maxUses;
  let status = 'active';
  let nextUse = 'allowed';
  // Without the ledger the exercise is blocked, so the state that says "available" would be a lie.
  if (!records) {
    status = 'no_ledger';
    nextUse = 'blocked_no_ledger';
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
    reviewOverdue: pending ? at > pending.dueAtMs : false,
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