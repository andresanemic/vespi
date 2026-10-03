'use strict';

// Contratos ROJOS para los seis comportamientos de kernel 0.1.4.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createOperation, runOperation, pauseOperation, resumeOperation } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');
const { buildReceipt } = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');
const delegation = require('../src/delegation.js');

const REQ = { asset: 'USDC:test', amount: '3', to: 'DEST-A' };
const verifyOk = async () => ({ verified: true, checks: { synthetic: true }, reason: 'synthetic proof' });
const noAsk = async () => ({ approved: false });

function receiptFor(action, status, exercised = [], evidence = null, at) {
  const receipt = buildReceipt({
    operation: { id: `op-${action}-${status}`, goal: `goal-${action}`, action },
    capabilityId: 'synthetic-cap', authority: { spend: [] },
    outcome: { status, exercised }, evidence,
    verification: status === 'verified'
      ? { verified: true, checks: { synthetic: true }, reason: 'synthetic proof' }
      : status === 'not_verified'
        ? { verified: false, checks: {}, reason: 'synthetic uncertainty' }
        : null,
    ...(at === undefined ? {} : { at }),
  });
  return receipt;
}

function reseal(receipt) {
  const body = { ...receipt };
  delete body.digest;
  delete body.anchor;
  const canonicalize = (value) => Array.isArray(value)
    ? value.map(canonicalize)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
      : value;
  receipt.digest = createHash('sha256').update(JSON.stringify(canonicalize(body)), 'utf8').digest('hex');
  return receipt;
}

const local = { verifyLocal: () => true };

test('V014-C1: not_verified con gasto ejercido pide reconciliación y no repropone', () => {
  const uncertain = receiptFor('transfer', 'not_verified', [{ ...REQ }]);
  const out = resumeFromReceipts([uncertain], { approved: [{ action: 'transfer', localReversible: true }] }, local);
  assert.equal(out.needsPerson, true);
  assert.equal(out.nextAction, null);
  assert.equal(out.reason, 'reconciliation_required');
});

test('V014-C2: not_verified sin gasto ejercido sigue siendo reanudable', () => {
  const out = resumeFromReceipts([receiptFor('transfer', 'not_verified')], { approved: [{ action: 'transfer' }] });
  assert.equal(out.needsPerson, false);
  assert.equal(out.nextAction.action, 'transfer');
});

test('V014-C3: un verified posterior cierra la incertidumbre anterior', () => {
  const out = resumeFromReceipts([
    receiptFor('transfer', 'not_verified', [{ ...REQ }], null, '2040-01-01T00:00:00.000Z'),
    receiptFor('transfer', 'verified', [], null, '2040-01-02T00:00:00.000Z'),
  ], { approved: [{ action: 'transfer', localReversible: true }] }, local);
  assert.equal(out.needsPerson, false);
  assert.equal(out.nextAction, null);
  assert.match(out.reason, /complete/i);
});

test('V014-C4: failed con settlementUnknown en evidencia pide reconciliación', () => {
  const failed = buildReceipt({
    operation: { id: 'failed-transfer', goal: 'goal-transfer', action: 'transfer' },
    capabilityId: 'synthetic-cap', authority: { spend: [] },
    outcome: { status: 'failed', exercised: [] },
    evidence: { settlementUnknown: true },
  });
  const out = resumeFromReceipts([failed], { approved: [{ action: 'transfer' }] });
  assert.equal(out.needsPerson, true);
  assert.equal(out.nextAction, null);
  assert.equal(out.reason, 'reconciliation_required');
});

async function captureKey({ goal = 'pay invoice', action = 'pay', to = 'DEST-A', expiresAt } = {}) {
  let key;
  const op = createOperation({
    goal,
    action,
    authority: grantSpend('USDC:test', '10', to, expiresAt),
  });
  const cap = {
    id: 'key-cap',
    required: () => ({ spend: [{ ...REQ, to }] }),
    perform: async (ctx) => { key = ctx.idempotencyKey; return { ok: true, evidence: { txHash: 'synthetic-tx' } }; },
  };
  const result = await runOperation(op, cap, { verify: verifyOk, ask: noAsk });
  return { key, result, op };
}

test('V014-I1: operaciones nuevas con mismo contenido reciben la misma clave SHA-256', async () => {
  const one = await captureKey();
  const two = await captureKey();
  assert.match(one.key, /^[a-f0-9]{64}$/);
  assert.match(two.key, /^[a-f0-9]{64}$/);
  assert.equal(two.key, one.key);
});

test('V014-I2: objetivo, acción o destino distintos cambian la clave', async () => {
  const base = await captureKey();
  const changedGoal = await captureKey({ goal: 'pay another invoice' });
  const changedAction = await captureKey({ action: 'refund' });
  const changedDestination = await captureKey({ to: 'DEST-B' });
  for (const { key } of [base, changedGoal, changedAction, changedDestination]) assert.match(key, /^[a-f0-9]{64}$/);
  assert.notEqual(changedGoal.key, base.key);
  assert.notEqual(changedAction.key, base.key);
  assert.notEqual(changedDestination.key, base.key);
});

test('V014-I3: la clave de una operación pausada coincide con la de una operación nueva equivalente', async () => {
  let firstKey;
  let secondKey;
  const authority = { ...grantSpend('USDC:test', '10', 'DEST-A'), pausers: ['human'] };
  const op = createOperation({ goal: 'pay invoice', action: 'pay', authority });
  const pausable = {
    id: 'key-cap', required: () => ({ spend: [{ ...REQ }] }),
    perform: async (ctx) => { firstKey = ctx.idempotencyKey; return { ok: true, evidence: { txHash: 'first' } }; },
  };
  pauseOperation(op, 'human');
  assert.equal((await runOperation(op, pausable, { verify: verifyOk, ask: noAsk })).status, 'paused');
  resumeOperation(op, 'human');
  await runOperation(op, pausable, { verify: verifyOk, ask: noAsk });
  const equivalent = createOperation({ goal: 'pay invoice', action: 'pay', authority });
  await runOperation(equivalent, {
    ...pausable,
    perform: async (ctx) => { secondKey = ctx.idempotencyKey; return { ok: true, evidence: { txHash: 'second' } }; },
  }, { verify: verifyOk, ask: noAsk });
  assert.match(firstKey, /^[a-f0-9]{64}$/);
  assert.equal(secondKey, firstKey);
});

test('V014-A1: failed y not_verified cuentan hasta agotar maxAttempts para la próxima acción', () => {
  const out = resumeFromReceipts([
    receiptFor('send', 'failed'),
    receiptFor('send', 'not_verified'),
  ], { approved: [{ action: 'send', maxAttempts: 2 }] });
  assert.equal(out.needsPerson, true);
  assert.equal(out.nextAction, null);
  assert.equal(out.reason, 'attempts_exhausted');
});

test('V014-A2: sin maxAttempts no cambia la propuesta tras recibos no verificados', () => {
  const out = resumeFromReceipts([receiptFor('send', 'failed')], { approved: [{ action: 'send' }] });
  assert.equal(out.needsPerson, false);
  assert.equal(out.nextAction.action, 'send');
});

test('V014-A3: un único fallo deja disponible la acción con maxAttempts 2', () => {
  const out = resumeFromReceipts([
    receiptFor('prior', 'verified'),
    receiptFor('send', 'failed'),
  ], { approved: [
    { action: 'prior', localReversible: true },
    { action: 'send', maxAttempts: 2 },
    { action: 'next' },
  ] }, local);
  assert.equal(out.needsPerson, false);
  assert.equal(out.nextAction.action, 'send');
});

test('V014-A4: maxAttempts exige entero positivo', () => {
  for (const maxAttempts of [0, -1, 2.5, '3']) {
    assert.throws(() => resumeFromReceipts([], { approved: [{ action: 'send', maxAttempts }] }), /maxAttempts.*positive integer/i);
  }
});

test('V014-D1: delegationStatus calcula vencimiento perezosamente desde now inyectado', () => {
  const d = delegation.createDelegation({ task: 'synthetic task', medium: {}, delegate: 'worker', orchestrator: 'vespi', deadlineMs: 50, now: () => 100 });
  assert.deepEqual(delegation.delegationStatus(d, 149), { overdue: false, dueAt: 150 });
  assert.deepEqual(delegation.delegationStatus(d, 151), { overdue: true, dueAt: 150 });
});

test('V014-D2: delegación sin deadline nunca vence', () => {
  const d = delegation.createDelegation({ task: 'synthetic task', medium: {}, delegate: 'worker', orchestrator: 'vespi', now: () => 100 });
  assert.deepEqual(delegation.delegationStatus(d, Number.MAX_SAFE_INTEGER), { overdue: false, dueAt: null });
});

test('V014-D3: recibo de revisión resuelve la delegación y evita marcarla vencida', () => {
  const d = delegation.createDelegation({ task: 'synthetic task', medium: {}, delegate: 'worker', orchestrator: 'vespi', deadlineMs: 10, now: () => 100 });
  delegation.recordResult(d, { output: 'done', touched: [] });
  delegation.reviewDelegation(d, { reviewer: 'vespi', accept: true });
  delegation.integrateDelegation(d);
  assert.deepEqual(delegation.delegationStatus(d, 1000), { overdue: false, dueAt: 110 });
});

test('V014-D4: deadlineMs exige entero positivo', () => {
  for (const deadlineMs of [0, -1, 1.5, '10']) {
    assert.throws(() => delegation.createDelegation({ task: 'x', medium: {}, delegate: 'worker', orchestrator: 'vespi', deadlineMs }), /deadlineMs.*positive integer/i);
  }
});

function clockCapability() {
  return {
    id: 'clock-cap',
    required: () => ({ spend: [{ ...REQ }] }),
    perform: async () => ({ ok: true, evidence: { txHash: 'clock-tx' } }),
  };
}

test('V014-T1: permiso futuro según io.now se acepta aunque el reloj real ya lo venció', async () => {
  const realNow = Date.now();
  const expiredInRealTime = new Date(realNow - 60_000).toISOString();
  const op = createOperation({ goal: 'clock check', authority: grantSpend('USDC:test', '10', 'DEST-A', expiredInRealTime) });
  const out = await runOperation(op, clockCapability(), { now: () => realNow - 120_000, verify: verifyOk, ask: noAsk });
  assert.equal(out.status, 'verified');
});

test('V014-T2: permiso vencido según io.now se rechaza aunque el reloj real sea anterior', async () => {
  const realNow = Date.now();
  const futureInRealTime = new Date(realNow + 60_000).toISOString();
  const op = createOperation({ goal: 'clock check', authority: grantSpend('USDC:test', '10', 'DEST-A', futureInRealTime) });
  const out = await runOperation(op, clockCapability(), { now: () => realNow + 120_000, verify: verifyOk, ask: noAsk });
  assert.equal(out.status, 'needs_human_decision');
});

test('V014-T3: el recibo usa io.now como tiempo de emisión', async () => {
  const fixed = Date.parse('2040-05-06T07:08:09.000Z');
  const op = createOperation({ goal: 'clock check', authority: grantSpend('USDC:test', '10', 'DEST-A') });
  const out = await runOperation(op, clockCapability(), { now: () => fixed, verify: verifyOk, ask: noAsk });
  assert.equal(out.receipt.at, new Date(fixed).toISOString());
});

test('V014-T4: sin io.now la expiración conserva el reloj real', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const op = createOperation({ goal: 'clock check', authority: grantSpend('USDC:test', '10', 'DEST-A', future) });
  const out = await runOperation(op, clockCapability(), { verify: verifyOk, ask: noAsk });
  assert.equal(out.status, 'verified');
});

test('V014-NR1: los exports públicos actuales mantienen sus nombres', () => {
  const operation = require('../src/operation.js');
  const authority = require('../src/authority.js');
  const receipt = require('../src/receipt.js');
  const continuity = require('../src/continuity.js');
  const delegationExports = require('../src/delegation.js');
  for (const name of ['createOperation', 'runOperation', 'pauseOperation', 'resumeOperation']) assert.equal(typeof operation[name], 'function', name);
  assert.equal(typeof operation.STATES, 'object');
  assert.equal(typeof operation.DEFAULT_EXIT, 'string');
  for (const name of ['grantSpend', 'sufficient']) assert.equal(typeof authority[name], 'function', name);
  for (const name of ['buildReceipt', 'verifyReceipt', 'anchorReceipt', 'anchorReceiptAsync']) assert.equal(typeof receipt[name], 'function', name);
  assert.equal(typeof continuity.resumeFromReceipts, 'function');
  for (const name of ['createDelegation', 'recordStart', 'recordResult', 'reviewDelegation', 'integrateDelegation', 'delegationReceipt', 'recordCard', 'personView']) assert.equal(typeof delegationExports[name], 'function', name);
});
