'use strict';

const { createHash } = require('node:crypto');
const { parseTime } = require('./time.js');
// The zk vocabulary lives in one place (src/zk.js) so the port that writes the evidence and the
// receipt that reads it cannot drift apart on what a valid claim is.
const { readZkClaim, reconcileZk, ZK_INCONSISTENT_REASON } = require('./zk.js');

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

// The body digest deliberately leaves `anchor` out: the digest is what gets written on the network,
// so it cannot depend on the answer the network gave. That exclusion used to leave the anchor
// free-floating — anyone could paste `anchored` and a made-up txHash onto an untouched receipt and
// it still verified. The anchor therefore travels bound to the body digest it was written for, and
// verification refuses an anchor that is not bound to the body it sits in (T1-X1).
// What this does not buy is authenticity: whoever can rewrite the receipts file can recompute the
// digest and the binding together. That limit is R1 finding M5 and it belongs to whoever stores and
// hands over the receipts.
function verifyAnchorBinding(receipt, expected) {
  try {
    const anchor = receipt.anchor;
    if (anchor === undefined || anchor === null) return { ok: true };
    if (typeof anchor !== 'object' || Array.isArray(anchor)) {
      return { ok: false, reason: 'anchor must be an object' };
    }
    if (anchor.status === 'pending') return { ok: true };
    if (typeof anchor.digest !== 'string' || anchor.digest.length === 0) {
      return { ok: false, reason: 'anchor is not bound to a receipt digest' };
    }
    if (anchor.digest !== expected) return { ok: false, reason: 'anchor is bound to another receipt' };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `anchor verify error: ${err && err.message ? err.message : String(err)}` };
  }
}

// What this proves, and what it does not: the digest is an unkeyed SHA-256 over the receipt, so
// `ok: true` means the receipt arrived intact — it was not edited after it was written, and any
// anchor it carries is bound to the body it travels with. It says nothing about **who** wrote it.
// Anyone able to rewrite the receipts file can recompute the digest and this returns `ok: true`;
// authenticity is a property the receipt does not carry, and it belongs to whoever stores and hands
// over the receipts (R1 finding M5).
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
    const bound = verifyAnchorBinding(receipt, expected);
    if (bound.ok !== true) return bound;
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
  // The binding is written last, over the digest the finished body actually has. `anchor` is not
  // part of the digest, so this cannot move it.
  try {
    if (base.anchor && typeof base.anchor === 'object' && base.anchor.status !== 'pending') {
      base.anchor = { ...base.anchor, digest: base.digest };
    }
  } catch {
  }
  return base;
}

function prepareAnchor(receipt) {
  const base = { ...(receipt || {}) };
  const prevNotCovered = Array.isArray(base.notCovered) ? base.notCovered : [];
  // The confirmed body is the body submitted to the adapter. Prepare its final coverage before
  // computing the digest so confirmation never needs to rewrite a field covered by that digest.
  base.notCovered = withExternalAnchor(prevNotCovered, true);
  try {
    base.digest = computeDigest(base);
  } catch {
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
  'status', 'success', 'ledger', 'operationId', 'blockHeight', 'type', 'code', 'settlementUnknown', 'exercisedUnknown',
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

// `verification` travels as evidence too, so it gets the same treatment: three named fields and
// nothing else. A verifier is still free to return whatever it likes, but only the verdict, the
// per-check results and the reason reach the receipt — a key it invented does not (T1-X2).
//
// `zk` is the one addition, and it is read with a closed schema (src/zk.js). A claim that does not
// hold up — malformed, or inconsistent with the verdict and the checks it travels with — is removed
// and the verdict becomes false with a fixed reason. It is never repaired into something valid: a
// sanitizer that fixed a bad claim would be manufacturing evidence.
function sanitizeVerification(verification) {
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) return null;
  const safe = {};
  try {
    if (verification.verified === true || verification.verified === false) safe.verified = verification.verified;
    const checks = verification.checks;
    if (checks !== null && typeof checks === 'object' && !Array.isArray(checks)) {
      const safeChecks = {};
      for (const key of Object.keys(checks)) {
        const value = safeScalar(checks[key]);
        if (value !== null) safeChecks[key] = value;
      }
      safe.checks = safeChecks;
    }
    const reason = safeScalar(verification.reason);
    if (typeof reason === 'string' && reason.length > 0) safe.reason = reason;
  } catch {
    return null;
  }
  const zkClaim = readZkClaim(verification);
  const reconciled = reconcileZk({
    verified: safe.verified === true,
    checks: safe.checks,
    claimed: zkClaim.claimed,
    zk: zkClaim.value,
  });
  if (reconciled.zk !== null) safe.zk = reconciled.zk;
  if (!reconciled.consistent) {
    safe.verified = false;
    safe.reason = ZK_INCONSISTENT_REASON;
  } else if (safe.verified !== reconciled.verified) {
    safe.verified = reconciled.verified;
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
    if ((typeof expiresAt === 'string' && expiresAt.length > 0)
      || (typeof expiresAt === 'number' && parseTime(expiresAt) !== null)) out.expiresAt = expiresAt;
    return out;
  });
}

function validExercisedEntry(item) {
  try {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const asset = item.asset;
    const to = item.to;
    const amount = item.amount ?? item.maxAmount;
    const validAmount = (typeof amount === 'string' && amount.length > 0)
      || (typeof amount === 'number' && Number.isFinite(amount));
    return typeof asset === 'string' && asset.length > 0
      && typeof to === 'string' && to.length > 0 && validAmount;
  } catch {
    return false;
  }
}

function buildReceipt({ operation, capabilityId, authority, outcome, evidence, verification, decidedBy, at }) {
  const grants = Array.isArray(authority && authority.spend) ? authority.spend : [];
  const rawExercised = outcome && outcome.exercised;
  const exercised = Array.isArray(rawExercised) ? rawExercised : [];
  const validExercised = exercised.filter(validExercisedEntry);
  const exercisedUnknown = (Array.isArray(rawExercised) && rawExercised.length > 0 && validExercised.length !== rawExercised.length)
    || (rawExercised !== undefined && rawExercised !== null && !Array.isArray(rawExercised));
  const safeVerification = sanitizeVerification(verification);
  const rawStatus = safeText(outcome && outcome.status) || 'failed';
  let status = RECEIPT_STATUSES.has(rawStatus) ? rawStatus : 'failed';
  // A direct caller can pass any status, so the zk rule is applied here too and not only inside
  // runOperation: a receipt may only read `verified` when the zk it carries says `verified` and the
  // verdict agrees. A claim that was refused cannot leave a verified receipt behind.
  if (status === 'verified' && readZkClaim(verification).claimed
    && !(safeVerification && safeVerification.verified === true && safeVerification.zk
      && safeVerification.zk.result === 'verified')) {
    status = 'not_verified';
  }
  const operationId = safeText(operation && operation.id) || 'unknown';
  const goal = safeText(operation && operation.goal) || '';
  const action = safeText(operation && operation.action);
  const receiptCapability = safeText(capabilityId) || 'unknown';
  const approval = safeText(authority && authority.approval);
  const detail = safeText(outcome && outcome.detail) ?? safeText(outcome && outcome.reason);
  const reason = safeText(outcome && outcome.reason);
  const exit = safeText(outcome && outcome.exit);
  // Coverage is read off the sanitized verification, so a key the sanitizer dropped can never be
  // counted as a check that passed.
  const { covered: coverage, failed: failedChecks } = readChecks(safeVerification);
  const decided = safeText(decidedBy) ?? safeText(outcome && outcome.decidedBy);
  const receipt = {
    status,
    operation: { id: operationId, goal },
    ...(action ? { action } : {}),
    capability: receiptCapability,
    authority: {
      grants: sanitizeSpend(grants),
      exercised: sanitizeSpend(validExercised),
      ...(approval ? { approval } : {}),
    },
    outcome: status,
    evidence: (() => {
      const safeEvidence = sanitizeEvidence(evidence);
      if (!exercisedUnknown) return safeEvidence;
      return { ...(safeEvidence || {}), exercisedUnknown: true };
    })(),
    verification: safeVerification,
    coverage,
    notCovered: [...failedChecks, 'external anchor'],
    anchor: { ...PENDING_ANCHOR },
    detail,
    ...(reason ? { reason } : {}),
    ...(exit ? { exit } : {}),
    ...(decided ? { decidedBy: decided } : {}),
    // An injected operation clock may supply the receipt time; direct callers retain wall time.
    at: at === undefined ? new Date().toISOString() : at,
  };
  receipt.digest = computeDigest(receipt);
  return receipt;
}

module.exports = { buildReceipt, verifyReceipt, anchorReceipt, anchorReceiptAsync };
