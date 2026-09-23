'use strict';

// Authority: pure data + one predicate. No I/O, no host, no capabilities.
function grantSpend(asset, maxAmount) {
  return { spend: [{ asset, maxAmount }] };
}

function num(s) {
  return BigInt(String(s));
}

// requirements: [{ asset, amount, to }] — what a capability says it needs.
// authority: { spend: [{ asset, maxAmount }] } — what the user granted.
// Every requirement must be covered, otherwise insufficient. No partial credit.
function sufficient(requirements, authority) {
  const reqs = requirements || [];
  if (reqs.length === 0) return { ok: true, reason: 'no side effect required' };
  const grants = (authority && authority.spend) || [];
  for (const r of reqs) {
    const g = grants.find((x) => x.asset === r.asset);
    if (!g) return { ok: false, reason: `no grant for asset ${r.asset}` };
    if (num(r.amount) > num(g.maxAmount)) {
      return { ok: false, reason: `amount ${r.amount} exceeds grant ${g.maxAmount} (${r.asset})` };
    }
    // Destination binds when the grant names one. A grant without `to` covers any
    // destination (caller beware); gate approvals always carry the requirement's `to`.
    if (g.to && r.to && g.to !== r.to) {
      return { ok: false, reason: `destination ${r.to} not covered by grant to ${g.to}` };
    }
  }
  return { ok: true, reason: 'covered by grant' };
}

module.exports = { grantSpend, sufficient };
