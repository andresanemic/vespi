'use strict';

// Regresiones independientes para los ocho hallazgos de la segunda vuelta.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOperation, runOperation } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');
const { buildReceipt, verifyReceipt } = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');
const delegation = require('../src/delegation.js');

const proof = async () => ({ verified: true, checks: { ok: true }, reason: 'proof' });
const noAsk = async () => ({ approved: false });
const approved = (action) => ({ approved: [{ action, localReversible: true }] });
const local = { verifyLocal: () => true };

function receipt(action, status, { exercised = [], evidence, at } = {}) {
  return buildReceipt({
    operation: { id: `op-${action}-${status}-${at || 'none'}`, goal: 'goal', action },
    capabilityId: 'cap', authority: { spend: [] }, outcome: { status, exercised }, evidence,
    verification: status === 'verified' ? { verified: true, checks: { ok: true }, reason: 'proof' }
      : status === 'not_verified' ? { verified: false, checks: {}, reason: 'uncertain' } : null,
    ...(at === undefined ? {} : { at }),
  });
}

async function runKey({ amount = '3', to = 'A', expiresAt } = {}) {
  let key;
  const op = createOperation({ goal: 'pay', action: 'transfer', authority: grantSpend('USD', '10', undefined, expiresAt) });
  const result = await runOperation(op, {
    id: 'key-test', required: () => ({ spend: [{ asset: 'USD', amount, to }] }),
    perform: async (ctx) => { key = ctx.idempotencyKey; return { ok: true, evidence: { txHash: 'x' } }; },
  }, { verify: proof, ask: noAsk });
  return { key, result };
}

test('H1/H5: la clave idempotente depende del efecto canónico y no de metadatos del permiso', async () => {
  const base = await runKey({ amount: '3', to: 'A', expiresAt: '2040-01-01T00:00:00.000Z' });
  const changedAmount = await runKey({ amount: '7', to: 'A', expiresAt: '2040-01-01T00:00:00.000Z' });
  const changedDestination = await runKey({ amount: '3', to: 'B', expiresAt: '2040-01-01T00:00:00.000Z' });
  const changedExpiry = await runKey({ amount: '3', to: 'A', expiresAt: '2041-01-01T00:00:00.000Z' });
  assert.notEqual(base.key, changedAmount.key);
  assert.notEqual(base.key, changedDestination.key);
  assert.equal(base.key, changedExpiry.key);
});

test('H2: buildReceipt conserva settlementUnknown y los recibos sin señal mantienen el digest', () => {
  const fixedAt = '2040-01-01T00:00:00.000Z';
  const plain = receipt('transfer', 'failed', { at: fixedAt });
  const flagged = receipt('transfer', 'failed', { evidence: { settlementUnknown: true }, at: fixedAt });
  assert.equal(flagged.evidence.settlementUnknown, true);
  assert.equal(verifyReceipt(plain).ok, true);
  assert.equal(resumeFromReceipts([flagged], { approved: [{ action: 'transfer' }] }).reason, 'reconciliation_required');
  assert.equal(plain.digest, 'a4d9cbbc2975fb5b22a70efd07e1054a4b813c901d4338ca1c7d15e9139a5f71');
  assert.equal(plain.digest, receipt('transfer', 'failed', { at: fixedAt }).digest);
});

test('H3: exercised objeto no vacío y forma desconocida piden revisión humana', () => {
  const object = receipt('transfer', 'not_verified', { exercised: { asset: 'USD', amount: '3', to: 'A' } });
  const unknown = receipt('transfer', 'not_verified', { exercised: 'possibly-spent' });
  for (const r of [object, unknown]) {
    const out = resumeFromReceipts([r], approved('transfer'));
    assert.equal(out.needsPerson, true);
    assert.equal(out.nextAction, null);
  }
});

test('H4: solo verified posterior puede cerrar incertidumbre, en cualquier orden de lista', () => {
  const oldVerified = receipt('transfer', 'verified', { at: '2040-01-01T00:00:00.000Z' });
  const laterUncertain = receipt('transfer', 'not_verified', { exercised: [{ asset: 'USD', amount: '3', to: 'A' }], at: '2040-01-02T00:00:00.000Z' });
  for (const list of [[oldVerified, laterUncertain], [laterUncertain, oldVerified]]) {
    const out = resumeFromReceipts(list, approved('transfer'), local);
    assert.equal(out.needsPerson, true);
    assert.equal(out.nextAction, null);
    assert.equal(out.reason, 'reconciliation_required');
  }
});

test('H6: se consulta el reloj antes de perform y al emitir el recibo', async () => {
  let now = 0;
  let calls = 0;
  let performed = false;
  const op = createOperation({ goal: 'pay', action: 'transfer', authority: grantSpend('USD', '3', 'A', '1970-01-01T00:00:01.000Z') });
  const out = await runOperation(op, {
    id: 'clock-test', required: () => { now = 2000; return { spend: [{ asset: 'USD', amount: '3', to: 'A' }] }; },
    perform: async () => { performed = true; return { ok: true, evidence: { txHash: 'x' } }; },
  }, { now: () => { calls += 1; return now; }, verify: proof, ask: noAsk });
  assert.equal(performed, false);
  assert.equal(out.status, 'needs_human_decision');
  assert.ok(calls >= 2);
  assert.equal(out.receipt.at, new Date(now).toISOString());
});

test('H7: recorrido público aceptado resuelve el estado de una delegación vencida', () => {
  const d = delegation.createDelegation({ task: 'task', medium: {}, delegate: 'worker', orchestrator: 'vespi', deadlineMs: 10, now: () => 100 });
  delegation.recordResult(d, { output: 'done', touched: [] });
  delegation.reviewDelegation(d, { reviewer: 'vespi', accept: true });
  delegation.integrateDelegation(d);
  assert.deepEqual(delegation.delegationStatus(d, 1000), { overdue: false, dueAt: 110 });
});

test('H8: recibos duplicados cuentan una vez y verified previo no consume intentos de la acción pendiente', () => {
  const failed = receipt('send', 'failed');
  const duplicate = resumeFromReceipts([failed, failed], { approved: [{ action: 'send', maxAttempts: 2 }] });
  assert.equal(duplicate.needsPerson, false);
  assert.equal(duplicate.nextAction.action, 'send');
  const completed = resumeFromReceipts([
    receipt('prior', 'verified'), receipt('send', 'failed'),
  ], { approved: [
    { action: 'prior', localReversible: true },
    { action: 'send', maxAttempts: 2 },
    { action: 'next' },
  ] }, local);
  assert.equal(completed.needsPerson, false);
  assert.equal(completed.nextAction.action, 'send');
});
