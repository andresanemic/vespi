'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOperation, runOperation } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');
const { createDelegation } = require('../src/delegation.js');

const REQUIREMENT = { asset: 'USD', amount: '3', to: 'DEST' };
const verifyOk = async () => ({ verified: true, checks: { ok: true }, reason: 'proof' });
const noAsk = async () => ({ approved: false });

function makeOperation(expiresAt) {
  return createOperation({ goal: 'test clock', authority: grantSpend('USD', '3', 'DEST', expiresAt) });
}

function capability(perform) {
  return {
    id: 'h5-cap',
    required: () => ({ spend: [{ ...REQUIREMENT }] }),
    perform,
  };
}

test('H5-A: sin reloj inyectado, el permiso se revalida con Date.now antes del efecto', async () => {
  const originalNow = Date.now;
  let now = 0;
  let performed = false;
  Date.now = () => now;
  try {
    const op = makeOperation(1000);
    queueMicrotask(() => { now = 2000; });
    const out = await runOperation(op, capability(async () => {
      performed = true;
      return { ok: true, evidence: { txHash: 'h5' } };
    }), { verify: verifyOk, ask: noAsk });

    assert.equal(performed, false, 'expired permission must stop before perform');
    assert.equal(out.status, 'needs_human_decision');
  } finally {
    Date.now = originalNow;
  }
});

test('H5-B: un reloj thenable posterior al efecto no deja rechazo sin manejar', async () => {
  let calls = 0;
  let performed = false;
  const unhandled = [];
  const capture = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', capture);
  try {
    const out = await runOperation(makeOperation(), capability(async () => {
      performed = true;
      return { ok: true, evidence: { txHash: 'h5' } };
    }), {
      now: () => {
        calls += 1;
        return calls <= 2 ? 0 : Promise.reject(new Error('async clock rejected'));
      },
      verify: verifyOk,
      ask: noAsk,
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(performed, true);
    assert.ok(out.receipt);
    assert.deepEqual(unhandled, [], 'a rejected async clock must be contained');
  } finally {
    process.removeListener('unhandledRejection', capture);
  }
});

test('H5-C: la delegación rechaza un dueAt fuera del contrato de tiempo', () => {
  assert.throws(() => createDelegation({
    task: 'boundary',
    medium: {},
    delegate: 'worker',
    orchestrator: 'vespi',
    deadlineMs: 1,
    now: () => 253402300799999,
  }), /dueAt.*(time|representable|contract)/i);
});
