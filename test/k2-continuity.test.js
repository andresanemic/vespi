'use strict';
// K2 de 0.1.8: continuidad sellada, autoridad que solo atenua e interposicion del permiso de
// efecto. Cada caso observa un contador de efectos o el estado del recibo, nunca la forma del
// objeto. El digest sin clave da integridad, no autoria: quien reescribe el checkpoint y su
// `expectedDigest` reescribe la prueba, y eso vive en el almacen del host.
const test = require('node:test');
const assert = require('node:assert');
const { createOperation, runOperation, checkpointOperation, restoreOperation, pauseOperation,
  resumeOperation } = require('../src/operation.js');
const { verifyReceipt, computeDigest, contextBinding } = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');
const { attenuates } = require('../src/authority.js');
const { createHostPort } = require('./helpers/host-port.js');

const GRANT = { asset: 'USDC', amount: '5', to: 'G1' };
const AUTH = { spend: [{ asset: 'USDC', maxAmount: '5', to: 'G1' }], pausers: ['owner'] };
const A = { manifestDigest: 'a'.repeat(64), scope: 'proyecto:demo/tarea:t1', sources: [{ ref: 'lore/principios.md', owner: 'andres', revision: 'r1', state: 'approved' }] };
const B = { ...A, manifestDigest: 'b'.repeat(64), sources: [{ ref: 'lore/principios.md', owner: 'andres', revision: 'r2', state: 'approved' }] };

function harness({ authority = AUTH, context = A, readContext = () => A, amount = '5' } = {}) {
  const calls = { perform: 0, readContext: 0, checkpoint: 0 };
  const cap = {
    id: 'cap',
    required: () => ({ spend: [{ ...GRANT, amount }] }),
    perform: async () => { calls.perform += 1; return { ok: true, evidence: { txHash: 'h' } }; },
  };
  const io = {
    verify: async () => ({ verified: true, checks: { mock: true }, reason: 'mock ok' }),
    readContext: async () => { calls.readContext += 1; return readContext(); },
  };
  const op = createOperation({ goal: 'pay', action: 'pay', authority, ...(context ? { context } : {}) });
  return { op, cap, io, calls };
}

// Un checkpoint que se abre mal no devuelve operacion: el efecto queda en cero por construccion.
function restoredOrNull(checkpoint, options) {
  try {
    return restoreOperation(checkpoint, options);
  } catch {
    return null;
  }
}

test('K2-01: un checkpoint editado sin resellar se rechaza por digest y no ejecuta', async () => {
  const { op, cap, io, calls } = harness();
  const checkpoint = checkpointOperation(op);
  const edited = JSON.parse(JSON.stringify(checkpoint));
  edited.context = B;
  assert.throws(() => restoreOperation(edited, { expectedDigest: checkpoint.digest }), /checkpoint_digest_mismatch/);
  const restored = restoredOrNull(edited, { expectedDigest: checkpoint.digest });
  if (restored) await runOperation(restored, cap, io);
  assert.strictEqual(calls.perform, 0);
});

test('K2-02: un checkpoint resellado se rechaza porque el host conserva otro expectedDigest', async () => {
  const { op, cap, io, calls } = harness();
  const checkpoint = checkpointOperation(op);
  const edited = JSON.parse(JSON.stringify(checkpoint));
  edited.context = B;
  edited.digest = computeDigest(edited);
  assert.throws(() => restoreOperation(edited, { expectedDigest: checkpoint.digest }), /checkpoint_expected_digest_mismatch/);
  const restored = restoredOrNull(edited, { expectedDigest: checkpoint.digest });
  if (restored) await runOperation(restored, cap, io);
  assert.strictEqual(calls.perform, 0);
});

test('K2-03: al reabrir, la autoridad solo puede atenuarse; ensancharla no ejecuta', async () => {
  const scoped = {
    spend: [{ asset: 'USDC', maxAmount: '5', to: 'G1', network: 'stellar:testnet', resource: 'https://example.test/pay', expiresAt: '2030-01-01T00:00:00.000Z' }],
    pausers: ['owner'],
  };
  const requirement = { asset: 'USDC', amount: '5', to: 'G1', network: 'stellar:testnet', resource: 'https://example.test/pay' };
  const widened = [
    { spend: [{ ...scoped.spend[0], maxAmount: '6' }], pausers: ['owner'] },
    { spend: [{ ...scoped.spend[0], to: 'G2' }], pausers: ['owner'] },
    { spend: [{ asset: 'USDC', maxAmount: '5', to: 'G1', expiresAt: '2030-01-01T00:00:00.000Z' }], pausers: ['owner'] },
    { spend: [{ ...scoped.spend[0], expiresAt: '2031-01-01T00:00:00.000Z' }], pausers: ['owner'] },
    { spend: [{ ...scoped.spend[0] }], pausers: ['owner', 'other'] },
  ];
  for (const authority of widened) {
    const { op } = harness({ authority: scoped });
    const checkpoint = checkpointOperation(op);
    assert.strictEqual(attenuates(authority, checkpoint.authority), false);
    assert.throws(() => restoreOperation(checkpoint, { expectedDigest: checkpoint.digest, authority }), /authority_widened/);
  }
  const { op, cap, io, calls } = harness({ authority: scoped });
  cap.required = () => ({ spend: [requirement] });
  const checkpoint = checkpointOperation(op);
  const restored = restoreOperation(checkpoint, { expectedDigest: checkpoint.digest, authority: JSON.parse(JSON.stringify(scoped)) });
  const out = await runOperation(restored, cap, io);
  assert.strictEqual(calls.perform, 1);
  assert.strictEqual(out.receipt.status, 'verified');
});

test('K2-04: tras pausar y reabrir, un contexto distinto bloquea y el recibo conserva A', async () => {
  const { op, cap, io, calls } = harness({ readContext: () => B });
  pauseOperation(op, 'owner');
  const checkpoint = checkpointOperation(op);
  const restored = restoreOperation(checkpoint, { expectedDigest: checkpoint.digest });
  resumeOperation(restored, 'owner');
  const out = await runOperation(restored, cap, io);
  assert.strictEqual(calls.perform, 0);
  assert.strictEqual(out.status, 'blocked');
  assert.match(out.receipt.detail || '', /context requires revalidation/);
  assert.deepStrictEqual(out.receipt.context, A);
});

test('K2-05: el control con A ejecuta una vez y conserva id e idempotencyKey', async () => {
  const twin = harness();
  let keyBefore = null;
  twin.cap.perform = async ({ idempotencyKey }) => {
    keyBefore = idempotencyKey;
    twin.calls.perform += 1;
    return { ok: true, evidence: { txHash: 'h' } };
  };
  await runOperation(twin.op, twin.cap, twin.io);

  const { op, cap, io, calls } = harness();
  pauseOperation(op, 'owner');
  const idBefore = op.id;
  const checkpoint = checkpointOperation(op);
  const restored = restoreOperation(checkpoint, { expectedDigest: checkpoint.digest });
  assert.strictEqual(restored.id, idBefore);
  resumeOperation(restored, 'owner');
  let keyAfter = null;
  cap.perform = async ({ idempotencyKey }) => {
    keyAfter = idempotencyKey;
    calls.perform += 1;
    return { ok: true, evidence: { txHash: 'h' } };
  };
  const out = await runOperation(restored, cap, io);
  assert.strictEqual(calls.perform, 1);
  assert.strictEqual(out.status, 'verified');
  assert.strictEqual(keyAfter, keyBefore);
  assert.strictEqual(verifyReceipt(out.receipt).ok, true);
});

test('K2-06: un checkpoint de intencion se restaura incierto y no repite el efecto', async () => {
  const { op, cap, io, calls } = harness();
  let intent = null;
  io.checkpoint = async (snapshot) => { intent = JSON.parse(JSON.stringify(snapshot)); };
  await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 1);
  assert.strictEqual(intent.effect.phase, 'intent');
  const restored = restoreOperation(intent, { expectedDigest: intent.digest });
  assert.strictEqual(restored.state, 'not_verified');
  assert.strictEqual(restored.receipt.status, 'not_verified');
  assert.strictEqual(restored.receipt.evidence.exercisedUnknown, true);
  const resumed = resumeFromReceipts([restored.receipt], { approved: [{ action: 'pay' }] });
  assert.strictEqual(resumed.reason, 'reconciliation_required');
  await runOperation(restored, cap, io);
  assert.strictEqual(calls.perform, 1);
});

test('K2-07: un recibo not_verified no reejecuta aunque se fuerce el estado de la operacion', async () => {
  const { op, cap, io, calls } = harness();
  io.performTimeoutMs = 10;
  cap.perform = async () => { calls.perform += 1; return new Promise(() => {}); };
  const first = await runOperation(op, cap, io);
  assert.strictEqual(first.receipt.status, 'not_verified');
  op.state = 'needs_human_decision';
  const second = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 1);
  assert.strictEqual(second.receipt.status, 'blocked');
  assert.match(second.receipt.detail || '', /reconciliation_required/);
});

test('K2-08: un checkpoint con contexto invalido se rechaza y no ejecuta', async () => {
  const { op, cap, io, calls } = harness();
  const checkpoint = checkpointOperation(op);
  const invalid = [
    { ...A, sources: [] },
    { ...A, sources: [{ ...A.sources[0], revision: undefined }] },
    { ...A, sources: [{ ...A.sources[0], state: 'proposal' }] },
  ];
  for (const context of invalid) {
    const edited = JSON.parse(JSON.stringify(checkpoint));
    edited.context = JSON.parse(JSON.stringify(context));
    edited.digest = computeDigest(edited);
    assert.throws(() => restoreOperation(edited, { expectedDigest: edited.digest }), /checkpoint/);
    const restored = restoredOrNull(edited, { expectedDigest: edited.digest });
    if (restored) await runOperation(restored, cap, io);
  }
  assert.strictEqual(calls.perform, 0);
});

test('K2-09: accesores y trampas no se ejecutan al reabrir un checkpoint', () => {
  const { op } = harness();
  const base = checkpointOperation(op);
  let reads = 0;
  const getter = { get() { reads += 1; throw new Error('must not execute'); }, enumerable: true, configurable: true };

  const onState = JSON.parse(JSON.stringify(base));
  Object.defineProperty(onState.operation, 'state', getter);
  assert.throws(() => restoreOperation(onState, { expectedDigest: base.digest }), /checkpoint/);

  const onAmount = JSON.parse(JSON.stringify(base));
  Object.defineProperty(onAmount.authority.spend[0], 'maxAmount', getter);
  assert.throws(() => restoreOperation(onAmount, { expectedDigest: base.digest }), /checkpoint/);

  const onSource = JSON.parse(JSON.stringify(base));
  Object.defineProperty(onSource.context.sources, '0', getter);
  assert.throws(() => restoreOperation(onSource, { expectedDigest: base.digest }), /checkpoint/);

  const onDigest = JSON.parse(JSON.stringify(base));
  Object.defineProperty(onDigest, 'digest', getter);
  assert.throws(() => restoreOperation(onDigest, { expectedDigest: base.digest }), /checkpoint/);

  const proxy = new Proxy({}, {
    getPrototypeOf() { throw new Error('trap'); },
    ownKeys() { throw new Error('trap'); },
    getOwnPropertyDescriptor() { throw new Error('trap'); },
  });
  assert.throws(() => restoreOperation(proxy, { expectedDigest: base.digest }), /checkpoint/);
  assert.strictEqual(reads, 0);
});

test('K2-10: claves extra, simbolos, prototipo ajeno y __proto__ propia se rechazan', () => {
  const { op } = harness();
  const base = checkpointOperation(op);
  const variants = [
    (copy) => { copy.extra = 1; },
    (copy) => { copy[Symbol('extra')] = 1; },
    (copy) => Object.setPrototypeOf(copy, { inherited: true }),
    (copy) => Object.defineProperty(copy, '__proto__', { value: { inherited: true }, enumerable: true, configurable: true }),
  ];
  for (const mutate of variants) {
    const copy = JSON.parse(JSON.stringify(base));
    mutate(copy);
    copy.digest = computeDigest(copy);
    assert.throws(() => restoreOperation(copy, { expectedDigest: copy.digest }), /checkpoint/);
  }
});

test('K2-11: un checkpoint unbound no acepta contexto nuevo y no lee ninguno', async () => {
  const { op, cap, io, calls } = harness({ context: null });
  const checkpoint = checkpointOperation(op);
  assert.strictEqual(checkpoint.binding, 'unbound');
  assert.throws(() => restoreOperation(checkpoint, { expectedDigest: checkpoint.digest, context: A }), /unbound|context/);
  const restored = restoreOperation(checkpoint, { expectedDigest: checkpoint.digest });
  const out = await runOperation(restored, cap, io);
  assert.strictEqual(calls.readContext, 0);
  assert.strictEqual(Object.hasOwn(out.receipt, 'context'), false);
});

test('K2-12: un recibo 0.1.7 pasa sin cambiar bytes ni digest y es unbound', async () => {
  const { op, cap, io } = harness({ context: null });
  const out = await runOperation(op, cap, io);
  const receipt = out.receipt;
  const bytes = JSON.stringify(receipt);
  const digest = receipt.digest;
  assert.strictEqual(verifyReceipt(receipt).ok, true);
  resumeFromReceipts([receipt], { approved: [{ action: 'pay' }] });
  assert.strictEqual(JSON.stringify(receipt), bytes);
  assert.strictEqual(receipt.digest, digest);
  assert.strictEqual(contextBinding(receipt), 'unbound');
});

test('K2-13: un recibo con contexto alterado sin resellar es invalid', async () => {
  const { op, cap, io } = harness();
  const out = await runOperation(op, cap, io);
  assert.strictEqual(contextBinding(out.receipt), 'sealed');
  const altered = JSON.parse(JSON.stringify(out.receipt));
  altered.context.sources[0].owner = 'other';
  assert.strictEqual(contextBinding(altered), 'invalid');
});

test('K2-14: una operacion sin contexto conserva claves, ask y recibo de 0.1.7', async () => {
  const { op, io } = harness({ context: null, authority: { spend: [] } });
  const keys = ['id', 'goal', 'action', 'authority', 'agent', 'exit', 'state', 'history', 'receipt', 'output', 'inFlight'];
  assert.deepStrictEqual(Object.keys(op), keys);
  let seen = null;
  io.ask = async (payload) => { seen = payload; return { approved: true, by: 'owner' }; };
  const cap = { id: 'cap', required: () => ({ spend: [GRANT] }), perform: async () => ({ ok: true, evidence: { txHash: 'h' } }) };
  const out = await runOperation(op, cap, io);
  assert.strictEqual(Array.isArray(seen), true);
  assert.strictEqual(Object.hasOwn(seen, 'approvalRequest'), false);
  assert.strictEqual(Object.hasOwn(seen, 'context'), false);
  assert.strictEqual(Object.hasOwn(out.receipt, 'context'), false);
  assert.strictEqual(Object.hasOwn(op, 'generation'), false);
});

test('K2-15: una aprobacion de la generacion 1 no autoriza la generacion 2', async () => {
  const first = harness({ authority: { spend: [] } });
  first.io.askTimeoutMs = 10;
  let request1 = null;
  first.io.ask = async (payload) => { request1 = payload.approvalRequest.digest; return new Promise(() => {}); };
  const stale = await runOperation(first.op, first.cap, first.io);
  assert.strictEqual(stale.receipt.status, 'needs_human_decision');
  first.io.ask = async () => ({ approved: true, by: 'owner', request: request1 });
  const out = await runOperation(first.op, first.cap, first.io);
  assert.strictEqual(first.calls.perform, 0);
  assert.strictEqual(out.receipt.status, 'needs_human_decision');
  assert.match(out.receipt.detail || '', /stale approval/);

  const control = harness({ authority: { spend: [] } });
  control.io.ask = async (payload) => ({ approved: true, by: 'owner', request: payload.approvalRequest.digest });
  const ok = await runOperation(control.op, control.cap, control.io);
  assert.strictEqual(control.calls.perform, 1);
  assert.strictEqual(ok.receipt.status, 'verified');
});

test('K2-16: si cambian los requisitos, el eco anterior no autoriza el nuevo intento', async () => {
  let amount = '5';
  const { op, cap, io, calls } = harness({ authority: { spend: [] }, amount });
  cap.required = () => ({ spend: [{ ...GRANT, amount }] });
  let request1 = null;
  io.ask = async (payload) => { request1 = payload.approvalRequest.digest; return { approved: false }; };
  await runOperation(op, cap, io);
  amount = '6';
  io.ask = async () => ({ approved: true, by: 'owner', request: request1 });
  const out = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 0);
  assert.strictEqual(out.receipt.status, 'needs_human_decision');
  assert.match(out.receipt.detail || '', /stale approval/);
});

test('K2-17: una aprobacion que llega tarde no cuenta tras pausar y reanudar con otro pauser', async () => {
  const { op, cap, io, calls } = harness({ authority: { spend: [], pausers: ['owner', 'other'] } });
  io.askTimeoutMs = 10;
  let late = null;
  io.ask = async (payload) => { late = payload.approvalRequest.digest; return new Promise(() => {}); };
  await runOperation(op, cap, io);
  pauseOperation(op, 'owner');
  io.ask = async () => ({ approved: true, by: 'owner', request: late });
  resumeOperation(op, 'other');
  const out = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 0);
  assert.strictEqual(out.receipt.status, 'needs_human_decision');
  assert.strictEqual(verifyReceipt(out.receipt).ok, true);
});

test('K2-18: el permiso de efecto se revoca al terminar y el puerto rechaza el uso tardio', async () => {
  const { op, cap, io, calls } = harness();
  const port = createHostPort();
  let saved = null;
  cap.perform = async (ctx) => { calls.perform += 1; saved = ctx; return { ok: true, evidence: { txHash: 'h' } }; };
  const out = await runOperation(op, cap, io);
  assert.strictEqual(out.status, 'verified');
  await assert.rejects(() => port(saved), /abort/i);
  assert.strictEqual(port.calls.length, 1);
});

test('K2-19: el vencimiento de perform revoca el permiso y el recibo queda not_verified', async () => {
  const { op, cap, io } = harness();
  const port = createHostPort();
  let saved = null;
  io.performTimeoutMs = 10;
  cap.perform = async (ctx) => { saved = ctx; return new Promise(() => {}); };
  const out = await runOperation(op, cap, io);
  assert.strictEqual(out.receipt.status, 'not_verified');
  await assert.rejects(() => port(saved), /abort/i);
  assert.strictEqual(port.calls.length, 1);
});

test('K2-20: un checkpoint que falla o vence bloquea antes de leer contexto o ejecutar', async () => {
  for (const failing of [
    { checkpoint: async () => { throw new Error('disk full'); } },
    { checkpoint: () => new Promise(() => {}), checkpointTimeoutMs: 10 },
  ]) {
    const { op, cap, io, calls } = harness();
    Object.assign(io, failing);
    const out = await runOperation(op, cap, io);
    assert.strictEqual(out.status, 'blocked');
    assert.strictEqual(calls.readContext, 0);
    assert.strictEqual(calls.perform, 0);
  }
});

test('K2-21: el orden observado es ask, checkpoint, readContext, now, perform', async () => {
  const { op, cap, io } = harness({ authority: { spend: [] } });
  const events = [];
  io.ask = async (payload) => { events.push('ask'); return { approved: true, by: 'owner', request: payload.approvalRequest.digest }; };
  io.checkpoint = async () => { events.push('checkpoint'); };
  io.readContext = async () => { events.push('readContext'); return A; };
  io.now = () => { events.push('now'); return Date.parse('2026-10-21T00:00:00.000Z'); };
  cap.perform = async () => { events.push('perform'); return { ok: true, evidence: { txHash: 'h' } }; };
  const out = await runOperation(op, cap, io);
  assert.strictEqual(out.status, 'verified');
  const at = (name) => events.indexOf(name);
  assert.ok(at('ask') < at('checkpoint'));
  assert.ok(at('checkpoint') < at('readContext'));
  const performAt = at('perform');
  const beforePerform = events.slice(0, performAt);
  assert.ok(at('readContext') < beforePerform.lastIndexOf('now'));
  assert.deepStrictEqual(events.slice(at('readContext'), performAt + 1), ['readContext', 'now', 'perform']);
});

test('K2-22: si el contexto cambia durante el await del checkpoint, no se ejecuta', async () => {
  let current = A;
  const { op, cap, io, calls } = harness({ readContext: () => current });
  io.checkpoint = async () => { await Promise.resolve(); current = B; };
  const out = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 0);
  assert.strictEqual(out.status, 'blocked');
  assert.deepStrictEqual(out.receipt.context, A);
});

// Segunda ronda del revisor: lo que sigue fija R1-R4, R7 y R8.

test('K2-23: un checkpoint terminal sin recibo se reabre bloqueado y no repite el efecto', async () => {
  for (const mode of ['verified', 'not_verified', 'blocked']) {
    const { op, cap, io, calls } = harness();
    if (mode !== 'verified') {
      io.performTimeoutMs = 10;
      cap.perform = async () => { calls.perform += 1; return new Promise(() => {}); };
    }
    await runOperation(op, cap, io);
    if (mode === 'blocked') {
      op.state = 'needs_human_decision';
      await runOperation(op, cap, io);
    }
    assert.strictEqual(op.state, mode);
    const checkpoint = checkpointOperation(op);
    const restored = restoreOperation(checkpoint, { expectedDigest: checkpoint.digest });
    assert.strictEqual(restored.state, 'blocked', mode);
    assert.strictEqual(restored.receipt.evidence.exercisedUnknown, true, mode);
    cap.perform = async () => { calls.perform += 1; return { ok: true, evidence: { txHash: 'h' } }; };
    const out = await runOperation(restored, cap, io);
    assert.strictEqual(calls.perform, 1, mode);
    assert.strictEqual(out.receipt.status, 'blocked', mode);
    assert.match(out.receipt.detail || '', /reconciliation_required/, mode);
  }
});

test('K2-24: el bloqueo por recibo incierto conserva la marca y no reejecuta', async () => {
  const { op, cap, io, calls } = harness();
  io.performTimeoutMs = 10;
  cap.perform = async () => { calls.perform += 1; return new Promise(() => {}); };
  await runOperation(op, cap, io);
  op.state = 'needs_human_decision';
  const second = await runOperation(op, cap, io);
  assert.strictEqual(second.receipt.status, 'blocked');
  assert.strictEqual(second.receipt.evidence.exercisedUnknown, true);
  op.state = 'needs_human_decision';
  cap.perform = async () => { calls.perform += 1; return { ok: true, evidence: { txHash: 'h' } }; };
  const third = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 1);
  assert.strictEqual(third.receipt.status, 'blocked');
  assert.strictEqual(third.receipt.evidence.exercisedUnknown, true);
});

test('K2-25: spend vacio o pausers vacio se checkpointea y se reabre', async () => {
  const authorities = [
    { spend: [] },
    { spend: [], pausers: ['owner'] },
    { spend: [{ asset: 'USDC', maxAmount: '5', to: 'G1' }], pausers: [] },
  ];
  for (const authority of authorities) {
    const { op, cap, io, calls } = harness({ authority });
    const checkpoint = checkpointOperation(op);
    const restored = restoreOperation(checkpoint, { expectedDigest: checkpoint.digest });
    assert.deepStrictEqual(restored.authority, authority);
    await runOperation(restored, cap, io);
    if (authority.spend.length === 0) assert.strictEqual(calls.perform, 0);
  }
});

test('K2-26: el host rechaza un checkpoint anterior a la ultima generacion', async () => {
  const { op, cap, io, calls } = harness({ authority: { spend: [{ asset: 'EUR', maxAmount: '1', to: 'X' }], pausers: ['owner'] } });
  const checkpoint = checkpointOperation(op);
  io.askTimeoutMs = 10;
  let late = null;
  io.ask = async (payload) => { late = payload.approvalRequest; return new Promise(() => {}); };
  await runOperation(op, cap, io);
  assert.strictEqual(late.generation, 1);
  assert.throws(() => restoreOperation(checkpoint, { expectedDigest: checkpoint.digest, minGeneration: 1 }),
    /checkpoint_generation_stale/);
  const current = checkpointOperation(op);
  const restored = restoreOperation(current, { expectedDigest: current.digest, minGeneration: 1 });
  assert.strictEqual(restored.generation, 1);
  io.ask = async () => ({ approved: true, by: 'owner', request: late.digest });
  const out = await runOperation(restored, cap, io);
  assert.strictEqual(calls.perform, 0);
  assert.match(out.receipt.detail || '', /stale approval/);
});

test('K2-27: bajar signers.required al reabrir ensancha y no ejecuta', async () => {
  const sealed = { ...AUTH, signers: { required: 2, allowed: ['ana', 'bea'] } };
  const { op, cap, io, calls } = harness({ authority: sealed });
  const checkpoint = checkpointOperation(op);
  const weakened = { spend: AUTH.spend.map((grant) => ({ ...grant })), pausers: ['owner'],
    signers: { required: 1, allowed: ['ana', 'bea'] } };
  assert.throws(() => restoreOperation(checkpoint, { expectedDigest: checkpoint.digest, authority: weakened }),
    /authority_widened/);
  await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 0);
});

test('K2-28: ampliar signers.allowed al reabrir ensancha y no ejecuta', async () => {
  const sealed = { ...AUTH, signers: { required: 2, allowed: ['ana', 'bea'] } };
  const { op, cap, io, calls } = harness({ authority: sealed });
  const checkpoint = checkpointOperation(op);
  const widened = { spend: AUTH.spend.map((grant) => ({ ...grant })), pausers: ['owner'],
    signers: { required: 2, allowed: ['ana', 'bea', 'eve'] } };
  assert.throws(() => restoreOperation(checkpoint, { expectedDigest: checkpoint.digest, authority: widened }),
    /authority_widened/);
  await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 0);
});

test('K2-29: un checkpoint running sin effect se restaura incierto y no reejecuta', async () => {
  const { op, cap, io, calls } = harness();
  let during = null;
  cap.perform = async () => {
    calls.perform += 1;
    during = checkpointOperation(op);
    return { ok: true, evidence: { txHash: 'h' } };
  };
  await runOperation(op, cap, io);
  assert.strictEqual(during.operation.state, 'running');
  assert.strictEqual(Object.hasOwn(during, 'effect'), false);
  const restored = restoreOperation(during, { expectedDigest: during.digest });
  assert.strictEqual(restored.state, 'not_verified');
  assert.strictEqual(restored.receipt.evidence.exercisedUnknown, true);
  await runOperation(restored, cap, io);
  assert.strictEqual(calls.perform, 1);
});

test('K2-30: la clave de la intencion es la misma que perform recibe', async () => {
  const { op, cap, io } = harness();
  let intent = null;
  let used = null;
  io.checkpoint = async (snapshot) => { intent = JSON.parse(JSON.stringify(snapshot)); };
  cap.perform = async ({ idempotencyKey }) => { used = idempotencyKey; return { ok: true, evidence: { txHash: 'h' } }; };
  await runOperation(op, cap, io);
  assert.match(used, /^[0-9a-f]{64}$/);
  assert.strictEqual(intent.effect.idempotencyKey, used);
});

test('K2-31: una operacion sin contexto restaurada no gana la clave generation', async () => {
  const { op } = harness({ context: null });
  assert.strictEqual(Object.hasOwn(op, 'generation'), false);
  const checkpoint = checkpointOperation(op);
  const restored = restoreOperation(checkpoint, { expectedDigest: checkpoint.digest });
  assert.strictEqual(Object.hasOwn(restored, 'generation'), false);
  assert.deepStrictEqual(Object.keys(restored), Object.keys(op));
});

test('K2-32: generation del checkpoint debe ser entero seguro no negativo', () => {
  const { op } = harness();
  const base = checkpointOperation(op);
  for (const generation of [Number.MAX_SAFE_INTEGER + 1, -1, 1.5, '1']) {
    const invalid = JSON.parse(JSON.stringify(base));
    invalid.operation.generation = generation;
    invalid.digest = computeDigest(invalid);
    assert.throws(() => restoreOperation(invalid, { expectedDigest: invalid.digest }), /checkpoint_invalid/);
  }
});

test('K2-33: minGeneration debe ser entero seguro no negativo', () => {
  const { op } = harness();
  const checkpoint = checkpointOperation(op);
  for (const minGeneration of [Number.MAX_SAFE_INTEGER + 1, -1, 1.5, '0']) {
    assert.throws(() => restoreOperation(checkpoint, { expectedDigest: checkpoint.digest, minGeneration }), /checkpoint_invalid/);
  }
});

test('K2-34: agotar generation bloquea el ask y no ejecuta', async () => {
  const { op, cap, io, calls } = harness({ authority: { spend: [{ asset: 'USDC', maxAmount: '1', to: 'G1' }] } });
  op.generation = Number.MAX_SAFE_INTEGER;
  let asks = 0;
  io.ask = async () => { asks += 1; return { approved: true, by: 'owner' }; };
  const out = await runOperation(op, cap, io);
  assert.strictEqual(out.status, 'blocked');
  assert.strictEqual(op.state, 'blocked');
  assert.strictEqual(op.generation, Number.MAX_SAFE_INTEGER);
  assert.strictEqual(asks, 0);
  assert.strictEqual(calls.perform, 0);
});

test('K2-35: una aprobación con contexto exige el eco vigente', async () => {
  for (const answer of [
    () => ({ approved: true, by: 'owner' }),
    () => ({ approved: true, by: 'owner', request: 'f'.repeat(64) }),
    () => 'approved',
  ]) {
    const { op, cap, io, calls } = harness({ authority: { spend: [] } });
    io.ask = async () => answer();
    const out = await runOperation(op, cap, io);
    assert.strictEqual(out.status, 'needs_human_decision');
    assert.match(out.receipt.detail || '', /stale approval/);
    assert.strictEqual(calls.perform, 0);
  }
  const multi = harness({ authority: { spend: [], signers: { required: 1, allowed: ['owner'] } } });
  multi.io.ask = async () => ['owner'];
  const multiOut = await runOperation(multi.op, multi.cap, multi.io);
  assert.strictEqual(multiOut.status, 'needs_human_decision');
  assert.match(multiOut.receipt.detail || '', /stale approval/);
  assert.strictEqual(multi.calls.perform, 0);
});

test('K2-36: el eco correcto permite aprobación con contexto y sin contexto conserva el ask legado', async () => {
  const contextual = harness({ authority: { spend: [] } });
  contextual.io.ask = async (payload) => ({ approved: true, by: 'owner', request: payload.approvalRequest.digest });
  const approved = await runOperation(contextual.op, contextual.cap, contextual.io);
  assert.strictEqual(approved.status, 'verified');
  assert.strictEqual(contextual.calls.perform, 1);

  const legacy = harness({ authority: { spend: [] }, context: null });
  let payload;
  legacy.io.ask = async (seen) => { payload = seen; return { approved: true, by: 'owner' }; };
  const unchanged = await runOperation(legacy.op, legacy.cap, legacy.io);
  assert.strictEqual(unchanged.status, 'verified');
  assert.strictEqual(Array.isArray(payload), true);
  assert.strictEqual(Object.hasOwn(payload, 'approvalRequest'), false);
  assert.strictEqual(JSON.stringify(payload), JSON.stringify(Object.assign([{ asset: 'USDC', amount: '5', to: 'G1' }], {
    requirements: [{ asset: 'USDC', amount: '5', to: 'G1' }], cost: [{ asset: 'USDC', amount: '5', to: 'G1' }],
    publicByDefault: false, exit: 'return to the person: change the agreement or cancel',
  })));
});

test('K2-37: los callbacks io no reciben receptor y sobreviven a mutaciones de funciones', async () => {
  const { op, cap, io, calls } = harness({ authority: { spend: [] } });
  const seen = [];
  const originalApply = Object.getOwnPropertyDescriptor(Function.prototype, 'apply');
  io.ask = function (payload) {
    seen.push(this);
    Object.defineProperty(Function.prototype, 'apply', { ...originalApply, value() { throw new Error('poisoned apply'); } });
    try { return { approved: true, by: 'owner', request: payload.approvalRequest.digest }; }
    finally { Object.defineProperty(Function.prototype, 'apply', originalApply); }
  };
  io.decide = function () { seen.push(this); return null; };
  io.checkpoint = function () { seen.push(this); };
  io.readContext = function () { seen.push(this); return A; };
  io.now = function () { seen.push(this); return Date.parse('2026-10-21T00:00:00Z'); };
  io.verify = function () { seen.push(this); return { verified: true, checks: { mock: true }, reason: 'mock ok' }; };
  const out = await runOperation(op, cap, io);
  assert.strictEqual(out.status, 'verified');
  assert.strictEqual(calls.perform, 1);
  assert.ok(seen.length >= 5);
  assert.ok(seen.every((receiver) => receiver === undefined));
});

test('K2-38: ask no puede reescribir el digest privado del eco', async () => {
  const { op, cap, io, calls } = harness({ authority: { spend: [] } });
  let verifies = 0;
  io.verify = async () => { verifies++; return { verified: true, checks: {}, reason: 'ok' }; };
  io.ask = payload => {
    try { payload.approvalRequest.digest = 'f'.repeat(64); } catch {}
    return { approved: true, by: 'owner', request: 'f'.repeat(64) };
  };
  const out = await runOperation(op, cap, io);
  assert.equal(out.status, 'needs_human_decision');
  assert.equal(calls.perform, 0);
  assert.equal(verifies, 0);
  assert.equal(verifyReceipt(out.receipt).ok, true);
});

test('K2-39: Reflect.apply resuelto tras ask no altera las llamadas internas', async () => {
  const original = Reflect.apply;
  const { op, cap, io, calls } = harness({ authority: { spend: [] } });
  io.ask = payload => {
    Reflect.apply = () => { throw new Error('late apply'); };
    return { approved: true, by: 'owner', request: payload.approvalRequest.digest };
  };
  try {
    const out = await runOperation(op, cap, io);
    assert.equal(out.status, 'verified');
    assert.equal(calls.perform, 1);
    assert.equal(verifyReceipt(out.receipt).ok, true);
  } finally { Reflect.apply = original; }
});

test('K2-40: JSON.stringify y Promise.prototype.then capturados sobreviven al checkpoint', async () => {
  const originalStringify = JSON.stringify;
  const originalResolve = Promise.resolve;
  const originalRace = Promise.race;
  const originalThen = Promise.prototype.then;
  const originalFinally = Promise.prototype.finally;
  const results = [];
  for (const poison of ['stringify', 'then', 'resolve', 'race', 'finally']) {
    const { op, cap, io, calls } = harness();
    let verifies = 0;
    io.verify = async () => { verifies++; return { verified: true, checks: {}, reason: 'ok' }; };
    io.readContext = () => B;
    io.checkpoint = () => {
      if (poison === 'stringify') JSON.stringify = () => originalStringify(A);
      else if (poison === 'then') Promise.prototype.then = () => { throw new Error('poisoned then'); };
      else if (poison === 'resolve') Promise.resolve = () => { throw new Error('poisoned resolve'); };
      else if (poison === 'race') Promise.race = () => { throw new Error('poisoned race'); };
      else Promise.prototype.finally = () => { throw new Error('poisoned finally'); };
    };
    try {
      const out = await runOperation(op, cap, io);
      results.push([poison, out.status, calls.perform, verifies, verifyReceipt(out.receipt).ok]);
    } finally { JSON.stringify = originalStringify; Promise.prototype.then = originalThen; Promise.resolve = originalResolve; Promise.race = originalRace; Promise.prototype.finally = originalFinally; }
  }
  assert.deepEqual(results, ['stringify', 'then', 'resolve', 'race', 'finally'].map(poison => [poison, 'blocked', 0, 0, true]));
});

test('K2-41: contexto síncrono distinto tras contaminar Object.prototype.then bloquea', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
  const { op, cap, io, calls } = harness();
  let verifies = 0;
  io.verify = async () => { verifies++; return { verified: true, checks: {}, reason: 'ok' }; };
  io.readContext = () => B;
  io.checkpoint = () => { Object.defineProperty(Object.prototype, 'then', { configurable: true, value: function (resolve) {
    delete Object.prototype.then;
    if (this && this.manifestDigest === B.manifestDigest) resolve(A);
    else resolve(this);
  } }); };
  try {
    const out = await runOperation(op, cap, io);
    assert.equal(out.status, 'blocked');
    assert.equal(calls.perform, 0);
    assert.equal(verifies, 0);
    assert.equal(verifyReceipt(out.receipt).ok, true);
  } finally {
    if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor);
    else delete Object.prototype.then;
  }
});

test('K2-42: ask síncrono no asimila un thenable del host', async () => {
  const { op, cap, io, calls } = harness({ authority: { spend: [] } });
  let thenCalls = 0;
  let verifies = 0;
  io.verify = async () => { verifies++; return { verified: true, checks: {}, reason: 'ok' }; };
  io.ask = payload => ({ approved: true, by: 'owner', request: payload.approvalRequest.digest,
    then(resolve) { thenCalls++; resolve({ approved: false }); } });
  const out = await runOperation(op, cap, io);
  assert.equal(out.status, 'needs_human_decision');
  assert.equal(calls.perform, 0);
  assert.equal(thenCalls, 0);
  assert.equal(verifies, 0);
  assert.equal(verifyReceipt(out.receipt).ok, true);
});

test('K2-43: checkpoint thenables and getters fail closed without invocation', async t => {
  const cases = [
    ['pending', () => ({ then() {} })],
    ['resolved', () => ({ then(resolve) { resolve(); } })],
    ['function', () => Object.assign(function () {}, { then() {} })],
  ];
  let getterReads = 0;
  cases.push(['getter', () => Object.defineProperty({}, 'then', { get() { getterReads++; throw Error('secret'); } })]);
  for (const [name, checkpoint] of cases) {
    const { op, cap, io, calls } = harness();
    io.checkpoint = checkpoint;
    const out = await runOperation(op, cap, io);
    t.diagnostic(`${name}: ${out.status}, effects=${calls.perform}, reads=${getterReads}`);
    assert.equal(out.status, 'blocked', name);
    assert.equal(calls.perform, 0, name);
    assert.equal(getterReads, 0, name);
    assert.match(out.receipt.detail, /VESPI_ASYNC_RETURN/);
  }
});

test('K2-44: native pending checkpoint still times out; synchronous checkpoint works', async () => {
  const pending = harness();
  pending.io.checkpointTimeoutMs = 10;
  pending.io.checkpoint = () => new Promise(() => {});
  assert.equal((await runOperation(pending.op, pending.cap, pending.io)).status, 'blocked');
  assert.equal(pending.calls.perform, 0);

  const sync = harness();
  sync.io.checkpoint = () => undefined;
  assert.equal((await runOperation(sync.op, sync.cap, sync.io)).status, 'verified');
  assert.equal(sync.calls.perform, 1);
});

test('K2-45: ask and verifier thenables are rejected by the shared host-call guard', async () => {
  const asking = harness({ authority: { spend: [] } });
  asking.io.ask = payload => ({ approved: true, request: payload.approvalRequest.digest, then() {} });
  assert.notEqual((await runOperation(asking.op, asking.cap, asking.io)).status, 'verified');
  assert.equal(asking.calls.perform, 0);

  const verifying = harness();
  verifying.io.verify = () => ({ verified: true, then() {} });
  assert.notEqual((await runOperation(verifying.op, verifying.cap, verifying.io)).status, 'verified');
  assert.equal(verifying.calls.perform, 1);

  const reading = harness();
  reading.io.readContext = () => ({ then() {} });
  assert.equal((await runOperation(reading.op, reading.cap, reading.io)).status, 'blocked');
  assert.equal(reading.calls.perform, 0);
});

test('K2-47: captured promise intrinsics preserve a valid run after host poisoning', async () => {
  const originals = {
    stringify: JSON.stringify,
    resolve: Promise.resolve,
    race: Promise.race,
    then: Promise.prototype.then,
    finally: Promise.prototype.finally,
  };
  for (const poison of ['race', 'finally']) {
    const { op, cap, io, calls } = harness();
    let verifies = 0;
    io.verify = async () => { verifies++; return { verified: true, checks: {}, reason: 'ok' }; };
    io.checkpoint = () => {
      if (poison === 'stringify') JSON.stringify = () => { throw Error('poisoned'); };
      else if (poison === 'resolve') Promise.resolve = () => { throw Error('poisoned'); };
      else if (poison === 'race') Promise.race = () => { throw Error('poisoned'); };
      else if (poison === 'then') Promise.prototype.then = () => { throw Error('poisoned'); };
      else Promise.prototype.finally = () => { throw Error('poisoned'); };
    };
    try {
      const out = await runOperation(op, cap, io);
      assert.equal(out.status, 'verified', `${poison}: ${out.receipt.detail}`);
      assert.equal(calls.perform, 1, poison);
      assert.equal(verifies, 1, poison);
    } finally {
      JSON.stringify = originals.stringify;
      Promise.resolve = originals.resolve;
      Promise.race = originals.race;
      Promise.prototype.then = originals.then;
      Promise.prototype.finally = originals.finally;
    }
  }
});

// R19/R20 (ronda 9): un retorno del host que no se puede inspeccionar sin ejecutar código del host
// (un proxy, o un objeto que hereda de un proxy) se rechaza cerrado antes de consultar una trampa.
function hostile(kind, counters, data = {}) {
  const then = () => { counters.then += 1; };
  const traps = {
    getOwnPropertyDescriptor(target, key) { counters.trap += 1; return key === 'then' ? undefined : Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { counters.trap += 1; return Reflect.getPrototypeOf(target); },
    get(target, key, receiver) { counters.trap += 1; return Reflect.get(target, key, receiver); },
    has(target, key) { counters.trap += 1; return Reflect.has(target, key); },
    ownKeys(target) { counters.trap += 1; return Reflect.ownKeys(target); },
  };
  if (kind === 'proxy-hidden') return new Proxy({ ...data, then }, traps);
  if (kind === 'proxy-throw') return new Proxy({}, { getOwnPropertyDescriptor() { counters.trap += 1; throw Error('PRIVATE_TRAP'); } });
  if (kind === 'proxy-proto') return Object.assign(Object.create(new Proxy({ then }, traps)), data);
  if (kind === 'getter') return Object.defineProperty({ ...data }, 'then', { get() { counters.get += 1; throw Error('PRIVATE_GETTER'); } });
  if (kind === 'plain') return { ...data, then };
  throw Error(`unknown kind ${kind}`);
}
const PROXY_KINDS = ['proxy-hidden', 'proxy-throw', 'proxy-proto'];

test('K2-50: checkpoint proxies are refused before any trap runs, with zero effects', async () => {
  for (const kind of PROXY_KINDS) {
    const c = { then: 0, get: 0, trap: 0 };
    const { op, cap, io, calls } = harness();
    io.checkpointTimeoutMs = 10;
    io.checkpoint = () => hostile(kind, c);
    const out = await runOperation(op, cap, io);
    assert.deepStrictEqual({ kind, status: out.status, perform: calls.perform, ...c },
      { kind, status: 'blocked', perform: 0, then: 0, get: 0, trap: 0 });
  }
});

test('K2-51: ask, decide, readContext and verify refuse proxies without running a trap', async () => {
  for (const hook of ['ask', 'decide', 'readContext', 'verify']) for (const kind of PROXY_KINDS) {
    const c = { then: 0, get: 0, trap: 0 };
    const empty = hook === 'ask' || hook === 'decide';
    const { op, cap, io, calls } = harness(empty ? { authority: { spend: [] } } : {});
    Object.assign(io, { askTimeoutMs: 20, decideTimeoutMs: 20, contextTimeoutMs: 20, verifyTimeoutMs: 20 });
    let delivered = 0;
    const data = hook === 'readContext' ? A : hook === 'verify'
      ? { verified: true, checks: { mock: true }, reason: 'ok' } : { approved: true, probability: 1, choice: true };
    io[hook] = payload => hostile(kind, c, { ...data, ...(hook === 'ask' ? { request: payload.approvalRequest.digest } : {}) });
    if (hook === 'decide') io.ask = payload => { delivered += payload.suggestion ? 1 : 0; return { approved: false }; };
    const out = await runOperation(op, cap, io);
    const label = `${hook}/${kind}`;
    assert.deepStrictEqual({ label, ...c }, { label, then: 0, get: 0, trap: 0 });
    if (hook === 'decide') assert.strictEqual(delivered, 0, label);
    else assert.notStrictEqual(out.status, 'verified', label);
    if (hook !== 'verify') assert.strictEqual(calls.perform, 0, label);
  }
});

test('K2-52: a native promise that resolves to a proxy is refused without running a trap', async () => {
  // La promesa nativa del host consulta `then` al resolverse: eso lo ejecuta el host sobre su propia
  // promesa. Lo que se exige es que el kernel no lea el valor resuelto a través de otras trampas.
  const c = { trap: 0 };
  const dataProxy = (data) => new Proxy({ ...data }, {
    get(t, k, r) { if (k !== 'then') c.trap += 1; return Reflect.get(t, k, r); },
    getOwnPropertyDescriptor(t, k) { if (k !== 'then') c.trap += 1; return Reflect.getOwnPropertyDescriptor(t, k); },
    ownKeys(t) { c.trap += 1; return Reflect.ownKeys(t); },
  });
  const { op, cap, io, calls } = harness();
  io.verify = async () => dataProxy({ verified: true, checks: { mock: true }, reason: 'ok' });
  const out = await runOperation(op, cap, io);
  assert.notStrictEqual(out.status, 'verified');
  assert.strictEqual(calls.perform, 1);
  const reading = harness();
  reading.io.readContext = async () => dataProxy(A);
  const blocked = await runOperation(reading.op, reading.cap, reading.io);
  assert.strictEqual(blocked.status, 'blocked');
  assert.strictEqual(reading.calls.perform, 0);
  assert.strictEqual(c.trap, 0);
});

test('K2-53: the operation clock never reads a then getter nor subscribes to a non-native thenable', async () => {
  for (const kind of ['getter', 'plain', 'proxy-hidden']) {
    const c = { then: 0, get: 0, trap: 0 };
    const { op, cap, io, calls } = harness();
    io.now = () => hostile(kind, c);
    const out = await runOperation(op, cap, io);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepStrictEqual({ kind, perform: calls.perform, ...c }, { kind, perform: 0, then: 0, get: 0, trap: 0 });
    assert.notStrictEqual(out.status, 'verified');
  }
  const rejected = harness();
  rejected.io.now = () => Promise.reject(Error('PRIVATE_CLOCK'));
  assert.notStrictEqual((await runOperation(rejected.op, rejected.cap, rejected.io)).status, 'verified');
  assert.strictEqual(rejected.calls.perform, 0);
});

test('K2-54: capability required() is inspected without reading a then getter or a proxy trap', async () => {
  for (const kind of ['getter', 'proxy-hidden']) {
    const c = { then: 0, get: 0, trap: 0 };
    const { op, cap, io, calls } = harness();
    cap.required = () => hostile(kind, c, { spend: [{ ...GRANT }] });
    const out = await runOperation(op, cap, io);
    assert.deepStrictEqual({ kind, perform: calls.perform, ...c }, { kind, perform: 0, then: 0, get: 0, trap: 0 });
    assert.notStrictEqual(out.status, 'verified');
  }
});

test('K2-55: legitimate synchronous values and native promises keep working after the proxy rule', async () => {
  class NativeSubclass extends Promise {}
  for (const checkpoint of [() => undefined, () => ({ saved: true }), () => ({ then: 7 }), () => NativeSubclass.resolve(undefined), () => Promise.resolve()]) {
    const { op, cap, io, calls } = harness();
    io.checkpoint = checkpoint;
    assert.strictEqual((await runOperation(op, cap, io)).status, 'verified');
    assert.strictEqual(calls.perform, 1);
  }
  const dated = harness();
  dated.io.now = () => '2040-01-01T00:00:00Z';
  assert.strictEqual((await runOperation(dated.op, dated.cap, dated.io)).status, 'verified');
});
