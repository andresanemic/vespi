'use strict';
// RC6 del kernel — confianza: S11 (auto-revisión de un delegado) y S10 (recibo re-sellado).
//
// Las pruebas de S11 son verdes: la corrección está en `src/delegation.js` y no cambia una sola
// firma pública. Cada una tiene su negativo, porque una puerta que solo rechaza y nunca deja pasar
// también es una puerta cerrada por accidente.
//
// Andrés aprobó el 29/09 que un recibo local re-sellado no atraviese una puerta humana.
// verifyReceipt sigue midiendo integridad; la continuidad exige un verificador independiente.
const { test } = require('node:test');
const assert = require('node:assert');
const { createHash } = require('node:crypto');
const delegation = require('../src/delegation.js');
const { buildReceipt, verifyReceipt } = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');

const ROOT = process.platform === 'win32' ? 'C:/Claude' : '/srv/claude';
const MEDIUM = { cwd: ROOT, material: [], forbidden: ['.env'] };

function returned() {
  const d = delegation.createDelegation({ task: 't', medium: MEDIUM, delegate: 'bunny', orchestrator: 'vespi' });
  delegation.recordStart(d, { readTask: true });
  delegation.recordResult(d, { output: 'x', touched: [`${ROOT}/src/a.js`] });
  return d;
}

// ---------------------------------------------------------------- S11 · positivo

test('RC6-S11-P1: the orchestrator the delegation was created with still reviews and accepts', () => {
  const d = returned();
  const out = delegation.reviewDelegation(d, { reviewer: 'vespi', findings: ['thin on evidence'], accept: true });
  assert.equal(out.state, 'accepted');
  assert.equal(d.respondedBy, 'vespi');
  assert.equal(d.history.at(-1).by, 'vespi');
});

test('RC6-S11-P2: the orchestrator still runs correction rounds and the work integrates', () => {
  const d = returned();
  assert.equal(delegation.reviewDelegation(d, { reviewer: 'vespi', corrections: ['cite the ledger'] }).state, 'needs_correction');
  assert.throws(() => delegation.integrateDelegation(d), /not accepted/);
  delegation.recordResult(d, { output: 'y' });
  assert.equal(delegation.reviewDelegation(d, { reviewer: 'vespi', accept: true }).state, 'accepted');
  assert.ok(delegation.integrateDelegation(d).digest);
});

test('RC6-S11-P3: the orchestrator still draws cards and they are attributed to it', () => {
  const d = returned();
  delegation.recordCard(d, { deck: 'eno', card: 'What would you not do?' });
  assert.equal(d.cards[0].by, 'vespi');
  assert.equal(delegation.personView(d).orchestrator, 'vespi');
});

test('RC6-S11-P4: a rewritten `orchestrator` field does not change what the receipt says', () => {
  const d = returned();
  delegation.reviewDelegation(d, { reviewer: 'vespi', accept: true });
  d.orchestrator = 'bunny';
  assert.equal(delegation.personView(d).orchestrator, 'vespi', 'the person view reports the binding');
  assert.equal(delegation.integrateDelegation(d).orchestrator, 'vespi', 'the receipt reports the binding');
});

// ---------------------------------------------------------------- S11 · negativo

test('RC6-S11-N1: a delegate that rewrites `orchestrator` to itself cannot review its own work', () => {
  const d = returned();
  d.orchestrator = 'bunny';
  assert.throws(
    () => delegation.reviewDelegation(d, { reviewer: 'bunny', accept: true }),
    /only the orchestrator/,
  );
  assert.notEqual(d.state, 'accepted');
  assert.throws(() => delegation.integrateDelegation(d), /not accepted/);
});

test('RC6-S11-N2: pointing the field at a third party does not buy a review either', () => {
  const d = returned();
  d.orchestrator = 'carol';
  assert.throws(() => delegation.reviewDelegation(d, { reviewer: 'carol', accept: true }), /only the orchestrator/);
  assert.notEqual(d.state, 'accepted');
});

test('RC6-S11-N3: a fabricated orchestrator cannot be credited with asking for corrections', () => {
  const d = returned();
  d.orchestrator = 'vespi-for-bunny';
  assert.throws(
    () => delegation.reviewDelegation(d, { reviewer: 'vespi-for-bunny', corrections: ['add evidence'] }),
    /only the orchestrator/,
  );
  assert.deepEqual(d.corrections, []);
  assert.notEqual(d.state, 'needs_correction');
});

test('RC6-S11-N4: an object that never went through createDelegation has no orchestrator at all', () => {
  const fake = {
    state: 'returned', task: 't', taskDigest: 'x', medium: MEDIUM, delegate: 'bunny',
    orchestrator: 'bunny', respondedBy: null, outputDigest: null, touched: [], violations: [],
    correctionRounds: 0, corrections: [], pendingCorrections: [], findings: [], sparks: [], cards: [],
    history: [],
  };
  assert.throws(
    () => delegation.reviewDelegation(fake, { reviewer: 'bunny', accept: true }),
    /never bound to an orchestrator/,
  );
  assert.notEqual(fake.state, 'accepted');
});

test('RC6-S11-N5: a third party, and a non-object, are both refused', () => {
  assert.throws(() => delegation.reviewDelegation(returned(), { reviewer: 'cheap-model', accept: true }), /only the orchestrator/);
  assert.throws(() => delegation.reviewDelegation(null, { reviewer: 'vespi', accept: true }), /never bound to an orchestrator/);
  assert.throws(() => delegation.reviewDelegation('vespi', { reviewer: 'vespi', accept: true }), /never bound to an orchestrator/);
});

// ---------------------------------------------------------------- S10 · el límite, en verde

// Re-sealing needs nothing but the documented algorithm: canonicalise, drop `digest` and `anchor`,
// SHA-256, hex. No private export, no module patch, no secret. That is the whole of S10.
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonicalize(v[k])]));
  }
  return v;
}

function reseal(r) {
  const stripped = {};
  for (const k of Object.keys(r)) if (k !== 'digest' && k !== 'anchor') stripped[k] = r[k];
  return createHash('sha256').update(JSON.stringify(canonicalize(stripped)), 'utf8').digest('hex');
}

// A real, honest receipt for an operation sitting at the human gate.
const blockedReceipt = () => buildReceipt({
  operation: { id: 'op-1', goal: 'move 100 USDC' },
  capabilityId: 'cap-1',
  authority: { spend: [] },
  outcome: { status: 'blocked', exercised: [], reason: 'the human gate is waiting' },
  evidence: {},
  verification: { verified: false, checks: { human_gate: false }, reason: 'waiting for the person' },
});

// The forgery: `blocked` becomes `verified`, the sealed verification becomes true, the list of what
// was not covered is emptied, and the digest is recomputed. Byte-for-byte a receipt the kernel
// would have produced for a step that genuinely succeeded.
const forgedAsVerified = () => {
  const forged = JSON.parse(JSON.stringify(blockedReceipt()));
  forged.status = 'verified';
  forged.outcome = 'verified';
  forged.verification = { verified: true, checks: { human_gate: true }, reason: 'all good' };
  forged.reason = 'done';
  forged.detail = 'all good';
  forged.notCovered = [];
  forged.digest = reseal(forged);
  return forged;
};

// Characterisation, not endorsement. The digest is unkeyed SHA-256 over the canonical body, so the
// whole of an attacker's toolkit is the algorithm printed in `src/receipt.js`. This test says so out
// loud, so `ok: true` is never read downstream as "this happened" or "vespi wrote it".
test('RC6-S10-C1: a re-sealed forgery verifies exactly like the honest receipt — integrity, not authenticity', () => {
  const honest = blockedReceipt();
  const tampered = JSON.parse(JSON.stringify(honest));
  tampered.status = 'verified';
  tampered.verification = { verified: true, checks: { human_gate: true }, reason: 'all good' };
  tampered.digest = reseal(tampered);

  assert.equal(honest.status, 'blocked');
  assert.equal(tampered.status, 'verified');
  assert.equal(verifyReceipt(honest).ok, true);
  assert.equal(verifyReceipt(tampered).ok, true, 'a re-sealed forgery is accepted: this is the unkeyed-digest limit');
  assert.equal(verifyReceipt(honest).reason, verifyReceipt(tampered).reason, 'the two verdicts are indistinguishable');

  // And what the re-sealing bought, in the function that trusts that `ok: true`.
  const agreement = { approved: [{ action: 'op-1' }, { action: 'op-2' }] };
  assert.equal(resumeFromReceipts([honest], agreement).needsPerson, true, 'honest: the blocked action returns to the person');
  const jumped = resumeFromReceipts([tampered], agreement);
  assert.equal(jumped.needsPerson, true, 'a matching local digest cannot cross the human gate');
  assert.equal(jumped.nextAction, null);
});

// ---------------------------------------------------------------- S10 · RED observado, GREEN tras aprobación

test('RC6-S10-T1: a re-sealed receipt cannot move continuity past an action that returned to the person', () => {
  const out = resumeFromReceipts([forgedAsVerified()], { approved: [{ action: 'op-1' }, { action: 'op-2' }] });
  assert.equal(out.needsPerson, true, 'today the forged receipt resumes op-2 with needsPerson: false');
  assert.equal(out.nextAction, null);
});

test('RC6-S10-T2: continuity does not resume on a receipt that never reached an external anchor', () => {
  const honest = buildReceipt({
    operation: { id: 'op-1', goal: 'g' },
    capabilityId: 'cap-1',
    authority: { spend: [] },
    outcome: { status: 'verified', exercised: [] },
    evidence: {},
    verification: { verified: true, checks: { a: true } },
  });
  assert.ok(honest.notCovered.includes('external anchor'));
  const out = resumeFromReceipts([honest], { approved: [{ action: 'op-1' }, { action: 'op-2' }] });
  assert.equal(out.needsPerson, true, 'today an unanchored receipt resumes the next action');
});

test('RC6-S10-T3: local digest remains integrity only; continuity requires a separate witness', () => {
  assert.equal(verifyReceipt(forgedAsVerified()).ok, true);
  const forged = forgedAsVerified();
  forged.anchor = { status: 'anchored', network: 'stellar:testnet', txHash: 'invented', digest: forged.digest };
  const agreement = { approved: [{ action: 'op-1' }, { action: 'op-2' }] };
  const out = resumeFromReceipts([forged], agreement, { verifyExternal: () => false });
  assert.equal(out.needsPerson, true);
  assert.equal(out.nextAction, null);
});

test('RC6-S10-P1: an independently confirmed external receipt permits the next approved action', () => {
  const receipt = buildReceipt({
    operation: { id: 'op-1', goal: 'move 100 USDC' },
    capabilityId: 'cap-1', authority: { spend: [] },
    outcome: { status: 'verified', exercised: [] }, evidence: {},
    verification: { verified: true, checks: { effect: true } },
  });
  receipt.anchor = { status: 'anchored', network: 'stellar:testnet', txHash: 'tx-real', digest: receipt.digest };
  const calls = [];
  const agreement = { approved: [{ action: 'op-1' }, { action: 'op-2' }] };
  const out = resumeFromReceipts([receipt], agreement, {
    verifyExternal: (...args) => { calls.push(args); return args[0] === 'tx-real' && args[1] === receipt.digest; },
  });
  assert.equal(out.needsPerson, false);
  assert.equal(out.nextAction.action, 'op-2');
  assert.deepEqual(calls, [['tx-real', receipt.digest, 'stellar:testnet']]);
});

test('RC6-S10-P2: explicitly local reversible work can continue without a network anchor', () => {
  const agreement = { approved: [{ action: 'op-1', localReversible: true }, { action: 'op-2' }] };
  const out = resumeFromReceipts([forgedAsVerified()], agreement, { verifyLocal: (action) => action === 'op-1' });
  assert.equal(out.needsPerson, false);
  assert.equal(out.nextAction.action, 'op-2');
});

test('RC6-S10-N1: local reversible classification alone cannot erase a human gate', () => {
  const agreement = { approved: [{ action: 'op-1', localReversible: true }, { action: 'op-2' }] };
  const out = resumeFromReceipts([forgedAsVerified()], agreement);
  assert.equal(out.needsPerson, true);
  assert.equal(out.nextAction, null);
});
