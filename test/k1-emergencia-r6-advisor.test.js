'use strict';

// K1 · the sixth independent reviewer's corpus, brought into this branch (fix round 6).
//
// Every title keeps the reviewer's N## number so a failure can be traced back to it. The fixture is
// this file's own, in the style of `emergency.test.js` and built on the same simulated host, and the
// assertions are the reviewer's, kept as they were written. Only two of the fourteen were red and both
// are minor:
//
//   N10 — `src/emergency.js` spliced the declared names into a refusal with `String.prototype.replace`,
//          where the replacement string is a PATTERN, not text. A declared name carrying `$'`, `$&` or
//          `` $` `` was therefore eaten or expanded and the refusal stopped naming who could have done
//          it. No authority is involved: the caller was already refused. The sentence was the defect.
//
//   N01 — the `owner` role on `grant` and `renew` restricts only a principal that is OFFERED, and the
//          table comment claimed it restricted the verb. The mechanism was right and the text was
//          wrong, so the reviewer's red case is not carried over as a hole: it becomes the positive
//          case the reviewer asked for, and the two comments now say the real size of the control.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const emergency = require('../src/emergency.js');
const { createHost } = require('./emergency-host.js');

const AT = '2026-10-04T12:00:00Z';
const LATER = '2026-10-04T12:01:00Z';
const EXT = '2026-10-06T00:00:00Z';
// One simulated host for this file, as in the fifth reviewer's file. A principal here is a frozen
// object the port hands back, the same object for the same name, which is the whole contract
// `src/emergency.js` asks a host for.
const host = createHost();

const GRANT = (overrides = {}) => ({
  id: 'r6',
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

// Same shape as the fifth reviewer's fixture: `checks` counts what the independent verifier was asked,
// `renewals` counts what the bound approver was asked, because "the grant was not spent" and "the
// approver was never asked" are two different claims and a refusal has to make both of them.
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
const OWNER = () => host.principal('owner');
const SENSOR = () => host.principal('sensor');

// ─── N10 · a refusal repeats the declared names literally (A01) ─────────────────────────────────

test('N10 a refusal sentence repeats the declared names literally', async () => {
  // The reviewer's case, kept as written: the grant declares one reviewer whose name carries `$'`, and
  // the owner is refused the review. `String.prototype.replace` reads `$'` in a replacement as "the text
  // after the match", so the declared name came back as `rev]x]` — the sentence named nobody.
  const s = await setup({ reviewers: ["rev$'x"] });
  assert.throws(() => s.review(OWNER()), (err) => {
    assert.match(err.message, /authorized/);
    assert.ok(err.message.includes("[rev$'x]"), err.message);
    return true;
  });
});

test('A10-ALL every refusal repeats every declared name literally, with all three patterns', async () => {
  // N10 is one verb and one pattern. A refusal that cannot be trusted to name the role that could have
  // performed the verb is a refusal that leaves the caller guessing, so the whole family is walked with
  // a grant whose owner, grantee, reviewer and pauser names each carry one of the three sequences a
  // replacement string reads: `$'` (the text after the match), `$&` (the match itself) and `` $` `` (the
  // text before it). The owner name is aliased to the owner principal, because a pauser entry that does
  // not resolve to the owner is refused as a grant that nobody could stop.
  const h = createHost();
  h.aliases.set('ow`ner', 'owner');
  const NASTY = {
    owner: 'ow`ner',
    grantee: 'ag$&ent',
    reviewers: ["rev$'x"],
    pausers: ['ow`ner'],
  };
  const options = (by) => ({
    authenticate: h.authenticate,
    authorizeGrantor: (candidate) => ({ verified: true, grantor: candidate.owner }),
    resolveVerifier: (id) => ({ id, verify: () => ({ verified: true }) }),
    authorizeRenewal: (candidate) => ({ verified: true, grantor: candidate.owner }),
    by,
  });
  const permission = await emergency.createEmergencyPermission(GRANT({ id: 'nasty', ...NASTY }), options());
  const ledger = emergency.createEmergencyLedger();
  // The verifier is a principal in this grant and is in none of the four roles, so it is the one caller
  // every verb below has to refuse.
  const stranger = h.principal('sensor');

  const refusals = [
    ['review', () => emergency.reviewEmergencyUse(permission, 'use-1', { ledger, by: stranger, decision: 'accept', now: LATER }),
      'not authorized to close this emergency review', "[rev$'x]"],
    ['pause', () => emergency.pauseEmergencyPermission(permission, { ledger, by: stranger, now: AT }),
      'not authorized to pause', '[ow`ner]'],
    ['resume', () => emergency.resumeEmergencyPermission(permission, { ledger, by: stranger, now: AT }),
      'not authorized to resume', '[ow`ner]'],
    ['revoke', () => emergency.revokeEmergencyPermission(permission, { ledger, by: stranger, now: AT }),
      'only the person who granted', 'ow`ner'],
    ['renew', () => emergency.renewEmergencyPermission(permission, { expiresAt: EXT }, { by: stranger }),
      'not the owner of this permission', 'ow`ner'],
  ];
  for (const [verb, call, because, names] of refusals) {
    assert.throws(call, (err) => {
      assert.ok(err.message.includes(because), `${verb}: ${err.message}`);
      assert.ok(err.message.includes(names), `${verb} did not repeat the declared name: ${err.message}`);
      // And the placeholder itself is gone: a message that still reads `{names}` names nobody either.
      assert.equal(err.message.includes('{names}'), false, `${verb}: ${err.message}`);
      return true;
    });
  }

  // The grant is a promise, not a throw, so its refusal is answered inside a promise as well.
  await assert.rejects(() => emergency.createEmergencyPermission(GRANT({ id: 'nasty-2', ...NASTY }), options(stranger)),
    (err) => err.message.includes('ow`ner') && !err.message.includes('{names}'), 'the grant refusal did not repeat the declared name');

  // The exercise answers with a blocked receipt instead of throwing, so its reason has to carry the
  // declared name too, and the refusal is the only thing that happened: nothing was spent and the
  // verifier was never asked.
  const answer = emergency.exerciseEmergency(permission, REQUEST({ actor: 'ag$&ent' }),
    { ledger, now: AT, by: stranger });
  assert.equal(answer.state, 'blocked');
  assert.ok(answer.reason.includes('(ag$&ent)'), answer.reason);
  assert.equal(answer.reason.includes('{names}'), false, answer.reason);
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).uses, 0);
});

// ─── N01 · omitting `by` on a renewal is always allowed, and the bound approver decides (A01) ────

test('N01 a renewal requested without a principal reaches the bound approver, whoever holds the handle', async () => {
  // The reviewer's own case, turned positive. The grantee is refused outright when it SHOWS its
  // principal, and the same grantee gets its renewal through by leaving the principal out. That is not
  // a hole: what authorizes a wider clock is the approver the host bound at grant time, which a caller
  // cannot replace, so the request is a request and the approver decides it. The honest size of the
  // `owner` role here is that it restricts a principal that is OFFERED, not the verb.
  let asks = 0;
  const seen = [];
  const s = await setup({}, {
    authorizeRenewal: (candidate) => {
      asks += 1;
      seen.push(candidate);
      return { verified: true, grantor: candidate.owner };
    },
  });

  assert.throws(() => emergency.renewEmergencyPermission(s.permission, { expiresAt: EXT }, { by: AGENT() }),
    /own use/, 'the grantee was not refused for offering its own principal');
  assert.equal(asks, 0, 'a refusal reached the approver');

  const renewed = emergency.renewEmergencyPermission(s.permission, { expiresAt: EXT });
  assert.equal(renewed.expiresAt, '2026-10-06T00:00:00.000Z');
  assert.equal(asks, 1, 'the bound approver is asked exactly once, and it is what authorized the clock');

  // The approver is not told who asked. A renewal presented by the owner produces the very same
  // candidate, because the candidate is the grant and the requester is not in it.
  assert.equal(emergency.renewEmergencyPermission(s.permission, { expiresAt: EXT }, { by: OWNER() }).expiresAt,
    '2026-10-06T00:00:00.000Z');
  assert.equal(asks, 2);
  assert.deepEqual(seen[1], seen[0], 'the approver was told who asked, or something else differed');
});

test('A01-DENY a request with no principal is refused the moment the bound approver says no', async () => {
  // The other half of the claim above, and the one that keeps it from being a bypass: omitting `by` does
  // not reach the approver around the door, it reaches it through it. A host that denies stops the
  // renewal whether a principal was offered or not, and the clock does not move.
  let asks = 0;
  const denying = await setup({}, { authorizeRenewal: (candidate) => { asks += 1; return { verified: false, grantor: candidate.owner }; } });
  assert.throws(() => emergency.renewEmergencyPermission(denying.permission, { expiresAt: EXT }), /did not approve/i);
  assert.throws(() => emergency.renewEmergencyPermission(denying.permission, { expiresAt: EXT }, { by: OWNER() }), /did not approve/i);
  assert.equal(asks, 2, 'both requests reached the approver, and both were refused by it');
  assert.equal(denying.permission.expiresAt, '2026-10-05T00:00:00.000Z');
  // A host whose approver approves for somebody who is not the owner authorizes nobody either.
  const elsewhere = await setup({}, { authorizeRenewal: (candidate) => ({ verified: true, grantor: 'somebody-else' }) });
  assert.throws(() => emergency.renewEmergencyPermission(elsewhere.permission, { expiresAt: EXT }), /does not name the owner/i);
});