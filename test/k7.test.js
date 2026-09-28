// K7 TDD (RED first): delegated work that comes back with a receipt, gets reviewed, and
// nothing goes in without that review (R41, R42, R44), plus sparks and cards (R45).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const { verifyReceipt } = require('../src/receipt.js');
const {
  createDelegation, recordStart, recordResult, recordCard,
  reviewDelegation, integrateDelegation, delegationReceipt, personView,
} = require('../src/delegation.js');

const TASK = 'write the incident report';
const TASK_DIGEST = '8d6b43176192a0ed0948a97eb617b6a496ec023d49614e9484fd6be856debcde';
const OUTPUT = 'report drafted with 3 findings';
const OUTPUT_DIGEST = '0f5eda5e939e6a17f30fbaa0b89f7020d731e0fac71fd7d7812cebb2d78fb99d';
const OUTPUT_FIXED = 'report drafted with 3 findings, 2 fixed';
const OUTPUT_FIXED_DIGEST = 'be9234720efd47a4ce31d3a847217ac9dbb4d59f3657b829772b42f3225a5d72';

const MEDIUM = {
  cwd: '/repo',
  material: ['src/'],
  forbidden: ['/repo/.env'],
};

function newDelegation(over = {}) {
  return createDelegation({ task: TASK, medium: MEDIUM, delegate: 'cheap-model', orchestrator: 'vespi', ...over });
}

// --- 1. createDelegation ---

test('K7.1 createDelegation keeps the task, its sha256, the medium, both ids, state created and a history', () => {
  const d = newDelegation();
  assert.equal(d.state, 'created');
  assert.equal(d.task, TASK);
  assert.equal(d.taskDigest, TASK_DIGEST);
  assert.equal(d.delegate, 'cheap-model');
  assert.equal(d.orchestrator, 'vespi');
  assert.deepEqual(d.medium, MEDIUM);
  assert.ok(Array.isArray(d.history) && d.history.length > 0);
  assert.equal(d.history[0].state, 'created');
});

test('K7.2 createDelegation refuses a delegate that is the orchestrator, and says which ones', () => {
  assert.throws(
    () => createDelegation({ task: TASK, medium: MEDIUM, delegate: 'vespi', orchestrator: 'vespi' }),
    (err) => /delegate/.test(err.message) && /orchestrator/.test(err.message) && /vespi/.test(err.message),
  );
});

test('K7.3 createDelegation without a medium still starts with empty material and forbidden lists', () => {
  const d = createDelegation({ task: TASK, delegate: 'cheap-model', orchestrator: 'vespi' });
  assert.equal(d.state, 'created');
  assert.deepEqual(d.medium.material, []);
  assert.deepEqual(d.medium.forbidden, []);
});

// --- 2. recordStart ---

test('K7.4 recordStart with the assignment read and a first step puts the delegate in running', () => {
  const d = newDelegation();
  const out = recordStart(d, { readTask: true, firstStep: 'read the brief' });
  assert.equal(d.state, 'running');
  assert.equal(out.relaunch, false);
  assert.equal(d.history[d.history.length - 1].state, 'running');
});

test('K7.5 a delegate that never confirmed reading the assignment fails to start and asks for a relaunch', () => {
  for (const start of [{ readTask: false, firstStep: 'read the brief' }, { firstStep: 'read the brief' }]) {
    const d = newDelegation();
    const out = recordStart(d, start);
    assert.equal(d.state, 'failed_to_start', JSON.stringify(start));
    assert.equal(out.relaunch, true, JSON.stringify(start));
    assert.match(out.reason, /assignment/i);
  }
});

test('K7.6 a host permission rejected by name fails to start and the reason carries the rejection', () => {
  const d = newDelegation();
  const out = recordStart(d, { readTask: false, firstStep: 'read the brief', rejected: 'read outside the medium' });
  assert.equal(d.state, 'failed_to_start');
  assert.equal(out.relaunch, true);
  assert.match(out.reason, /read outside the medium/);
  assert.match(out.reason, /assignment/i);
});

// --- 3. recordResult ---

function running() {
  const d = newDelegation();
  recordStart(d, { readTask: true, firstStep: 'read the brief' });
  return d;
}

test('K7.7 recordResult keeps the sha256 of the output, the files touched and state returned', () => {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: ['src/report.md'] });
  assert.equal(d.state, 'returned');
  assert.equal(d.outputDigest, OUTPUT_DIGEST);
  assert.deepEqual(d.touched, ['src/report.md']);
});

test('K7.8 a touched file that is exactly forbidden is out of bounds and names the file', () => {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: ['src/report.md', '/repo/.env'] });
  assert.equal(d.state, 'out_of_bounds');
  assert.deepEqual(d.violations, ['/repo/.env']);
  assert.equal(d.outputDigest, OUTPUT_DIGEST, 'the output is still recorded');
});

test('K7.9 a touched file inside a forbidden directory is out of bounds', () => {
  const d = createDelegation({
    task: TASK,
    medium: { cwd: '/repo', material: ['src/'], forbidden: ['/repo/secrets'] },
    delegate: 'cheap-model',
    orchestrator: 'vespi',
  });
  recordStart(d, { readTask: true, firstStep: 'read the brief' });
  recordResult(d, { output: OUTPUT, touched: ['secrets/keys.txt'] });
  assert.equal(d.state, 'out_of_bounds');
  assert.deepEqual(d.violations, ['secrets/keys.txt'], 'the violation names the file the delegate touched');
});

test('K7.10 a file that only shares a prefix with a forbidden one stays in bounds', () => {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: ['/repo/.env.example', '/repo/.environment/notes.md'] });
  assert.equal(d.state, 'returned');
  assert.deepEqual(d.violations, []);
});

// --- 4. reviewDelegation ---

test('K7.11 corrections send the work back, and only a new result and a new review accept it', () => {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: ['src/report.md'] });
  reviewDelegation(d, { reviewer: 'vespi', findings: ['thin on evidence'], corrections: ['cite the ledger'] });
  assert.equal(d.state, 'needs_correction');
  assert.deepEqual(d.corrections, ['cite the ledger']);

  recordResult(d, { output: OUTPUT_FIXED, touched: ['src/report.md'] });
  assert.deepEqual(d.pendingCorrections, [], 'delivering again clears what was asked');
  reviewDelegation(d, { reviewer: 'vespi', findings: ['good now'], corrections: [], accept: true });
  assert.equal(d.state, 'accepted');
  assert.equal(d.respondedBy, 'vespi');
  assert.equal(d.correctionRounds, 1);
  assert.deepEqual(d.corrections, ['cite the ledger'], 'what was improved stays on the record');
});

test('K7.12 only the orchestrator may review the delegated work', () => {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: [] });
  assert.throws(
    () => reviewDelegation(d, { reviewer: 'cheap-model', findings: [], corrections: [], accept: true }),
    (err) => /reviewer/.test(err.message) && /orchestrator/.test(err.message) && /cheap-model/.test(err.message),
  );
});

test('K7.13 accepting while corrections are still pending does not accept, and does not integrate', () => {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: [] });
  reviewDelegation(d, { reviewer: 'vespi', corrections: ['cite the ledger'] });
  reviewDelegation(d, { reviewer: 'vespi', accept: true });
  assert.notEqual(d.state, 'accepted');
  assert.throws(() => integrateDelegation(d), /accepted/);
});

// --- 5. integrateDelegation ---

test('K7.14 a returned result that was never reviewed cannot be integrated', () => {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: [] });
  assert.throws(() => integrateDelegation(d), /accepted/);
  assert.throws(() => integrateDelegation(d), /returned/);
});

test('K7.15 work that went out of bounds can never be accepted or integrated', () => {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: ['/repo/.env'] });
  reviewDelegation(d, { reviewer: 'vespi', accept: true });
  assert.equal(d.state, 'out_of_bounds');
  assert.throws(() => integrateDelegation(d), /accepted/);
});

test('K7.16 a delegate that never started cannot deliver, accept or integrate', () => {
  const d = newDelegation();
  recordStart(d, { readTask: false, rejected: 'read outside the medium' });
  assert.throws(() => recordResult(d, { output: OUTPUT, touched: [] }), /failed to start/);
  assert.equal(d.state, 'failed_to_start', 'a failed delegate stays failed; a relaunch is a new delegation');
  assert.throws(() => integrateDelegation(d), /accepted/);
});

test('K7.17 integrateDelegation on accepted work hands back the delegation receipt', () => {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: ['src/report.md'] });
  reviewDelegation(d, { reviewer: 'vespi', accept: true });
  const receipt = integrateDelegation(d);
  assert.equal(receipt.outputDigest, OUTPUT_DIGEST);
  assert.equal(receipt.delegate, 'cheap-model');
});

// --- 6. delegationReceipt ---

function corrected() {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: ['src/report.md'] });
  reviewDelegation(d, { reviewer: 'vespi', findings: ['thin on evidence'], corrections: ['cite the ledger'] });
  recordResult(d, { output: OUTPUT_FIXED, touched: ['src/report.md'] });
  reviewDelegation(d, { reviewer: 'vespi', accept: true });
  return d;
}

test('K7.18 the final receipt carries the assignment, the medium, both ids, the accepted output and the corrections', () => {
  const receipt = delegationReceipt(corrected());
  assert.equal(receipt.task, TASK);
  assert.equal(receipt.taskDigest, TASK_DIGEST);
  assert.deepEqual(receipt.medium, MEDIUM);
  assert.equal(receipt.delegate, 'cheap-model');
  assert.equal(receipt.orchestrator, 'vespi');
  assert.equal(receipt.respondedBy, 'vespi', 'the orchestrator that answered for the result');
  assert.equal(receipt.outputDigest, OUTPUT_FIXED_DIGEST, 'the fingerprint of the accepted output, not the first one');
  assert.equal(receipt.correctionRounds, 1);
  assert.deepEqual(receipt.corrections, ['cite the ledger'], 'the list of what was improved');
});

test('K7.19 the final receipt verifies with verifyReceipt, and any edit to it breaks the seal', () => {
  const receipt = delegationReceipt(corrected());
  assert.match(receipt.digest, /^[0-9a-f]{64}$/);
  assert.equal(verifyReceipt(receipt).ok, true);
  for (const mutate of [
    (r) => { r.outputDigest = OUTPUT_DIGEST; },
    (r) => { r.corrections = []; },
    (r) => { r.respondedBy = 'cheap-model'; },
    (r) => { r.medium.forbidden = []; },
  ]) {
    const copy = JSON.parse(JSON.stringify(receipt));
    mutate(copy);
    assert.equal(verifyReceipt(copy).ok, false, 'an edited receipt must not verify');
  }
});

// --- 7. sparks and cards ---

const SPARK = 'the ledger line was missing so the count looked smaller';
const TWENTY = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
const TWENTY_ONE = `${TWENTY} twentyone`;
const CARD = 'the orchard keeps its own accounts';

test('K7.20 a spark of up to 20 words rides along with the result and lands in the receipt', () => {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: [], spark: SPARK });
  assert.deepEqual(d.sparks, [SPARK]);
  const receipt = delegationReceipt(d);
  assert.deepEqual(receipt.sparks, [SPARK]);
  assert.equal(verifyReceipt(receipt).ok, true);

  const d20 = running();
  recordResult(d20, { output: OUTPUT, touched: [], spark: TWENTY });
  assert.deepEqual(d20.sparks, [TWENTY], '20 words is allowed');
});

test('K7.21 a spark of more than 20 words is refused, and the delegate keeps the result it already had', () => {
  const d = running();
  assert.throws(() => recordResult(d, { output: OUTPUT, touched: [], spark: TWENTY_ONE }), /20 words/);
  assert.deepEqual(d.sparks, [], 'a refused spark is not stored');
  assert.equal(d.state, 'running', 'a refused spark does not deliver the result');
});

test('K7.22 a card is kept silent in the receipt and never in what the person is shown', () => {
  const d = running();
  recordResult(d, { output: OUTPUT, touched: [] });
  recordCard(d, { deck: 'entre', card: CARD, perturbation: 'a slow question' });
  assert.equal(d.cards.length, 1);
  assert.equal(d.cards[0].silent, true, 'the card is state silent');
  assert.equal(d.cards[0].deck, 'entre');
  assert.equal(d.cards[0].perturbation, 'a slow question');

  reviewDelegation(d, { reviewer: 'vespi', accept: true });
  const receipt = delegationReceipt(d);
  assert.equal(receipt.cards.length, 1);
  assert.equal(receipt.cards[0].card, CARD);
  assert.equal(receipt.cards[0].silent, true);
  assert.equal(verifyReceipt(receipt).ok, true);

  const view = personView(d);
  assert.equal(view.state, 'accepted');
  assert.equal(view.cards, undefined, 'cards are not part of what the person is shown');
  assert.doesNotMatch(JSON.stringify(view), /the orchard keeps its own accounts/);
  assert.doesNotMatch(JSON.stringify(view), /a slow question/);
});

test('K7.23 a card is only drawn from the eno or entre deck', () => {
  const d = running();
  for (const deck of ['eno', 'entre']) {
    recordCard(d, { deck, card: CARD, perturbation: null });
  }
  assert.equal(d.cards.length, 2);
  assert.throws(() => recordCard(d, { deck: 'memoria', card: CARD }), /eno|entre/);
  assert.equal(d.cards.length, 2, 'a refused card is not stored');
});
