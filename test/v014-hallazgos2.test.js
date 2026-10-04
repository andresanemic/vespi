'use strict';

// Casos nuevos de regresión para la tercera vuelta de revisión.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { buildReceipt } = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');
const { createOperation, runOperation } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');

const proof = async () => ({ verified: true, checks: { ok: true }, reason: 'proof' });
const noAsk = async () => ({ approved: false });
const local = { verifyLocal: () => true };
const agreement = { approved: [{ action: 'transfer', localReversible: true }] };

function receipt(status, { at, exercised = [], action = 'transfer' } = {}) {
  return buildReceipt({
    operation: { id: `op-${status}-${String(at)}`, goal: 'goal', action },
    capabilityId: 'cap', authority: { spend: [] }, outcome: { status, exercised },
    verification: status === 'verified' ? { verified: true, checks: { ok: true } }
      : status === 'not_verified' ? { verified: false, checks: {} } : null,
    ...(at === undefined ? {} : { at }),
  });
}

function reseal(receiptValue) {
  const body = { ...receiptValue };
  delete body.digest;
  delete body.anchor;
  const canonicalize = (value) => Array.isArray(value) ? value.map(canonicalize)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])) : value;
  receiptValue.digest = createHash('sha256').update(JSON.stringify(canonicalize(body)), 'utf8').digest('hex');
  return receiptValue;
}

test('H9: verified sin tiempo estricto posterior conserva la incertidumbre en cualquier orden', () => {
  const cases = [null, 'fecha inválida', undefined, '2041-02-30T00:00:00.000Z'];
  for (const at of cases) {
    const uncertain = receipt('not_verified', { at: '2041-03-01T00:00:00.000Z', exercised: [{ asset: 'USD', amount: '3', to: 'A' }] });
    let verified;
    if (at === undefined) {
      verified = receipt('verified');
      delete verified.at;
      reseal(verified);
    } else {
      verified = receipt('verified', { at });
    }
    for (const list of [[uncertain, verified], [verified, uncertain]]) {
      const out = resumeFromReceipts(list, agreement, local);
      assert.equal(out.reason, 'reconciliation_required', `verified at=${String(at)}`);
      assert.equal(out.needsPerson, true);
    }
  }
  const malformedCalendar = receipt('verified', { at: '2041-02-30T00:00:00.000Z' });
  const uncertain = receipt('not_verified', { at: '2041-03-01T00:00:00.000Z', exercised: [{ asset: 'USD', amount: '3', to: 'A' }] });
  assert.equal(resumeFromReceipts([uncertain, malformedCalendar], agreement, local).reason, 'reconciliation_required');
});

test('H10: buildReceipt conserva exercised desconocido y continuidad pide revisión', () => {
  for (const exercised of [{ asset: 'USD', amount: '3', to: 'A' }, false, 0, {}]) {
    const r = receipt('not_verified', { exercised });
    const out = resumeFromReceipts([r], agreement, local);
    assert.equal(out.needsPerson, true, `exercised=${JSON.stringify(exercised)}`);
    assert.equal(out.nextAction, null);
    assert.equal(out.reason, 'reconciliation_required');
  }
  for (const exercised of [undefined, []]) {
    const r = receipt('not_verified', { exercised });
    assert.equal(resumeFromReceipts([r], agreement, local).needsPerson, false);
  }
});

test('H11: reloj no representable detiene perform y runOperation devuelve recibo', async () => {
  let performed = false;
  const op = createOperation({ goal: 'pay', action: 'transfer', authority: grantSpend('USD', '3', 'A') });
  const out = await runOperation(op, {
    id: 'clock-invalid', required: () => ({ spend: [{ asset: 'USD', amount: '3', to: 'A' }] }),
    perform: async () => { performed = true; return { ok: true, evidence: { txHash: 'x' } }; },
  }, { now: () => Number.MAX_VALUE, verify: proof, ask: noAsk });
  assert.equal(performed, false);
  assert.ok(out.receipt);
  assert.equal(out.status, 'failed');
});

async function keyFor(amount) {
  let key;
  const op = createOperation({ goal: 'pay', action: 'transfer', authority: grantSpend('USD', '10', 'A') });
  await runOperation(op, {
    id: 'amount-key', required: () => ({ spend: [{ asset: 'USD', amount, to: 'A' }] }),
    perform: async (ctx) => { key = ctx.idempotencyKey; return { ok: true, evidence: { txHash: 'x' } }; },
  }, { verify: proof, ask: noAsk });
  return key;
}

test('H12: amounts enteros equivalentes producen la misma clave idempotente', async () => {
  assert.equal(await keyFor('3'), await keyFor('03'));
});
