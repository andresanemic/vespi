'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOperation, runOperation } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');
const { parseTime } = require('../src/time.js');

const REQ = { asset: 'USD', amount: '3', to: 'A' };
const verifyOk = async () => ({ verified: true, checks: { ok: true }, reason: 'proof' });
const noAsk = async () => ({ approved: false });

function makeOperation(authority = grantSpend('USD', '3', 'A')) {
  return createOperation({ goal: 'pay', action: 'transfer', authority });
}

function capability(perform) {
  return { id: 'h4-cap', required: () => ({ spend: [{ ...REQ }] }), perform };
}

test('H4-A: la vigencia se vuelve a comprobar dentro de la microtarea que ejecutaría perform', async () => {
  let now = 0;
  let performed = false;
  const op = makeOperation(grantSpend('USD', '3', 'A', 1000));
  const cap = capability(async () => {
    performed = true;
    return { ok: true, evidence: { txHash: 'x' } };
  });
  // This is queued before runOperation queues its deferred perform callback.
  queueMicrotask(() => { now = 2000; });

  const out = await runOperation(op, cap, { now: () => now, verify: verifyOk, ask: noAsk });

  assert.equal(performed, false, 'expired authority must stop before the effect');
  assert.equal(out.status, 'needs_human_decision');
});

test('H4-B: el parser limita el instante UTC resuelto al rango ISO de cuatro dígitos', () => {
  for (const value of [
    253402300800000,
    '9999-12-31T23:59:59-01:00',
    '0000-01-01T00:00:00+01:00',
  ]) {
    assert.equal(parseTime(value), null, `${String(value)} must be unparseable`);
  }
  assert.equal(parseTime(253402300799999), 253402300799999);
  assert.equal(parseTime('9999-12-31T23:59:59.999Z'), 253402300799999);
  assert.equal(parseTime('0000-01-01T00:00:00.000Z'), -62167219200000);
});

test('H4-C: un getter io.now que falla después del efecto no escapa sin recibo', async () => {
  let performed = false;
  const io = {
    get now() {
      if (performed) throw new Error('clock getter failed');
      return () => 0;
    },
    verify: verifyOk,
    ask: noAsk,
  };
  let result;
  let thrown;
  try {
    result = await runOperation(makeOperation(), capability(async () => {
      performed = true;
      return { ok: true, evidence: { txHash: 'x' } };
    }), io);
  } catch (error) {
    thrown = error;
  }

  assert.equal(performed, true);
  assert.equal(thrown, undefined, 'clock accessor errors after perform must be contained');
  assert.ok(result?.receipt, 'the completed operation must have a receipt');
});
