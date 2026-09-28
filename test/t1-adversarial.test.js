'use strict';
// T1: TDD adversarial final del candidato 0.1.3 (plan de construcción, 2026-09-28).
// La pregunta no es si el código anda, sino qué NO puede hacer. Cada `test` verde fija una
// propiedad segura que el kernel respeta hoy; cada `test.todo` deja escrita la aserción segura
// que el kernel todavía no cumple, con el hallazgo y a quién le toca decidirlo. Los siete
// hallazgos tocan autoridad, recibos o guardia, así que van marcados para que los relea un
// modelo alto (condición 4 del segundo relevo) antes de que el 0.1.3 secongele.
const { test } = require('node:test');
const assert = require('node:assert');
const { sufficient } = require('../src/authority.js');
const receipt = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');
const delegation = require('../src/delegation.js');

const REQ = { asset: 'USDC:test', amount: '100', to: 'RECEIVER' };
const AT = '2026-01-01T00:00:00.000Z';

const spec = (over = {}) => ({
  operation: { id: 'op-1', goal: 'g' },
  capabilityId: 'cap-1',
  authority: { spend: [] },
  outcome: { status: 'verified', exercised: [] },
  evidence: { txHash: 'tx1' },
  verification: { verified: true, checks: { a: true }, reason: 'ok' },
  ...over,
});

// ---------------------------------------------------------------- autoridad

test('T1-A1: an amount that is a number, a float, a negative or an exponent never becomes a spend', () => {
  const grant = { spend: [{ asset: 'USDC:test', maxAmount: '1000', to: 'RECEIVER' }] };
  for (const amount of [100, 100.5, -100, '1e3', ' 100', '+100', '0x10', '', null, '100 ']) {
    const res = sufficient([{ ...REQ, amount }], grant, { now: AT });
    assert.equal(res.ok, false, `amount ${JSON.stringify(amount)} must not be spendable`);
  }
});

test('T1-A2: two requirements cannot share a wildcard grant to spend twice its ceiling', () => {
  const grant = { spend: [{ asset: 'USDC:test', maxAmount: '100' }] };
  const one = sufficient([{ ...REQ, amount: '60' }], grant, { now: AT });
  const two = sufficient([{ ...REQ, amount: '60' }, { ...REQ, to: 'OTHER', amount: '60' }], grant, { now: AT });
  assert.equal(one.ok, true);
  assert.equal(two.ok, false, 'the wildcard grant is consumed once, not twice');
  assert.match(two.reason, /consume 120 against grant max 100/);
});

test('T1-A3: a grant is dead the instant it expires, and a dead grant never covers anything', () => {
  const grant = { spend: [{ asset: 'USDC:test', maxAmount: '100', to: 'RECEIVER', expiresAt: AT }] };
  assert.equal(sufficient([REQ], grant, { now: AT }).ok, false, 'expiry is inclusive');
  assert.equal(sufficient([REQ], grant, { now: '2025-12-31T23:59:59.999Z' }).ok, true);
  const withLive = { spend: [{ ...grant.spend[0] }, { asset: 'USDC:test', maxAmount: '100', to: 'RECEIVER' }] };
  assert.equal(sufficient([REQ], withLive, { now: AT }).ok, true, 'a second live grant covers it');
});

test('T1-A4: a grant cannot be aimed at nobody by accident', () => {
  for (const to of [null, '', 0, false]) {
    const res = sufficient([REQ], { spend: [{ asset: 'USDC:test', maxAmount: '100', to }] }, { now: AT });
    assert.equal(res.ok, false, `to ${JSON.stringify(to)} must be refused, not read as a wildcard`);
  }
});

test('T1-A5: no requirement at all is never "covered"', () => {
  assert.equal(sufficient([], { spend: [{ asset: 'USDC:test', maxAmount: '999' }] }, { now: AT }).ok, false);
  assert.equal(sufficient(undefined, { spend: [] }, { now: AT }).ok, false);
});

// ---------------------------------------------------------------- recibos

test('T1-B1: the body of the receipt is covered by the digest', () => {
  const r = receipt.buildReceipt(spec());
  for (const mutate of [
    (x) => { x.status = 'not_verified'; },
    (x) => { x.coverage = ['a', 'b', 'c']; },
    (x) => { x.evidence.txHash = 'other'; },
    (x) => { x.authority.exercised[0] = { asset: 'USDC:test', maxAmount: '999999', to: 'X' }; },
    (x) => { x.operation.goal = 'another goal'; },
  ]) {
    const copy = JSON.parse(JSON.stringify(r));
    mutate(copy);
    assert.equal(receipt.verifyReceipt(copy).ok, false, 'an edited receipt must not verify');
  }
});

test('T1-B2: a network this kernel cannot anchor on leaves the receipt pending', () => {
  for (const network of ['stellar:mainnet', 'mainnet', 'testnet', '', 'STELLAR:TESTNET', 'ethereum:1']) {
    const out = receipt.anchorReceipt(receipt.buildReceipt(spec()), () => ({ network, txHash: 'tx1' }), () => true);
    assert.equal(out.anchor.status, 'pending', `network ${JSON.stringify(network)} must not anchor`);
  }
});

test('T1-B3: only a verifier that confirms it turns "submitted" into "anchored"', () => {
  const r = receipt.buildReceipt(spec());
  const confirmed = receipt.anchorReceipt(r, () => ({ network: 'stellar:testnet', txHash: 'tx1' }), (txHash, digest) => txHash === 'tx1' && digest === r.digest);
  assert.equal(confirmed.anchor.status, 'anchored');
  assert.ok(!confirmed.notCovered.includes('external anchor'));
  const denied = receipt.anchorReceipt(r, () => ({ network: 'stellar:testnet', txHash: 'tx1' }), () => false);
  assert.equal(denied.anchor.status, 'submitted');
  const threw = receipt.anchorReceipt(r, () => ({ network: 'stellar:testnet', txHash: 'tx1' }), () => { throw new Error('rpc down'); });
  assert.equal(threw.anchor.status, 'submitted', 'a verifier that throws anchors nothing');
  // Y lo que el kernel no puede saber: un verificador que responde true sin comprobar nada ancla igual.
  // El estado `anchored` es la palabra del adaptador, no una prueba; por eso `verifyReceipt` declara
  // que prueba integridad y no autenticidad (finding M5, ya escrito en el código).
  const careless = receipt.anchorReceipt(r, () => ({ network: 'stellar:testnet', txHash: 'tx1' }), () => true);
  assert.equal(careless.anchor.status, 'anchored');
});

test('T1-B4: evidence is an allowlist, so a capability cannot write arbitrary keys into a receipt', () => {
  const r = receipt.buildReceipt(spec({ evidence: { txHash: 'tx1', secret: 'sk-live-123', notes: 'x'.repeat(5000) } }));
  assert.equal(r.evidence.secret, undefined);
  assert.equal(r.evidence.notes, undefined);
  assert.equal(r.evidence.txHash, 'tx1');
});

// ---------------------------------------------------------------- continuidad

test('T1-C1: a receipt whose digest does not verify is discarded, and it is counted', () => {
  const good = receipt.buildReceipt(spec());
  const bad = JSON.parse(JSON.stringify(good));
  bad.status = 'not_verified';
  const out = resumeFromReceipts([good, bad], { approved: [{ action: 'op-1' }] });
  assert.equal(out.discarded, 1);
  assert.equal(out.needsPerson, false);
});

test('T1-C2: a change in what was agreed returns the operation to the person', () => {
  const r = receipt.buildReceipt(spec());
  for (const changes of [{ scope: 'other' }, { amount: '999' }, { ceiling: '999' }, { status: 'failed' }]) {
    const out = resumeFromReceipts([r], { approved: [{ action: 'a', changes }, { action: 'op-1' }] });
    assert.equal(out.needsPerson, true, `${JSON.stringify(changes)} must revalidate`);
  }
});

test('T1-C3: an action whose last receipt is blocked, paused or waiting is not resumed by an agent', () => {
  for (const status of ['blocked', 'paused', 'needs_human_decision']) {
    const r = receipt.buildReceipt(spec({ outcome: { status, exercised: [] } }));
    const out = resumeFromReceipts([r], { approved: [{ action: 'op-1' }] });
    assert.equal(out.needsPerson, true, `${status} must return to the person`);
    assert.equal(out.nextAction, null);
  }
});

test('T1-C4: a verified receipt for an action outside the agreement revalidates instead of resuming', () => {
  const r = receipt.buildReceipt(spec());
  const out = resumeFromReceipts([r], { approved: [{ action: 'something-else' }] });
  assert.equal(out.needsPerson, true);
  assert.match(out.reason, /outside the agreement/);
});

// ---------------------------------------------------------------- delegación

const medium = { cwd: 'C:/Claude', material: [], forbidden: ['.env'] };

test('T1-D1: a delegate that never read the assignment fails to start and cannot deliver', () => {
  const d = delegation.createDelegation({ task: 't', medium, delegate: 'bunny', orchestrator: 'vespi' });
  const start = delegation.recordStart(d, { readTask: false });
  assert.equal(start.relaunch, true);
  assert.equal(d.state, 'failed_to_start');
  assert.throws(() => delegation.recordResult(d, { output: 'x' }), /relaunch it instead/);
});

test('T1-D2: a shared prefix is not containment, so .env.example is not .env', () => {
  const d = delegation.createDelegation({ task: 't', medium, delegate: 'bunny', orchestrator: 'vespi' });
  const out = delegation.recordResult(d, { output: 'x', touched: ['.env.example', 'C:/Claude/.env'] });
  assert.deepEqual(out.violations, ['C:/Claude/.env']);
  assert.equal(out.state, 'out_of_bounds');
});

test('T1-D3: only the orchestrator reviews, and accepted is unreachable without a returned result', () => {
  const d = delegation.createDelegation({ task: 't', medium, delegate: 'bunny', orchestrator: 'vespi' });
  assert.throws(() => delegation.reviewDelegation(d, { reviewer: 'bunny', accept: true }), /only the orchestrator/);
  const early = delegation.reviewDelegation(d, { reviewer: 'vespi', accept: true });
  assert.notEqual(early.state, 'accepted', 'nothing is accepted before the delegate returns');
  assert.throws(() => delegation.integrateDelegation(d), /not accepted/);
});

test('T1-D4: a correction round leaves the work unaccepted until it is reviewed again', () => {
  const d = delegation.createDelegation({ task: 't', medium, delegate: 'bunny', orchestrator: 'vespi' });
  delegation.recordStart(d, { readTask: true });
  delegation.recordResult(d, { output: 'x', spark: 'una chispa' });
  const asked = delegation.reviewDelegation(d, { reviewer: 'vespi', corrections: ['corrige esto'] });
  assert.equal(asked.state, 'needs_correction');
  assert.throws(() => delegation.integrateDelegation(d), /not accepted/);
  const again = delegation.recordResult(d, { output: 'y' });
  assert.deepEqual(again.pendingCorrections, [], 'a new result clears the pending corrections');
  const ok = delegation.reviewDelegation(d, { reviewer: 'vespi', accept: true });
  assert.equal(ok.state, 'accepted');
  assert.ok(delegation.integrateDelegation(d).digest);
});

test('T1-D5: a spark of more than twenty words is refused before it commits, and cards stay out of the person view', () => {
  const d = delegation.createDelegation({ task: 't', medium, delegate: 'bunny', orchestrator: 'vespi' });
  delegation.recordStart(d, { readTask: true });
  assert.throws(() => delegation.recordResult(d, { output: 'x', spark: 'palabra '.repeat(21).trim() }), /at most 20 words/);
  const out = delegation.recordResult(d, { output: 'x', spark: 'palabra '.repeat(20).trim() });
  assert.equal(out.sparks.length, 1);
  delegation.recordCard(d, { deck: 'eno', card: 'What would you not do?', perturbation: 'T1' });
  assert.throws(() => delegation.recordCard(d, { deck: 'inventado', card: 'x' }), /eno or entre/);
  assert.equal('cards' in delegation.personView(d), false, 'the cards are the Entre\'s own, not the person\'s');
});

// ---------------------------------------------------------------- los siete huecos
// Cada uno se escribió como lo que el kernel debería hacer, y quedó como `todo` porque tocar el
// formato del recibo o el estado de una delegación es decisión del acuerdo. La decisión se tomó
// (T1-cierre): los siete están hoy como pruebas que el kernel pasa. Lo que sigue siendo decisión
// pendiente son los cambios de formato que quedaron dentro — el recibo de delegación ahora lleva
// `violations` y se queda sin cartas silenciosas — y eso se relee con un modelo alto antes de
// congelar el 0.1.3.

test('T1-X1: an anchor cannot be forged without breaking the digest', () => {
  const r = receipt.buildReceipt(spec());
  const forged = JSON.parse(JSON.stringify(r));
  forged.anchor = { status: 'anchored', network: 'stellar:testnet', txHash: 'tx-inventado' };
  assert.equal(receipt.verifyReceipt(forged).ok, false, 'the digest excludes `anchor`, so today this verifies');
});

test('T1-X2: the receipt stores the verification object sanitized, like evidence', () => {
  const r = receipt.buildReceipt(spec({ verification: { verified: true, checks: {}, secret: 'sk-live-123' } }));
  assert.equal(r.verification.secret, undefined, '`verification` is copied raw, bypassing the evidence allowlist');
});

test('T1-X3: the revalidation gate watches every key that changes what was agreed', () => {
  const r = receipt.buildReceipt(spec());
  const out = resumeFromReceipts([r], { approved: [{ action: 'a', changes: { to: 'OTRO' } }, { action: 'op-1' }] });
  assert.equal(out.needsPerson, true, 'only scope, amount, ceiling and status are watched today');
});

test('T1-X4: continuity trusts the verification, not only the status field of the receipt', () => {
  const r = receipt.buildReceipt(spec({ verification: { verified: false, checks: { a: false }, reason: 'fallo' } }));
  const out = resumeFromReceipts([r], { approved: [{ action: 'op-1' }] });
  assert.equal(out.needsPerson, true, 'a receipt whose own verification says false is resumed today');
});

test('T1-X5: a violation recorded once cannot be erased by a second result', () => {
  const d = delegation.createDelegation({ task: 't', medium, delegate: 'bunny', orchestrator: 'vespi' });
  delegation.recordStart(d, { readTask: true });
  delegation.recordResult(d, { output: 'x', touched: ['C:/Claude/.env'] });
  const clean = delegation.recordResult(d, { output: 'y', touched: [] });
  assert.ok(clean.violations.length > 0, 'a second result replaces the violations today');
  assert.notEqual(clean.state, 'returned');
});

test('T1-X6: the silent cards do not travel in the delegation receipt', () => {
  const d = delegation.createDelegation({ task: 't', medium, delegate: 'bunny', orchestrator: 'vespi' });
  delegation.recordStart(d, { readTask: true });
  delegation.recordResult(d, { output: 'x' });
  delegation.recordCard(d, { deck: 'entre', card: 'carta' });
  delegation.reviewDelegation(d, { reviewer: 'vespi', accept: true });
  assert.deepEqual(delegation.integrateDelegation(d).cards, [], 'the receipt carries the cards today');
});

test('T1-X7: a touched file outside the medium is a violation even when nothing is forbidden', () => {
  const d = delegation.createDelegation({ task: 't', medium: { cwd: 'C:/Claude', material: [], forbidden: [] }, delegate: 'bunny', orchestrator: 'vespi' });
  delegation.recordStart(d, { readTask: true });
  const out = delegation.recordResult(d, { output: 'x', touched: ['C:/Users/andre/.ssh/id_rsa'] });
  assert.ok(out.violations.length > 0, 'only the forbidden list bounds a delegate today');
});
