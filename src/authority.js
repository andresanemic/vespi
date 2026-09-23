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
  // Assign every requirement to exactly one grant, then cap consumption PER GRANT.
  // A wildcard grant (no `to`) covers any destination but is NOT renewed per
  // destination: all requirements assigned to it share its single maxAmount.
  // Destination-specific grants keep separate budgets.
  const consumption = new Map(); // grant index -> total assigned
  for (const r of reqs) {
    // Most specific matching grant first: a destination-specific grant takes
    // precedence for its destination; the wildcard is the fallback, never renewed.
    const gi = grants.findIndex((x) => x.asset === r.asset && x.to && r.to && x.to === r.to);
    const wi = gi >= 0 ? gi : grants.findIndex((x) => x.asset === r.asset && !x.to);
    const idx = gi >= 0 ? gi : wi;
    if (idx < 0) return { ok: false, reason: `no grant for asset ${r.asset}${r.to ? ` to ${r.to}` : ''}` };
    consumption.set(idx, (consumption.get(idx) || 0n) + num(r.amount));
  }
  for (const [gi, total] of consumption) {
    const g = grants[gi];
    if (total > num(g.maxAmount)) {
      return { ok: false, reason: `requirements consume ${total} against grant max ${g.maxAmount} (${g.asset}${g.to ? ` to ${g.to}` : ''})` };
    }
  }
  return { ok: true, reason: 'covered by grant' };
}

module.exports = { grantSpend, sufficient };
