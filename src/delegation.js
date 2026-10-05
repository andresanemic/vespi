'use strict';

// K7: work the orchestrator delegates to a cheaper model (R41, R42, R44).
//
// The delegated work comes back with a receipt, the orchestrator reviews it and says what to
// fix, and nothing delegated is ever integrated without that review. A delegate can also fail
// to start (the host refuses to let it read its assignment), and that has to show up early.
//
// R45: the delegate leaves sparks and the orchestrator draws cards for itself. Cards are silent:
// they belong to the kernel, never to what the person is shown.

const { createHash } = require('node:crypto');
const path = require('node:path');
const { parseTime } = require('./time.js');

const SPARK_MAX_WORDS = 20;
const DECKS = new Set(['eno', 'entre']);

// Which orchestrator a delegation belongs to is written once, here, and never leaves this module.
// The constructor already refused `delegate === orchestrator`, but that check only ever saw the
// value at construction: the gate in `reviewDelegation` compared the reviewer against `d.orchestrator`,
// a plain writable field of the very object being reviewed. A delegate that holds `d` could rewrite
// that field, appoint itself, and review its own work — and `integrateDelegation` then produced a
// receipt that `verifyReceipt` accepted. The field stays, because the receipt and the person view are
// built from it, but it is now a report and not the authority. The authority lives here, and a
// delegation with no binding is refused rather than trusted (S11).
//
// What this does NOT buy, stated plainly: this binds the *declared* orchestrator, it does not
// authenticate the *caller*. Nothing inside this process can tell which agent is on the other end of
// `reviewDelegation`, so a caller that can reach the object can still pass `reviewer: 'vespi'`. That
// half is the host's job and it is a decision, not a patch.
const BOUND_ORCHESTRATOR = new WeakMap();

function boundOrchestrator(d) {
  try {
    if (d !== null && typeof d === 'object') {
      const bound = BOUND_ORCHESTRATOR.get(d);
      if (typeof bound === 'string' && bound.length > 0) return bound;
    }
  } catch {
  }
  return null;
}

// Where identity is reported. The binding wins when there is one, so a rewritten field cannot put a
// false orchestrator into the receipt, into the person view, or into the attribution of a card.
function orchestratorOf(d) {
  const bound = boundOrchestrator(d);
  if (bound !== null) return bound;
  return d && typeof d === 'object' ? d.orchestrator : null;
}

function digestOf(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// What a delegation recorded when its delivered output could not be sealed. It is a marker of this
// module, not text a delegate chose, so it can never be confused with a file that was touched.
const UNSEALABLE_OUTPUT = 'the delivered output could not be sealed';

function text(value) {
  return typeof value === 'string' && value.length > 0;
}

function list(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.length > 0) : [];
}

function normalizeMedium(medium) {
  const raw = medium !== null && typeof medium === 'object' && !Array.isArray(medium) ? medium : {};
  return {
    cwd: text(raw.cwd) ? raw.cwd : '',
    material: list(raw.material),
    forbidden: list(raw.forbidden),
  };
}

function push(d, state, by) {
  d.state = state;
  try {
    d.history.push({ state, by: by || null, at: new Date().toISOString() });
  } catch {
  }
  return d;
}

function createDelegation({ task, medium, delegate, orchestrator, deadlineMs, now }) {
  // Store a fixed due time so later status checks do not need the creation clock.
  if (deadlineMs !== undefined && (!Number.isInteger(deadlineMs) || deadlineMs <= 0)) {
    throw new Error('deadlineMs must be a positive integer');
  }
  let createdAt = Date.now();
  if (typeof now === 'function') {
    let value;
    let read = false;
    try {
      value = now();
      read = true;
    } catch {
    }
    if (read && value !== null && (typeof value === 'object' || typeof value === 'function')) {
      let then;
      try {
        then = value.then;
      } catch {
        throw new Error('reloj inyectado no comprobable');
      }
      if (typeof then === 'function') {
        try {
          // The clock contract is synchronous; contain any eventual rejection before refusing it.
          Promise.resolve(value).catch(() => {});
        } catch {
        }
        throw new Error('reloj inyectado no comprobable');
      }
    }
    if (read) {
      const parsed = parseTime(value);
      if (parsed !== null) createdAt = parsed;
    }
  }
  const taskText = text(task) ? task : '';
  const delegateId = text(delegate) ? delegate : null;
  const orchestratorId = text(orchestrator) ? orchestrator : null;
  if (!delegateId || !orchestratorId) throw new Error('delegate and orchestrator are required');
  if (delegateId === orchestratorId) {
    throw new Error(`delegate and orchestrator must be different: both are ${delegateId}`);
  }
  const dueAt = deadlineMs === undefined ? undefined : createdAt + deadlineMs;
  if (deadlineMs !== undefined && parseTime(dueAt) === null) {
    throw new Error('deadlineMs produces a dueAt outside the supported time contract');
  }
  const created = push({
    task: taskText,
    ...(deadlineMs === undefined ? {} : { dueAt }),
    taskDigest: digestOf(taskText),
    medium: normalizeMedium(medium),
    delegate: delegateId,
    orchestrator: orchestratorId,
    state: 'created',
    history: [],
    touched: [],
    violations: [],
    outputDigest: null,
    corrections: [],
    pendingCorrections: [],
    correctionRounds: 0,
    findings: [],
    respondedBy: null,
    sparks: [],
    cards: [],
  }, 'created', orchestratorId);
  BOUND_ORCHESTRATOR.set(created, orchestratorId);
  return created;
}

function delegationStatus(delegation, now = Date.now()) {
  const dueAt = Number.isFinite(delegation?.dueAt) ? delegation.dueAt : null;
  const resolved = Boolean(delegation?.reviewReceipt)
    || ['accepted', 'rejected', 'integrated', 'completed'].includes(delegation?.state);
  let nowMs = Date.now();
  const parsed = parseTime(now);
  if (parsed !== null) nowMs = parsed;
  return { overdue: dueAt !== null && !resolved && nowMs > dueAt, dueAt };
}

function recordStart(d, { readTask, firstStep, rejected } = {}) {
  const rejection = text(rejected) ? rejected : null;
  const read = readTask === true;
  if (rejection || !read) {
    const reason = rejection
      ? `the delegate could not read the assignment: ${rejection}`
      : 'the delegate never confirmed reading the assignment';
    d.reason = reason;
    push(d, 'failed_to_start', d.delegate);
    return { relaunch: true, reason };
  }
  push(d, 'running', d.delegate);
  return { relaunch: false, reason: null };
}

// A touched file is out of bounds when it is the forbidden path itself or lives under it.
// A shared prefix is not containment: '.env.example' is not '.env'.
function within(cwd, touched, forbidden) {
  const from = path.resolve(cwd, forbidden);
  const to = path.resolve(cwd, touched);
  const rel = path.relative(from, to);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// The other half of the question, which the forbidden list cannot answer on its own: is the file
// inside the medium the orchestrator agreed at all? `violationsFor` used to ask only whether the file
// was on the deny list, so an empty `forbidden` bounded nothing and a delegate could touch
// `C:/Users/andre/.ssh/id_rsa` with a clean report. The agreed medium is the allowed side: a file
// has to live in the area the delegation was given (`cwd`), and only then does the deny list get to
// take it away (T1-X7).
// A delegation created with no medium declares no area, so there is nothing it was allowed to
// touch; every file it reports is out of the medium. `material` is carried and sealed as part of
// what was agreed, but it does not narrow the area: K7.10 pins that a file under `cwd` and outside
// `material` (`/repo/.env.example` with material `['src/']`) stays in bounds.
function inMedium(d, file) {
  const cwd = d.medium.cwd;
  if (!cwd) return false;
  return within(cwd, file, '.');
}

function violationsFor(d, touched) {
  const cwd = d.medium.cwd;
  return touched.filter((file) => !inMedium(d, file) || d.medium.forbidden.some((forbidden) => within(cwd, file, forbidden)));
}

// A spark is a short line the delegate leaves on the way out (R45). Over 20 words is not a
// spark, it is a report, and the report is the result: the call is refused before it commits.
function readSpark(spark) {
  if (spark === undefined || spark === null) return null;
  if (!text(spark)) throw new Error('a spark must be text');
  const words = spark.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length > SPARK_MAX_WORDS) {
    throw new Error(`a spark is at most ${SPARK_MAX_WORDS} words, this one is ${words.length}`);
  }
  return spark;
}

// A violation is a fact about the delegation, not about the last delivery. `recordResult` used to
// write the list the delegate returned with, so a second, clean result erased a violation that had
// already been recorded and the work went back to `returned`. A violation, once recorded, stays:
// the list only grows (never repeated), the state stays `out_of_bounds` while one is on record, and
// the receipt carries it (T1-X5). `touched` still says what the last delivery touched — that is
// what it means — but what was out of bounds stays on the record however many times it is answered.
function recordResult(d, { output, touched, spark } = {}) {
  if (d.state === 'failed_to_start') {
    throw new Error(`this delegation failed to start and cannot deliver: relaunch it instead (${d.reason || 'no reason recorded'})`);
  }
  const note = readSpark(spark);
  const files = list(touched);
  const violations = [...new Set([...d.violations, ...violationsFor(d, files)])];
  // Sealing the output is the one step here the delegate's own data can make fail: JSON.stringify
  // throws a RangeError on an output nested past the stack, and a BigInt or a getter throws too. Left
  // unguarded, that RangeError escaped recordResult, so the delegation stayed `running` with no
  // outputDigest, no violation on record and no receipt at all: a failure that leaves no trace. A
  // result this kernel cannot seal is refused in words of its own and recorded as a violation, so
  // what happened is on the record instead of nowhere (R1 finding H7).
  let sealed = null;
  try {
    const serialized = text(output) ? output : JSON.stringify(output === undefined ? null : output);
    sealed = typeof serialized === 'string' ? digestOf(serialized) : null;
  } catch {
    sealed = null;
  }
  if (sealed === null) {
    d.outputDigest = null;
    d.touched = files;
    d.violations = [...new Set([...violations, UNSEALABLE_OUTPUT])];
    d.pendingCorrections = [];
    if (note !== null) d.sparks.push(note);
    push(d, 'out_of_bounds', d.delegate);
    d.reason = 'the delivered output could not be sealed, so this kernel cannot say what came back';
    return d;
  }
  d.outputDigest = sealed;
  d.touched = files;
  d.violations = violations;
  d.pendingCorrections = [];
  if (note !== null) d.sparks.push(note);
  push(d, violations.length > 0 ? 'out_of_bounds' : 'returned', d.delegate);
  return d;
}

// A card the orchestrator draws for itself (R45): eno or entre, always silent.
function recordCard(d, { deck, card, perturbation } = {}) {
  if (!DECKS.has(deck)) {
    throw new Error(`a card is drawn from the eno or entre deck, not from ${String(deck)}`);
  }
  const note = readSpark(card);
  if (note === null) throw new Error('a card needs text');
  d.cards.push({
    deck,
    card: note,
    perturbation: text(perturbation) ? perturbation : null,
    silent: true,
    by: orchestratorOf(d),
    at: new Date().toISOString(),
  });
  return d;
}

// What the person is shown. The cards are deliberately absent: they are the Entre's own.
function personView(d) {
  return {
    state: d.state,
    task: d.task,
    delegate: d.delegate,
    orchestrator: orchestratorOf(d),
    outputDigest: d.outputDigest,
    touched: [...d.touched],
    correctionRounds: d.correctionRounds,
    corrections: [...d.corrections],
    sparks: [...d.sparks],
  };
}

// The seal is the same canonical digest receipt.js uses, so verifyReceipt from receipt.js
// verifies a delegation receipt as it verifies any other (digest and anchor excluded).
// The copy is built without a prototype on purpose. Assigning to `{}` runs the inherited
// `__proto__` setter, so a body carrying that key as its own property (JSON.parse makes one, and a
// receipts file read from disk is full of them) either changed this copy's prototype and lost the
// key or replaced it, and the key then never reached the sealed text: two different bodies hashed to
// the same digest and verifyReceipt answered ok on both (R1 finding H5). With no prototype there is
// no inherited setter, every key of the body becomes exactly the data property it was, and the
// string this returns for a body without that key is byte for byte the one a plain object gave.
// This is the copy emergency.js:497 already builds, and the reason it does.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function seal(receipt) {
  // Without a prototype here too, for the same reason: a `__proto__` key of the receipt has to be a
  // key of the sealed text rather than a write to an inherited setter that goes nowhere.
  const stripped = Object.create(null);
  for (const key of Object.keys(receipt)) {
    if (key === 'digest' || key === 'anchor') continue;
    stripped[key] = receipt[key];
  }
  return createHash('sha256').update(JSON.stringify(canonicalize(stripped)), 'utf8').digest('hex');
}

function delegationReceipt(d) {
  const receipt = {
    state: d.state,
    task: d.task,
    taskDigest: d.taskDigest,
    medium: { ...d.medium, material: [...d.medium.material], forbidden: [...d.medium.forbidden] },
    delegate: d.delegate,
    orchestrator: orchestratorOf(d),
    respondedBy: d.respondedBy,
    outputDigest: d.outputDigest,
    touched: [...d.touched],
    violations: [...d.violations],
    correctionRounds: d.correctionRounds,
    corrections: [...d.corrections],
    sparks: [...d.sparks],
    // The cards are the Entre's own (R45): the receipt is what travels out of the delegation, and
    // a card marked `silent` is by definition not for whoever receives it. They stay in the
    // delegation's own state, where the orchestrator drew them, and no silent card is sealed into a
    // receipt (T1-X6). A card that is not silent — a deck that ever stops marking itself so — would
    // still travel, because the rule is about the mark and not about the deck.
    cards: d.cards.filter((card) => card.silent !== true).map((card) => ({ ...card })),
    at: new Date().toISOString(),
  };
  receipt.digest = seal(receipt);
  return receipt;
}

// Nothing delegated is integrated without the orchestrator's review (R42, R44):
// 'accepted' is reachable only from a result that is in bounds, has no pending correction
// and was accepted by the orchestrator. The reviewer is compared against the orchestrator this
// module bound at construction, never against a field of `d` that whoever holds `d` can rewrite (S11).
function reviewDelegation(d, { reviewer, findings, corrections, accept } = {}) {
  const orchestrator = boundOrchestrator(d);
  if (orchestrator === null) {
    throw new Error(`only the orchestrator may review delegated work: this object was never bound to an orchestrator, so the review is refused instead of trusted (reviewer (${String(reviewer)}))`);
  }
  if (reviewer !== orchestrator) {
    throw new Error(`only the orchestrator may review delegated work: reviewer (${String(reviewer)}) must be the orchestrator (${orchestrator})`);
  }
  d.respondedBy = reviewer;
  d.findings = list(findings);
  const asked = list(corrections);
  if (asked.length > 0) {
    d.corrections.push(...asked);
    d.pendingCorrections = asked;
    d.correctionRounds += 1;
    return push(d, 'needs_correction', reviewer);
  }
  if (accept === true && d.state === 'returned' && d.pendingCorrections.length === 0) {
    return push(d, 'accepted', reviewer);
  }
  return d;
}

function integrateDelegation(d) {
  if (d.state !== 'accepted') {
    throw new Error(`delegated work is not accepted: state is ${d.state}; nothing delegated is integrated without orchestrator review`);
  }
  return delegationReceipt(d);
}

module.exports = {
  createDelegation,
  delegationStatus,
  recordStart,
  recordResult,
  reviewDelegation,
  integrateDelegation,
  delegationReceipt,
  recordCard,
  personView,
};
