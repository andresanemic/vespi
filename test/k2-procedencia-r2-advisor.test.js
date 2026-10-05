'use strict';

// K2 (decision 24), the second independent review round: the adversarial suite the Advisor wrote
// against this branch, case by case.
//
// Six of these seventeen cases were red when the report was written (R201 to R206) and each one keeps
// the reviewer's code in its title, so a failure here can be traced back to the numbered fix that
// asked for it. The other eleven were already green and are kept as the regression floor of that
// round: hostile evidence that must stay contained, replays that must stay refused, and deadlines
// that must stay answerable.
//
// What the six red cases have in common is honesty about evidence that did not fully arrive: a
// recomputation the kernel did perform and then forgot to report, three identity checks that a
// missing fourth erased, a refutation that an absent field or a throwing getter managed to hide, and
// a revoked proxy that escaped the authority API instead of being refused by it.
//
// The names and the assertions are the reviewer's; the spacing and the helpers are this repository's.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  registerSkillProvenance,
  verifySkillProvenance,
  authorizeSkill,
  loadSkill,
  buildSkillReceipt,
} = require('../src/skill-provenance.js');
const { verifyReceipt } = require('../src/receipt.js');

const SPEC = Object.freeze({
  name: 'round-two',
  repository: 'https://example.test/r2',
  commit: 'a'.repeat(40),
  author: 'Artifact Author',
  content: '# safe',
  authority: ['read'],
});

const RECEIPT_SPEC = Object.freeze({
  operation: { id: 'r2', goal: 'audit' },
  capabilityId: 'loader',
  authority: { spend: [] },
  outcome: { exercised: [] },
  at: '2040-01-01T00:00:00.000Z',
});

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

async function registeredAndVerified() {
  const claim = registerSkillProvenance(SPEC);
  return [claim, await verifySkillProvenance(claim, () => proof())];
}

// --- Fix 1 (R201, R202): the flag has to say that this kernel ran SHA-256 over the bytes ---

test('R201 a mismatching byte hash still reports local recomputation', async () => {
  // The bytes differed, so the verdict is `discrepant`, and the hashing still happened here. A
  // receipt that says `contentRecomputed: false` on this path tells the reader the digest was taken
  // from a claim when it was taken from bytes, which is the whole distinction the flag exists for.
  const claim = registerSkillProvenance(SPEC);
  const result = await verifySkillProvenance(claim, () => proof({ content: '# changed' }));
  assert.equal(result.status, 'discrepant');
  assert.equal(result.contentRecomputed, true);
});

test('R202 a refuted author preserves recomputation through the refusal receipt', async () => {
  const claim = registerSkillProvenance(SPEC);
  const result = await verifySkillProvenance(claim, () => proof({ author: 'Different Author' }));
  const loaded = loadSkill(claim, result, SPEC.content, ['read']);
  const receipt = buildSkillReceipt(RECEIPT_SPEC, loaded);
  assert.equal(loaded.authorized, false);
  assert.equal(receipt.skill.contentRecomputed, true);
});

// --- Fix 2 (R203): a missing fourth check does not erase the three that passed ---

test('R203 missing bytes retain three already successful identity checks', async () => {
  // No content and no digest means `content_digest` is not covered. It does not mean the repository,
  // the commit and the author were never compared: those three comparisons really ran and passed.
  const claim = registerSkillProvenance(SPEC);
  const result = await verifySkillProvenance(claim, () => proof({ content: undefined }));
  assert.equal(result.status, 'not_verifiable');
  assert.deepEqual(result.coverage, ['repository', 'commit_exists', 'author']);
});

// --- Fix 3 (R204, R205): absence is not a refutation, and a refutation is not hidden by absence ---

test('R204 missing existence cannot hide a refuted author', async () => {
  // `exists` unanswered is one check not covered. The author the resolver contradicted is a
  // refutation, and `discrepant` outranks the unanswered field.
  const claim = registerSkillProvenance(SPEC);
  const result = await verifySkillProvenance(claim, () => proof({ exists: undefined, author: 'Different Author' }));
  assert.equal(result.status, 'discrepant');
  assert.equal(result.checks.author, false);
});

test('R205 content getter failure cannot hide explicitly nonexistent commit', async () => {
  const claim = registerSkillProvenance(SPEC);
  const answered = proof({ exists: false });
  Object.defineProperty(answered, 'content', {
    get() { throw new Error('SYNTHETIC_PRIVATE'); },
  });
  const result = await verifySkillProvenance(claim, () => answered);
  assert.equal(result.status, 'discrepant');
  assert.ok(!result.reason.includes('SYNTHETIC_PRIVATE'), result.reason);
});

// --- Fix 4 (R206): a revoked proxy is refused by the API, not thrown out of it ---

test('R206 revoked requested array is refused without escaping the authority API', async () => {
  // `Array.isArray` runs a trap check, so on a revoked proxy it throws. The caller is holding an
  // object it already destroyed; throwing at it is not a refusal, it is a crash in someone else's
  // control flow.
  const [claim, result] = await registeredAndVerified();
  const revoked = Proxy.revocable(['read'], {});
  revoked.revoke();
  let decision;
  assert.doesNotThrow(() => { decision = authorizeSkill(claim, result, revoked.proxy); });
  assert.equal(decision.authorized, false);
  // The fix asked for more than a refusal without a throw: the provenance that was verified stays
  // verified, the four checks that passed stay covered, and the scope check is the one marked false.
  assert.equal(decision.checks.authority_scope, false);
  assert.equal(decision.provenanceStatus, 'verified');
  assert.deepEqual([...decision.coverage].sort(), ['author', 'commit_exists', 'content_digest', 'repository']);
});

// --- The eleven the review found already holding: they must stay that way ---

test('R207 revoked evidence array yields an unverifiable result rather than rejection', async () => {
  const claim = registerSkillProvenance(SPEC);
  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  let result;
  await assert.doesNotReject(async () => { result = await verifySkillProvenance(claim, () => revoked.proxy); });
  assert.equal(result.status, 'not_verifiable');
});

test('R208 identical registrations cannot replay a result across private identities', async () => {
  const [claim, result] = await registeredAndVerified();
  const other = registerSkillProvenance(SPEC);
  assert.equal(other.digest, claim.digest);
  assert.equal(authorizeSkill(other, result, ['read']).authorized, false);
});

test('R209 proxy wrappers around a genuine decision cannot mint a receipt', async () => {
  const [claim, result] = await registeredAndVerified();
  const loaded = loadSkill(claim, result, SPEC.content, ['read']);
  assert.throws(() => buildSkillReceipt(RECEIPT_SPEC, new Proxy(loaded, {})), /decision/);
});

test('R210 changing evidence commit getter is captured exactly once', async () => {
  const claim = registerSkillProvenance(SPEC);
  const answered = proof();
  let reads = 0;
  Object.defineProperty(answered, 'commit', {
    get() { return (reads += 1) === 1 ? SPEC.commit : 'b'.repeat(40); },
  });
  const result = await verifySkillProvenance(claim, () => answered);
  assert.equal(reads, 1);
  assert.equal(result.status, 'verified');
});

test('R211 resolver asserted recomputation cannot turn digest-only evidence into bytes', async () => {
  const claim = registerSkillProvenance(SPEC);
  const result = await verifySkillProvenance(claim, () => proof({
    content: undefined,
    contentDigest: claim.contentDigest,
    contentRecomputed: true,
  }));
  assert.equal(result.status, 'verified');
  assert.equal(result.contentRecomputed, false);
  const receipt = buildSkillReceipt(RECEIPT_SPEC, loadSkill(claim, result, SPEC.content, ['read']));
  assert.equal(receipt.skill.contentRecomputed, false);
});

test('R212 late resolver success cannot upgrade a deadline refusal', async () => {
  const claim = registerSkillProvenance(SPEC);
  let answer;
  const pending = new Promise((resolve) => { answer = resolve; });
  const result = await verifySkillProvenance(claim, () => pending, { timeoutMs: 5 });
  answer(proof());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.status, 'not_verifiable');
  assert.equal(authorizeSkill(claim, result, ['read']).authorized, false);
});

test('R213 nested skill receipt editing is detected by its digest', async () => {
  const [claim, result] = await registeredAndVerified();
  const receipt = buildSkillReceipt(RECEIPT_SPEC, loadSkill(claim, result, SPEC.content, ['read']));
  receipt.skill.provenance.author = 'Different Author';
  receipt.skill.requested.push('delete');
  assert.equal(verifyReceipt(receipt).ok, false);
});

test('R214 refutation without bytes preserves successful repository and commit checks', async () => {
  const claim = registerSkillProvenance(SPEC);
  const result = await verifySkillProvenance(claim, () => proof({ content: undefined, author: 'Different Author' }));
  assert.equal(result.status, 'discrepant');
  assert.equal(result.checks.repository, true);
  assert.equal(result.checks.commit_exists, true);
  assert.equal(result.contentRecomputed, false);
});

test('R215 throwing proxy length getter is contained without copying its exception', async () => {
  const [claim, result] = await registeredAndVerified();
  const requested = new Proxy(['read'], {
    get(target, key) {
      if (key === 'length') throw new Error('SYNTHETIC_LENGTH_PRIVATE');
      return Reflect.get(target, key);
    },
  });
  let decision;
  assert.doesNotThrow(() => { decision = authorizeSkill(claim, result, requested); });
  assert.equal(decision.authorized, false);
  assert.ok(!decision.reason.includes('SYNTHETIC_LENGTH_PRIVATE'), decision.reason);
});

test('R216 a proxy reporting an unsafe array length cannot authorize', async () => {
  const [claim, result] = await registeredAndVerified();
  const requested = new Proxy(['read'], {
    get(target, key) { return key === 'length' ? Number.MAX_SAFE_INTEGER + 1 : Reflect.get(target, key); },
  });
  const decision = authorizeSkill(claim, result, requested);
  assert.equal(decision.authorized, false);
  assert.equal(decision.checks.authority_scope, false);
});

test('R217 partial missing-commit evidence preserves a real recomputation', async () => {
  const claim = registerSkillProvenance(SPEC);
  const result = await verifySkillProvenance(claim, () => proof({ commit: undefined }));
  assert.equal(result.status, 'not_verifiable');
  assert.equal(result.contentRecomputed, true);
  assert.equal(result.checks.content_digest, true);
  const receipt = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['read']));
  assert.equal(receipt.skill.contentRecomputed, true);
  assert.equal(receipt.status, 'not_verified');
});