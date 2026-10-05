// K3 TDD (RED primero): recibos durables, cobertura y anclaje Stellar testnet (interfaz).
const { test } = require('node:test');
const assert = require('node:assert');

const receiptMod = require('../src/receipt.js');
const { createOperation, runOperation, STATES } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');

const verifierOk = async () => ({ verified: true, checks: { mock: true }, reason: 'mock ok' });
const silentAsk = async () => ({ approved: false });

function baseSpec(status = 'verified') {
  return {
    operation: { id: 'op-k3', goal: 'demo' },
    capabilityId: 'cap-k3',
    authority: { spend: [] },
    outcome: { status, exercised: [], detail: 'ok' },
    evidence: { txHash: 'tx-1' },
    verification: { verified: true, checks: { mock: true }, reason: 'mock ok' },
  };
}

test('K3.1 buildReceipt incluye digest SHA-256 hex y verifyReceipt lo acepta', () => {
  assert.equal(typeof receiptMod.verifyReceipt, 'function');
  const r = receiptMod.buildReceipt(baseSpec());
  assert.match(r.digest, /^[0-9a-f]{64}$/);
  const v = receiptMod.verifyReceipt(r);
  assert.equal(v.ok, true);
});

test('K3.2 cualquier cambio en el recibo hace fallar verifyReceipt', () => {
  const r = receiptMod.buildReceipt(baseSpec());
  for (const mutate of [
    (c) => { c.status = 'failed'; },
    (c) => { c.evidence = { txHash: 'tx-2' }; },
    (c) => { c.coverage = []; },
    (c) => { c.detail = 'otro'; },
  ]) {
    const copy = JSON.parse(JSON.stringify(r));
    mutate(copy);
    const v = receiptMod.verifyReceipt(copy);
    assert.equal(v.ok, false, 'mutación debe fallar');
    assert.equal(typeof v.reason, 'string');
  }
});

test('K3.3 digest es canónico: orden de claves no cambia y excluye digest y anchor', () => {
  const r = receiptMod.buildReceipt(baseSpec());
  const reordered = {};
  for (const k of Object.keys(r).reverse()) reordered[k] = r[k];
  assert.equal(receiptMod.verifyReceipt(reordered).ok, true);
  // El digest del cuerpo excluye `anchor`, así que anclar no lo mueve: el mismo cuerpo con el ancla
  // atada a ese digest sigue verificando. Un ancla escrita a mano, sin atar, ya no verifica (T1-X1).
  const bound = { ...r, anchor: { status: 'anchored', network: 'stellar:testnet', txHash: 'X', digest: r.digest } };
  assert.equal(receiptMod.verifyReceipt(bound).ok, true, 'el mismo cuerpo con el ancla atada sigue verificando');
  const unbound = { ...r, anchor: { status: 'anchored', network: 'stellar:testnet', txHash: 'X' } };
  assert.equal(receiptMod.verifyReceipt(unbound).ok, false, 'un ancla escrita a mano no verifica');
});

test('K3.4 coverage sale de verification.checks; sin checks es vacía', () => {
  const r = receiptMod.buildReceipt(baseSpec());
  assert.deepEqual([...r.coverage].sort(), ['mock']);
  const empty = receiptMod.buildReceipt({ ...baseSpec(), verification: null });
  assert.deepEqual(empty.coverage, []);
});

test('K3.5 notCovered incluye external anchor mientras no haya anclaje', () => {
  const r = receiptMod.buildReceipt(baseSpec());
  assert.ok(r.notCovered.includes('external anchor'));
  // Orchestrator review (R42): a txHash alone is not proof; the anchor counts once verified on-chain.
  const anchored = receiptMod.anchorReceipt(r, () => ({ network: 'stellar:testnet', txHash: 'abc' }), () => true);
  assert.ok(!anchored.notCovered.includes('external anchor'));
});

test('K3.6 anchorReceipt sin anchor deja pending en stellar:testnet, nunca anchored', () => {
  const r = receiptMod.buildReceipt(baseSpec());
  const out = receiptMod.anchorReceipt(r);
  assert.equal(out.anchor.status, 'pending');
  assert.equal(out.anchor.network, 'stellar:testnet');
  assert.notEqual(out.anchor.status, 'anchored');
});

test('K3.7 anchorReceipt con anchor que lanza deja pending, nunca anchored', () => {
  const r = receiptMod.buildReceipt(baseSpec());
  const out = receiptMod.anchorReceipt(r, () => { throw new Error('red caída'); });
  assert.equal(out.anchor.status, 'pending');
  assert.equal(out.anchor.network, 'stellar:testnet');
});

test('K3.8 anchorReceipt sin txHash deja pending, nunca anchored', () => {
  const r = receiptMod.buildReceipt(baseSpec());
  for (const bad of [() => ({}), () => ({ network: 'stellar:testnet' }), () => null]) {
    const out = receiptMod.anchorReceipt(r, bad);
    assert.equal(out.anchor.status, 'pending');
  }
});

test('K3.9 anchorReceipt con txHash deja anchored y conserva digest válido', () => {
  const r = receiptMod.buildReceipt(baseSpec());
  let seenDigest = null;
  const out = receiptMod.anchorReceipt(r, (digest) => {
    seenDigest = digest;
    return { network: 'stellar:testnet', txHash: 'deadbeef' };
  }, (txHash, digest) => txHash === 'deadbeef' && digest === seenDigest);
  assert.equal(out.anchor.status, 'anchored');
  assert.equal(out.anchor.txHash, 'deadbeef');
  assert.equal(out.digest, seenDigest);
  assert.equal(out.anchor.digest, seenDigest);
  assert.equal(receiptMod.verifyReceipt(out).ok, true);
});

test('K3.10 el estado del recibo es exacto e igual al de la operación', async () => {
  const allowed = new Set(['verified', 'not_verified', 'failed', 'blocked', 'paused', 'needs_human_decision']);
  const capOk = {
    id: 'k3-cap',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '100000', to: 'RECEIVER' }] }),
    perform: async () => ({ ok: true, evidence: { tx: 'X' } }),
  };
  const op = createOperation({ goal: 'demo', authority: grantSpend('USDC:test', '500000') });
  const res = await runOperation(op, capOk, { verify: verifierOk, ask: silentAsk });
  assert.ok(allowed.has(res.receipt.status));
  assert.equal(res.receipt.status, res.status);
  const paused = receiptMod.buildReceipt({
    ...baseSpec(),
    outcome: { status: 'paused', exercised: [], detail: 'pausado' },
  });
  assert.equal(paused.status, 'paused');
});
