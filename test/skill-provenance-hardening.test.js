'use strict';

// K2 (decision 24), the attacker round: attacks written against this branch by someone who did not
// build it, grouped by the class of defect each one is looking for.
//
// The two previous review rounds (A01-A17, R201-R217) already closed the authority replay, the
// mutable request, the throwing resolver, the forged decision, the timer range and the recomputation
// flag. Nothing here repeats those cases. What is left is what a reviewer who reads the code instead
// of the tests would press on:
//
//   - A revoked proxy or a throwing getter that escapes an API instead of being refused by it. The
//     request capture was fixed for this (R206) and the two other entry points were not.
//   - The granted authority read through a caller-supplied iterator, the one thing the module says
//     no method handed over by the caller ever decides (A02), applied to registration instead of to
//     the request.
//   - Text the resolver supplied copied into a reason this kernel hands back, the same rule the
//     module already applies to a thrown value (A05, A06).
//   - Content whose UTF-8 bytes cannot tell two different strings apart, under a digest the module
//     documents as being over the exact bytes.
//
// The rest are the floor: attacks that must stay refused, so a later fix cannot quietly open them.
// The `todo` cases are the two attacks whose repair is a decision about a public contract and not a
// bug fix; they are written down, not silently dropped.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const {
  registerSkillProvenance,
  verifySkillProvenance,
  authorizeSkill,
  loadSkill,
  buildSkillReceipt,
} = require('../src/skill-provenance.js');
const { verifyReceipt } = require('../src/receipt.js');

const SPEC = Object.freeze({
  name: 'attacker',
  repository: 'https://example.test/attacker',
  commit: 'a'.repeat(40),
  author: 'Attacker Author',
  content: '# safe',
  authority: ['read'],
});

const RECEIPT_SPEC = Object.freeze({
  operation: { id: 'attacker', goal: 'attack' },
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

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function registeredAndVerified(spec = SPEC) {
  const claim = registerSkillProvenance(spec);
  return [claim, await verifySkillProvenance(claim, () => proof())];
}

function claimRegisteredWith(overrides) {
  return registerSkillProvenance({ ...SPEC, ...overrides });
}

// --- Group 1: an API that throws at the caller instead of refusing (H01, H02, H03) ---
//
// The module's rule, stated where the request capture is built: a caller holding an object it has
// already destroyed gets a refusal, not a `TypeError` out of someone else's control flow. Two other
// entry points took a hostile object as an object and let the platform decide.

test('H01 a revoked proxy as the registration spec is refused by name, not thrown at the caller', () => {
  // `Array.isArray` runs a trap check, so on a revoked proxy it throws before the module has decided
  // anything about the spec. The caller is holding something it already destroyed; the answer it is
  // owed is the module's own "a skill needs a name", not a `TypeError` from `IsArray`.
  const revoked = Proxy.revocable({ name: 'x', ...SPEC }, {});
  revoked.revoke();
  assert.throws(() => registerSkillProvenance(revoked.proxy), (err) => {
    assert.equal(err.constructor, Error, `a TypeError escaped: ${err && err.message}`);
    assert.match(err.message, /name/i);
    return true;
  });
});

test('H02 a throwing authority getter is refused with a module reason, not with the caller own error', () => {
  const spec = { ...SPEC };
  Object.defineProperty(spec, 'authority', { get() { throw new Error('SYNTHETIC_AUTHORITY_READ'); } });
  assert.throws(() => registerSkillProvenance(spec), (err) => {
    assert.match(err.message, /^authority must be an array of capability names$/);
    assert.ok(!err.message.includes('SYNTHETIC_AUTHORITY_READ'), 'the caller own text came back out');
    return true;
  });
});

test('H03 an authority array whose element read throws is refused, not thrown', () => {
  const raw = ['read'];
  const hostile = new Proxy(raw, {
    get(target, key) {
      if (key === '0') throw new Error('SYNTHETIC_ELEMENT_READ');
      return Reflect.get(target, key);
    },
  });
  assert.throws(() => registerSkillProvenance({ ...SPEC, authority: hostile }), (err) => {
    assert.equal(err.constructor, Error, `a TypeError escaped: ${err && err.message}`);
    assert.ok(!err.message.includes('SYNTHETIC_ELEMENT_READ'), err.message);
    return true;
  });
});

// --- Group 2: the grant is the declared list, not what an overridden iterator yields (H04) ---
//
// The request capture reads by index precisely so that "no method handed over by the caller ever
// decides whether authority widens" (A02). Registration read the granted list through `for...of`,
// which consults `Symbol.iterator`, so the same sentence did not hold for the grant.

test('H04 an overridden iterator on the granted authority cannot grant what the array does not', () => {
  // The array declares one capability. The iterator yields another. Whoever registered this meant the
  // array, and the module's own comment says the exact names on it are the grant.
  const authority = ['read'];
  let consulted = 0;
  authority[Symbol.iterator] = function* iterator() { consulted += 1; yield 'delete'; };
  const claim = registerSkillProvenance({ ...SPEC, authority });
  assert.deepEqual(claim.authority, ['read']);
  assert.equal(consulted, 0, 'the granted list was read through the caller iterator');
  assert.equal(authority[0], 'read');
});

test('H05 the granted authority is read by index and each element is read exactly once', () => {
  // Two ways to move the number the registry reports: an iterator that lies about how many items
  // there are, and an element getter that answers differently the second time it is read.
  const inflated = new Proxy(['read'], {
    get(target, key) { return key === 'length' ? 3 : Reflect.get(target, key); },
  });
  assert.throws(() => registerSkillProvenance({ ...SPEC, authority: inflated }), /authority/i);

  let reads = 0;
  const changing = [];
  Object.defineProperty(changing, '0', {
    enumerable: true,
    get() { return (reads += 1) === 1 ? 'read' : 'delete'; },
  });
  changing.length = 1;
  const claim = registerSkillProvenance({ ...SPEC, authority: changing });
  assert.equal(reads, 1);
  assert.deepEqual(claim.authority, ['read']);
});

// --- Group 3: text the resolver supplied must not be copied into a reason (H06, H07, H08) ---
//
// The rule the module already applies to a thrown value (A05, A06): the value belongs to whoever
// produced it, it can carry a token or a path, and none of it is read. Evidence fields are produced
// by the same party, and a resolver is free to put whatever it likes in `author`. The declared value
// is already in the receipt's provenance block, so echoing the reported one buys nothing.

test('H06 a resolver-reported author is not echoed into the reason this kernel hands back', async () => {
  const claim = claimRegisteredWith({});
  const planted = 'ghp_PLANTED_BY_THE_RESOLVER_0123456789';
  const result = await verifySkillProvenance(claim, () => proof({ author: planted }));
  assert.equal(result.status, 'discrepant');
  assert.ok(!result.reason.includes(planted), result.reason);
  assert.match(result.reason, /author/);
});

test('H07 a resolver-reported repository is not echoed into the reason', async () => {
  const claim = claimRegisteredWith({});
  const planted = 'https://attacker.test/private/token-in-the-path';
  const result = await verifySkillProvenance(claim, () => proof({ repository: planted }));
  assert.equal(result.status, 'discrepant');
  assert.ok(!result.reason.includes(planted), result.reason);
  assert.match(result.reason, /repository/);
});

test('H08 a resolver-reported commit is not echoed into the reason', async () => {
  const claim = claimRegisteredWith({});
  const planted = 'c'.repeat(40);
  const result = await verifySkillProvenance(claim, () => proof({ commit: planted }));
  assert.equal(result.status, 'discrepant');
  assert.ok(!result.reason.includes(planted), result.reason);
  // The commit the person declared is the module own text and may still be named.
  assert.match(result.reason, new RegExp(SPEC.commit.slice(0, 8)));
});

// --- Group 4: the receipt spec is hostile input too (H09, H10, H11) ---

test('H09 a revoked proxy as the receipt spec is contained, and the receipt says it knows nothing', async () => {
  // A receipt can be built from no spec at all, so an unreadable one degrades the same way: an
  // ordinary receipt that names nothing it cannot know. Registration is the opposite case, because a
  // record with no name is not a record and `registerSkillProvenance` refuses (H01).
  const [claim, result] = await registeredAndVerified();
  const decision = authorizeSkill(claim, result, ['read']);
  const revoked = Proxy.revocable({ ...RECEIPT_SPEC }, {});
  revoked.revoke();
  let receipt;
  assert.doesNotThrow(() => { receipt = buildSkillReceipt(revoked.proxy, decision); });
  assert.equal(receipt.operation.id, 'unknown');
  assert.equal(receipt.capability, 'unknown');
  assert.equal(receipt.status, 'verified');
  assert.equal(receipt.skill.name, SPEC.name);
  assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
});

test('H10 a throwing getter in the receipt spec is contained instead of escaping the API', async () => {
  const [claim, result] = await registeredAndVerified();
  const decision = authorizeSkill(claim, result, ['read']);
  for (const key of ['operation', 'outcome', 'authority', 'capabilityId', 'at']) {
    const spec = { ...RECEIPT_SPEC };
    Object.defineProperty(spec, key, { get() { throw new Error(`SYNTHETIC_${key.toUpperCase()}_READ`); } });
    let receipt;
    assert.doesNotThrow(() => { receipt = buildSkillReceipt(spec, decision); }, key);
    assert.ok(!JSON.stringify(receipt).includes('SYNTHETIC_'), key);
    assert.equal(verifyReceipt(receipt).ok, true, key);
  }
});

test('H11 a receipt spec whose own key enumeration throws is contained', async () => {
  const [claim, result] = await registeredAndVerified();
  const decision = authorizeSkill(claim, result, ['read']);
  const hostile = new Proxy({ ...RECEIPT_SPEC }, {
    ownKeys() { throw new Error('SYNTHETIC_OWN_KEYS'); },
  });
  let receipt;
  assert.doesNotThrow(() => { receipt = buildSkillReceipt(hostile, decision); });
  assert.equal(verifyReceipt(receipt).ok, true);
  assert.equal(receipt.skill.name, SPEC.name);
});

// --- Group 5: the digest is over the exact bytes, so the text has to be exact too (H12) ---
//
// The module states that the digest covers the exact bytes and that line endings are not normalized
// away. UTF-8 cannot carry an unpaired surrogate, so two different strings can hash to the same
// digest: a load that offers text nobody verified passes the check under the name of text that was.

test('H12 text that hashes like the verified bytes but is not that text cannot load', async () => {
  const registered = 'head\uFFFDtail';
  const lookalike = 'head\uD800tail';
  assert.notEqual(registered, lookalike);
  // The premise of the attack, measured: the two strings are different and hash the same.
  assert.equal(sha256(registered), sha256(lookalike));

  const claim = claimRegisteredWith({ content: registered });
  const verified = await verifySkillProvenance(claim, () => proof({ content: registered }));
  assert.equal(verified.status, 'verified');

  // Both sides are refused, so this is the form the attack takes once the registry will not hold
  // text carrying unpaired surrogates (H13): the load offers the other string that hashes alike.
  const loaded = loadSkill(claim, verified, lookalike, ['read']);
  assert.equal(loaded.authorized, false);
  assert.equal(loaded.status, 'discrepant');
  assert.equal(loaded.checks.loaded_content_digest, false);
  assert.equal(loaded.loadedDigest, null);
  // The honest spelling of the same content still loads, surrogates and all.
  assert.equal(loadSkill(claim, verified, registered, ['read']).authorized, true);
});

test('H13 unpaired surrogates cannot enter the registry in the first place', () => {
  assert.throws(() => registerSkillProvenance({ ...SPEC, content: 'a\uD800b' }), /content/i);
  // Text that survives its own UTF-8 round trip is still fine, including non-ASCII.
  assert.doesNotThrow(() => registerSkillProvenance({ ...SPEC, content: 'üñíçødé \u2713' }));
});

// --- Group 6: two attacks whose repair is a contract decision, not a bug fix ---

test('H12d a refused request is not recorded in the decision it refuses', { todo: "diferido al 0.1.5 por decisión del coordinador" }, async () => {
  const [claim, result] = await registeredAndVerified();
  const decision = authorizeSkill(claim, result, ['delete']);
  const receipt = buildSkillReceipt(RECEIPT_SPEC, decision);
  // What the reader of the receipt gets today: the reason names it, the requested list does not.
  assert.match(decision.reason, /delete/);
  assert.deepEqual([...decision.requested], ['delete']);
  assert.deepEqual([...receipt.skill.requested], ['delete']);
});

test('H13d a receipt cannot show when the provenance behind it was verified', { todo: "diferido al 0.1.5 por decisión del coordinador" }, async () => {
  const [claim, result] = await registeredAndVerified();
  const decision = authorizeSkill(claim, result, ['read']);
  const earlier = buildSkillReceipt({ ...RECEIPT_SPEC, at: '1970-01-01T00:00:00.000Z' }, decision);
  const later = buildSkillReceipt({ ...RECEIPT_SPEC, at: '2999-01-01T00:00:00.000Z' }, decision);
  assert.equal(verifyReceipt(earlier).ok, true);
  assert.equal(verifyReceipt(later).ok, true);
  // A receipt built from the same decision carries no trace of when the decision was taken.
  assert.equal(earlier.skill.verifiedAt, later.skill.verifiedAt);
});

// --- Group 7: the floor. Attacks that must stay refused ---

test('H14 the digest covers every field of the skill block, one field at a time', async () => {
  const [claim, result] = await registeredAndVerified();
  const receipt = buildSkillReceipt(RECEIPT_SPEC, loadSkill(claim, result, SPEC.content, ['read']));
  const fields = Object.keys(receipt.skill);
  assert.ok(fields.length >= 11, JSON.stringify(fields));
  for (const field of fields) {
    const original = receipt.skill[field];
    const tampered = {
      ...receipt,
      skill: {
        ...receipt.skill,
        [field]: Array.isArray(original)
          ? original.concat(['injected'])
          : (original !== null && typeof original === 'object' ? { ...original, author: 'Injected' } : 'injected'),
      },
    };
    assert.equal(verifyReceipt(tampered).ok, false, `the digest does not cover skill.${field}`);
  }
});

test('H15 a claim forged out of the question the resolver was handed cannot be authorized', async () => {
  let stolen = null;
  const claim = claimRegisteredWith({});
  const result = await verifySkillProvenance(claim, (question) => {
    stolen = { ...question, authority: ['read', 'delete'], digest: sha256('forged') };
    return proof();
  });
  assert.equal(result.status, 'verified');
  assert.equal(authorizeSkill(stolen, result, ['read']).authorized, false);
  assert.equal(loadSkill(stolen, result, SPEC.content, ['read']).authorized, false);
  assert.throws(() => buildSkillReceipt(RECEIPT_SPEC, { ...stolen, status: 'verified' }), /decision/i);
});

test('H16 evidence and a request from another realm behave the same as local ones', async () => {
  const claim = claimRegisteredWith({});
  const foreignEvidence = vm.runInNewContext(`(${JSON.stringify(proof())})`);
  const verified = await verifySkillProvenance(claim, () => foreignEvidence);
  assert.equal(verified.status, 'verified');
  const foreignRequest = vm.runInNewContext('["read"]');
  const decision = authorizeSkill(claim, verified, foreignRequest);
  assert.equal(decision.authorized, true);
  // And a foreign realm cannot smuggle a name past the grant either.
  const foreignOutOfScope = vm.runInNewContext('["delete"]');
  assert.equal(authorizeSkill(claim, verified, foreignOutOfScope).authorized, false);
});

test('H17 a resolver that re-enters the kernel cannot widen or corrupt the outer verdict', async () => {
  const claim = claimRegisteredWith({});
  let inner = null;
  let outerDecision = null;
  const result = await verifySkillProvenance(claim, (question) => {
    // Everything a hostile resolver could reach from inside the call: register a second skill, ask
    // for authority on the first one, and read the registry.
    registerSkillProvenance({ ...SPEC, name: 'injected-by-resolver', authority: ['delete'] });
    inner = authorizeSkill(claim, null, ['delete']).authorized;
    return proof();
  });
  outerDecision = authorizeSkill(claim, result, ['read']);
  assert.equal(inner, false);
  assert.equal(outerDecision.authorized, true);
  assert.deepEqual(outerDecision.granted, ['read']);
  assert.equal(outerDecision.provenance.repository, SPEC.repository);
});

test('H18 a proxy wrapping a genuine claim is refused at both doors', async () => {
  const [claim, result] = await registeredAndVerified();
  const wrapped = new Proxy(claim, {});
  assert.equal((await verifySkillProvenance(wrapped, () => proof())).status, 'not_verifiable');
  assert.equal(authorizeSkill(wrapped, result, ['read']).authorized, false);
  assert.equal(loadSkill(wrapped, result, SPEC.content, ['read']).authorized, false);
});

test('H19 no text the resolver supplied reaches the sealed receipt', async () => {
  const claim = claimRegisteredWith({});
  const planted = 'SYNTHETIC_RESOLVER_TEXT_9f2b';
  const refuted = await verifySkillProvenance(claim, () => ({
    ...proof(),
    author: planted,
    repository: planted,
    privateField: planted,
  }));
  const receipt = buildSkillReceipt(RECEIPT_SPEC, loadSkill(claim, refuted, SPEC.content, ['read']));
  assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
  assert.ok(!JSON.stringify(receipt).includes(planted), 'resolver text reached the receipt');
  assert.ok(!JSON.stringify(refuted).includes('privateField'));
});

test('H20 an anchor bound to another receipt is refused on a skill receipt too', async () => {
  const [claim, result] = await registeredAndVerified();
  const receipt = buildSkillReceipt(RECEIPT_SPEC, loadSkill(claim, result, SPEC.content, ['read']));
  const elsewhere = buildSkillReceipt(
    { ...RECEIPT_SPEC, operation: { id: 'other', goal: 'other' } },
    authorizeSkill(claim, result, ['read']),
  );
  const moved = { ...receipt, anchor: { status: 'anchored', network: 'stellar:testnet', txHash: 'made-up', digest: elsewhere.digest } };
  assert.equal(verifyReceipt(moved).ok, false);
  assert.equal(verifyReceipt({ ...receipt, anchor: { status: 'anchored', network: 'stellar:testnet', txHash: 'made-up', digest: receipt.digest } }).ok, true);
});

test('H21 nothing sets verified without a decision this kernel produced', async () => {
  const [claim, result] = await registeredAndVerified();
  const authorized = authorizeSkill(claim, result, ['read']);
  assert.equal(buildSkillReceipt(RECEIPT_SPEC, authorized).verification.verified, true);
  // Every path that refuses has to leave the flag down, whatever it was handed.
  const forgeries = [
    { status: 'verified', checks: { repository: true }, authorized: true },
    { ...authorized, authorized: true },
  ];
  for (const forged of forgeries) {
    let refused = false;
    try {
      buildSkillReceipt(RECEIPT_SPEC, forged);
    } catch {
      refused = true;
    }
    assert.equal(refused, true, JSON.stringify(Object.keys(forged)));
  }
  for (const status of ['not_verifiable', 'discrepant', 'not_verified']) {
    const unverifiable = await verifySkillProvenance(claim, () => proof({ author: 'Somebody Else' }));
    const decision = authorizeSkill(claim, unverifiable, ['read']);
    const receipt = buildSkillReceipt(RECEIPT_SPEC, decision);
    assert.equal(receipt.verification.verified, false);
    assert.equal(receipt.status === 'verified', false, status);
  }
});

test('H22 a hostile option object is refused, not read', async () => {
  const claim = claimRegisteredWith({});
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  await assert.rejects(
    () => verifySkillProvenance(claim, () => proof(), revoked.proxy),
    (err) => {
      assert.equal(err.constructor, Error, `a TypeError escaped: ${err && err.message}`);
      return true;
    },
  );
  // A resolver that was destroyed before it was handed over is a refusal, not a crash.
  const deadResolver = Proxy.revocable(() => proof(), {});
  deadResolver.revoke();
  const result = await verifySkillProvenance(claim, deadResolver.proxy);
  assert.equal(result.status, 'not_verifiable');
  assert.equal(authorizeSkill(claim, result, ['read']).authorized, false);
});

test('H23 a capability name that is a prototype key grants nothing but pollutes nothing', async () => {
  const claim = claimRegisteredWith({ authority: ['__proto__', 'constructor'] });
  const result = await verifySkillProvenance(claim, () => proof());
  const decision = authorizeSkill(claim, result, ['__proto__']);
  const receipt = buildSkillReceipt(RECEIPT_SPEC, decision);
  assert.equal(verifyReceipt(receipt).ok, true);
  assert.equal({}.polluted, undefined);
  // And a spec that carries a `__proto__` key does not reach the receipt body either.
  const planted = buildSkillReceipt(
    { ...RECEIPT_SPEC, evidence: JSON.parse('{"__proto__":{"polluted":true}}') },
    decision,
  );
  assert.equal({}.polluted, undefined);
  assert.equal(verifyReceipt(planted).ok, true);
});

test('H24 the declared authority survives the whole round trip unchanged', async () => {
  const claim = claimRegisteredWith({});
  const result = await verifySkillProvenance(claim, () => proof());
  const decision = authorizeSkill(claim, result, ['read']);
  const receipt = buildSkillReceipt(RECEIPT_SPEC, loadSkill(claim, result, SPEC.content, ['read']));
  assert.deepEqual(decision.granted, ['read']);
  assert.deepEqual(receipt.skill.granted, ['read']);
  assert.deepEqual(receipt.skill.provenance, {
    repository: SPEC.repository,
    commit: SPEC.commit,
    author: SPEC.author,
    contentDigest: sha256(SPEC.content),
  });
});