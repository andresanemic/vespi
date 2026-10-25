'use strict';
// K1 de 0.1.8: una operacion declara el contexto bajo el que se aprobo y el kernel lo contrasta con el
// contexto efectivo del host justo antes del efecto. Cambio, ausencia o estado no vigente bloquean el
// efecto (performed === 0). Una operacion sin contexto declarado (0.1.7) se comporta como antes, y
// nadie afirma retroactivamente que fue verificada contra uno.
const test = require('node:test');
const assert = require('node:assert');
const { createOperation, runOperation, pauseOperation, resumeOperation } = require('../src/operation.js');

const GRANT = { asset: 'USDC', amount: '5', to: 'G1' };
const AUTH = { spend: [{ asset: 'USDC', maxAmount: '5', to: 'G1' }] };
const A = { manifestDigest: 'a'.repeat(64), scope: 'proyecto:demo/tarea:t1', sources: [{ ref: 'lore/principios.md', owner: 'andres', revision: 'r1', state: 'approved' }] };
const B = { ...A, manifestDigest: 'b'.repeat(64), sources: [{ ref: 'lore/principios.md', owner: 'andres', revision: 'r2', state: 'approved' }] };

function harness(context, readContext) {
  const calls = { perform: 0, readContext: 0 };
  const cap = {
    id: 'cap',
    required: () => ({ spend: [GRANT] }),
    perform: async () => { calls.perform += 1; return { ok: true, evidence: { txHash: 'h' } }; },
  };
  const io = {
    verify: async () => ({ verified: true, checks: { mock: true }, reason: 'mock ok' }),
    ...(readContext ? { readContext: async (scope) => { calls.readContext += 1; return readContext(scope); } } : {}),
  };
  const op = createOperation({ goal: 'pay', authority: AUTH, ...(context ? { context } : {}) });
  return { op, cap, io, calls };
}

test('K1 contexto: el contexto efectivo igual al aprobado produce un solo efecto y queda en el recibo', async () => {
  const { op, cap, io, calls } = harness(A, () => A);
  const out = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 1);
  assert.strictEqual(out.receipt.status, 'verified');
  assert.strictEqual(out.receipt.context.manifestDigest, A.manifestDigest);
  assert.strictEqual(out.receipt.context.scope, A.scope);
});

test('K1 contexto: el host entrega otro contexto justo antes del efecto -> bloqueado, performed === 0', async () => {
  const { op, cap, io, calls } = harness(A, () => B);
  const out = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 0, 'el efecto no corre bajo un contexto que cambio');
  assert.strictEqual(out.status, 'blocked');
  assert.strictEqual(out.receipt.status, 'blocked');
  assert.match(out.receipt.detail || out.receipt.reason || '', /context/i);
});

test('K1 contexto: el contexto cambia durante el await de la decision humana y se contrasta justo antes del efecto', async () => {
  let current = A;
  const { op, cap, io, calls } = harness(A, () => current);
  io.ask = async (payload) => { current = B; return { approved: true, request: payload.approvalRequest.digest }; };
  op.authority = { spend: [] };
  const out = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 0);
  assert.strictEqual(out.receipt.status, 'blocked');
});

test('K1 contexto: una fuente ausente o en estado propuesta en vez de vigente bloquea', async () => {
  for (const effective of [
    { ...A, sources: [] },
    { ...A, sources: [{ ...A.sources[0], state: 'proposal' }] },
    null,
    undefined,
  ]) {
    const { op, cap, io, calls } = harness(A, () => effective);
    const out = await runOperation(op, cap, io);
    assert.strictEqual(calls.perform, 0, `contexto efectivo ${JSON.stringify(effective)} no autoriza el efecto`);
    assert.strictEqual(out.receipt.status, 'blocked');
  }
});

test('K1 contexto: sin io.readContext, o si falla, una operacion con contexto declarado no se ejecuta', async () => {
  const sinLector = harness(A, null);
  const out1 = await runOperation(sinLector.op, sinLector.cap, sinLector.io);
  assert.strictEqual(sinLector.calls.perform, 0);
  assert.strictEqual(out1.receipt.status, 'blocked');

  const quienFalla = harness(A, () => { throw new Error('host sin lectura'); });
  const out2 = await runOperation(quienFalla.op, quienFalla.cap, quienFalla.io);
  assert.strictEqual(quienFalla.calls.perform, 0);
  assert.strictEqual(out2.receipt.status, 'blocked');
});

test('K1 contexto: reducir el alcance (scope distinto) tambien bloquea', async () => {
  const { op, cap, io, calls } = harness(A, () => ({ ...A, scope: 'proyecto:otro' }));
  const out = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 0);
  assert.strictEqual(out.receipt.status, 'blocked');
});

test('K1 contexto: el contexto declarado es un dato inerte; mutarlo despues de crear la operacion no cambia lo aprobado', async () => {
  const declared = JSON.parse(JSON.stringify(A));
  const { op, cap, io, calls } = harness(declared, () => A);
  declared.manifestDigest = 'c'.repeat(64);
  const out = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 1, 'el snapshot ignora la mutacion posterior del objeto original');
  assert.strictEqual(out.receipt.context.manifestDigest, A.manifestDigest);
});

test('K1 contexto: una declaracion malformada se rechaza al crear la operacion', () => {
  assert.throws(() => createOperation({ goal: 'x', authority: { spend: [] }, context: { manifestDigest: 'corto', scope: 's', sources: [] } }), /context/i);
  assert.throws(() => createOperation({ goal: 'x', authority: { spend: [] }, context: { manifestDigest: 'a'.repeat(64), scope: '', sources: [] } }), /context/i);
});

test('K1 contexto: una operacion 0.1.7 sin contexto corre igual y su recibo no afirma contexto verificado', async () => {
  const { op, cap, io, calls } = harness(null, () => B);
  const out = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 1);
  assert.strictEqual(out.receipt.status, 'verified');
  assert.strictEqual(out.receipt.context, undefined);
  assert.strictEqual(calls.readContext, 0, 'sin contexto declarado no se lee ninguno');
});

test('K1 contexto: la llave de idempotencia conserva la identidad del efecto al renovar contexto', async () => {
  const keys = [];
  const receipts = [];
  for (const ctx of [A, B]) {
    const { op, io } = harness(ctx, () => ctx);
    const cap = { id: 'cap', required: () => ({ spend: [GRANT] }), perform: async ({ idempotencyKey }) => { keys.push(idempotencyKey); return { ok: true, evidence: { txHash: 'h' } }; } };
    receipts.push((await runOperation(op, cap, io)).receipt);
  }
  assert.notDeepStrictEqual(receipts[0].context, receipts[1].context);
  assert.notStrictEqual(receipts[0].digest, receipts[1].digest);
  assert.strictEqual(keys.length, 2);
  assert.strictEqual(keys[0], keys[1]);
});

const { verifyReceipt } = require('../src/receipt.js');

test('K1 sealed context tampering invalidates the receipt', async () => {
  const { op, cap, io } = harness(A, () => A);
  const out = await runOperation(op, cap, io);
  assert.strictEqual(verifyReceipt(out.receipt).ok, true);
  const altered = JSON.parse(JSON.stringify(out.receipt));
  altered.context.sources[0].owner = 'other';
  assert.strictEqual(verifyReceipt(altered).ok, false);
});

test('K1 both human gate payloads retain A while effective context changes to B', async () => {
  for (const signers of [null, { required: 1, allowed: ['owner'] }]) {
    let current = A;
    const { op, cap, io, calls } = harness(A, () => current);
    op.authority = { spend: [], ...(signers ? { signers } : {}) };
    let shown;
    io.ask = async (payload) => {
      shown = payload.context;
      current = B;
      assert.throws(() => { op.context = B; }, TypeError);
      assert.throws(() => { delete op.context; }, TypeError);
      return { approved: true, by: 'owner', request: payload.approvalRequest.digest };
    };
    const out = await runOperation(op, cap, io);
    assert.deepStrictEqual(shown, A);
    assert.strictEqual(Object.isFrozen(shown.sources[0]), true);
    assert.strictEqual(out.status, 'blocked');
    assert.deepStrictEqual(out.receipt.context, A);
    assert.strictEqual(calls.perform, 0);
  }
});

test('K1 late context reader cannot reach perform after its timeout', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const { op, cap, io, calls } = harness(A, () => pending);
  io.contextTimeoutMs = 10;
  const out = await runOperation(op, cap, io);
  assert.strictEqual(out.status, 'blocked');
  assert.deepStrictEqual(out.receipt.authority.exercised, []);
  resolve(A);
  await new Promise((done) => setTimeout(done, 20));
  assert.strictEqual(calls.perform, 0);
});

test('K1 authority clock is rechecked after awaiting the context', async () => {
  let now = Date.parse('2040-01-01T00:00:00Z');
  const { op, cap, io, calls } = harness(A, async () => {
    await Promise.resolve();
    now += 2000;
    return A;
  });
  op.authority.spend[0].expiresAt = now + 1000;
  io.now = () => now;
  const out = await runOperation(op, cap, io);
  assert.strictEqual(calls.perform, 0);
  assert.strictEqual(out.status, 'needs_human_decision');
  assert.deepStrictEqual(out.receipt.authority.exercised, []);
});

test('K1 rejects getters without invoking them and rejects proxy inspection failures', async () => {
  let reads = 0;
  const getter = { get() { reads += 1; throw new Error('must not execute'); }, enumerable: true };
  const options = { goal: 'x', authority: AUTH };
  Object.defineProperty(options, 'context', getter);
  assert.throws(() => createOperation(options), /context/);
  const source = { ...A.sources[0] };
  Object.defineProperty(source, 'state', getter);
  const sources = [A.sources[0]];
  Object.defineProperty(sources, '0', getter);
  for (const context of [{ ...A, sources: [source] }, { ...A, sources }]) {
    assert.throws(() => createOperation({ goal: 'x', context }), /context/);
    const { op, cap, io, calls } = harness(A, () => context);
    assert.strictEqual((await runOperation(op, cap, io)).status, 'blocked');
    assert.strictEqual(calls.perform, 0);
  }
  assert.strictEqual(reads, 0);
  const { op, cap, io, calls } = harness(A, () => new Proxy({}, { getPrototypeOf() { throw new Error('trap'); } }));
  assert.strictEqual((await runOperation(op, cap, io)).status, 'blocked');
  assert.strictEqual(calls.perform, 0);
});

test('K1 same digest with altered owner, revision, source, cardinality or scope blocks', async () => {
  const changes = [
    { sources: [{ ...A.sources[0], owner: 'other' }] },
    { sources: [{ ...A.sources[0], revision: 'r2' }] },
    { sources: [{ ...A.sources[0], ref: 'other' }] },
    { sources: [A.sources[0], A.sources[0]] },
    { scope: A.scope + '/wider' },
  ];
  for (const change of changes) {
    const { op, cap, io, calls } = harness(A, () => ({ ...A, ...change }));
    assert.strictEqual((await runOperation(op, cap, io)).status, 'blocked');
    assert.strictEqual(calls.perform, 0);
  }
});

test('K1 closed context rejects explicit absence, extras, inherited fields and sparse arrays', () => {
  for (const context of [null, undefined, [], { ...A, extra: 1 },
    { ...A, [Symbol('extra')]: 1 }, { ...A, sources: new Array(1) },
    { ...A, sources: [{ ...A.sources[0], state: 'proposal' }] },
    Object.create(A), { ...A, sources: [{ ...A.sources[0], extra: true }] }]) {
    assert.throws(() => createOperation({ goal: 'x', context }), /context/);
  }
  const inherited = Object.create({ context: A });
  assert.throws(() => createOperation(inherited), /context/);
});

test('K1 paused persisted operation preserves context and rechecks before resuming', async () => {
  for (const effective of [A, B]) {
    const { op, cap, io, calls } = harness(A, () => effective);
    op.authority.pausers = ['owner'];
    pauseOperation(op, 'owner');
    const restored = JSON.parse(JSON.stringify(op));
    assert.deepStrictEqual(restored.context, A);
    resumeOperation(restored, 'owner');
    const out = await runOperation(restored, cap, io);
    assert.strictEqual(out.status, effective === A ? 'verified' : 'blocked');
    assert.strictEqual(calls.perform, effective === A ? 1 : 0);
    assert.deepStrictEqual(out.receipt.context, A);
  }
});

test('K1 old receipt verifies without inventing context coverage', async () => {
  const { op, cap, io } = harness(null, () => B);
  const out = await runOperation(op, cap, io);
  const saved = JSON.parse(JSON.stringify(out.receipt));
  assert.strictEqual(Object.hasOwn(saved, 'context'), false);
  assert.strictEqual(verifyReceipt(saved).ok, true);
});
