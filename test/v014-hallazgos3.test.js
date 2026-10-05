'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOperation, runOperation } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');
const { buildReceipt, verifyReceipt } = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');
const { createDelegation, delegationStatus } = require('../src/delegation.js');

const REQ = { asset: 'USD', amount: '3', to: 'A' };
const verifyOk = async () => ({ verified: true, checks: { ok: true }, reason: 'proof' });
const noAsk = async () => ({ approved: false });
const agreement = { approved: [{ action: 'transfer', localReversible: true }] };
const local = { verifyLocal: () => true };

function makeReceipt({ status = 'not_verified', exercised = [], at = '2041-01-01T00:00:00.000Z', evidence } = {}) {
  return buildReceipt({
    operation: { id: 'op-repro', goal: 'goal', action: 'transfer' }, capabilityId: 'cap',
    authority: { spend: [] }, outcome: { status, exercised }, evidence,
    verification: status === 'verified' ? { verified: true, checks: {}, reason: 'proof' } : { verified: false, checks: {} }, at,
  });
}

function makeOperation(authority = grantSpend('USD', '3', 'A')) {
  return createOperation({ goal: 'pay', action: 'transfer', authority });
}

function cap(perform) {
  return { id: 'repro-cap', required: () => ({ spend: [{ ...REQ }] }), perform };
}

test('H3-a: un reloj inválido al emitir nunca deja runOperation sin recibo', async (t) => {
  for (const invalid of [Symbol('bad clock'), Object.create(null)]) {
    await t.test(typeof invalid === 'symbol' ? 'Symbol después de perform' : 'objeto nulo después de perform', async () => {
      let calls = 0;
      let performed = false;
      let out;
      let thrown;
      try {
        out = await runOperation(makeOperation(), cap(async () => { performed = true; return { ok: true, evidence: { txHash: 'x' } }; }), {
          now: () => (++calls <= 2 ? 0 : invalid), verify: verifyOk, ask: noAsk,
        });
      } catch (error) { thrown = error; }
      assert.equal(thrown, undefined, 'receipt failure must not escape after perform');
      assert.equal(performed, true, 'the receipt-time read occurs after perform');
      assert.equal(out.status, 'verified');
      assert.ok(out?.receipt);
      assert.equal(verifyReceipt(out.receipt).ok, true);
      assert.match(out.receipt.detail || '', /clock|receipt|fallback/i);
    });
  }
});

test('H3-a2: un reloj no comprobable antes del efecto devuelve failed sin ejecutar perform', async (t) => {
  const invalidValues = [Symbol('clock'), Object.create(null), '2041-02-30T00:00:00Z', '2041-01-01T00:00:00', '+010000-01-01T00:00:00Z'];
  for (const invalid of invalidValues) {
    await t.test(typeof invalid === 'symbol' ? 'Symbol' : invalid && Object.getPrototypeOf(invalid) === null ? 'objeto con prototipo nulo' : String(invalid), async () => {
      let performed = false;
      const out = await runOperation(makeOperation(), cap(async () => { performed = true; return { ok: true, evidence: { txHash: 'x' } }; }), {
        now: () => invalid, verify: verifyOk, ask: noAsk,
      });
      assert.equal(performed, false);
      assert.equal(out.status, 'failed');
      assert.ok(out.receipt);
      assert.match(out.receipt.detail, /invalid|time|clock/i);
    });
  }
});

test('H3-b: exercised inválido o desconocido se señala y obliga a reconciliar', (t) => {
  for (const exercised of [[NaN], [''], [false], [0], [null], NaN]) {
    t.test(`marca ${String(exercised)}`, () => {
      const r = makeReceipt({ exercised });
      const roundTrip = JSON.parse(JSON.stringify(r));
      assert.deepEqual(roundTrip.authority.exercised, []);
      assert.equal(roundTrip.evidence.exercisedUnknown, true);
      const out = resumeFromReceipts([roundTrip], agreement, local);
      assert.equal(out.reason, 'reconciliation_required');
      assert.equal(out.nextAction, null);
    });
  }
  const clean = makeReceipt({ exercised: [] });
  assert.equal(clean.evidence?.exercisedUnknown, undefined);
  const mixed = makeReceipt({ exercised: [{ ...REQ }, null] });
  assert.deepEqual(mixed.authority.exercised, [{ asset: 'USD', maxAmount: '3', to: 'A' }]);
  assert.equal(mixed.evidence.exercisedUnknown, true);
});

test('H3-c: el parser común rechaza calendario imposible y hora sin zona', async (t) => {
  for (const now of ['2041-02-30T00:00:00Z', '2041-01-01T00:00:00']) {
    await t.test(now, async () => {
      let performed = false;
      const out = await runOperation(makeOperation(), cap(async () => { performed = true; return { ok: true, evidence: { txHash: 'x' } }; }), {
        now: () => now, verify: verifyOk, ask: noAsk,
      });
      assert.equal(performed, false, now);
      assert.equal(out.status, 'failed');
      assert.ok(out.receipt);
      assert.match(out.receipt.detail, /time|clock|invalid/i);
    });
  }
  const expiryOp = makeOperation(grantSpend('USD', '3', 'A', '2041-02-30T00:00:00Z'));
  const expiryOut = await runOperation(expiryOp, cap(async () => ({ ok: true, evidence: { txHash: 'x' } })), { now: () => 0, verify: verifyOk, ask: noAsk });
  assert.notEqual(expiryOut.status, 'verified');
});

test('H3-d: la vigencia se comprueba con la lectura inmediatamente anterior a perform', async () => {
  let nowCalls = 0;
  let performed = false;
  const capability = {
    id: 'advancing-clock',
    required: () => ({ spend: [{ ...REQ }] }),
    perform: async () => { performed = true; return { ok: true, evidence: { txHash: 'x' } }; },
  };
  const out = await runOperation(makeOperation(grantSpend('USD', '3', 'A', 1000)), capability, {
    now: () => (++nowCalls === 1 ? 0 : 2000), verify: verifyOk, ask: noAsk,
  });
  assert.equal(performed, false);
  assert.equal(out.status, 'needs_human_decision');
  assert.match(out.receipt.detail, /expired/i);
});

test('H3-e: exercised no copia objetos sensibles ni serializa referencias circulares o BigInt', (t) => {
  const secret = { secret: 'private-key', nested: { token: 'private-token' } };
  const circular = {}; circular.self = circular;
  for (const exercised of [secret, circular, 1n]) {
    t.test(typeof exercised === 'bigint' ? 'BigInt' : exercised === circular ? 'circular' : 'objeto sensible', () => {
      const r = makeReceipt({ exercised });
      assert.deepEqual(r.authority.exercised, []);
      assert.equal(r.evidence.exercisedUnknown, true);
      assert.equal(JSON.stringify(r).includes('private-key'), false);
    });
  }
});

test('H3-f: año fuera del contrato temporal no fecha operación ni resuelve recibo incierto', async () => {
  let performed = false;
  const out = await runOperation(makeOperation(), cap(async () => { performed = true; return { ok: true, evidence: { txHash: 'x' } }; }), {
    now: () => '+010000-01-01T00:00:00Z', verify: verifyOk, ask: noAsk,
  });
  assert.equal(performed, false);
  assert.equal(out.status, 'failed');

  const uncertain = makeReceipt({ at: '9999-12-31T23:59:59.999Z', exercised: [{ ...REQ }] });
  const later = makeReceipt({ status: 'verified', at: '+010000-01-01T00:00:00Z' });
  const resumed = resumeFromReceipts([uncertain, later], agreement, local);
  assert.equal(resumed.reason, 'reconciliation_required');
});

test('H3-g: una delegación rechaza dueAt no representable', () => {
  assert.throws(() => createDelegation({ task: 'x', medium: {}, delegate: 'worker', orchestrator: 'vespi', deadlineMs: Number.MAX_VALUE, now: () => Number.MAX_VALUE }), /representable|finite|deadline/i);
  const d = createDelegation({ task: 'x', medium: {}, delegate: 'worker', orchestrator: 'vespi', deadlineMs: 10, now: () => 100 });
  assert.deepEqual(delegationStatus(d, 105), { overdue: false, dueAt: 110 });
});
