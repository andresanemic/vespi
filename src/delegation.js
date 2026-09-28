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

const SPARK_MAX_WORDS = 20;
const DECKS = new Set(['eno', 'entre']);

function digestOf(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

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

function createDelegation({ task, medium, delegate, orchestrator }) {
  const taskText = text(task) ? task : '';
  const delegateId = text(delegate) ? delegate : null;
  const orchestratorId = text(orchestrator) ? orchestrator : null;
  if (!delegateId || !orchestratorId) throw new Error('delegate and orchestrator are required');
  if (delegateId === orchestratorId) {
    throw new Error(`delegate and orchestrator must be different: both are ${delegateId}`);
  }
  return push({
    task: taskText,
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

function violationsFor(d, touched) {
  const cwd = d.medium.cwd;
  return touched.filter((file) => d.medium.forbidden.some((forbidden) => within(cwd, file, forbidden)));
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

function recordResult(d, { output, touched, spark } = {}) {
  if (d.state === 'failed_to_start') {
    throw new Error(`this delegation failed to start and cannot deliver: relaunch it instead (${d.reason || 'no reason recorded'})`);
  }
  const note = readSpark(spark);
  const files = list(touched);
  const violations = violationsFor(d, files);
  d.outputDigest = digestOf(text(output) ? output : JSON.stringify(output === undefined ? null : output));
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
    by: d.orchestrator,
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
    orchestrator: d.orchestrator,
    outputDigest: d.outputDigest,
    touched: [...d.touched],
    correctionRounds: d.correctionRounds,
    corrections: [...d.corrections],
    sparks: [...d.sparks],
  };
}

// The seal is the same canonical digest receipt.js uses, so verifyReceipt from receipt.js
// verifies a delegation receipt as it verifies any other (digest and anchor excluded).
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function seal(receipt) {
  const stripped = {};
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
    orchestrator: d.orchestrator,
    respondedBy: d.respondedBy,
    outputDigest: d.outputDigest,
    touched: [...d.touched],
    correctionRounds: d.correctionRounds,
    corrections: [...d.corrections],
    sparks: [...d.sparks],
    cards: d.cards.map((card) => ({ ...card })),
    at: new Date().toISOString(),
  };
  receipt.digest = seal(receipt);
  return receipt;
}

// Nothing delegated is integrated without the orchestrator's review (R42, R44):
// 'accepted' is reachable only from a result that is in bounds, has no pending correction
// and was accepted by the orchestrator.
function reviewDelegation(d, { reviewer, findings, corrections, accept } = {}) {
  if (reviewer !== d.orchestrator) {
    throw new Error(`only the orchestrator may review delegated work: reviewer (${String(reviewer)}) must be the orchestrator (${d.orchestrator})`);
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
  recordStart,
  recordResult,
  reviewDelegation,
  integrateDelegation,
  delegationReceipt,
  recordCard,
  personView,
};
