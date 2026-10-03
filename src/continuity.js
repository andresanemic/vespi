'use strict';

const { verifyReceipt } = require('./receipt.js');
const { parseTime } = require('./time.js');

function receiptAction(receipt) {
  try {
    if (typeof receipt?.action === 'string' && receipt.action.length > 0) return receipt.action;
    const id = receipt?.operation?.id;
    if (typeof id === 'string' && id.length > 0) return id;
    const goal = receipt?.operation?.goal;
    if (typeof goal === 'string' && goal.length > 0) return goal;
  } catch {
  }
  return null;
}

// Any key the agreement puts under `changes` is a change to what was agreed, whatever it is named.
// The gate used to watch a fixed list (scope, amount, ceiling, status), which meant renaming a key
// or adding a new one opened a hole: `changes: { to: 'OTRO' }` passed straight through and an agent
// resumed an action the person had altered. A fixed list can only ever be as complete as the last
// person who thought of a key; the shape of the change is the signal, not its name (T1-X3).
function hasRevalidationChanges(entry) {
  try {
    const changes = entry && entry.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return false;
    return Object.keys(changes).some((key) => changes[key] !== undefined);
  } catch {
    return false;
  }
}

// A receipt whose own verification does not say `verified: true` is not a finished step, whatever
// its `status` field says. Continuity used to read `status` alone, so a receipt could claim
// `verified` while the verification recorded inside it — the one the digest covers — said false, and
// the agent resumed it. The verdict recorded in the receipt is the one that decides (T1-X4). It is
// the same object the digest seals, so it cannot be rewritten after the fact without breaking the seal.
function claimsVerifiedWithoutProof(receipt) {
  try {
    const verification = receipt?.verification;
    return !verification || verification.verified !== true;
  } catch {
    return true;
  }
}

function mayHaveExercised(receipt) {
  try {
    const exercised = receipt?.authority?.exercised;
    if (exercised === undefined || exercised === null) return false;
    if (Array.isArray(exercised)) return exercised.length > 0;
    return true;
  } catch {
    return true;
  }
}

function receiptTime(receipt) {
  try {
    return parseTime(receipt?.at);
  } catch {
    return null;
  }
}

function resumeFromReceipts(receipts, agreement, { verifyExternal, verifyLocal } = {}) {
  const list = Array.isArray(receipts) ? receipts : [];
  const approved = Array.isArray(agreement?.approved) ? agreement.approved : [];
  const workingMode = agreement?.workingMode;

  for (const entry of approved) {
    if (entry?.maxAttempts !== undefined && (!Number.isInteger(entry.maxAttempts) || entry.maxAttempts <= 0)) {
      throw new Error('maxAttempts must be a positive integer');
    }
  }

  const approvedByAction = new Map();
  for (const entry of approved) {
    try {
      if (entry && typeof entry.action === 'string' && !approvedByAction.has(entry.action)) {
        approvedByAction.set(entry.action, entry);
      }
    } catch {}
  }

  let discarded = 0;
  const verifiedByAction = new Map();
  const waitingByAction = new Map();
  const unprovenByAction = new Map();
  const seenVerifiedActions = new Set();
  const verifiedReceipts = [];
  const uncertainByAction = new Map();
  const attemptsByAction = new Map();
  const seenDigests = new Set();

  for (const receipt of list) {
    let check;
    try {
      check = verifyReceipt(receipt);
    } catch {
      check = { ok: false, reason: 'verify error' };
    }
    if (!check || check.ok !== true) {
      discarded += 1;
      continue;
    }
    const digest = receipt?.digest;
    if (typeof digest === 'string' && seenDigests.has(digest)) continue;
    if (typeof digest === 'string') seenDigests.add(digest);
    if (receipt?.status === 'failed' || receipt?.status === 'not_verified') {
      const action = receiptAction(receipt);
      if (action) attemptsByAction.set(action, (attemptsByAction.get(action) || 0) + 1);
    }
    if (receipt?.status !== 'verified') {
      const pendingAction = receiptAction(receipt);
      if (pendingAction && ['blocked', 'paused', 'needs_human_decision'].includes(receipt?.status)) {
        waitingByAction.set(pendingAction, receipt.status);
      }
      if (pendingAction && (
        (receipt?.status === 'not_verified' && mayHaveExercised(receipt))
        || (receipt?.status === 'failed' && receipt?.evidence?.settlementUnknown === true)
        || receipt?.evidence?.exercisedUnknown === true
      )) {
        const uncertainties = uncertainByAction.get(pendingAction) || [];
        uncertainties.push(receipt);
        uncertainByAction.set(pendingAction, uncertainties);
      }
      continue;
    }
    const action = receiptAction(receipt);
    if (!action) continue;
    seenVerifiedActions.add(action);
    if (claimsVerifiedWithoutProof(receipt)) {
      if (!unprovenByAction.has(action)) unprovenByAction.set(action, receipt);
      continue;
    }
    // A local digest can be re-sealed. Only a trusted host verifier can establish an
    // external effect; an explicitly local, reversible action may use the local receipt.
    const local = approvedByAction.get(action)?.localReversible === true;
    let locallyProven = false;
    if (local && typeof verifyLocal === 'function') {
      try {
        locallyProven = verifyLocal(action, receipt.digest) === true;
      } catch {}
    }
    let externallyProven = false;
    if (!local && receipt?.anchor?.status === 'anchored' && typeof verifyExternal === 'function') {
      try {
        externallyProven = verifyExternal(receipt.anchor.txHash, receipt.digest, receipt.anchor.network) === true;
      } catch {}
    }
    if (!locallyProven && !externallyProven) {
      if (!unprovenByAction.has(action)) unprovenByAction.set(action, receipt);
      continue;
    }
    if (!verifiedByAction.has(action)) verifiedByAction.set(action, receipt);
    verifiedReceipts.push({ receipt, action });
  }

  // A verified receipt for an action outside the agreement: revalidate.
  for (const action of seenVerifiedActions) {
    if (!approvedByAction.has(action)) {
      return {
        lastState: verifiedReceipts.length > 0 ? verifiedReceipts[0].receipt.status : null,
        nextAction: null,
        needsPerson: true,
        reason: `an action outside the agreement needs revalidation: ${action}; discarded ${discarded}`,
        discarded,
        workingMode,
      };
    }
  }

  // An action whose last receipt claims `verified` while the verification sealed inside it says
  // false is not a finished step either. It is not discarded — its seal is intact — it simply does
  // not carry the proof, so it cannot be resumed by an agent: the person decides (T1-X4).
  for (const [action, unproven] of unprovenByAction) {
    if (!approvedByAction.has(action)) continue;
    return {
      lastState: unproven.status ?? 'verified',
      nextAction: null,
      needsPerson: true,
      reason: `the receipt claims verified without a verification and returns to the person: ${action}; discarded ${discarded}`,
      discarded,
      workingMode,
    };
  }

  for (const [action, uncertainties] of uncertainByAction) {
    if (!approvedByAction.has(action)) continue;
    const stillPending = uncertainties.some((uncertain) => !verifiedReceipts.some((verified) => {
      if (verified.action !== action) return false;
      const uncertainTime = receiptTime(uncertain);
      const verifiedTime = receiptTime(verified.receipt);
      return uncertainTime !== null && verifiedTime !== null && verifiedTime > uncertainTime;
    }));
    if (stillPending) {
      return { lastState: 'not_verified', nextAction: null, needsPerson: true, reason: 'reconciliation_required', discarded, workingMode };
    }
  }

  let lastState = null;
  let nextAction = null;
  for (const entry of approved) {
    if (!entry || typeof entry.action !== 'string') continue;
    if (verifiedByAction.has(entry.action)) {
      const r = verifiedByAction.get(entry.action);
      lastState = r?.status ?? 'verified';
    } else {
      nextAction = entry;
      break;
    }
  }

  if (!nextAction) {
    if (verifiedByAction.size === 0) lastState = null;
    return {
      lastState,
      nextAction: null,
      needsPerson: false,
      reason: verifiedByAction.size === 0 && approved.length > 0
        ? `no receipts; discarded ${discarded}`
        : `complete; discarded ${discarded}`,
      discarded,
      workingMode,
    };
  }

  if (uncertainByAction.has(nextAction.action)) {
    return {
      lastState,
      nextAction: null,
      needsPerson: true,
      reason: 'reconciliation_required',
      discarded,
      workingMode,
    };
  }

  if (nextAction.maxAttempts !== undefined) {
    const attempts = attemptsByAction.get(nextAction.action) || 0;
    if (attempts >= nextAction.maxAttempts) {
      return { lastState, nextAction: null, needsPerson: true, reason: 'attempts_exhausted', discarded, workingMode };
    }
  }

  // R36 gate (orchestrator review R42): an action whose last receipt is blocked, paused or waiting for a
  // decision is not resumed by an agent; it returns to the person.
  if (waitingByAction.has(nextAction.action)) {
    return {
      lastState: waitingByAction.get(nextAction.action),
      nextAction: null,
      needsPerson: true,
      reason: `the next action is ${waitingByAction.get(nextAction.action)} and returns to the person: ${nextAction.action}; discarded ${discarded}`,
      discarded,
      workingMode,
    };
  }

  if (hasRevalidationChanges(nextAction)) {
    return {
      lastState,
      nextAction: null,
      needsPerson: true,
      reason: `the next action changes what was agreed and needs revalidation: ${nextAction.action}; discarded ${discarded}`,
      discarded,
      workingMode,
    };
  }

  return {
    lastState,
    nextAction,
    needsPerson: false,
    reason: `resumes ${nextAction.action}; discarded ${discarded}`,
    discarded,
    workingMode,
  };
}

module.exports = { resumeFromReceipts };
