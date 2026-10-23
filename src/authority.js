'use strict';

const { parseTime } = require('./time.js');
const MAX_ATTENUATION_WORK = 1_000_000;

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

function resolveGrantIndex(requirement, grants, nowMs) {
  const scopeMatches = (grant) => ['network', 'resource'].every((key) => grant[key] === undefined || grant[key] === requirement[key]);
  const live = (grant) => !isExpired(grant, nowMs) && scopeMatches(grant);
  const specific = grants.findIndex((grant) => live(grant) && grant.asset === requirement.asset && grant.to === requirement.to);
  return specific >= 0 ? specific : grants.findIndex((grant) => live(grant) && grant.asset === requirement.asset && grant.to === undefined);
}

function isExpired(grant, nowMs) {
  return grant.expiresAt !== undefined && parseTime(grant.expiresAt) <= nowMs;
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

  const consumption = new Map();
  for (const requirement of reqs) {
    const scopeMatches = (grant) => ['network', 'resource'].every((key) => grant[key] === undefined || grant[key] === requirement[key]);
    const index = resolveGrantIndex(requirement, grants, nowMs);
    if (index < 0) {
      const expiredMatch = grants.find((grant) => isExpired(grant, nowMs) && scopeMatches(grant) && grant.asset === requirement.asset && (grant.to === undefined || grant.to === requirement.to));
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

    const toValues = (grant, key, includeOmitted) => {
      if (grant[key] !== undefined) return [grant[key]];
      const values = [...new Set([...sealedSpend, ...nextSpend].map((seal) => seal && seal[key]).filter((value) => value !== undefined))];
      if (includeOmitted) values.push(undefined);
      let other = '__attenuation_other__';
      while (values.includes(other)) other += '_';
      values.push(other);
      return values;
    };
    const grants = [...nextSpend, ...sealedSpend];
    const expiries = [...new Set(grants.map((grant) => grant && grant.expiresAt).filter((value) => value !== undefined).map(parseTime))];
    if (expiries.some((expiry) => expiry === null)) return false;
    const minTime = parseTime('0000-01-01T00:00:00Z');
    const maxTime = parseTime('9999-12-31T23:59:59.999Z');
    const times = [...new Set([minTime, maxTime, ...expiries.flatMap((expiry) => [expiry > minTime ? expiry - 1 : null, expiry]).filter((time) => time !== null)])];
    const values = Object.fromEntries(['to', 'network', 'resource'].map((key) => [key, new Set(grants.map((grant) => grant && grant[key]).filter((value) => value !== undefined)).size]));
    // An authority identical to the sealed one is contained by definition: restoring it never depends on the work budget.
    const fields = ['asset', 'maxAmount', 'to', 'network', 'resource', 'expiresAt'];
    const identicalSpend = nextSpend.length === sealedSpend.length
      && nextSpend.every((grant, index) => grant && sealedSpend[index] && fields.every((key) => grant[key] === sealedSpend[index][key]));
    const scans = nextSpend.length + sealedSpend.length;
    let points = 0;
    if (!identicalSpend) for (const grant of nextSpend) {
      const candidates = (grant && grant.to === undefined ? values.to + 1 : 1)
        * (grant && grant.network === undefined ? values.network + 2 : 1)
        * (grant && grant.resource === undefined ? values.resource + 2 : 1);
      points += candidates;
      if (!Number.isSafeInteger(points) || points * times.length * scans > MAX_ATTENUATION_WORK) return false;
    }
    for (let nextIndex = 0; nextIndex < nextSpend.length; nextIndex++) {
      const grant = nextSpend[nextIndex];
      if (!grant || !text(grant.asset) || atomic(grant.maxAmount) === null) return false;
      if (grant.to !== undefined && !text(grant.to)) return false;
      if (['network', 'resource'].some((key) => grant[key] !== undefined && !text(grant[key]))) return false;
    }
    // The identical case skips the sweep, so it also skips the per-grant candidate lists (quadratic in the number of grants).
    const destinations = identicalSpend ? [] : nextSpend.map((grant) => grant.to === undefined ? toValues(grant, 'to', false) : [grant.to]);
    const networks = identicalSpend ? [] : nextSpend.map((grant) => toValues(grant, 'network', true));
    const resources = identicalSpend ? [] : nextSpend.map((grant) => toValues(grant, 'resource', true));
    for (const nowMs of identicalSpend ? [] : times) {
      const totals = new Map();
      for (let nextIndex = 0; nextIndex < nextSpend.length; nextIndex++) {
        const grant = nextSpend[nextIndex];
        if (isExpired(grant, nowMs)) continue;
        for (const to of destinations[nextIndex]) for (const network of networks[nextIndex]) for (const resource of resources[nextIndex]) {
          const point = { asset: grant.asset, to, network, resource };
          if (resolveGrantIndex(point, nextSpend, nowMs) !== nextIndex) continue;
          const index = resolveGrantIndex(point, sealedSpend, nowMs);
          if (index < 0) return false;
          const seal = sealedSpend[index];
          if (!seal || atomic(seal.maxAmount) === null) return false;
          const nextExpiry = grant.expiresAt === undefined ? null : parseTime(grant.expiresAt);
          const sealedExpiry = seal.expiresAt === undefined ? null : parseTime(seal.expiresAt);
          if ((nextExpiry === null && seal.expiresAt !== undefined) || (sealedExpiry !== null && nextExpiry !== null && nextExpiry > sealedExpiry)) return false;
          if (!totals.has(index)) totals.set(index, new Set());
          totals.get(index).add(nextIndex);
        }
      }
      for (const [index, indices] of totals) {
        const total = [...indices].reduce((sum, i) => sum + atomic(nextSpend[i].maxAmount), 0n);
        if (total > atomic(sealedSpend[index].maxAmount)) return false;
      }
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
