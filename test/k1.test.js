// K1 TDD (RED primero): bloqueada, pausers, puerta humana.
const { test } = require('node:test');
const assert = require('node:assert');

const ops = require('../src/operation.js');
const { createOperation, runOperation, STATES } = ops;
const { grantSpend } = require('../src/authority.js');

const verifierOk = async () => ({ verified: true, checks: { mock: true }, reason: 'mock ok' });
const REQ = { asset: 'USDC:test', amount: '100000', to: 'RECEIVER' };
const DEFAULT_EXIT = 'return to the person: change the agreement or cancel';

function capWith(spend, performFn) {
  let calls = 0;
  return {
    id: 'k1-cap',
    required: () => ({ spend }),
    perform: async (ctx) => { calls++; return performFn(ctx); },
    calls: () => calls,
  };
}

test('K1.1 STATES.BLOCKED existe y vale blocked', () => {
  assert.equal(STATES.BLOCKED, 'blocked');
});

test('K1.2 perform imposible -> blocked con reason, exit y sin reintento', async () => {
  const cap = capWith([REQ], async () => ({ ok: false, impossible: true, reason: 'no hay ruta' }));
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: async () => ({ approved: false }) });
  assert.equal(res.status, 'blocked');
  assert.equal(res.receipt.status, 'blocked');
  assert.match(res.receipt.detail || res.receipt.reason || '', /no hay ruta/);
  assert.equal(typeof (res.receipt.exit || res.receipt.outcome), 'string');
  assert.equal(res.receipt.exit, DEFAULT_EXIT);
  assert.equal(cap.calls(), 1);
  const second = await runOperation(op, cap, { verify: verifierOk, ask: async () => ({ approved: false }) });
  assert.equal(second.status, 'blocked');
  assert.equal(cap.calls(), 1);
});

test('K1.3 required imposible -> blocked sin llamar a perform', async () => {
  let performs = 0;
  const cap = {
    id: 'k1-req-imp',
    required: () => ({ impossible: true, reason: 'acuerdo no lo permite' }),
    perform: async () => { performs++; return { ok: true, evidence: { tx: 'X' } }; },
  };
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const res = await runOperation(op, cap, { verify: verifierOk, ask: async () => ({ approved: false }) });
  assert.equal(res.status, 'blocked');
  assert.equal(res.receipt.status, 'blocked');
  assert.match(res.receipt.detail || res.receipt.reason || '', /acuerdo no lo permite/);
  assert.equal(performs, 0);
});

test('K1.4 STATES.PAUSED existe y pausers autorizados pausan y reanudan', async () => {
  assert.equal(STATES.PAUSED, 'paused');
  assert.equal(typeof ops.pauseOperation, 'function');
  assert.equal(typeof ops.resumeOperation, 'function');
  const op = createOperation({ goal: 'demo', authority: { spend: [], pausers: ['ana'] } });
  ops.pauseOperation(op, 'ana');
  assert.equal(op.state, 'paused');
  assert.ok(op.history.length >= 1);
  let performs = 0;
  const cap = {
    id: 'paused-cap',
    required: () => ({ spend: [REQ] }),
    perform: async () => { performs++; return { ok: true, evidence: { tx: 'X' } }; },
  };
  const res = await runOperation(op, cap, { verify: verifierOk, ask: async () => ({ approved: true, by: 'ana' }) });
  assert.equal(res.status, 'paused');
  assert.equal(performs, 0);
  ops.resumeOperation(op, 'ana');
  assert.equal(op.state, 'created');
});

test('K1.5 pausar sin permiso lanza error que dice quién puede pausar', () => {
  const op = createOperation({ goal: 'demo', authority: { spend: [], pausers: ['ana'] } });
  assert.throws(() => ops.pauseOperation(op, 'bob'), /ana/);
});

test('K1.6 ask recibe { requirements, cost, publicByDefault:false, exit }', async () => {
  const cap = capWith([REQ], async () => ({ ok: true, evidence: { tx: 'X' } }));
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  let seen = null;
  await runOperation(op, cap, {
    verify: verifierOk,
    ask: async (arg) => { seen = arg; return { approved: true, by: 'humana' }; },
  });
  assert.ok(seen && typeof seen === 'object');
  // Forma compatible: una lista (como la usa demo/x402) que además lleva los cuatro gestos.
  assert.deepEqual(seen.requirements, [REQ]);
  const payload = seen;
  assert.deepEqual(payload.cost, [REQ]);
  assert.equal(payload.publicByDefault, false);
  assert.equal(typeof payload.exit, 'string');
});

test('K1.7 el agente no puede consentir por la persona (by == agent -> no aprobado)', async () => {
  const cap = capWith([REQ], async () => ({ ok: true, evidence: { tx: 'X' } }));
  const op = createOperation({ goal: 'demo', authority: { spend: [] }, agent: 'agente-1' });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => ({ approved: true, by: 'agente-1' }),
  });
  assert.equal(cap.calls(), 0);
  assert.notEqual(res.status, STATES.SUCCEEDED);
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.match(res.receipt.detail || '', /agente|by|consent|person/i);
});

test('K1.8 aprobación humana válida requiere by distinto del agente', async () => {
  const cap = capWith([REQ], async () => ({ ok: true, evidence: { tx: 'X' } }));
  const op = createOperation({ goal: 'demo', authority: { spend: [] }, agent: 'agente-1' });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => ({ approved: true, by: 'humana-9' }),
  });
  assert.equal(res.status, STATES.SUCCEEDED);
  assert.equal(cap.calls(), 1);
});

test('K1.9 rechazo humano deja exit en el recibo', async () => {
  const cap = capWith([REQ], async () => ({ ok: true, evidence: { tx: 'X' } }));
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => ({ approved: false, by: 'humana-9' }),
  });
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(typeof res.receipt.exit, 'string');
});
