'use strict';

const { computeDigest } = require('./receipt.js');
const { parseTime } = require('./time.js');

const LEDGER = new WeakMap();

function text(value) { return typeof value === 'string' && value.length > 0; }

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

function requireUniqueStrings(values, label) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !text(value))
    || new Set(values).size !== values.length) throw new Error(`${label} must be a non-empty list of unique strings`);
}

function readNow(value) {
  const time = value === undefined ? Date.now() : parseTime(value);
  if (time === null) throw new Error('invalid emergency clock');
  return time;
}

function iso(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid emergency clock');
  return date.toISOString();
}

function validateGrant(grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) throw new Error('emergency permission must be an object');
  for (const key of ['id', 'owner', 'grantee', 'destination']) if (!text(grant[key])) throw new Error(`${key} is required`);
  requireUniqueStrings(grant.actions, 'actions');
  requireUniqueStrings(grant.scope, 'scope');
  requireUniqueStrings(grant.reviewers, 'reviewers');
  requireUniqueStrings(grant.pausers, 'pausers');
  if (!grant.pausers.includes(grant.owner)) throw new Error('the person who grants the permission must be allowed to pause it');
  if (!Array.isArray(grant.triggers) || grant.triggers.length === 0
    || grant.triggers.some((trigger) => !trigger || !text(trigger.id) || !text(trigger.verifierId))) {
    throw new Error('triggers must name a trigger and its independent verifier');
  }
  if (!Number.isInteger(grant.maxUses) || grant.maxUses < 1) throw new Error('maxUses must be a positive integer');
  if (!Number.isInteger(grant.reviewDueMs) || grant.reviewDueMs < 1) throw new Error('reviewDueMs must be a positive integer');
  const starts = parseTime(grant.startsAt);
  const expires = parseTime(grant.expiresAt);
  if (starts === null || expires === null || expires <= starts) throw new Error('emergency permission requires a valid clock interval');
}

async function createEmergencyPermission(grant, { authorizeGrantor } = {}) {
  validateGrant(grant);
  if (typeof authorizeGrantor !== 'function') throw new Error('a trusted grantor authorization verifier is required');
  let result;
  try { result = await authorizeGrantor(clone(grant)); } catch { throw new Error('grantor authority could not be verified'); }
  if (!result || result.verified !== true || result.grantor !== grant.owner) throw new Error('grantor authority does not match the person who owns this permission');
  return freeze(clone({ ...grant, grantVerification: { verified: true, reason: text(result.reason) ? result.reason : 'grantor authority verified' } }));
}

function createEmergencyLedger() {
  const ledger = Object.freeze({});
  LEDGER.set(ledger, new Map());
  return ledger;
}

function getRecord(permission, ledger) {
  const records = LEDGER.get(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required');
  let record = records.get(permission.id);
  if (!record) {
    record = { uses: 0, paused: false, revoked: false, pending: null, useIds: new Set(), signalIds: new Set(), receipts: [] };
    records.set(permission.id, record);
  }
  return record;
}

function blocked(permission, action, reason, now) {
  const at = iso(now);
  const receipt = {
    status: 'blocked', operation: { id: permission.id, goal: 'emergency permission exercise' }, action,
    capability: 'emergency-access', authority: { grants: [], exercised: [] }, outcome: 'blocked',
    evidence: null, verification: { verified: false, checks: {}, reason }, coverage: [], notCovered: ['independent effect verification', 'external anchor'],
    anchor: { status: 'pending', network: 'stellar:testnet' }, detail: reason, at,
  };
  receipt.digest = computeDigest(receipt);
  return { state: 'blocked', reason, receipt };
}

function receiptForUse(permission, request, trigger, now) {
  const at = iso(now);
  const dueAt = iso(now + permission.reviewDueMs);
  const receipt = {
    status: 'not_verified', operation: { id: permission.id, goal: 'emergency access under prior authority' }, action: request.action,
    capability: 'emergency-access',
    authority: {
      grants: [{ asset: `emergency-use:${permission.id}`, maxAmount: String(permission.maxUses), to: permission.destination, expiresAt: permission.expiresAt }],
      exercised: [{ asset: `emergency-use:${permission.id}`, maxAmount: '1', to: permission.destination }],
      approval: permission.grantVerification.reason,
    },
    outcome: 'not_verified', evidence: { signalId: trigger.signalId },
    verification: { verified: false, checks: { trigger_verified: true, effect_verified: false }, reason: 'trigger verified; effect awaits separate verification and post-use review' },
    coverage: ['trigger_verified'], notCovered: ['effect_verified', 'external anchor'],
    trigger: { id: trigger.id, verifierId: trigger.verifierId, signalId: trigger.signalId, verification: { verified: true, reason: trigger.reason } },
    review: { status: 'pending', reviewers: [...permission.reviewers], dueAt },
    useId: request.useId, at,
  };
  receipt.digest = computeDigest(receipt);
  return receipt;
}

function exerciseEmergency(permission, request, { ledger, now, triggerVerifier } = {}) {
  const time = readNow(now);
  let record;
  try { record = getRecord(permission, ledger); } catch (error) { return blocked(permission, request?.action, error.message, time); }
  const fail = (reason) => blocked(permission, request?.action, reason, time);
  if (record.revoked) return fail('emergency permission was revoked by its owner');
  if (record.paused) return fail('emergency permission is paused');
  if (record.pending) return fail(`post-use review is pending for ${record.pending.useId}`);
  if (time < parseTime(permission.startsAt) || time >= parseTime(permission.expiresAt)) return fail('emergency permission is outside its validity period');
  if (record.uses >= permission.maxUses) return fail('emergency permission use limit is exhausted');
  if (!request || request.actor !== permission.grantee) return fail('actor is outside the granted authority');
  if (!permission.actions.includes(request.action) || !permission.scope.includes(request.subject)
    || request.destination !== permission.destination) return fail('requested action, subject, or destination is outside the granted scope');
  if (!text(request.useId) || record.useIds.has(request.useId)) return fail('emergency use was already used or has no stable use id (replay)');
  const trigger = permission.triggers.find((item) => item.id === request.triggerId);
  if (!trigger) return fail('trigger was not declared in advance');
  if (!text(request.triggerSignal?.id) || record.signalIds.has(request.triggerSignal.id)) return fail('trigger signal was already used or has no unique id');
  if (!triggerVerifier || triggerVerifier.id !== trigger.verifierId || typeof triggerVerifier.verify !== 'function') return fail('the declared independent trigger verifier is unavailable');
  let checked;
  try { checked = triggerVerifier.verify(clone(trigger), clone(request.triggerSignal)); } catch { return fail('trigger verification failed'); }
  if (!checked || typeof checked.then === 'function' || checked.verified !== true) return fail('trigger signal was not independently verified');
  // Synchronous reservation serializes calls in this process before a later caller can spend the same slot.
  record.uses += 1;
  record.useIds.add(request.useId);
  record.signalIds.add(request.triggerSignal.id);
  const receipt = receiptForUse(permission, request, {
    id: trigger.id, verifierId: trigger.verifierId, signalId: request.triggerSignal.id,
    reason: text(checked.reason) ? checked.reason : 'trigger verified by injected verifier',
  }, time);
  record.pending = { useId: request.useId, dueAt: receipt.review.dueAt };
  record.receipts.push(receipt);
  return { state: 'review_pending', receipt, nextUse: 'blocked_until_review' };
}

function reviewEmergencyUse(permission, useId, { by, decision, now } = {}, ledger) {
  const record = getRecord(permission, ledger);
  if (!record.pending || record.pending.useId !== useId) throw new Error('no matching pending emergency review');
  if (!permission.reviewers.includes(by)) throw new Error('reviewer is not authorized to close this emergency review');
  if (!['accept', 'reject'].includes(decision)) throw new Error('review decision must be accept or reject');
  const reviewedAt = iso(readNow(now));
  record.receipts = record.receipts.map((receipt) => receipt.useId === useId
    ? seal({ ...receipt, review: { ...receipt.review, status: 'reviewed', decision, by, reviewedAt } }) : receipt);
  record.pending = null;
  return record.receipts.find((receipt) => receipt.useId === useId);
}

function seal(receipt) {
  const next = { ...receipt };
  delete next.digest;
  next.digest = computeDigest(next);
  return next;
}

function pauseEmergencyPermission(permission, by, ledger) {
  if (!permission.pausers.includes(by)) throw new Error(`not authorized to pause; pausers are [${permission.pausers.join(', ')}]`);
  getRecord(permission, ledger).paused = true;
}

function resumeEmergencyPermission(permission, by, ledger) {
  if (!permission.pausers.includes(by)) throw new Error(`not authorized to resume; pausers are [${permission.pausers.join(', ')}]`);
  const record = getRecord(permission, ledger);
  if (record.revoked) throw new Error('a revoked emergency permission cannot be resumed');
  record.paused = false;
}

function revokeEmergencyPermission(permission, by, ledger) {
  if (by !== permission.owner) throw new Error('only the person who granted the emergency permission may revoke it');
  getRecord(permission, ledger).revoked = true;
}

function getEmergencyState(permission, ledger, now) {
  const record = getRecord(permission, ledger);
  return {
    status: record.revoked ? 'revoked' : record.paused ? 'paused' : 'active',
    uses: record.uses,
    remainingUses: Math.max(0, permission.maxUses - record.uses),
    pendingReview: record.pending ? record.pending.useId : null,
    reviewOverdue: record.pending ? readNow(now) > parseTime(record.pending.dueAt) : false,
  };
}

function renewEmergencyPermission(permission, changes) {
  if (!changes || Object.keys(changes).some((key) => key !== 'expiresAt')) throw new Error('renewal cannot expand or alter actions, scope, destination, triggers, reviewers, pausers, or use cap');
  const expires = parseTime(changes.expiresAt);
  if (expires === null || expires <= parseTime(permission.expiresAt)) throw new Error('renewal expiry must extend the existing clock');
  return freeze({ ...clone(permission), expiresAt: changes.expiresAt });
}

module.exports = {
  createEmergencyPermission, createEmergencyLedger, exerciseEmergency, reviewEmergencyUse,
  pauseEmergencyPermission, resumeEmergencyPermission, revokeEmergencyPermission,
  getEmergencyState, renewEmergencyPermission,
};
