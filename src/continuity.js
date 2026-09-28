'use strict';

const { verifyReceipt } = require('./receipt.js');

const REVALIDATION_KEYS = ['scope', 'amount', 'ceiling', 'status'];

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

function hasRevalidationChanges(entry) {
  try {
    const changes = entry && entry.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return false;
    return REVALIDATION_KEYS.some((key) => changes[key] !== undefined);
  } catch {
    return false;
  }
}

function resumeFromReceipts(receipts, agreement) {
  const list = Array.isArray(receipts) ? receipts : [];
  const approved = Array.isArray(agreement?.approved) ? agreement.approved : [];
  const workingMode = agreement?.workingMode;

  let discarded = 0;
  const verifiedByAction = new Map();
  const waitingByAction = new Map();
  const verifiedReceipts = [];

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
    if (receipt?.status !== 'verified') {
      const pendingAction = receiptAction(receipt);
      if (pendingAction && ['blocked', 'paused', 'needs_human_decision'].includes(receipt?.status)) {
        waitingByAction.set(pendingAction, receipt.status);
      }
      continue;
    }
    const action = receiptAction(receipt);
    if (!action) continue;
    if (!verifiedByAction.has(action)) verifiedByAction.set(action, receipt);
    verifiedReceipts.push(receipt);
  }

  const approvedByAction = new Map();
  for (const entry of approved) {
    try {
      if (entry && typeof entry.action === 'string' && !approvedByAction.has(entry.action)) {
        approvedByAction.set(entry.action, entry);
      }
    } catch {
    }
  }

  // A verified receipt for an action outside the agreement: revalidate.
  for (const action of verifiedByAction.keys()) {
    if (!approvedByAction.has(action)) {
      return {
        lastState: verifiedReceipts.length > 0 ? verifiedReceipts[0].status : null,
        nextAction: null,
        needsPerson: true,
        reason: `an action outside the agreement needs revalidation: ${action}; discarded ${discarded}`,
        discarded,
        workingMode,
      };
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
