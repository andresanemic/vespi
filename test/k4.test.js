// K4 TDD (RED primero): continuidad por recibos + io.decide opcional.
const { test } = require('node:test');
const assert = require('node:assert');

const { buildReceipt } = require('../src/receipt.js');
const continuity = require('../src/continuity.js');
const { createOperation, runOperation, STATES } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');

const verifierOk = async () => ({ verified: true, checks: { mock: true }, reason: 'mock ok' });
const silentAsk = async () => ({ approved: false });
const REQ = { asset: 'USDC:test', amount: '100000', to: 'RECEIVER' };

// The receipt is built the way the kernel builds it, with the action the agreement names
// (R1 finding A2: a fixture that invented its own shape validates a contract that does not exist).
function receiptFor(action, status = 'verified') {
  return buildReceipt({
    operation: { id: `op-${action}`, goal: action, action },
    capabilityId: 'cap-k4',
    authority: { spend: [] },
    outcome: { status, exercised: [], detail: 'ok' },
    evidence: { txHash: `tx-${action}` },
    verification: { verified: true, checks: { mock: true }, reason: 'mock ok' },
  });
}

function agreementFor(approved, workingMode = 'normal') {
  return { approved, workingMode };
}

// --- 1. Continuidad por recibos ---

test('K4.1 resume retoma: nextAction es la siguiente aprobada sin recibo verified', () => {
  const r1 = receiptFor('step-1');
  const agreement = agreementFor([
    { action: 'step-1', scope: 's1' },
    { action: 'step-2', scope: 's2' },
  ], 'normal');
  const res = continuity.resumeFromReceipts([r1], agreement);
  assert.equal(res.lastState, 'verified');
  assert.equal(res.nextAction && res.nextAction.action, 'step-2');
  assert.equal(res.needsPerson, false);
  assert.equal(res.discarded, 0);
  assert.equal(res.workingMode, 'normal');
  assert.equal(typeof res.reason, 'string');
});

test('K4.2 descarta recibos alterados, lo dice y es independiente del orden', () => {
  const r1 = receiptFor('step-1');
  const bad = JSON.parse(JSON.stringify(receiptFor('step-2')));
  bad.detail = 'alterado';
  const agreement = agreementFor([
    { action: 'step-1', scope: 's1' },
    { action: 'step-2', scope: 's2' },
  ]);
  const res = continuity.resumeFromReceipts([bad, r1], agreement);
  assert.equal(res.discarded, 1);
  assert.match(res.reason, /discard/i);
  assert.equal(res.nextAction && res.nextAction.action, 'step-2');
  assert.equal(res.needsPerson, false);
  // orden inverso da lo mismo
  const res2 = continuity.resumeFromReceipts([r1, bad], agreement);
  assert.deepEqual(
    { next: res2.nextAction && res2.nextAction.action, discarded: res2.discarded, needs: res2.needsPerson },
    { next: 'step-2', discarded: 1, needs: false },
  );
});

test('K4.3 todo completo: nextAction nula sin pedir persona', () => {
  const agreement = agreementFor([{ action: 'a', scope: 's' }, { action: 'b', scope: 's' }]);
  const res = continuity.resumeFromReceipts([receiptFor('a'), receiptFor('b')], agreement);
  assert.equal(res.nextAction, null);
  assert.equal(res.needsPerson, false);
  assert.match(res.reason, /complet/i);
});

test('K4.4 revalidación: si lo siguiente cambia amount/scope/ceiling/status pide persona y anula next', () => {
  for (const changes of [
    { amount: '999' },
    { scope: 'otro' },
    { ceiling: '1' },
    { status: 'aprobado' },
  ]) {
    const agreement = agreementFor([
      { action: 'step-1', scope: 's1' },
      { action: 'step-2', scope: 's2', changes },
    ]);
    const res = continuity.resumeFromReceipts([receiptFor('step-1')], agreement);
    assert.equal(res.needsPerson, true, `changes=${JSON.stringify(changes)}`);
    assert.equal(res.nextAction, null, `changes=${JSON.stringify(changes)}`);
    assert.equal(typeof res.reason, 'string');
  }
});

test('K4.5 retomar lo acordado no abre la puerta (solo cambiar lo acordado la abre)', () => {
  const agreement = agreementFor([
    { action: 'step-1', scope: 's1' },
    { action: 'step-2', scope: 's2' },
  ]);
  const res = continuity.resumeFromReceipts([receiptFor('step-1')], agreement);
  assert.equal(res.needsPerson, false);
  assert.equal(res.nextAction && res.nextAction.action, 'step-2');
});

test('K4.6 acción fuera de approved pide persona y anula next', () => {
  const agreement = agreementFor([{ action: 'step-1', scope: 's1' }]);
  const res = continuity.resumeFromReceipts([receiptFor('intruso')], agreement);
  assert.equal(res.needsPerson, true);
  assert.equal(res.nextAction, null);
});

test('K4.7 sin recibos: lastState nula y next es la primera aprobada', () => {
  const agreement = agreementFor([{ action: 'step-1', scope: 's1' }], 'modo-x');
  const res = continuity.resumeFromReceipts([], agreement);
  assert.equal(res.lastState, null);
  assert.equal(res.nextAction && res.nextAction.action, 'step-1');
  assert.equal(res.workingMode, 'modo-x');
});

// --- 2. io.decide opcional ---

function capOk() {
  let calls = 0;
  return {
    id: 'k4-cap',
    required: () => ({ spend: [REQ] }),
    perform: async () => { calls++; return { ok: true, evidence: { tx: 'X' } }; },
    calls: () => calls,
  };
}

test('K4.8 (revisado, R42) una sugerencia confiada del modelo llega a ask y nunca aprueba sola', async () => {
  const cap = capOk();
  let asks = 0;
  let seen = null;
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async (payload) => { asks++; seen = payload; return { approved: false }; },
    decide: async () => ({ choice: true, probability: 0.99 }),
  });
  assert.equal(asks, 1, 'la persona siempre decide');
  assert.equal(cap.calls(), 0, 'sin el si de la persona no se ejecuta');
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.deepEqual(seen.suggestion, { choice: true, probability: 0.99, by: 'decision-model' });
  assert.notEqual(res.receipt.decidedBy, 'decision-model');
});

test('K4.9 una sugerencia con probabilidad baja no se muestra', async () => {
  const cap = capOk();
  let seen = null;
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async (payload) => { seen = payload; return { approved: true, by: 'humana' }; },
    decide: async () => ({ choice: true, probability: 0.5 }),
  });
  assert.equal(res.status, STATES.SUCCEEDED);
  assert.equal(seen.suggestion, undefined);
});

test('K4.10 decideThreshold decide cuándo la sugerencia se muestra, nunca cuándo aprueba', async () => {
  let seen = null;
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  await runOperation(op, capOk(), {
    verify: verifierOk,
    ask: async (payload) => { seen = payload; return { approved: true, by: 'humana' }; },
    decide: async () => ({ choice: true, probability: 0.6 }),
    decideThreshold: 0.5,
  });
  assert.equal(seen.suggestion.probability, 0.6);
  let seenStrict = null;
  const op2 = createOperation({ goal: 'demo', authority: { spend: [] } });
  await runOperation(op2, capOk(), {
    verify: verifierOk,
    ask: async (payload) => { seenStrict = payload; return { approved: true, by: 'humana' }; },
    decide: async () => ({ choice: true, probability: 0.95 }),
    decideThreshold: 0.99,
  });
  assert.equal(seenStrict.suggestion, undefined);
});

test('K4.12 (R42) un modelo de decision que lanza o miente no rompe la puerta', async () => {
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, capOk(), {
    verify: verifierOk,
    ask: async () => ({ approved: false }),
    decide: async () => { throw new Error('modelo caido'); },
  });
  assert.equal(res.status, STATES.NEEDS_DECISION);
});

test('K4.11 sin decide el kernel funciona igual (pide a ask)', async () => {
  const cap = capOk();
  let asks = 0;
  const op = createOperation({ goal: 'demo', authority: { spend: [] } });
  const res = await runOperation(op, cap, {
    verify: verifierOk,
    ask: async () => { asks++; return { approved: true, by: 'humana' }; },
  });
  assert.equal(res.status, STATES.SUCCEEDED);
  assert.equal(asks, 1);
  assert.notEqual(res.receipt.decidedBy, 'decision-model');
});
