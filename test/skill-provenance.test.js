'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  registerSkillProvenance,
  verifySkillProvenance,
  authorizeSkill,
  loadSkill,
  buildSkillReceipt,
} = require('../src/skill-provenance.js');
const { buildReceipt, verifyReceipt } = require('../src/receipt.js');

const CONTENT = '# ponytail\nUse the smallest sufficient change.\n';
const REPOSITORY = 'https://example.test/obra/ponytail.git';
const COMMIT = 'a'.repeat(40);
const AUTHOR = 'Ada Example <ada@example.test>';
const GRANTED = ['read:project', 'write:patch'];

function register(overrides = {}) {
  return registerSkillProvenance({
    name: 'ponytail',
    repository: REPOSITORY,
    commit: COMMIT,
    author: AUTHOR,
    content: CONTENT,
    authority: GRANTED,
    ...overrides,
  });
}

function evidence(provenance, overrides = {}) {
  return {
    exists: true,
    repository: provenance.repository,
    commit: provenance.commit,
    author: provenance.author,
    contentDigest: provenance.contentDigest,
    ...overrides,
  };
}

function resolverFor(provenance, overrides = {}) {
  return async () => evidence(provenance, overrides);
}

function receiptSpec() {
  return {
    operation: { id: 'skill-load', goal: 'load an authorized skill' },
    capabilityId: 'skill-loader',
    authority: { spend: [] },
    outcome: { status: 'verified', exercised: [] },
    evidence: {},
    verification: { verified: true, checks: { local: true }, reason: 'local check' },
    at: '2040-01-01T00:00:00.000Z',
  };
}

test('verified provenance binds repository, exact commit, author and loaded bytes', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor(claim));
  assert.equal(claim.contentDigest, createHash('sha256').update(CONTENT, 'utf8').digest('hex'));
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.coverage.sort(), ['author', 'commit_exists', 'content_digest', 'repository']);
  assert.deepEqual(result.notCovered, []);
});

test('a borrowed known skill name cannot mask a different repository', async () => {
  const claim = register({ repository: 'https://attacker.test/fake/superpowers.git', name: 'superpowers' });
  const result = await verifySkillProvenance(claim, resolverFor(claim, {
    repository: 'https://real.test/obra/superpowers.git',
  }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.notCovered.includes('repository'));
});

test('a digest that differs from the pinned commit is discrepant', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor(claim, { contentDigest: '0'.repeat(64) }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.notCovered.includes('content_digest'));
});

test('a commit reported as absent is discrepant', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor(claim, { exists: false }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.notCovered.includes('commit_exists'));
});

test('an author different from the declared author is discrepant', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor(claim, { author: 'Mallory <m@example.test>' }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.notCovered.includes('author'));
});

test('self-declared provenance without independent resolver evidence is not verifiable', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim);
  assert.equal(result.status, 'not_verifiable');
  assert.notEqual(result.status, 'verified');
});

test('resolver rejection is not verifiable and never grants skill authority', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, async () => { throw new Error('offline'); });
  assert.equal(result.status, 'not_verifiable');
  assert.equal(authorizeSkill(claim, result, CONTENT, ['read:project']).authorized, false);
});

test('a resolver timeout is not verifiable even if its promise settles later', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, () => new Promise((resolve) => {
    setTimeout(() => resolve(evidence(claim)), 40);
  }), { timeoutMs: 5 });
  assert.equal(result.status, 'not_verifiable');
  assert.equal(authorizeSkill(claim, result, CONTENT, ['read:project']).authorized, false);
});

test('loaded bytes are hashed again so post-verification mutation is rejected', async () => {
  const claim = register();
  const verified = await verifySkillProvenance(claim, resolverFor(claim));
  const loaded = loadSkill(claim, verified, `${CONTENT}# injected after check\n`, ['read:project']);
  assert.equal(loaded.authorized, false);
  assert.equal(loaded.status, 'discrepant');
  assert.ok(loaded.notCovered.includes('loaded_content_digest'));
});

test('a skill cannot exercise authority beyond the person grant', async () => {
  const claim = register();
  const verified = await verifySkillProvenance(claim, resolverFor(claim));
  const decision = authorizeSkill(claim, verified, CONTENT, ['read:project', 'delete:repository']);
  assert.equal(decision.authorized, false);
  assert.equal(decision.status, 'not_verified');
  assert.ok(decision.notCovered.includes('authority_scope'));
});

test('only verified provenance plus an in-scope request receives authority', async () => {
  const claim = register();
  const verified = await verifySkillProvenance(claim, resolverFor(claim));
  const decision = authorizeSkill(claim, verified, CONTENT, ['read:project']);
  assert.equal(decision.authorized, true);
  assert.equal(decision.status, 'verified');
});

test('skill identity and digest are sealed into each receipt, detecting substitution', async () => {
  const first = register();
  const firstVerification = await verifySkillProvenance(first, resolverFor(first));
  const firstAuthorization = authorizeSkill(first, firstVerification, CONTENT, ['read:project']);
  const second = register({ name: 'lookalike', repository: 'https://attacker.test/lookalike.git', commit: 'b'.repeat(40) });
  const secondVerification = await verifySkillProvenance(second, resolverFor(second));
  const secondAuthorization = authorizeSkill(second, secondVerification, CONTENT, ['read:project']);
  const a = buildSkillReceipt(receiptSpec(), firstAuthorization);
  const b = buildSkillReceipt(receiptSpec(), secondAuthorization);
  assert.equal(verifyReceipt(a).ok, true);
  assert.equal(verifyReceipt(b).ok, true);
  assert.notEqual(a.digest, b.digest);
  assert.notEqual(a.skill.provenance.repository, b.skill.provenance.repository);
});

test('legacy receipt digest remains byte-for-byte stable when skill data is absent', () => {
  assert.equal(buildReceipt(receiptSpec()).digest, '0b4ea0547e976cdf9e5d14c2a792e4075727a668b3fc488480c5822ac13c2a30');
});
