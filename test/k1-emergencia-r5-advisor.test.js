'use strict';

// K1 · the fifth independent reviewer's adversarial corpus, brought into this branch (fix round 5).
//
// Every title keeps the reviewer's R5## number so a failure can be traced back to it. The fixture is
// this file's own, in the style of `emergency.test.js` and built on the same simulated host, and the
// assertions are the reviewer's, kept as they were written: six red ones and fourteen that were
// already green. What they prove is one thing — the exercise never authenticated its caller, so a
// legitimate reviewer, the trigger verifier or the owner could spend the authority and then close
// their own review with nothing but the permission and the ledger.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const emergency = require('../src/emergency.js');
const { createHost } = require('./emergency-host.js');

const AT = '2026-10-04T12:00:00Z';
const LATER = '2026-10-04T12:01:00Z';
const EXT = '2026-10-06T00:00:00Z';
// One simulated host for this file. It is not an identity provider and it proves nothing about
// anybody: a principal here is a frozen object the port hands back, and it is the same object for the
// same name, which is the whole contract `src/emergency.js` asks a host for.
const host = createHost();

const GRANT = (overrides = {}) => ({
  id: 'r5',
  owner: 'owner',
  grantee: 'agent',
  destination: 'clinic',
  purpose: 'prior emergency grant',
  actions: ['read'],
  scope: ['record-ref'],
  startsAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-10-05T00:00:00Z',
  maxUses: 3,
  reviewDueMs: 60000,
  triggers: [{ id: 'critical', verifierId: 'sensor' }],
  reviewers: ['reviewer'],
  pausers: ['owner'],
  ...overrides,
});

const REQUEST = (overrides = {}) => ({
  useId: 'use-1',
  actor: 'agent',
  action: 'read',
  subject: 'record-ref',
  destination: 'clinic',
  triggerId: 'critical',
  triggerSignal: { id: 'certified-1', source: 'sensor' },
  ...overrides,
});

// `checks` counts the calls the independent verifier received, because "the grant was not spent" and
// "the verifier was never asked" are two different claims and a refusal has to make both of them.
async function setup(overrides = {}, deps = {}) {
  let checks = 0;
  let renewals = 0;
  const options = {
    authenticate: host.authenticate,
    authorizeGrantor: (candidate) => ({ verified: true, grantor: candidate.owner }),
    resolveVerifier: (id) => ({
      id,
      verify: (_trigger, signal) => {
        checks += 1;
        return { verified: signal.id === 'certified-1' || signal.id === 'certified-2' };
      },
    }),
    authorizeRenewal: (candidate) => { renewals += 1; return { verified: true, grantor: candidate.owner }; },
    ...deps,
  };
  const permission = await emergency.createEmergencyPermission(GRANT(overrides), options);
  const ledger = emergency.createEmergencyLedger();
  const req = (extra = {}) => REQUEST(extra);
  const use = (request = req(), extra = {}, on = permission) => emergency.exerciseEmergency(on, request, { ledger, now: AT, ...extra });
  const review = (by, decision = 'accept', on = permission) => emergency.reviewEmergencyUse(on, 'use-1', { ledger, by, decision, now: LATER });
  const state = (on = permission) => emergency.getEmergencyState(on, { ledger, now: AT });
  return { permission, ledger, req, use, review, state, checks: () => checks, renewals: () => renewals };
}

const AGENT = () => host.principal('agent');

// ─── A01 · the exercise authenticates who is calling (R501-R505) ───────────────────────────────

test('R501 an unauthenticated bearer cannot spend another principal grant', async () => {
  const s = await setup();
  const answer = s.use();
  assert.equal(answer.state, 'blocked', 'No authenticated executor was supplied, but the grant was spent');
  assert.equal(s.checks(), 0);
  assert.equal(s.state().uses, 0);
});

test('R502 an honest reviewer cannot exercise as the agent and then review its own use', async () => {
  const s = await setup();
  const reviewer = host.principal('reviewer');
  const answer = s.use(s.req(), { by: reviewer });
  let closed = null;
  if (answer.state === 'review_pending') closed = s.review(reviewer);
  assert.equal(answer.state, 'blocked', JSON.stringify({ actualExecutor: 'reviewer', suppliedActor: 'agent',
    exercised: answer.state, ownReview: closed && closed.review, covered: closed && closed.coverage }));
});

test('R503 a frozen lookalike grantee principal cannot authorize exercise', async () => {
  const s = await setup();
  const answer = s.use(s.req(), { by: Object.freeze({ id: 'agent' }) });
  assert.equal(answer.state, 'blocked', 'A forged executor principal was ignored instead of refused');
  assert.equal(s.state().uses, 0);
});

test('R504 the independent signal verifier cannot exercise and close its own review', async () => {
  const s = await setup({ reviewers: ['sensor'] });
  const sensor = host.principal('sensor');
  const answer = s.use(s.req(), { by: sensor });
  const closed = answer.state === 'review_pending' ? s.review(sensor) : null;
  assert.equal(answer.state, 'blocked', JSON.stringify({ actualExecutor: 'sensor',
    triggerVerifier: answer.receipt.trigger && answer.receipt.trigger.verifierId,
    review: closed && closed.review }));
});

test('R505 an honest owner cannot pretend to be the grantee then approve its own use', async () => {
  const s = await setup({ reviewers: ['owner'] });
  const owner = host.principal('owner');
  const answer = s.use(s.req(), { by: owner });
  const closed = answer.state === 'review_pending' ? s.review(owner) : null;
  assert.equal(answer.state, 'blocked', JSON.stringify({ actualExecutor: 'owner', review: closed && closed.review }));
});

// The positive control the refusal needs beside it: with the authentic grantee principal presented,
// the same request is a use, and the independent reviewer closes it. A door that refuses everything
// would pass all five cases above and mean nothing.
test('A01-POS the authentic grantee principal exercises and a declared reviewer closes the review', async () => {
  const s = await setup();
  const answer = s.use(s.req(), { by: AGENT() });
  assert.equal(answer.state, 'review_pending');
  assert.equal(s.checks(), 1);
  assert.equal(s.state().uses, 1);
  const closed = s.review(host.principal('reviewer'));
  assert.equal(closed.review.status, 'reviewed');
  assert.equal(closed.review.decision, 'accept');
  assert.equal(closed.review.by, 'reviewer');
  // Nothing here claimed the effect happened: accepting a review is a decision about a use, not
  // proof that anybody read the record.
  assert.equal(closed.status, 'not_verified');
  assert.equal(closed.verification.checks.effect_verified, false);
});

// ─── A04 · a contradictory port is refused (R519) ──────────────────────────────────────────────

test('R519 a port giving different principals for the same name in two roles is refused', async () => {
  // Contract robustness only, and not an honest-host bypass: this port breaks the one rule the kernel
  // depends on, which is that one name is one person. It is refused anyway, because a kernel that
  // compares principals cannot afford a port that answers two of them for the same person.
  const bad = ({ name, role }) => (name === 'owner' && role === 'reviewer' ? host.principal('reviewer') : host.authenticate({ name }));
  await assert.rejects(() => setup({ reviewers: ['owner'] }, { authenticate: bad }), /contradict|principal|same|identity/i);
});

test('A04-POS the same name in two roles is one principal, so a grant that names it twice is not a contradiction', async () => {
  // The boundary of the case above: the owner is also a pauser in this file's grant, and the port
  // answers with one object both times. That is what the host means when it says "the same person",
  // so it has to be accepted.
  const s = await setup();
  assert.equal(s.permission.owner, 'owner');
  assert.deepEqual(s.permission.pausers, ['owner']);
});
