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
  // Group by asset + destination: splitting one side effect across several
  // requirements must not exceed the grant that covers that group.
  const groups = new Map();
  for (const r of reqs) {
    const key = `${r.asset}@@${r.to || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const [key, members] of groups) {
    const [asset, to] = key.split('@@');
    const g = grants.find((x) => x.asset === asset && (!x.to || !to || x.to === to));
    if (!g) return { ok: false, reason: `no grant for asset ${asset}${to ? ` to ${to}` : ''}` };
    const total = members.reduce((sum, m) => sum + num(m.amount), 0n);
    if (total > num(g.maxAmount)) {
      return { ok: false, reason: `grouped amount ${total} exceeds grant ${g.maxAmount} (${asset}${to ? ` to ${to}` : ''})` };
    }
  }
  return { ok: true, reason: 'covered by grant' };
}

module.exports = { grantSpend, sufficient };
