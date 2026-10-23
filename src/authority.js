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
    if (['network', 'resource'].some((key) => requirement[key] !== undefined && !text(requirement[key]))) {
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
    if (['network', 'resource'].some((key) => grant[key] !== undefined && !text(grant[key]))) {
      return { ok: false, reason: 'invalid spend grant' };
    }
  }

  function isExpired(grant) {
    if (grant.expiresAt === undefined) return false;
    const expiry = parseTime(grant.expiresAt);
    return nowMs !== null && expiry <= nowMs;
  }

  const consumption = new Map();
  for (const requirement of reqs) {
    const scopeMatches = (grant) => ['network', 'resource'].every((key) => grant[key] === undefined || grant[key] === requirement[key]);
    const liveSpecific = grants.findIndex((grant) => !isExpired(grant) && scopeMatches(grant) && grant.asset === requirement.asset && grant.to === requirement.to);
    const liveWildcard = liveSpecific >= 0 ? liveSpecific : grants.findIndex((grant) => !isExpired(grant) && scopeMatches(grant) && grant.asset === requirement.asset && grant.to === undefined);
    const index = liveSpecific >= 0 ? liveSpecific : liveWildcard;
    if (index < 0) {
      const expiredMatch = grants.find((grant) => isExpired(grant) && scopeMatches(grant) && grant.asset === requirement.asset && (grant.to === undefined || grant.to === requirement.to));
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

// Reopening a sealed checkpoint may only narrow what the person granted. Every new grant has to be
// covered by a sealed one, the way `sufficient` consumes a grant (T1-A2), and the people who can
// pause or who have to sign can only shrink. A predicate, not a repair: it says no and the caller
// refuses, because an authority the kernel rewrote would be an authority nobody granted.
function attenuates(next, sealed) {
  try {
    const nextSpend = next && next.spend;
    const sealedSpend = sealed && sealed.spend;
    if (!Array.isArray(nextSpend) || !Array.isArray(sealedSpend)) return false;

    const coverage = new Map();
    for (const grant of nextSpend) {
      if (!grant || !text(grant.asset) || atomic(grant.maxAmount) === null) return false;
      if (grant.to !== undefined && !text(grant.to)) return false;
      if (['network', 'resource'].some((key) => grant[key] !== undefined && !text(grant[key]))) return false;
      const index = sealedSpend.findIndex((seal) => seal && seal.asset === grant.asset
        && (seal.to === undefined || seal.to === grant.to)
        && ['network', 'resource'].every((key) => seal[key] === undefined || seal[key] === grant[key]));
      if (index < 0) return false;
      const seal = sealedSpend[index];
      if (atomic(seal.maxAmount) === null) return false;
      if (seal.expiresAt !== undefined) {
        if (grant.expiresAt === undefined) return false;
        const nextExpiry = parseTime(grant.expiresAt);
        const sealedExpiry = parseTime(seal.expiresAt);
        if (nextExpiry === null || sealedExpiry === null || nextExpiry > sealedExpiry) return false;
      } else if (grant.expiresAt !== undefined && parseTime(grant.expiresAt) === null) {
        return false;
      }
      coverage.set(index, (coverage.get(index) || 0n) + atomic(grant.maxAmount));
    }
    for (const [index, total] of coverage) {
      if (total > atomic(sealedSpend[index].maxAmount)) return false;
    }

    const nextPausers = next.pausers === undefined ? [] : next.pausers;
    const sealedPausers = sealed.pausers === undefined ? [] : sealed.pausers;
    if (!Array.isArray(nextPausers) || !Array.isArray(sealedPausers)) return false;
    if (nextPausers.some((who) => typeof who !== 'string' || !sealedPausers.includes(who))) return false;

    if (sealed.signers !== undefined) {
      const grant = next.signers;
      const seal = sealed.signers;
      if (!grant || !seal || !Number.isInteger(grant.required) || grant.required < seal.required) return false;
      if (!Array.isArray(grant.allowed) || !Array.isArray(seal.allowed)) return false;
      if (grant.allowed.some((who) => !seal.allowed.includes(who))) return false;
    } else if (next.signers !== undefined) {
      const grant = next.signers;
      if (!grant || !Number.isInteger(grant.required) || grant.required < 1) return false;
      if (!Array.isArray(grant.allowed) || grant.allowed.length === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = { grantSpend, sufficient, attenuates };
