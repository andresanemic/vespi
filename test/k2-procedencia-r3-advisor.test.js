'use strict';

// K2 (decision 24), the third independent review round: the adversarial suite the Advisor wrote
// against this branch, case by case.
//
// Four of these fourteen cases were red when the report was written (N01 to N04) and each one keeps
// the reviewer's code in its title, so a failure here can be traced back to the numbered fix that
// asked for it. N05 was the owner's decision and was taken on 2026-10-04: the resolver is no longer
// handed the declared author or content digest, so the case is green here and lives in
// `d1-procedencia-independencia.test.js` with the rest of that contract. Two cases stay red on
// purpose and are marked `todo`: N07 is the optional symmetry fix the report left out of the list,
// and N08 asks a promise out of base code this branch does not touch, so its answer is in a comment
// instead of in a behavior change.
//
// What the four red cases have in common is that something the party under audit controls used to
// reach further than it was allowed: a digest string the resolver wrote landed in the reason a host
// logs, the caller's own `outcome` object was spread into the sealed receipt, and asking for a
// capability nobody granted turned a refuted skill into a softer receipt.
//
// The names and the assertions are the reviewer's; the spacing and the helpers are this repository's.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  registerSkillProvenance,
  verifySkillProvenance,
  authorizeSkill,
  loadSkill,
  buildSkillReceipt,
  listSkillProvenance,
} = require('../src/skill-provenance.js');
const { verifyReceipt } = require('../src/receipt.js');

const SPEC = Object.freeze({
  name: 'round-three',
  repository: 'https://example.test/r3',
  commit: 'b'.repeat(40),
  author: 'Round Three Author',
  content: '# r3 skill',
  authority: ['read'],
});

const RECEIPT_SPEC = Object.freeze({
  operation: { id: 'r3', goal: 'review' },
  capabilityId: 'loader',
  authority: { spend: [] },
  outcome: { exercised: [] },
  at: '2040-01-01T00:00:00.000Z',
});

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// Written out by hand, not derived from the claim, so a resolver that echoed the declaration back
// could not pass.
function proof(overrides = {}) {
  return {
    exists: true,
    repository: SPEC.repository,
    commit: SPEC.commit,
    author: SPEC.author,
    content: SPEC.content,
    ...overrides,
  };
}

function registered(overrides = {}) {
  return registerSkillProvenance({ ...SPEC, ...overrides });
}

async function registeredAndVerified() {
  const claim = registered();
  return [claim, await verifySkillProvenance(claim, () => proof())];
}

// --- Fix 1 (N04): the scope of the request cannot soften a refutation ---

test('N04 asking out of scope cannot soften a refuted provenance into a not_verified receipt', async () => {
  // The provenance is refuted either way, so both requests have to produce the same failed receipt.
  // Before the fix the out-of-scope request was refused by the scope rule first, and a rule that
  // arrives earlier in the function decided the status: whoever holds a refuted skill picked the
  // softer receipt by asking for a capability nobody granted.
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => proof({ author: 'Someone Else' }));
  assert.equal(result.status, 'discrepant');
  const inScope = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['read']));
  const outOfScope = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['delete']));
  assert.equal(inScope.status, 'failed');
  assert.equal(outOfScope.skill.provenanceStatus, 'discrepant');
  assert.equal(outOfScope.status, 'failed', 'the caller chose the softer receipt by asking for an ungranted capability');
});

// --- Fix 2 (N01): no text the resolver wrote reaches the reason ---

test('N01 a resolver-written digest string does not reach the reason or the receipt', async () => {
  // H06-H08 stopped quoting the resolver's repository, author and commit. The digest prefix was
  // still quoted, and on the path where the resolver sends a digest instead of bytes that prefix is
  // its own text: a string the party under audit chose, in the reason a host logs.
  const claim = registered();
  const planted = 'PRIVATEtoken0123456789';
  const { content, ...withoutContent } = proof();
  const result = await verifySkillProvenance(claim, () => ({ ...withoutContent, contentDigest: planted }));
  assert.equal(result.status, 'discrepant');
  const receipt = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['read']));
  assert.ok(!result.reason.includes(planted.slice(0, 12)), `reason: ${result.reason}`);
  assert.ok(!JSON.stringify(receipt).includes(planted.slice(0, 12)), 'resolver text reached the sealed receipt');
});

// --- Fix 3 (N02, N03): the caller's `outcome` is read, not enumerated ---

test('N02 a revoked proxy as receipt outcome is contained, not thrown', async () => {
  // Seven top-level fields were read under guards and then `{ ...outcome }` enumerated an object the
  // caller still controlled. A revoked proxy answers no `ownKeys`, and the `TypeError` left this
  // module into someone else's control flow.
  const [claim, result] = await registeredAndVerified();
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.doesNotThrow(() => buildSkillReceipt({ ...RECEIPT_SPEC, outcome: proxy }, authorizeSkill(claim, result, ['read'])));
});

test('N03 a throwing getter inside the receipt outcome is contained, not thrown', async () => {
  const [claim, result] = await registeredAndVerified();
  const outcome = { get detail() { throw new Error('PRIVATE_outcome_getter'); } };
  assert.doesNotThrow(() => buildSkillReceipt({ ...RECEIPT_SPEC, outcome }, authorizeSkill(claim, result, ['read'])));
});

// --- The owner's decision, taken on 2026-10-04: N05 is green ---

test('N05 the resolver is not handed the answers it is asked to produce (author, digest)', async () => {
  // The question now carries name, repository and commit only. An echo of it can say where it looked,
  // so `repository` and `commit_exists` stay covered, but the two answers it is asked for are exactly
  // the two it cannot invent, and the result says which ones are missing.
  const claim = registered();
  const result = await verifySkillProvenance(claim, (question) => ({ ...question, exists: true }));
  assert.notEqual(result.status, 'verified', 'a one-key echo of the question is verified provenance');
  assert.deepEqual([...result.notCovered].sort(), ['author', 'content_digest']);
});

// --- Still red on purpose, with the reason written down ---

test('N07 resolver bytes carrying unpaired surrogates are not verified bytes (H12 symmetry)', { todo: "diferido al 0.1.5 por decisión del coordinador" }, async () => {
  const claim = registered({ content: '# r3 \ufffd' });
  const result = await verifySkillProvenance(claim, () => proof({ content: '# r3 \ud800' }));
  assert.notEqual(result.status, 'verified', 'text that is not the registered text was verified by its lossy encoding');
});

test('N08 a hostile nested receipt field is contained as the builder comment promises', { todo: "diferido al 0.1.5 por decisión del coordinador" }, async () => {
  const [claim, result] = await registeredAndVerified();
  const operation = { get id() { throw new Error('PRIVATE_operation_getter'); } };
  assert.doesNotThrow(() => buildSkillReceipt({ ...RECEIPT_SPEC, operation }, authorizeSkill(claim, result, ['read'])));
});

// --- The seven defenses the review found already holding: they must stay that way ---

test('N09 an uppercase spelling of the same commit is a refutation, not a match', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => proof({ commit: SPEC.commit.toUpperCase() }));
  assert.equal(result.status, 'discrepant');
  assert.equal(result.checks.commit_exists, false);
});

test('N10 a stringly-typed exists flag covers nothing and verifies nothing', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => proof({ exists: 'true' }));
  assert.equal(result.status, 'not_verifiable');
  assert.equal(result.checks.commit_exists, false);
  assert.deepEqual([...result.coverage], ['repository', 'author', 'content_digest']);
});

test('N11 a boxed String request grants nothing', async () => {
  const [claim, result] = await registeredAndVerified();
  const decision = authorizeSkill(claim, result, [new String('read')]);
  assert.equal(decision.authorized, false);
  assert.ok(decision.checks.authority_scope === false);
});

test('N12 a verified authorization without a load says so in the receipt coverage', async () => {
  const [claim, result] = await registeredAndVerified();
  const receipt = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['read']));
  assert.equal(receipt.status, 'verified');
  assert.equal(receipt.skill.loadedDigest, null);
  assert.ok(!receipt.skill.coverage.includes('loaded_content_digest'));
  assert.equal(verifyReceipt(receipt).ok, true);
});

test('N13 editing a listed registry entry does not change the registry', () => {
  registered({ name: 'r3-list' });
  const first = listSkillProvenance().find((entry) => entry.name === 'r3-list');
  first.contentDigest = sha256('evil');
  const again = listSkillProvenance().find((entry) => entry.name === 'r3-list');
  assert.equal(again.contentDigest, sha256(SPEC.content));
});

test('N14 a load that matches cannot upgrade a discrepant decision into authority', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => proof({ repository: 'https://example.test/fork' }));
  const loaded = loadSkill(claim, result, SPEC.content, ['read']);
  assert.equal(loaded.authorized, false);
  assert.equal(loaded.status, 'discrepant');
  assert.equal(buildSkillReceipt(RECEIPT_SPEC, loaded).status, 'failed');
});

test('N06 a resolver value that revokes itself after resolution is refused, not thrown', async () => {
  const claim = registered();
  const { proxy, revoke } = Proxy.revocable(proof(), {
    get(target, key) {
      if (key === 'then') { queueMicrotask(revoke); return undefined; }
      return target[key];
    },
  });
  let result;
  await assert.doesNotReject(async () => { result = await verifySkillProvenance(claim, () => proxy); });
  assert.notEqual(result.status, 'verified');
});
