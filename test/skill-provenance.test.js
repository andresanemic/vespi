'use strict';

// K2 (decision 24): a skill is a capability, and a capability enters only with written provenance.
//
// The shape of the attack this file is written against is the one the ecosystem study found: a skill
// that borrows a known name from another repository, ships content that does not match the commit it
// claims, and describes itself as safe. Nothing the skill says about itself counts here. The only
// evidence that counts comes from a resolver the caller injects, and the kernel never reaches the
// network to get it.

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
  SKILL_PROVENANCE_STATUSES,
} = require('../src/skill-provenance.js');
const { buildReceipt, verifyReceipt, computeDigest, anchorReceiptAsync } = require('../src/receipt.js');

const CONTENT = '# ponytail\nUse the smallest sufficient change.\n';
const REPOSITORY = 'https://example.test/obra/ponytail.git';
const COMMIT = 'a'.repeat(40);
const AUTHOR = 'Ada Example <ada@example.test>';
const GRANTED = ['read:project', 'write:patch'];
const OTHER_COMMIT = 'b'.repeat(40);

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

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

// Evidence is written out by hand, not derived from the claim, so a verifier that merely echoed the
// declaration back could not pass.
function evidence(overrides = {}) {
  return {
    exists: true,
    repository: REPOSITORY,
    commit: COMMIT,
    author: AUTHOR,
    content: CONTENT,
    ...overrides,
  };
}

function resolverFor(overrides = {}) {
  return async () => evidence(overrides);
}

function receiptSpec(overrides = {}) {
  return {
    operation: { id: 'skill-load', goal: 'load an authorized skill' },
    capabilityId: 'skill-loader',
    authority: { spend: [] },
    outcome: { status: 'verified', exercised: [] },
    evidence: {},
    verification: { verified: true, checks: { local: true }, reason: 'local check' },
    at: '2040-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// --- 1. The registry: repository, commit, author, content digest, granted authority ---

test('the registry binds repository, exact commit, author, content digest and granted authority', () => {
  const claim = register();
  assert.equal(claim.name, 'ponytail');
  assert.equal(claim.repository, REPOSITORY);
  assert.equal(claim.commit, COMMIT);
  assert.equal(claim.author, AUTHOR);
  assert.equal(claim.contentDigest, sha256(CONTENT));
  assert.deepEqual(claim.authority, GRANTED);
});

test('the content digest is over the exact bytes: line endings are not normalized away', () => {
  const lf = register({ content: 'one\ntwo\n' });
  const crlf = register({ content: 'one\r\ntwo\r\n' });
  assert.notEqual(lf.contentDigest, crlf.contentDigest);
  assert.equal(lf.contentDigest, sha256('one\ntwo\n'));
});

test('the record carries its own seal, and the seal is what makes two registrations distinguishable', () => {
  const first = register();
  const same = register();
  const other = register({ repository: 'https://attacker.test/fake/ponytail.git' });
  assert.equal(first.digest, same.digest);
  assert.notEqual(first.digest, other.digest);
});

test('the same name may be registered twice from different repositories: the name is not the identity', () => {
  const real = register({ name: 'superpowers', repository: 'https://example.test/obra/superpowers.git' });
  const fake = register({ name: 'superpowers', repository: 'https://attacker.test/101-skills/superpowers.git' });
  assert.notEqual(real.digest, fake.digest);
  const listed = listSkillProvenance().filter((entry) => entry.name === 'superpowers');
  assert.equal(listed.length, 2);
});

test('the registry refuses an entry without repository, commit or author', () => {
  assert.throws(() => register({ repository: '' }), /repository/i);
  assert.throws(() => register({ repository: '   ' }), /repository/i);
  assert.throws(() => register({ commit: undefined }), /commit/i);
  assert.throws(() => register({ author: null }), /author/i);
  assert.throws(() => register({ name: '' }), /name/i);
});

test('the registry refuses content that is not text and an authority that is not a list of names', () => {
  assert.throws(() => register({ content: Buffer.from('x') }), /content/i);
  assert.throws(() => register({ content: undefined }), /content/i);
  assert.throws(() => register({ authority: 'read:project' }), /authority/i);
  assert.throws(() => register({ authority: ['read:project', 7] }), /authority/i);
});

test('the registry refuses a moving reference where a commit belongs', () => {
  // `HEAD` and `main` keep their name while their content changes, so a claim built on them would be
  // provenance for bytes nobody pinned.
  for (const moving of ['HEAD', 'main', 'refs/heads/main', 'v1.2.3', 'abc1234', 'A'.repeat(40), `${COMMIT} `]) {
    assert.throws(() => register({ commit: moving }), /fixed commit/i, moving);
  }
  assert.doesNotThrow(() => register({ commit: 'a'.repeat(64) }));
});

test('a claim whose fields are getters that throw is refused, not read', () => {
  assert.throws(() => registerSkillProvenance({
    get name() { throw new Error('hostile'); },
    repository: REPOSITORY,
    commit: COMMIT,
    author: AUTHOR,
    content: CONTENT,
    authority: GRANTED,
  }), /name/i);
});

test('listing the registry reports identity and digests, never the skill content', () => {
  register({ name: 'listed-skill' });
  const entry = listSkillProvenance().find((item) => item.name === 'listed-skill');
  assert.deepEqual(Object.keys(entry).sort(), ['author', 'commit', 'contentDigest', 'name', 'repository']);
  assert.equal(entry.content, undefined);
});

// --- 2. Verification against injected evidence ---

test('the status vocabulary is exactly the four states the encargo names', () => {
  assert.deepEqual([...SKILL_PROVENANCE_STATUSES].sort(), ['discrepant', 'not_verifiable', 'not_verified', 'verified']);
});

test('verified provenance covers repository, commit existence, author and loaded content', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor());
  assert.equal(result.status, 'verified');
  assert.deepEqual([...result.coverage].sort(), ['author', 'commit_exists', 'content_digest', 'repository']);
  assert.deepEqual(result.notCovered, []);
});

// The question is where the independence starts or does not. It carries only what locates the
// evidence: the skill's name, its repository and the exact commit. The declared author and the
// declared content digest are withheld, because those are the two answers this kernel asks the
// resolver to produce; handing them over made a one-key echo of the question enough to be `verified`.
test('the resolver is asked only where the evidence is, and is called exactly once', async () => {
  const claim = register();
  const calls = [];
  const result = await verifySkillProvenance(claim, async (question) => {
    calls.push(question);
    return evidence();
  });
  assert.equal(result.status, 'verified');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'ponytail');
  assert.equal(calls[0].repository, REPOSITORY);
  assert.equal(calls[0].commit, COMMIT);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['commit', 'name', 'repository']);
  // What the question must not carry, asserted as absences rather than as a comment.
  assert.equal(calls[0].author, undefined);
  assert.equal(calls[0].contentDigest, undefined);
  assert.equal(JSON.stringify(calls[0]).includes(AUTHOR), false, 'the declared author reached the resolver');
  assert.equal(JSON.stringify(calls[0]).includes(sha256(CONTENT)), false, 'the declared content digest reached the resolver');
  assert.equal(Object.isFrozen(calls[0]), true);
});

test('the kernel hashes the bytes the resolver returns instead of believing a digest string', async () => {
  const claim = register();
  // A resolver that reports the right digest string while shipping different bytes is refuted: the
  // digest is computed here, not asserted by the party being checked (decision 22).
  const result = await verifySkillProvenance(claim, resolverFor({
    content: `${CONTENT}# exfiltrate\n`,
    contentDigest: sha256(CONTENT),
  }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.notCovered.includes('content_digest'));
});

test('a resolver that returns only a digest string is accepted, and that weaker shape is declared', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor({ content: undefined, contentDigest: sha256(CONTENT) }));
  assert.equal(result.status, 'verified');
});

test('partial refutation keeps the checks that did pass in coverage', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor({ author: 'Mallory <m@example.test>' }));
  assert.equal(result.status, 'discrepant');
  assert.deepEqual([...result.coverage].sort(), ['commit_exists', 'content_digest', 'repository']);
  assert.deepEqual(result.notCovered, ['author']);
});

test('an absent commit is discrepant, and the reason names the commit', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor({ exists: false }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.notCovered.includes('commit_exists'));
  assert.match(result.reason, new RegExp(COMMIT.slice(0, 8)));
});

test('a digest that differs from the pinned commit is discrepant', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor({ content: undefined, contentDigest: '0'.repeat(64) }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.notCovered.includes('content_digest'));
});

test('evidence about a different commit than the one declared is discrepant', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor({ commit: OTHER_COMMIT }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.notCovered.includes('commit_exists'));
});

test('an author that differs only in case is a different author', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor({ author: 'ada example <ada@example.test>' }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.notCovered.includes('author'));
});

test('a repository that differs only in spelling is a different repository', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor({ repository: REPOSITORY.replace(/\.git$/, '') }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.notCovered.includes('repository'));
});

// --- 3. Adversarial: borrowed names and self-declared provenance ---

test('a borrowed known skill name cannot mask a different repository', async () => {
  const claim = register({ name: 'superpowers', repository: 'https://attacker.test/fake/superpowers.git' });
  const result = await verifySkillProvenance(claim, resolverFor({
    repository: 'https://example.test/obra/superpowers.git',
  }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.notCovered.includes('repository'));
});

test('self-declared provenance without a resolver is not verifiable', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim);
  assert.equal(result.status, 'not_verifiable');
  assert.deepEqual(result.coverage, []);
  assert.equal(result.notCovered.length, 4);
});

test('a skill cannot attach its own proof of innocence to its claim', async () => {
  const claim = register();
  // A skill that ships its own evidence: every field a resolver would return, written onto the claim.
  // The claim is frozen, so the write does not even land — and nothing on it is read as evidence.
  assert.throws(() => {
    claim.evidence = evidence();
    claim.exists = true;
    claim.selfDigest = sha256(CONTENT);
  }, TypeError);
  const result = await verifySkillProvenance(claim);
  assert.equal(result.status, 'not_verifiable');
  assert.deepEqual(Object.keys(claim).sort(), ['author', 'authority', 'commit', 'contentDigest', 'digest', 'name', 'repository']);
});

test('a claim that was never registered cannot be verified, however perfect the evidence', async () => {
  const forged = {
    name: 'ponytail',
    repository: REPOSITORY,
    commit: COMMIT,
    author: AUTHOR,
    contentDigest: sha256(CONTENT),
    authority: GRANTED,
    digest: sha256('made up'),
  };
  const result = await verifySkillProvenance(forged, resolverFor());
  assert.equal(result.status, 'not_verifiable');
  assert.equal(authorizeSkill(forged, result, ['read:project']).authorized, false);
});

test('a claim rewritten after registration no longer carries the registered provenance', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor());
  assert.equal(result.status, 'verified');
  const swapped = { ...claim, commit: OTHER_COMMIT, contentDigest: sha256('# swapped\n'), digest: sha256('swapped') };
  const after = await verifySkillProvenance(swapped, resolverFor());
  assert.equal(after.status, 'not_verifiable');
});

test('the registered provenance cannot be rewritten in place', async () => {
  const claim = register();
  try {
    claim.commit = OTHER_COMMIT;
    claim.authority = ['delete:repository'];
  } catch {
    // The record is frozen, so the write is refused outright.
  }
  const result = await verifySkillProvenance(claim, resolverFor());
  assert.equal(result.status, 'verified');
  assert.deepEqual(claim.authority, GRANTED);
  const decision = authorizeSkill(claim, result, ['delete:repository']);
  assert.equal(decision.authorized, false);
});

test('a resolver that is not callable is not verifiable', async () => {
  const claim = register();
  for (const bad of [undefined, null, 'git ls-remote', 42, {}, []]) {
    const result = await verifySkillProvenance(claim, bad);
    assert.equal(result.status, 'not_verifiable', String(bad));
  }
});

test('evidence that is not an object is not verifiable', async () => {
  const claim = register();
  for (const bad of [null, undefined, 'ok', 7, ['ok'], true]) {
    const result = await verifySkillProvenance(claim, async () => bad);
    assert.equal(result.status, 'not_verifiable', JSON.stringify(bad));
    assert.equal(authorizeSkill(claim, result, ['read:project']).authorized, false);
  }
});

test('evidence that omits a field proves nothing about it', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, async () => ({ exists: true }));
  assert.equal(result.status, 'not_verifiable');
  assert.deepEqual(result.coverage, []);
  assert.deepEqual([...result.notCovered].sort(), ['author', 'commit_exists', 'content_digest', 'repository']);
});

test('an exists flag that is not a boolean is not verifiable rather than a yes', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, resolverFor({ exists: 'yes' }));
  assert.equal(result.status, 'not_verifiable');
});

// --- 4. Adversarial: a resolver that fails, stalls or answers late ---

test('a resolver rejection is not verifiable and never grants skill authority', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, async () => { throw new Error('offline'); });
  assert.equal(result.status, 'not_verifiable');
  assert.equal(authorizeSkill(claim, result, ['read:project']).authorized, false);
});

test('a resolver that answers after the deadline is not verifiable, never verified', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, () => new Promise((resolve) => {
    setTimeout(() => resolve(evidence()), 40).unref();
  }), { timeoutMs: 5 });
  assert.equal(result.status, 'not_verifiable');
  assert.equal(authorizeSkill(claim, result, ['read:project']).authorized, false);
});

test('a resolver that rejects after the deadline cannot reach the result', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, () => new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error('late failure')), 30).unref();
  }), { timeoutMs: 5 });
  assert.equal(result.status, 'not_verifiable');
  return new Promise((resolve) => setTimeout(resolve, 60)).then(() => {
    assert.equal(result.status, 'not_verifiable');
  });
});

test('a deadline that is not a positive integer is refused instead of ignored', async () => {
  const claim = register();
  await assert.rejects(() => verifySkillProvenance(claim, resolverFor(), { timeoutMs: 0 }), /timeoutMs/);
  await assert.rejects(() => verifySkillProvenance(claim, resolverFor(), { timeoutMs: -1 }), /timeoutMs/);
  await assert.rejects(() => verifySkillProvenance(claim, resolverFor(), { timeoutMs: 1.5 }), /timeoutMs/);
});

test('with no deadline given the resolver is waited for: the kernel sets no time of its own', async () => {
  const claim = register();
  const result = await verifySkillProvenance(claim, () => new Promise((resolve) => {
    setTimeout(() => resolve(evidence()), 25).unref();
  }));
  assert.equal(result.status, 'verified');
});

test('evidence whose getters throw is not verifiable and never crashes the caller', async () => {
  const claim = register();
  const hostile = {
    exists: true,
    get repository() { throw new Error('hostile repository'); },
    author: AUTHOR,
    content: CONTENT,
  };
  const result = await verifySkillProvenance(claim, async () => hostile);
  assert.equal(result.status, 'not_verifiable');
  assert.equal(authorizeSkill(claim, result, ['read:project']).authorized, false);
});

// --- 5. Adversarial: time-of-check to time-of-use ---

test('bytes loaded after verification are hashed again and a mutation is refused', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    const loaded = loadSkill(claim, verified, `${CONTENT}# injected after the check\n`, ['read:project']);
    assert.equal(loaded.authorized, false);
    assert.equal(loaded.status, 'discrepant');
    assert.ok(loaded.notCovered.includes('loaded_content_digest'));
    assert.equal(loaded.loadedDigest, sha256(`${CONTENT}# injected after the check\n`));
  });
});

test('the unchanged bytes still load after verification', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    const loaded = loadSkill(claim, verified, CONTENT, ['read:project']);
    assert.equal(loaded.authorized, true);
    assert.equal(loaded.status, 'verified');
    assert.equal(loaded.loadedDigest, sha256(CONTENT));
  });
});

test('loading bytes that are not text is refused', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    const loaded = loadSkill(claim, verified, null, ['read:project']);
    assert.equal(loaded.authorized, false);
    assert.equal(loaded.status, 'discrepant');
  });
});

// --- 6. Authority: only what the person granted ---

test('only verified provenance plus an in-scope request receives authority', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    const decision = authorizeSkill(claim, verified, ['read:project']);
    assert.equal(decision.authorized, true);
    assert.equal(decision.status, 'verified');
    assert.deepEqual(decision.granted, GRANTED);
    assert.deepEqual(decision.requested, ['read:project']);
  });
});

test('a skill cannot exercise authority beyond the person grant', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    const decision = authorizeSkill(claim, verified, ['read:project', 'delete:repository']);
    assert.equal(decision.authorized, false);
    assert.equal(decision.status, 'not_verified');
    assert.ok(decision.notCovered.includes('authority_scope'));
    assert.match(decision.reason, /delete:repository/);
  });
});

test('a wildcard never enters the registry, so there is no silent expansion to discover later', () => {
  assert.throws(() => register({ authority: ['read:*'] }), /wildcard/i);
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    const decision = authorizeSkill(claim, verified, ['read:*']);
    assert.equal(decision.authorized, false);
    assert.match(decision.reason, /wildcard/i);
  });
});

test('a request that is empty or malformed receives no authority', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    for (const bad of [[], 'read:project', null, undefined, [7], ['read:project', 'read:project']]) {
      const decision = authorizeSkill(claim, verified, bad);
      assert.equal(decision.authorized, false, JSON.stringify(bad));
      assert.ok(decision.notCovered.includes('authority_scope'));
    }
  });
});

test('a skill registered with no granted authority can never be authorized', () => {
  const claim = register({ authority: [] });
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    assert.equal(verified.status, 'verified');
    const decision = authorizeSkill(claim, verified, ['read:project']);
    assert.equal(decision.authorized, false);
    assert.ok(decision.notCovered.includes('authority_scope'));
  });
});

test('refuted provenance keeps its own status in the decision and its reason', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor({ author: 'Mallory <m@example.test>' })).then((refuted) => {
    const decision = authorizeSkill(claim, refuted, ['read:project']);
    assert.equal(decision.authorized, false);
    assert.equal(decision.status, 'discrepant');
    assert.equal(decision.provenanceStatus, 'discrepant');
    assert.deepEqual([...decision.notCovered], ['author']);
    // A refuted author is not an authority problem, and the three checks that did pass stay covered.
    assert.deepEqual([...decision.coverage].sort(), ['commit_exists', 'content_digest', 'repository']);
  });
});

test('a request out of scope does not erase the provenance coverage that was achieved', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    const decision = authorizeSkill(claim, verified, ['delete:repository']);
    assert.equal(decision.authorized, false);
    assert.deepEqual([...decision.notCovered], ['authority_scope']);
    assert.deepEqual([...decision.coverage].sort(), ['author', 'commit_exists', 'content_digest', 'repository']);
  });
});

test('a verification result cannot be replayed against another skill', () => {
  const real = register();
  const other = register({ name: 'lookalike', repository: 'https://attacker.test/lookalike.git', commit: OTHER_COMMIT });
  return verifySkillProvenance(real, resolverFor()).then((verified) => {
    assert.equal(authorizeSkill(real, verified, ['read:project']).authorized, true);
    assert.equal(authorizeSkill(other, verified, ['read:project']).authorized, false);
    assert.equal(loadSkill(other, verified, CONTENT, ['read:project']).authorized, false);
  });
});

test('a forged verification result is refused', () => {
  const claim = register();
  const forged = {
    status: 'verified',
    coverage: ['author', 'commit_exists', 'content_digest', 'repository'],
    notCovered: [],
    checks: { repository: true, commit_exists: true, author: true, content_digest: true },
    reason: 'trust me',
  };
  const decision = authorizeSkill(claim, forged, ['read:project']);
  assert.equal(decision.authorized, false);
  assert.equal(decision.status, 'not_verifiable');
});

test('a resolver that echoes the question back proves nothing', async () => {
  const claim = register();
  // The cheapest possible forgery: hand the kernel the declaration and call it evidence.
  const result = await verifySkillProvenance(claim, async (question) => question);
  assert.equal(result.status, 'not_verifiable');
  assert.equal(authorizeSkill(claim, result, ['read:project']).authorized, false);
});

test('a reason composed from hostile evidence stays inside the receipt size limit', async () => {
  const claim = register();
  const long = 'x'.repeat(4000);
  const result = await verifySkillProvenance(claim, resolverFor({ repository: long, author: long }));
  assert.equal(result.status, 'discrepant');
  assert.ok(result.reason.length <= 512, `reason was ${result.reason.length} characters`);
  const receipt = buildSkillReceipt(receiptSpec(), authorizeSkill(claim, result, ['read:project']));
  assert.equal(receipt.status, 'failed');
  assert.ok((receipt.skill.reason || '').length <= 512);
  assert.equal(verifyReceipt(receipt).ok, true);
});

// --- 7. The receipt ---

test('a skill receipt verifies and carries the provenance, the scope and the coverage', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    const decision = authorizeSkill(claim, verified, ['read:project']);
    const receipt = buildSkillReceipt(receiptSpec(), decision);
    assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
    assert.equal(receipt.status, 'verified');
    assert.equal(receipt.skill.name, 'ponytail');
    assert.deepEqual(receipt.skill.provenance, {
      repository: REPOSITORY,
      commit: COMMIT,
      author: AUTHOR,
      contentDigest: sha256(CONTENT),
    });
    assert.deepEqual(receipt.skill.granted, GRANTED);
    assert.deepEqual(receipt.skill.requested, ['read:project']);
    assert.deepEqual([...receipt.coverage].sort(), ['author', 'commit_exists', 'content_digest', 'repository']);
    assert.deepEqual(receipt.notCovered, ['external anchor']);
  });
});

test('the receipt status is one the receipt ladder already knows', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor({ repository: 'https://attacker.test/x.git' })).then((refuted) => {
    const decision = authorizeSkill(claim, refuted, ['read:project']);
    const receipt = buildSkillReceipt(receiptSpec(), decision);
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.skill.status, 'discrepant');
    assert.equal(receipt.skill.provenanceStatus, 'discrepant');
    assert.ok(receipt.notCovered.includes('repository'));
    assert.equal(verifyReceipt(receipt).ok, true);
  });
});

test('an unverifiable skill lands on not_verified, not on a clean bill of health', () => {
  const claim = register();
  return verifySkillProvenance(claim).then((unverifiable) => {
    const decision = authorizeSkill(claim, unverifiable, ['read:project']);
    const receipt = buildSkillReceipt(receiptSpec(), decision);
    assert.equal(receipt.status, 'not_verified');
    assert.equal(receipt.skill.provenanceStatus, 'not_verifiable');
    assert.equal(receipt.verification.verified, false);
    assert.deepEqual(receipt.coverage, []);
    assert.equal(verifyReceipt(receipt).ok, true);
  });
});

test('the skill block is inside the seal: swapping one skill for another breaks the receipt', () => {
  const first = register();
  const second = register({ name: 'lookalike', repository: 'https://attacker.test/lookalike.git', commit: OTHER_COMMIT });
  return Promise.all([verifySkillProvenance(first, resolverFor()), verifySkillProvenance(second, resolverFor({ repository: 'https://attacker.test/lookalike.git', commit: OTHER_COMMIT }))])
    .then(([a, b]) => {
      const receiptA = buildSkillReceipt(receiptSpec(), authorizeSkill(first, a, ['read:project']));
      const receiptB = buildSkillReceipt(receiptSpec(), authorizeSkill(second, b, ['read:project']));
      assert.equal(receiptA.operation.id, receiptB.operation.id);
      assert.notEqual(receiptA.digest, receiptB.digest);
      const tampered = { ...receiptA, skill: receiptB.skill };
      assert.equal(verifyReceipt(tampered).ok, false);
      assert.equal(verifyReceipt(tampered).reason, 'digest mismatch');
    });
});

test('the same decision and the same clock seal the same receipt twice', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    const decision = authorizeSkill(claim, verified, ['read:project']);
    const one = buildSkillReceipt(receiptSpec(), decision);
    const two = buildSkillReceipt(receiptSpec(), decision);
    assert.equal(one.digest, two.digest);
    assert.equal(one.digest, computeDigest(one));
  });
});

test('a receipt is refused for a decision this kernel did not produce', () => {
  assert.throws(() => buildSkillReceipt(receiptSpec(), { status: 'verified', authorized: true }), /decision/i);
});

test('a load receipt says the bytes were re-checked at load time', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    const loaded = loadSkill(claim, verified, CONTENT, ['read:project']);
    const receipt = buildSkillReceipt(receiptSpec(), loaded);
    assert.equal(receipt.status, 'verified');
    // Five checks now: the four from verification and the one the load itself ran.
    assert.deepEqual([...receipt.coverage].sort(), ['author', 'commit_exists', 'content_digest', 'loaded_content_digest', 'repository']);
    assert.equal(receipt.skill.loadedDigest, sha256(CONTENT));
    assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
  });
});

test('a load receipt for bytes that changed says so in the status and in what was not covered', () => {
  const claim = register();
  return verifySkillProvenance(claim, resolverFor()).then((verified) => {
    const loaded = loadSkill(claim, verified, `${CONTENT}# swapped in the gap\n`, ['read:project']);
    const receipt = buildSkillReceipt(receiptSpec(), loaded);
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.skill.status, 'discrepant');
    assert.ok(receipt.notCovered.includes('loaded_content_digest'));
    assert.equal(receipt.skill.loadedDigest, sha256(`${CONTENT}# swapped in the gap\n`));
    assert.equal(verifyReceipt(receipt).ok, true);
  });
});

test('a skill receipt travels through the anchor machinery the kernel already had', async () => {
  const claim = register();
  const verified = await verifySkillProvenance(claim, resolverFor());
  const receipt = buildSkillReceipt(receiptSpec(), authorizeSkill(claim, verified, ['read:project']));
  const anchored = await anchorReceiptAsync(receipt, async (digest) => ({ txHash: `tx-${digest.slice(0, 8)}` }), async () => true);
  assert.equal(anchored.anchor.status, 'anchored');
  assert.equal(anchored.skill.provenance.commit, COMMIT);
  assert.equal(verifyReceipt(anchored).ok, true, verifyReceipt(anchored).reason);
});

// --- 8. Compatibility ---

test('a receipt built without skill data keeps its previous digest byte for byte', () => {
  assert.equal(buildReceipt(receiptSpec()).digest, 'e19da3380d3ae2f5a63ae68f4de701b40e97d6fb51d0482958d664573d591a33');
});

test('the public exports of the modules that were already there keep their names', () => {
  const receipt = require('../src/receipt.js');
  for (const name of ['buildReceipt', 'verifyReceipt', 'anchorReceipt', 'anchorReceiptAsync', 'computeDigest']) {
    assert.equal(typeof receipt[name], 'function', name);
  }
  const authority = require('../src/authority.js');
  for (const name of ['grantSpend', 'sufficient']) assert.equal(typeof authority[name], 'function', name);
});
