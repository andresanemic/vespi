'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sufficient, attenuates } = require('../src/authority.js');
const { createOperation, runOperation, checkpointOperation, restoreOperation } = require('../src/operation.js');

function mixedAuthority(size) {
  const base = Date.parse('2030-01-01T00:00:00Z');
  return { spend: Array.from({ length: size }, (_, i) => {
    const grant = { asset: 'USDC', maxAmount: '100' };
    if (i % 4 === 0) grant.to = `T${i}`;
    else if (i % 4 === 1) grant.network = `N${i}`;
    else if (i % 4 === 2) grant.resource = `R${i}`;
    grant.expiresAt = new Date(base + i * 1000).toISOString();
    return grant;
  }) };
}

test('KF-4 rejects oversized mixed authorities before expensive enumeration', () => {
  const tooLarge = mixedAuthority(40);
  const start = process.hrtime.bigint();
  assert.equal(attenuates(tooLarge, tooLarge), false);
  assert.ok(Number(process.hrtime.bigint() - start) / 1e6 < 500);

  const operation = createOperation({ goal: 'g', authority: tooLarge, action: 'pay' });
  const checkpoint = checkpointOperation(operation);
  const restoreStart = process.hrtime.bigint();
  assert.throws(() => restoreOperation(checkpoint, { expectedDigest: checkpoint.digest, authority: tooLarge }), /authority_widened/);
  assert.ok(Number(process.hrtime.bigint() - restoreStart) / 1e6 < 500);
});

test('KF-4 accepts a legitimate mixed authority with 16 grants quickly', () => {
  const legitimate = mixedAuthority(16);
  const legitimateStart = process.hrtime.bigint();
  assert.equal(attenuates(legitimate, legitimate), true);
  assert.ok(Number(process.hrtime.bigint() - legitimateStart) / 1e6 < 100);
});

test('KF-1 rejects resolution and scope mismatches', () => {
  const cases = [
    [{ asset: 'USDC', maxAmount: '100' }, { asset: 'USDC', maxAmount: '10', to: 'GX' }, { asset: 'USDC', maxAmount: '100', to: 'GX' }],
    [{ asset: 'B', maxAmount: '5', to: 'X', network: 'N1', resource: 'R1' }, { asset: 'B', maxAmount: '20', to: 'X' }, { asset: 'B', maxAmount: '10', to: 'X' }],
    [{ asset: 'B', maxAmount: '5', to: 'X', resource: 'R1', expiresAt: '2032-01-01T00:00:00Z' }, { asset: 'B', maxAmount: '20', resource: 'R1', expiresAt: '2032-01-01T00:00:00Z' }, { asset: 'B', maxAmount: '10', resource: 'R1', expiresAt: '2032-01-01T00:00:00Z' }],
    [{ asset: 'B', maxAmount: '20', expiresAt: '2032-01-01T00:00:00Z' }, { asset: 'B', maxAmount: '5', to: 'Y', resource: 'R1' }, { asset: 'B', maxAmount: '20', network: 'N1', resource: 'R1', expiresAt: '2031-01-01T00:00:00Z' }],
    [{ asset: 'B', maxAmount: '5', to: 'X', network: 'N1', expiresAt: '2032-01-01T00:00:00Z' }, { asset: 'B', maxAmount: '20', network: 'N1' }, { asset: 'B', maxAmount: '10', network: 'N1', resource: 'R1', expiresAt: '2031-01-01T00:00:00Z' }, { asset: 'B', maxAmount: '10', to: 'Y', network: 'N1', expiresAt: '2031-01-01T00:00:00Z' }],
  ];
  for (const [a, b, ...widened] of cases) {
    const sealed = { spend: [a, b] }, next = { spend: widened };
    assert.equal(attenuates(next, sealed), false);
    const cp = checkpointOperation(createOperation({ goal: 'g', authority: sealed, action: 'pay' }));
    assert.throws(() => restoreOperation(cp, { expectedDigest: cp.digest, authority: next }), /authority_widened/);
  }
});

test('KF-1 preserves legitimate narrowed authorities', () => {
  const sealed = { spend: [
    { asset: 'A', maxAmount: '20', resource: 'R1', expiresAt: '2032-01-01T00:00:00Z' },
    { asset: 'B', maxAmount: '10' },
  ] };
  for (const next of [
    structuredClone(sealed),
    { spend: [{ ...sealed.spend[0], maxAmount: '10' }, sealed.spend[1]] },
    { spend: [{ ...sealed.spend[0], to: 'X' }, sealed.spend[1]] },
    { spend: [{ ...sealed.spend[0], network: 'N1' }, sealed.spend[1]] },
    { spend: [{ ...sealed.spend[0], expiresAt: '2031-01-01T00:00:00Z' }, sealed.spend[1]] },
    { spend: [sealed.spend[0]] },
  ]) assert.equal(attenuates(next, sealed), true);
});

test('KF-1 finite deterministic fuzz preserves every sampled allowed point', () => {
  let seed = 0x5eed1234;
  const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const pick = (values) => values[rnd(values.length)];
  const values = { asset: ['A', 'B'], to: [undefined, 'X', 'Y', 'Z'], network: [undefined, 'N1', 'N2'], resource: [undefined, 'R1', 'R2'], expiresAt: [undefined, '2029-01-01T00:00:00Z', '2031-01-01T00:00:00Z', '2032-01-01T00:00:00Z'] };
  const grant = () => Object.fromEntries(Object.entries({ asset: pick(values.asset), maxAmount: String(pick([5, 10, 20])), to: pick(values.to), network: pick(values.network), resource: pick(values.resource), expiresAt: pick(values.expiresAt) }).filter(([, value]) => value !== undefined));
  const domains = ['X', 'Y', 'Z', 'OTHER'];
  for (let i = 0; i < 5000; i++) {
    const asset = pick(['A', 'B', 'C']), to = pick(['X', 'Y', 'Z']), network = pick(['N1', 'N2', 'N3']), resource = pick(['R1', 'R2', 'R3']);
    const sealed = { spend: [{ asset, maxAmount: '5', to, network, resource, expiresAt: '2032-01-01T00:00:00Z' }, { asset, maxAmount: '20', expiresAt: '2032-01-01T00:00:00Z' }] };
    const next = { spend: [{ asset, maxAmount: '10', network, resource, expiresAt: '2032-01-01T00:00:00Z' }] };
    const req = [{ asset, amount: '10', to, network, resource }];
    assert.equal(sufficient(req, next, { now: Date.parse('2030-01-01T00:00:00Z') }).ok, true);
    assert.equal(sufficient(req, sealed, { now: Date.parse('2030-01-01T00:00:00Z') }).ok, false);
    assert.equal(attenuates(next, sealed), false);
  }
  let examined = 0;
  while (examined < 5000) {
    const sealed = { spend: [grant()] };
    const source = pick(sealed.spend);
    const narrowed = { ...source, maxAmount: String(1 + rnd(Number(source.maxAmount))) };
    if (source.to === undefined && rnd(2)) narrowed.to = pick(['X', 'Y', 'Z']);
    if (source.network === undefined && rnd(2)) narrowed.network = pick(['N1', 'N2']);
    if (source.resource === undefined && rnd(2)) narrowed.resource = pick(['R1', 'R2']);
    if (source.expiresAt === undefined && rnd(2)) narrowed.expiresAt = pick(['2029-01-01T00:00:00Z', '2031-01-01T00:00:00Z', '2032-01-01T00:00:00Z']);
    const next = { spend: [narrowed] };
    assert.equal(attenuates(next, sealed), true, JSON.stringify({ sealed, next }));
    examined++;
    for (const g of next.spend) for (const to of (g.to === undefined ? domains : [g.to])) {
      for (const network of (g.network === undefined ? [undefined, 'N1', 'N2', 'OTHER'] : [g.network])) {
        for (const resource of (g.resource === undefined ? [undefined, 'R1', 'R2', 'OTHER'] : [g.resource])) {
          const req = { asset: g.asset, to, network, resource, amount: g.maxAmount };
          for (const now of [Date.parse('2028-01-01T00:00:00Z'), Date.parse('2030-01-01T00:00:00Z'), Date.parse('2031-06-01T00:00:00Z'), Date.parse('2033-01-01T00:00:00Z')]) {
            if (sufficient([req], next, { now }).ok) assert.equal(sufficient([req], sealed, { now }).ok, true, JSON.stringify({ sealed, next, req, now }));
          }
        }
      }
    }
  }
  assert.equal(examined, 5000);
});

test('KF-2 closes unserializable operations as failed receipts without effects', async () => {
  for (const mutate of [(op) => { op.goal = 10n; }, (op) => { const c = {}; c.self = c; op.action = c; }]) {
    let performed = 0;
    const op = createOperation({ goal: 'g', authority: { spend: [{ asset: 'USDC', maxAmount: '10', to: 'GX' }] }, action: 'pay' });
    mutate(op);
    const out = await runOperation(op, { id: 'cap', required: () => ({ spend: [{ asset: 'USDC', amount: '5', to: 'GX' }] }), perform: async () => { performed++; return { ok: true }; } }, { verify: () => ({ verified: true, checks: { a: true }, reason: 'ok' }) });
    assert.equal(out.status, 'failed'); assert.ok(out.receipt); assert.equal(performed, 0);
  }
});

test('KF-3 stale approval has no decidedBy attribution', async () => {
  const context = { manifestDigest: 'a'.repeat(64), scope: 'plan', sources: [{ ref: 'r1', owner: 'o', revision: '1', state: 'approved' }] };
  const op = createOperation({ goal: 'g', authority: { spend: [] }, action: 'pay', context });
  const cap = { id: 'cap', required: () => ({ spend: [{ asset: 'USDC', amount: '5', to: 'GX' }] }), perform: async () => ({ ok: true }) };
  const out = await runOperation(op, cap, { ask: () => ({ approved: true, by: 'ana', request: 'f'.repeat(64) }), readContext: () => context });
  assert.equal(out.receipt.status, 'needs_human_decision'); assert.equal(out.receipt.decidedBy, undefined);
});
