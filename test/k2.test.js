// K2 TDD (RED primero): autoridad con reloj, presupuesto/destino, varias firmas.
const { test } = require('node:test');
const assert = require('node:assert');

const { createOperation, runOperation, STATES } = require('../src/operation.js');
const { sufficient, grantSpend } = require('../src/authority.js');

const verifierOk = async () => ({ verified: true, checks: { mock: true }, reason: 'mock ok' });
const silentAsk = async () => ({ approved: false });
const REQ = { asset: 'USDC:test', amount: '100000', to: 'RECEIVER' };

function capWith(spend, performFn) {
  let calls = 0;
  return {
    id: 'k2-cap',
    required: () => ({ spend }),
    perform: async (ctx) => { calls++; return performFn(ctx); },
    calls: () => calls,
  };
}

// --- 1. Autoridad con reloj ---

test('K2.1 grant vencido se rechaza y el reason dice que venció y cuándo', () => {
  const authority = { spend: [{ asset: 'USDC:test', maxAmount: '500000', expiresAt: '2024-01-01T00:00:00.000Z' }] };
  const res = sufficient([REQ], authority, { now: '2024-06-01T00:00:00.000Z' });
  assert.equal(res.ok, false);
  assert.match(res.reason, /venci|expir/i);
  assert.match(res.reason, /2024-01-01T00:00:00\.000Z/);
});

test('K2.2 grant vigente (expiresAt futuro) sigue cubriendo', () => {
  const authority = { spend: [{ asset: 'USDC:test', maxAmount: '500000', expiresAt: '2025-01-01T00:00:00.000Z' }] };
  const res = sufficient([REQ], authority, { now: '2024-06-01T00:00:00.000Z' });
  assert.equal(res.ok, true);
});

test('K2.3 now es inyectable: mismo grant vence o no según now', () => {
  const authority = { spend: [{ asset: 'USDC:test', maxAmount: '500000', expiresAt: '2024-06-01T12:00:00.000Z' }] };
  const before = sufficient([REQ], authority, { now: '2024-06-01T11:00:00.000Z' });
  const after = sufficient([REQ], authority, { now: '2024-06-01T13:00:00.000Z' });
  assert.equal(before.ok, true);
  assert.equal(after.ok, false);
});

// --- 2. Presupuesto y destino ---

test('K2.4 grant con to solo cubre ese destino', () => {
  const authority = { spend: [{ asset: 'USDC:test', maxAmount: '500000', to: 'OTHER' }] };
  const res = sufficient([REQ], authority);
  assert.equal(res.ok, false);
  const okSame = sufficient([REQ], { spend: [{ asset: 'USDC:test', maxAmount: '500000', to: 'RECEIVER' }] });
  assert.equal(okSame.ok, true);
});

test('K2.5 el presupuesto se consume sumando exigencias del mismo grant', () => {
  const authority = grantSpend('USDC:test', '500000');
  const two = [
    { asset: 'USDC:test', amount: '400000', to: 'SAME' },
    { asset: 'USDC:test', amount: '400000', to: 'SAME' },
  ];
  const res = sufficient(two, authority);
  assert.equal(res.ok, false);
  const exact = [
    { asset: 'USDC:test', amount: '250000', to: 'AAA' },
    { asset: 'USDC:test', amount: '250000', to: 'BBB' },
  ];
  assert.equal(sufficient(exact, authority).ok, true);
});

// --- 3. Varias firmas ---

test('K2.6 con firmas insuficientes queda en needs_human_decision y dice cuántas faltan', async () => {
  const cap = capWith([REQ], async () => ({ ok: true, evidence: { tx: 'X' } }));
  const op = createOperation({
    goal: 'demo',
    authority: { spend: [], signers: { required: 2, allowed: ['ana', 'bob', 'cara'] } },
  });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => ({ approved: true, by: 'ana' }),
  });
  assert.equal(cap.calls(), 0);
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(res.receipt.status, 'needs_human_decision');
  assert.match(res.receipt.detail || '', /1/);
  assert.match(res.receipt.detail || '', /faltan|missing/i);
});

test('K2.7 con n firmas distintas dentro de allowed la puerta pasa', async () => {
  const cap = capWith([REQ], async () => ({ ok: true, evidence: { tx: 'X' } }));
  const op = createOperation({
    goal: 'demo',
    authority: { spend: [], signers: { required: 2, allowed: ['ana', 'bob', 'cara'] } },
  });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => ({ approved: true, approvals: [{ by: 'ana' }, { by: 'bob' }] }),
  });
  assert.equal(res.status, STATES.SUCCEEDED);
  assert.equal(cap.calls(), 1);
});

test('K2.8 la misma id dos veces cuenta una sola vez', async () => {
  const cap = capWith([REQ], async () => ({ ok: true, evidence: { tx: 'X' } }));
  const op = createOperation({
    goal: 'demo',
    authority: { spend: [], signers: { required: 2, allowed: ['ana', 'bob'] } },
  });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => ({ approved: true, approvals: [{ by: 'ana' }, { by: 'ana' }] }),
  });
  assert.equal(cap.calls(), 0);
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.match(res.receipt.detail || '', /1/);
});

test('K2.9 el agente nunca cuenta como firmante', async () => {
  const cap = capWith([REQ], async () => ({ ok: true, evidence: { tx: 'X' } }));
  const op = createOperation({
    goal: 'demo',
    authority: { spend: [], signers: { required: 1, allowed: ['ana', 'agente-1'] } },
    agent: 'agente-1',
  });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => ({ approved: true, approvals: [{ by: 'agente-1' }] }),
  });
  assert.equal(cap.calls(), 0);
  assert.equal(res.status, STATES.NEEDS_DECISION);
});

test('K2.10 ids fuera de allowed no cuentan', async () => {
  const cap = capWith([REQ], async () => ({ ok: true, evidence: { tx: 'X' } }));
  const op = createOperation({
    goal: 'demo',
    authority: { spend: [], signers: { required: 1, allowed: ['ana', 'bob'] } },
  });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => ({ approved: true, approvals: [{ by: 'intruso' }, { by: 'ana' }] }),
  });
  assert.equal(res.status, STATES.SUCCEEDED);
  const op2 = createOperation({
    goal: 'demo',
    authority: { spend: [], signers: { required: 1, allowed: ['ana', 'bob'] } },
  });
  const res2 = await runOperation(op2, capWith([REQ], async () => ({ ok: true, evidence: { tx: 'X' } })), {
    verify: verifierOk,
    ask: async () => ({ approved: true, approvals: [{ by: 'intruso' }] }),
  });
  assert.equal(res2.status, STATES.NEEDS_DECISION);
});
