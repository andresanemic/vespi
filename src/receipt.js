'use strict';

const { createHash } = require('node:crypto');

const RECEIPT_STATUSES = new Set([
  'verified',
  'not_verified',
  'failed',
  'blocked',
  'paused',
  'needs_human_decision',
]);

const PENDING_ANCHOR = { status: 'pending', network: 'stellar-testnet' };

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function computeDigest(receipt) {
  const stripped = {};
  for (const key of Object.keys(receipt)) {
    if (key === 'digest' || key === 'anchor') continue;
    stripped[key] = receipt[key];
  }
  const canonical = JSON.stringify(canonicalize(stripped));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// A check counts as coverage only when it passed; a failed check is listed as not covered.
function readChecks(verification) {
  const covered = [];
  const failed = [];
  try {
    const checks = verification && verification.checks;
    if (checks !== null && typeof checks === 'object' && !Array.isArray(checks)) {
      for (const key of Object.keys(checks)) (checks[key] === true ? covered : failed).push(key);
    }
  } catch {
  }
  return { covered, failed };
}

function withExternalAnchor(list, anchored) {
  const arr = Array.isArray(list) ? list.filter((x) => x !== 'external anchor') : [];
  if (!anchored) arr.push('external anchor');
  return arr;
}

function verifyReceipt(receipt) {
  try {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
      return { ok: false, reason: 'receipt must be an object' };
    }
    if (typeof receipt.digest !== 'string' || receipt.digest.length === 0) {
      return { ok: false, reason: 'missing digest' };
    }
    const expected = computeDigest(receipt);
    if (receipt.digest !== expected) return { ok: false, reason: 'digest mismatch' };
    return { ok: true, reason: 'digest matches' };
  } catch (err) {
    return { ok: false, reason: `verify error: ${err && err.message ? err.message : String(err)}` };
  }
}

function readAnchorResult(result) {
  try {
    const txHash = result && typeof result.txHash === 'string' && result.txHash.length > 0 ? result.txHash : null;
    const network = result && typeof result.network === 'string' && result.network.length > 0 ? result.network : 'stellar-testnet';
    return txHash ? { txHash, network } : null;
  } catch {
    return null;
  }
}

// Status ladder, honest by construction (principle 7 of Vespi):
//   pending   -> nothing reached the network (no adapter, it threw, or it returned no txHash)
//   submitted -> the adapter returned a txHash, but nobody confirmed the digest on-chain
//   anchored  -> verifyAnchor(txHash, digest) confirmed it (e.g. MEMO_HASH of that Stellar transaction)
function finishAnchor(base, prevNotCovered, submitted, confirmed) {
  if (submitted && confirmed) {
    base.anchor = { status: 'anchored', network: submitted.network, txHash: submitted.txHash };
    base.notCovered = withExternalAnchor(prevNotCovered, true);
  } else if (submitted) {
    base.anchor = { status: 'submitted', network: submitted.network, txHash: submitted.txHash };
    base.notCovered = withExternalAnchor(prevNotCovered, false);
  } else {
    base.anchor = { ...PENDING_ANCHOR };
    base.notCovered = withExternalAnchor(prevNotCovered, false);
  }
  try {
    base.digest = computeDigest(base);
  } catch {
  }
  return base;
}

function prepareAnchor(receipt) {
  const base = { ...(receipt || {}) };
  const prevNotCovered = Array.isArray(base.notCovered) ? base.notCovered : [];
  if (typeof base.digest !== 'string') {
    try {
      base.digest = computeDigest(base);
    } catch {
    }
  }
  return { base, prevNotCovered };
}

function anchorReceipt(receipt, anchor, verifyAnchor) {
  const { base, prevNotCovered } = prepareAnchor(receipt);
  let submitted = null;
  if (typeof anchor === 'function') {
    try {
      submitted = readAnchorResult(anchor(base.digest));
    } catch {
      submitted = null;
    }
  }
  let confirmed = false;
  if (submitted && typeof verifyAnchor === 'function') {
    try {
      confirmed = verifyAnchor(submitted.txHash, base.digest) === true;
    } catch {
      confirmed = false;
    }
  }
  return finishAnchor(base, prevNotCovered, submitted, confirmed);
}

async function anchorReceiptAsync(receipt, anchor, verifyAnchor) {
  const { base, prevNotCovered } = prepareAnchor(receipt);
  let submitted = null;
  if (typeof anchor === 'function') {
    try {
      submitted = readAnchorResult(await anchor(base.digest));
    } catch {
      submitted = null;
    }
  }
  let confirmed = false;
  if (submitted && typeof verifyAnchor === 'function') {
    try {
      confirmed = (await verifyAnchor(submitted.txHash, base.digest)) === true;
    } catch {
      confirmed = false;
    }
  }
  return finishAnchor(base, prevNotCovered, submitted, confirmed);
}

const SAFE_EVIDENCE_KEYS = new Set([
  'txHash', 'tx', 'transaction', 'payer', 'network', 'amount', 'authDigest', 'planDigest',
  'status', 'success', 'ledger', 'operationId', 'blockHeight', 'type', 'code',
]);

function safeText(value) {
  return typeof value === 'string' && value.length <= 512 ? value : null;
}

function safeScalar(value) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return safeText(value);
}

function sanitizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const safe = {};
  try {
    for (const key of Object.keys(evidence)) {
      if (!SAFE_EVIDENCE_KEYS.has(key)) continue;
      const value = safeScalar(evidence[key]);
      if (value !== null) safe[key] = value;
    }
  } catch {
    return {};
  }
  return safe;
}

function sanitizeSpend(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && typeof item === 'object').map((item) => {
    const out = {
      asset: safeScalar(item.asset),
      maxAmount: safeScalar(item.maxAmount),
      to: safeScalar(item.to),
    };
    const expiresAt = safeScalar(item.expiresAt);
    if (typeof expiresAt === 'string' && expiresAt.length > 0) out.expiresAt = expiresAt;
    return out;
  });
}

function buildReceipt({ operation, capabilityId, authority, outcome, evidence, verification }) {
  const grants = Array.isArray(authority && authority.spend) ? authority.spend : [];
  const exercised = Array.isArray(outcome && outcome.exercised) ? outcome.exercised : [];
  const rawStatus = safeText(outcome && outcome.status) || 'failed';
  const status = RECEIPT_STATUSES.has(rawStatus) ? rawStatus : 'failed';
  const operationId = safeText(operation && operation.id) || 'unknown';
  const goal = safeText(operation && operation.goal) || '';
  const receiptCapability = safeText(capabilityId) || 'unknown';
  const approval = safeText(authority && authority.approval);
  const detail = safeText(outcome && outcome.detail) ?? safeText(outcome && outcome.reason);
  const reason = safeText(outcome && outcome.reason);
  const exit = safeText(outcome && outcome.exit);
  const { covered: coverage, failed: failedChecks } = readChecks(verification);
  const receipt = {
    status,
    operation: { id: operationId, goal },
    capability: receiptCapability,
    authority: {
      grants: sanitizeSpend(grants),
      exercised: sanitizeSpend(exercised),
      ...(approval ? { approval } : {}),
    },
    outcome: status,
    evidence: sanitizeEvidence(evidence),
    verification: verification || null,
    coverage,
    notCovered: [...failedChecks, 'external anchor'],
    anchor: { ...PENDING_ANCHOR },
    detail,
    ...(reason ? { reason } : {}),
    ...(exit ? { exit } : {}),
    at: new Date().toISOString(),
  };
  receipt.digest = computeDigest(receipt);
  return receipt;
}

module.exports = { buildReceipt, verifyReceipt, anchorReceipt, anchorReceiptAsync };
