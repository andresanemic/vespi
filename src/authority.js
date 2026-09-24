'use strict';

// Authority: pure data + one predicate. No I/O, no host, no capabilities.
function grantSpend(asset, maxAmount) {
  return { spend: [{ asset, maxAmount }] };
}

function text(value) {
  return typeof value === 'string' && value.length > 0;
}

function atomic(value) {
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;
}

function sufficient(requirements, authority) {
  const reqs = requirements;
  if (!Array.isArray(reqs)) return { ok: false, reason: 'requirements must be an array' };
  if (reqs.length === 0) return { ok: false, reason: 'no spend requirement declared' };
  const grants = (authority && authority.spend) || [];
  if (!Array.isArray(grants)) return { ok: false, reason: 'authority spend must be an array' };

  for (const requirement of reqs) {
    if (!requirement || !text(requirement.asset) || !text(requirement.to) || atomic(requirement.amount) === null) {
      return { ok: false, reason: 'invalid spend requirement' };
    }
  }
  for (const grant of grants) {
    if (!grant || !text(grant.asset) || atomic(grant.maxAmount) === null || (grant.to !== undefined && !text(grant.to))) {
      return { ok: false, reason: 'invalid spend grant' };
    }
  }

  const consumption = new Map();
  for (const requirement of reqs) {
    const specific = grants.findIndex((grant) => grant.asset === requirement.asset && grant.to === requirement.to);
    const wildcard = specific >= 0 ? specific : grants.findIndex((grant) => grant.asset === requirement.asset && grant.to === undefined);
    const index = specific >= 0 ? specific : wildcard;
    if (index < 0) return { ok: false, reason: `no grant for asset ${requirement.asset} to ${requirement.to}` };
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
