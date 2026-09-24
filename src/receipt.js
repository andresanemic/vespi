'use strict';

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
  return items.filter((item) => item && typeof item === 'object').map((item) => ({
    asset: safeScalar(item.asset),
    maxAmount: safeScalar(item.maxAmount),
    to: safeScalar(item.to),
  }));
}

function buildReceipt({ operation, capabilityId, authority, outcome, evidence, verification }) {
  const grants = Array.isArray(authority && authority.spend) ? authority.spend : [];
  const exercised = Array.isArray(outcome && outcome.exercised) ? outcome.exercised : [];
  const status = safeText(outcome && outcome.status) || 'failed';
  const operationId = safeText(operation && operation.id) || 'unknown';
  const goal = safeText(operation && operation.goal) || '';
  const receiptCapability = safeText(capabilityId) || 'unknown';
  const approval = safeText(authority && authority.approval);
  const detail = safeText(outcome && outcome.detail);
  return {
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
    detail,
    at: new Date().toISOString(),
  };
}

module.exports = { buildReceipt };
