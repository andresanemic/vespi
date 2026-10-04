'use strict';

// K2 (decision 24), the independent review round: the adversarial suite the Advisor wrote against this
// branch, case by case.
//
// Each test keeps the reviewer's own A## code in its title so a failure can be traced back to the
// report that asked for it. The cases are hostile about one thing each: a forged decision, a mutable
// request, an evidence record that answers about the wrong commit, a resolver that throws something
// the kernel must not copy, a refutation that a missing field must not hide, a comparison against
// nothing, a refusal that erases a verified provenance, a timer the platform will not honour, and a
// digest the kernel computed versus a digest the resolver asserted.
//
// The names and the assertions are the reviewer's; the spacing and the helpers are this repository's.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  registerSkillProvenance,
  verifySkillProvenance,
  authorizeSkill,
  loadSkill,
  buildSkillReceipt,
} = require('../src/skill-provenance.js');
const { verifyReceipt } = require('../src/receipt.js');

const MODULE_PATH = path.join(__dirname, '..', 'src', 'skill-provenance.js');

const SPEC = Object.freeze({
  name: 'advisor',
  repository: 'https://example.test/repo',
  commit: 'a'.repeat(40),
  author: 'Artifact Author',
  content: '# safe',
  authority: ['read'],
});

const RECEIPT_SPEC = Object.freeze({
  operation: { id: 'advisor', goal: 'check' },
  capabilityId: 'loader',
  authority: { spend: [] },
  outcome: { status: 'verified', exercised: [] },
  evidence: {},
  at: '2040-01-01T00:00:00.000Z',
});

// Written out by hand, not derived from the claim, so a verifier that only echoed the declaration
// back could not pass.
function proof() {
  return {
    exists: true,
    repository: SPEC.repository,
    commit: SPEC.commit,
    author: SPEC.author,
    content: SPEC.content,
  };
}

async function registeredAndVerified() {
  const claim = registerSkillProvenance(SPEC);
  return [claim, await verifySkillProvenance(claim, proof)];
}

// --- A01: a decision this kernel never produced cannot mint a receipt ---

test('A01 fabricated complete decision cannot mint a verified receipt', () => {
  // Every field present and every check green, and no skill was ever registered, no resolver ever ran.
  const forged = {
    authorized: true,
    status: 'verified',
    provenanceStatus: 'verified',
    checks: { repository: true, commit_exists: true, author: true, content_digest: true },
    coverage: ['repository', 'commit_exists', 'author', 'content_digest'],
    notCovered: [],
    name: 'forged',
    granted: ['delete'],
    requested: ['delete'],
    provenance: { repository: 'attacker', commit: SPEC.commit, author: 'attacker', contentDigest: '0'.repeat(64) },
    reason: 'no resolver ran',
  };
  assert.throws(() => buildSkillReceipt(RECEIPT_SPEC, forged), /decision/i);
});

// --- A02, A03, A16: one capture of the request, and nothing caller-supplied decides authority ---

test('A02 overridden array filter and iterator cannot widen granted authority', async () => {
  const [claim, result] = await registeredAndVerified();
  const requested = ['delete'];
  let iterations = 0;
  requested[Symbol.iterator] = function* iterator() { yield (iterations += 1) === 1 ? 'read' : 'delete'; };
  requested.filter = () => [];
  const decision = authorizeSkill(claim, result, requested);
  assert.ok(
    !decision.authorized || decision.requested.every((name) => SPEC.authority.includes(name)),
    JSON.stringify(decision),
  );
});

test('A03 changing request getter cannot swap bytes between scope check and snapshot', async () => {
  const [claim, result] = await registeredAndVerified();
  let reads = 0;
  const requested = [];
  Object.defineProperty(requested, '0', {
    enumerable: true,
    get() { return (reads += 1) <= 4 ? 'read' : 'delete'; },
  });
  const decision = authorizeSkill(claim, result, requested);
  assert.ok(
    !decision.authorized || decision.requested.every((name) => SPEC.authority.includes(name)),
    JSON.stringify(decision),
  );
});

test('A16 a throwing request element is refused without escaping the authority API', async () => {
  const [claim, result] = await registeredAndVerified();
  const requested = [];
  Object.defineProperty(requested, '0', { get() { throw new Error('SYNTHETIC_REQUEST_ERROR'); } });
  let decision;
  assert.doesNotThrow(() => { decision = authorizeSkill(claim, result, requested); });
  assert.equal(decision.authorized, false);
});

// --- A04: the evidence has to name the commit it answered about ---

test('A04 missing evidence commit cannot cover commit existence for the declared commit', async () => {
  const claim = registerSkillProvenance(SPEC);
  const answered = proof();
  delete answered.commit;
  const result = await verifySkillProvenance(claim, () => answered);
  assert.notEqual(result.status, 'verified');
  assert.equal(result.checks.commit_exists, false);
});

// --- A05, A06: the thrown value belongs to whoever threw it ---

test('A05 resolver exception text is not copied into a persistable reason', async () => {
  const claim = registerSkillProvenance(SPEC);
  const result = await verifySkillProvenance(claim, () => { throw new Error('SYNTHETIC_PRIVATE_TOKEN'); });
  assert.ok(!result.reason.includes('SYNTHETIC_PRIVATE_TOKEN'), result.reason);
});

test('A06 hostile thrown message getter cannot reject the verification API', async () => {
  const claim = registerSkillProvenance(SPEC);
  let result;
  await assert.doesNotReject(async () => {
    result = await verifySkillProvenance(claim, () => { throw { get message() { throw new Error('secondary'); } }; });
  });
  assert.equal(result.status, 'not_verifiable');
});

// --- A07: a refutation is not hidden by an unanswered field ---

test('A07 explicit refutation survives missing repository evidence', async () => {
  const claim = registerSkillProvenance(SPEC);
  const answered = proof();
  answered.exists = false;
  delete answered.repository;
  const result = await verifySkillProvenance(claim, () => answered);
  assert.equal(result.status, 'discrepant');
});

// --- A08: hashing the bytes is not the same as having compared them ---

test('A08 unregistered load cannot report a registered digest comparison passed', () => {
  const decision = loadSkill({}, null, SPEC.content, ['read']);
  assert.equal(decision.authorized, false);
  assert.equal(decision.checks.loaded_content_digest, false);
});

// --- A09: a refusal of authority is not a refutation of provenance ---

test('A09 out of scope request preserves independently verified provenance status', async () => {
  const [claim, result] = await registeredAndVerified();
  const decision = authorizeSkill(claim, result, ['delete']);
  assert.equal(decision.authorized, false);
  assert.equal(decision.provenanceStatus, 'verified');
});

// --- A10, A11, A12, A13: what the review found already held ---

test('A10 contradictory exists flag must stay strictly false without coercion', async () => {
  const claim = registerSkillProvenance(SPEC);
  const result = await verifySkillProvenance(claim, () => ({ ...proof(), exists: 1 }));
  assert.equal(result.status, 'not_verifiable');
  assert.equal(authorizeSkill(claim, result, ['read']).authorized, false);
});

test('A11 evidence extra fields do not propagate into the receipt', async () => {
  const claim = registerSkillProvenance(SPEC);
  const result = await verifySkillProvenance(claim, () => ({ ...proof(), privateField: 'SYNTHETIC_PRIVATE_VALUE', verified: true }));
  const out = buildSkillReceipt(RECEIPT_SPEC, loadSkill(claim, result, SPEC.content, ['read']));
  assert.equal(verifyReceipt(out).ok, true);
  assert.ok(!JSON.stringify(out).includes('SYNTHETIC_PRIVATE_VALUE'));
});

test('A12 editing resolver evidence later cannot mutate the sealed result', async () => {
  const claim = registerSkillProvenance(SPEC);
  const answered = proof();
  const result = await verifySkillProvenance(claim, () => answered);
  answered.repository = 'attacker';
  answered.content = 'changed';
  assert.equal(result.provenance.repository, SPEC.repository);
  assert.equal(loadSkill(claim, result, 'changed', ['read']).authorized, false);
});

test('A13 caller input arrays and spec remain unchanged', async () => {
  const input = { ...SPEC, authority: ['read'] };
  const before = JSON.stringify(input);
  const claim = registerSkillProvenance(input);
  const result = await verifySkillProvenance(claim, proof);
  const requested = ['read'];
  buildSkillReceipt(RECEIPT_SPEC, loadSkill(claim, result, SPEC.content, requested));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(requested, ['read']);
});

// --- A14, A15: a deadline the platform honours, and one that still answers on its own ---

test('A14 timeout outside the platform timer range is rejected', async () => {
  const claim = registerSkillProvenance(SPEC);
  await assert.rejects(() => verifySkillProvenance(claim, proof, { timeoutMs: 2147483648 }), /timeoutMs/);
});

test('A15 pending resolver deadline returns a verdict in a standalone process', () => {
  // Its own process on purpose: `unref` on the only timer would let a standalone program exit with
  // no verdict at all, and the rest of this suite's handles would hide that here.
  const { spawnSync } = require('node:child_process');
  const script = [
    `const kernel = require(${JSON.stringify(MODULE_PATH)});`,
    `const claim = kernel.registerSkillProvenance(${JSON.stringify(SPEC)});`,
    'kernel.verifySkillProvenance(claim, () => new Promise(() => {}), { timeoutMs: 5 })',
    '  .then((result) => console.log(result.status));',
  ].join('\n');
  const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 2000 });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /not_verifiable/);
});

// --- A17: a digest computed here and a digest asserted there are not the same claim ---

test('A17 byte recomputation is distinguishable from a resolver asserted digest', async () => {
  const claim = registerSkillProvenance(SPEC);
  const bytes = await verifySkillProvenance(claim, proof);
  const asserted = await verifySkillProvenance(claim, () => ({ ...proof(), content: undefined, contentDigest: claim.contentDigest }));
  assert.notDeepEqual(bytes, asserted, 'Vela must be able to record whether the verifier recomputed content');
});

test('A17 extended: a resolver cannot claim the kernel recomputed its content', async () => {
  const claim = registerSkillProvenance(SPEC);
  // The flag is computed by the kernel and is never read off the evidence, so a resolver that writes
  // it into its own answer buys nothing.
  const asserted = await verifySkillProvenance(claim, () => ({
    ...proof(),
    content: undefined,
    contentDigest: claim.contentDigest,
    contentRecomputed: true,
  }));
  assert.equal(asserted.contentRecomputed, false);
  const decision = authorizeSkill(claim, asserted, ['read']);
  assert.equal(decision.contentRecomputed, false);
  assert.equal(buildSkillReceipt(RECEIPT_SPEC, decision).skill.contentRecomputed, false);
});

test('A17 extended: the receipt states that the kernel hashed the bytes, and the seal covers that', async () => {
  const claim = registerSkillProvenance(SPEC);
  const bytes = await verifySkillProvenance(claim, proof);
  const receipt = buildSkillReceipt(RECEIPT_SPEC, loadSkill(claim, bytes, SPEC.content, ['read']));
  assert.equal(receipt.skill.contentRecomputed, true);
  assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
  const tampered = { ...receipt, skill: { ...receipt.skill, contentRecomputed: false } };
  assert.equal(verifyReceipt(tampered).ok, false);
});
