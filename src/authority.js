'use strict';

const { parseTime } = require('./time.js');

// Authority: pure data + one predicate. No I/O, no host, no capabilities.
function grantSpend(asset, maxAmount, to, expiresAt) {
  const grant = { asset, maxAmount };
  if (to !== undefined) grant.to = to;
  if (expiresAt !== undefined) grant.expiresAt = expiresAt;
  return { spend: [grant] };
}

function text(value) {
  return typeof value === 'string' && value.length > 0;
}

function atomic(value) {
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;
}

function parseNow(now) {
  try {
    if (now === undefined || now === null) return Date.now();
    return parseTime(now);
  } catch {
    return null;
  }
}

function sufficient(requirements, authority, options) {
  const reqs = requirements;
  if (!Array.isArray(reqs)) return { ok: false, reason: 'requirements must be an array' };
  if (reqs.length === 0) return { ok: false, reason: 'no spend requirement declared' };
  const grants = (authority && authority.spend) || [];
  if (!Array.isArray(grants)) return { ok: false, reason: 'authority spend must be an array' };

  const nowMs = parseNow(options && options.now);
  if (nowMs === null) return { ok: false, reason: 'invalid or unrepresentable current time' };

  for (const requirement of reqs) {
    if (!requirement || !text(requirement.asset) || !text(requirement.to) || atomic(requirement.amount) === null) {
      return { ok: false, reason: 'invalid spend requirement' };
    }
  }
  for (const grant of grants) {
    if (!grant || !text(grant.asset) || atomic(grant.maxAmount) === null || (grant.to !== undefined && !text(grant.to))) {
      return { ok: false, reason: 'invalid spend grant' };
    }
    if (grant.expiresAt !== undefined) {
      if (parseTime(grant.expiresAt) === null) {
        return { ok: false, reason: 'invalid spend grant' };
      }
    }
  }

  function isExpired(grant) {
    if (grant.expiresAt === undefined) return false;
    const expiry = parseTime(grant.expiresAt);
    return nowMs !== null && expiry <= nowMs;
  }

  const consumption = new Map();
  for (const requirement of reqs) {
    const liveSpecific = grants.findIndex((grant) => !isExpired(grant) && grant.asset === requirement.asset && grant.to === requirement.to);
    const liveWildcard = liveSpecific >= 0 ? liveSpecific : grants.findIndex((grant) => !isExpired(grant) && grant.asset === requirement.asset && grant.to === undefined);
    const index = liveSpecific >= 0 ? liveSpecific : liveWildcard;
    if (index < 0) {
      const expiredMatch = grants.find((grant) => isExpired(grant) && grant.asset === requirement.asset && (grant.to === undefined || grant.to === requirement.to));
      if (expiredMatch) {
        return { ok: false, reason: `grant for asset ${requirement.asset} expired at ${expiredMatch.expiresAt}` };
      }
      return { ok: false, reason: `no grant for asset ${requirement.asset} to ${requirement.to}` };
    }
    consumption.set(index, (consumption.get(index) || 0n) + atomic(requirement.amount));
  }
  for (const [index, total] of consumption) {
    const grant = grants[index];
    if (total > atomic(grant.maxAmount)) {
      return { ok: false, reason: `requirements consume ${total} against grant max ${grant.maxAmount} (${grant.asset}${grant.to ? ` to ${grant.to}` : ''})` };
    }
  }
  return { ok: true, reason: 'covered by grant' };
}

module.exports = { grantSpend, sufficient };
