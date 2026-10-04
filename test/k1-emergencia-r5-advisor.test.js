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

// ─── A02 · the open review belongs to the principal that spent the authority, not to a name ─────

test('A02-R502e the principal that spent the authority cannot close its own review', async () => {
  const s = await setup();
  assert.equal(s.use(s.req(), { by: AGENT() }).state, 'review_pending');
  // The record keeps the executor as a principal, so this refusal is a relation between two objects
  // and not a comparison of the request's `actor` against the grant's `grantee`.
  assert.throws(() => s.review(AGENT()), /own review|spend|exercised|grantee|own use/i);
  assert.equal(s.state().pendingReview, 'use-1');
  // And the reviewer who did not exercise it can.
  assert.equal(s.review(host.principal('reviewer')).review.status, 'reviewed');
});

test('A02-EQUIV only the grantee can exercise, so the executor and the grantee are one principal', async () => {
  // The equivalence the review asked to see stated rather than assumed: the exercise admits exactly
  // the grantee, so the principal in the pending is the one `refuseGrantee` already refused, and both
  // refusals stand over the same caller. Proved by walking every principal the host vouched for this
  // grant and showing that only the reviewer can close a use the agent spent, and nobody but the agent
  // can spend it.
  const s = await setup();
  for (const name of ['owner', 'reviewer', 'sensor']) {
    assert.equal(s.use(s.req({ useId: `u-${name}` }), { by: host.principal(name) }).state, 'blocked',
      `${name} should not be able to spend this authority at all`);
  }
  assert.equal(s.checks(), 0);
  assert.equal(s.state().uses, 0);
  assert.equal(s.use(s.req(), { by: AGENT() }).state, 'review_pending');
  for (const name of ['owner', 'sensor']) {
    assert.throws(() => s.review(host.principal(name)), /review|authorized/i, `${name} closed a review it did not sign`);
    assert.equal(s.state().pendingReview, 'use-1');
  }
  assert.equal(s.review(host.principal('reviewer')).review.by, 'reviewer');
});

test('A02-NOSERIAL no principal ever travels into a receipt', async () => {
  const s = await setup();
  const used = s.use(s.req(), { by: AGENT() });
  const closed = s.review(host.principal('reviewer'));
  for (const receipt of [used.receipt, closed]) {
    // The executor is remembered in the private record and nowhere else. A receipt carries the
    // DECLARED name, because that is what the grant digest and the authorized grant are made of; the
    // proof that the caller was that person is the host's and does not travel.
    const sealed = JSON.stringify(receipt);
    assert.equal(receipt.review.reviewers.includes('reviewer'), true);
    assert.equal(Object.values(receipt).some((value) => value === AGENT()), false);
    assert.equal(sealed.includes('principal'), false);
    assert.equal(sealed.includes('who'), false);
  }
  assert.equal(closed.review.by, 'reviewer');
});

// ─── A03 · one door, a role matrix, and the two verbs whose acting person is the host's answer ──

test('A03-G1 a grant presented by the owner principal is accepted', async () => {
  const s = await setup({}, { by: host.principal('owner') });
  assert.equal(s.permission.grantVerification.verified, true);
  assert.equal(s.permission.owner, 'owner');
});

test('A03-G2 a grant presented by somebody who is not the owner is refused', async () => {
  for (const [what, by] of [['the grantee', host.principal('agent')], ['a declared reviewer', host.principal('reviewer')],
    ['the verifier', host.principal('sensor')], ['a declared name', 'owner'], ['a frozen lookalike', Object.freeze({ principal: 'owner' })]]) {
    await assert.rejects(() => setup({}, { by }), /owner|principal|authenticate|name|grant/i,
      `a grant presented by ${what} should be refused`);
  }
});

test('A03-R1 a renewal presented by the owner extends the clock', async () => {
  const s = await setup();
  const renewed = emergency.renewEmergencyPermission(s.permission, { expiresAt: EXT }, { by: host.principal('owner') });
  assert.equal(renewed.expiresAt, '2026-10-06T00:00:00.000Z');
  assert.equal(s.renewals(), 1);
  assert.equal(s.state(renewed).uses, 0);
});

test('A03-R2 a renewal presented by somebody who is not the owner moves nothing', async () => {
  const s = await setup();
  for (const [what, by] of [['the grantee', host.principal('agent')], ['a declared reviewer', host.principal('reviewer')],
    ['the verifier', host.principal('sensor')], ['a declared name', 'owner'], ['a frozen lookalike', Object.freeze({ principal: 'owner' })]]) {
    assert.throws(() => emergency.renewEmergencyPermission(s.permission, { expiresAt: EXT }, { by }), /owner|principal|authenticate|name|clock/i,
      `a renewal presented by ${what} should be refused`);
  }
  // Not one of them reached the approver, and the original grant is exactly as usable as it was.
  assert.equal(s.renewals(), 0);
  assert.equal(s.permission.expiresAt, '2026-10-05T00:00:00.000Z');
});

test('A03-R3 the bound approver is still what authorizes the extension, with or without a principal', async () => {
  // The honest size of this door, stated as a test: a principal offered here is checked, and the
  // authority for growing the clock is the host callback the kernel bound, which a caller cannot
  // replace. So a renewal with no principal at all is still decided by that approver and nothing else.
  let denyingAsks = 0;
  const denying = await setup({}, { authorizeRenewal: (c) => { denyingAsks += 1; return { verified: false, grantor: c.owner }; } });
  assert.throws(() => emergency.renewEmergencyPermission(denying.permission, { expiresAt: EXT }), /did not approve/i);
  assert.throws(() => emergency.renewEmergencyPermission(denying.permission, { expiresAt: EXT }, { by: host.principal('owner') }), /did not approve/i);
  assert.equal(denyingAsks, 2);
  assert.equal(denying.permission.expiresAt, '2026-10-05T00:00:00.000Z');
  const approving = await setup();
  assert.equal(emergency.renewEmergencyPermission(approving.permission, { expiresAt: EXT }).expiresAt, '2026-10-06T00:00:00.000Z');
});

test('A03-R4 the requester cannot be smuggled in through the changes, and a hidden one is refused', async () => {
  const s = await setup();
  // Enumerable: the renewal refuses to touch anything but the clock, whoever asked.
  assert.throws(() => emergency.renewEmergencyPermission(s.permission, { expiresAt: EXT, by: AGENT() }), /widen|alter/i);
  // Non-enumerable, which is how the reviewer tried to hide one: `Object.keys` never sees it, so the
  // bound approver is the only thing that answers (R509).
  const hidden = { expiresAt: EXT };
  Object.defineProperty(hidden, 'by', { value: AGENT(), enumerable: false });
  assert.equal(emergency.renewEmergencyPermission(s.permission, hidden).expiresAt, '2026-10-06T00:00:00.000Z');
  // And an accessor on the options bag is refused outright rather than read (R301).
  const options = {};
  Object.defineProperty(options, 'by', { get() { throw new Error('fixture-private-text'); } });
  assert.throws(() => emergency.renewEmergencyPermission(s.permission, { expiresAt: '2026-10-07T00:00:00Z' }, options),
    (err) => /options/.test(err.message) && !err.message.includes('fixture-private-text'));
});

// The matrix itself, walked. Every verb, every principal the host issued, and the two shapes that are
// never a principal at all. A door is only as good as the table behind it, so the table is the test.
test('A03-MATRIX every verb admits exactly the roles the matrix names', async () => {
  const EVERYONE = ['owner', 'agent', 'reviewer', 'sensor', 'stranger'];
  const NEVER = ['a declared name', 'a frozen lookalike', 'nothing at all'];
  // exercise, review and the three administrative verbs require a principal; grant and renew do not,
  // because the host callback the kernel bound is the authority there.
  const REQUIRED = { exercise: ['agent'], review: ['reviewer'], pause: ['owner'], resume: ['owner'], revoke: ['owner'], grant: ['owner'], renew: ['owner'] };

  for (const [verb, allowed] of Object.entries(REQUIRED)) {
    for (const name of EVERYONE) {
      const s = await setup();
      const answer = verb === 'exercise' ? s.use(s.req(), { by: host.principal(name) }) : null;
      const may = name === allowed[0];
      if (verb === 'exercise') {
        assert.equal(answer.state, may ? 'review_pending' : 'blocked', `exercise by ${name}`);
        continue;
      }
      const call = {
        review: () => s.review(host.principal(name)),
        pause: () => emergency.pauseEmergencyPermission(s.permission, { ledger: s.ledger, by: host.principal(name), now: AT }),
        resume: () => emergency.resumeEmergencyPermission(s.permission, { ledger: s.ledger, by: host.principal(name), now: AT }),
        revoke: () => emergency.revokeEmergencyPermission(s.permission, { ledger: s.ledger, by: host.principal(name), now: AT }),
        grant: () => emergency.createEmergencyPermission(GRANT({ id: `matrix-${name}` }), {
          authenticate: host.authenticate,
          authorizeGrantor: (c) => ({ verified: true, grantor: c.owner }),
          resolveVerifier: (id) => ({ id, verify: () => ({ verified: true }) }),
          authorizeRenewal: (c) => ({ verified: true, grantor: c.owner }),
          by: host.principal(name),
        }),
        renew: () => emergency.renewEmergencyPermission(s.permission, { expiresAt: EXT }, { by: host.principal(name) }),
      }[verb];
      if (may) {
        // The verbs that need a use in flight need one in flight, so the positive cell is a real
        // transition and not a call that would have been refused for a different reason.
        if (verb === 'review') s.use(s.req(), { by: AGENT() });
        if (verb === 'resume') emergency.pauseEmergencyPermission(s.permission, { ledger: s.ledger, by: host.principal('owner'), now: AT });
        const result = await call();
        if (verb === 'review') assert.equal(result.review.status, 'reviewed');
        else if (verb === 'renew') assert.equal(result.expiresAt, '2026-10-06T00:00:00.000Z');
        else if (verb === 'grant') assert.equal(result.owner, 'owner');
      } else {
        // Every verb here but the grant throws synchronously, so this is `assert.throws` and not
        // `assert.rejects`: a promise assertion would bypass the reason check on a sync throw.
        const refused = () => call();
        const reason = /principal|owner|authorized|grantee|own use|review|pause|resume|revoke|clock|grant/i;
        if (verb === 'grant') await assert.rejects(refused, reason, `${verb} by ${name} should be refused`);
        else assert.throws(refused, reason, `${verb} by ${name} should be refused`);
      }
    }
    // And the three shapes that are never a caller, on the five verbs that insist on one.
    for (const [label, by] of [['a declared name', 'agent'], ['a frozen lookalike', Object.freeze({ principal: 'agent' })], ['nothing at all', undefined]]) {
      if (!['exercise', 'review', 'pause', 'resume', 'revoke'].includes(verb)) continue;
      const s = await setup();
      const call = {
        exercise: () => s.use(s.req(), { by }),
        review: () => s.review(by),
        pause: () => emergency.pauseEmergencyPermission(s.permission, { ledger: s.ledger, by, now: AT }),
        resume: () => emergency.resumeEmergencyPermission(s.permission, { ledger: s.ledger, by, now: AT }),
        revoke: () => emergency.revokeEmergencyPermission(s.permission, { ledger: s.ledger, by, now: AT }),
      }[verb];
      if (verb === 'review') s.use(s.req(), { by: AGENT() });
      if (verb === 'exercise') {
        // The exercise answers with a blocked receipt and a verifiable reason instead of throwing,
        // because a refused use is a thing the caller keeps.
        const answer = await call();
        assert.equal(answer.state, 'blocked', `exercise with ${label} should be blocked`);
        assert.equal(answer.nextUse, 'blocked');
      } else {
        assert.throws(call, /principal|authenticate|name/i, `${verb} with ${label} should be refused`);
      }
    }
  }
});

// ─── A04 · a contradictory port is refused (R519) ──────────────────────────────────────────────

test('R519 a port giving different principals for the same name in two roles is refused', async () => {
  // Contract robustness only, and not an honest-host bypass: this port breaks the one rule the kernel
  // depends on, which is that one name is one person. It is refused anyway, because a kernel that
  // compares principals cannot afford a port that answers two of them for the same person.
  const bad = ({ name, role }) => (name === 'owner' && role === 'reviewer' ? host.principal('reviewer') : host.authenticate({ name }));
  await assert.rejects(() => setup({ reviewers: ['owner'] }, { authenticate: bad }), /contradict|principal|same|identity/i);
});

test('A04-EACH the contradiction is refused in every pair of roles, not only owner against reviewer', async () => {
  // The reviewer R519 used is one pair. The rule is about the NAME, so it has to hold for every pair
  // of roles a name can appear in, and it is asked in a port that answers two principals for the one
  // name `reviewer` and the honest answer for everybody else.
  const CASES = [
    [{ reviewers: ['owner'] }, 'the owner asked twice, as owner and as reviewer'],
    [{ pausers: ['owner', 'reviewer'] }, 'the reviewer asked twice, as reviewer and as pauser'],
    [{ triggers: [{ id: 'critical', verifierId: 'reviewer' }] }, 'the reviewer asked twice, as reviewer and as verifier'],
  ];
  for (const [overrides, what] of CASES) {
    const flipSecondRole = (claim) => (claim.role === 'reviewer' || claim.role === 'pauser' || claim.role === 'verifier'
      ? host.principal(claim.role === 'reviewer' ? 'owner' : 'sensor')
      : host.authenticate(claim));
    await assert.rejects(() => setup(overrides, { authenticate: flipSecondRole }),
      /contradict|principal|same|identity/i,
      `${what} and answered with two principals should be refused`);
  }
});

test('A04-UNKNOWN a port that cannot authenticate a declared name refuses the grant', async () => {
  // The kernel asked about somebody by name and the host had no principal to give. There is nothing to
  // guess here and nothing to wait for, so the grant is refused rather than bound to a hole.
  await assert.rejects(() => setup({}, { authenticate: (claim) => (claim.name === 'reviewer' ? undefined : host.authenticate(claim)) }),
    /frozen principal|authenticate/i);
  // The same for a name the host never declared, which it may well have no principal for.
  await assert.rejects(() => setup({ reviewers: ['ghost'] }, { authenticate: (claim) => (claim.name === 'ghost' ? undefined : host.authenticate(claim)) }),
    /frozen principal|authenticate/i);
});

test('A04-POS the same name in two roles is one principal, so a grant that names it twice is not a contradiction', async () => {
  // The boundary of the case above: the owner is also a pauser in this file's grant, and the port
  // answers with one object both times. That is what the host means when it says "the same person",
  // so it has to be accepted.
  const s = await setup();
  assert.equal(s.permission.owner, 'owner');
  assert.deepEqual(s.permission.pausers, ['owner']);
});
