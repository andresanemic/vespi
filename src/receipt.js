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

// The network is named the way Stellar names it (CAIP-2): `stellar:testnet` or `stellar:pubnet`.
// Anything else is not a network this kernel can anchor on, so nothing leaves pending.
const DEFAULT_NETWORK = 'stellar:testnet';
const ANCHOR_NETWORKS = new Set([DEFAULT_NETWORK, 'stellar:pubnet']);

const PENDING_ANCHOR = { status: 'pending', network: DEFAULT_NETWORK };

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

// What this proves, and what it does not: the digest is an unkeyed SHA-256 over the receipt, so
// `ok: true` means the receipt arrived intact — it was not edited after it was written. It says
// nothing about **who** wrote it. Anyone able to rewrite the receipts file can recompute the
// digest and this returns `ok: true`; authenticity is a property the receipt does not carry, and
// it belongs to whoever stores and hands over the receipts (R1 finding M5).
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
    const declared = result ? result.network : undefined;
    // An adapter that says nothing is taken to mean the default network; an adapter that names
    // one has to name a real Stellar network, and a blank name is not one.
    const network = declared === undefined || declared === null ? DEFAULT_NETWORK : declared;
    if (typeof network !== 'string' || !ANCHOR_NETWORKS.has(network)) return null;
    return txHash ? { txHash, network } : null;
  } catch {
    return null;
  }
}

// Status ladder, honest by construction (principle 7 of Vespi):
//   pending   -> nothing reached the network (no adapter, it threw, it named a network this
//                kernel cannot anchor on, or it returned no txHash)
//   submitted -> the adapter returned a txHash, but nobody confirmed the digest on-chain
//   anchored  -> verifyAnchor(txHash, digest, network) confirmed it (e.g. MEMO_HASH of that
//                Stellar transaction). The network passphrase is part of what Stellar signs, so
//                the verifier is told which network the anchor claims to be on.
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
      confirmed = verifyAnchor(submitted.txHash, base.digest, submitted.network) === true;
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
      confirmed = (await verifyAnchor(submitted.txHash, base.digest, submitted.network)) === true;
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

// A grant names its ceiling `maxAmount`; a requirement names what it spends `amount`. The receipt
// keeps one shape, and the exercised amount must not be lost on the way (R1 finding A1).
function sanitizeSpend(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && typeof item === 'object').map((item) => {
    const out = {
      asset: safeScalar(item.asset),
      maxAmount: safeScalar(item.maxAmount) ?? safeScalar(item.amount),
      to: safeScalar(item.to),
    };
    const expiresAt = safeScalar(item.expiresAt);
    if (typeof expiresAt === 'string' && expiresAt.length > 0) out.expiresAt = expiresAt;
    return out;
  });
}

function buildReceipt({ operation, capabilityId, authority, outcome, evidence, verification, decidedBy }) {
  const grants = Array.isArray(authority && authority.spend) ? authority.spend : [];
  const exercised = Array.isArray(outcome && outcome.exercised) ? outcome.exercised : [];
  const rawStatus = safeText(outcome && outcome.status) || 'failed';
  const status = RECEIPT_STATUSES.has(rawStatus) ? rawStatus : 'failed';
  const operationId = safeText(operation && operation.id) || 'unknown';
  const goal = safeText(operation && operation.goal) || '';
  const action = safeText(operation && operation.action);
  const receiptCapability = safeText(capabilityId) || 'unknown';
  const approval = safeText(authority && authority.approval);
  const detail = safeText(outcome && outcome.detail) ?? safeText(outcome && outcome.reason);
  const reason = safeText(outcome && outcome.reason);
  const exit = safeText(outcome && outcome.exit);
  const { covered: coverage, failed: failedChecks } = readChecks(verification);
  const decided = safeText(decidedBy) ?? safeText(outcome && outcome.decidedBy);
  const receipt = {
    status,
    operation: { id: operationId, goal },
    ...(action ? { action } : {}),
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
    ...(decided ? { decidedBy: decided } : {}),
    at: new Date().toISOString(),
  };
  receipt.digest = computeDigest(receipt);
  return receipt;
}

module.exports = { buildReceipt, verifyReceipt, anchorReceipt, anchorReceiptAsync };
