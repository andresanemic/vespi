'use strict';

// H-P: what real use showed about skill provenance (Vela, P2b report section 4).
//
// Three of the four kernel findings in that report have a reproduction in it. Two were fixed here and
// one is the owner's question and stays a `todo` at the bottom.
//
// 4.1 · The provenance in a receipt cannot say which of the two things it is. The report measured it
// in twelve lines: a declared author the resolver refuted still turns up inside the sealed receipt,
// under a field name that reads as "the provenance". Reading the code says what that name was worth.
// `provenanceOf(record)` is the declaration, the result copies it, the decision copies it again, and
// `buildSkillReceipt` copies it into `receipt.skill.provenance` — so a host that persists receipts was
// persisting a claim inside an object this kernel had sealed, with nothing in the receipt to say the
// claim was never verified. Not a copy-paste slip either: the resolver's answer was read, compared and
// dropped, and only the declaration was left standing.
//
// The report asks what a verified receipt should seal, and the answer is what the resolver observed.
// For a `verified` verdict that is the same string as the declared value, field by field, because
// each check *is* an equality (`found === declared`); so a verified receipt already seals the observed
// value and nothing about it has to change. For every other verdict the observed value is text the
// resolver typed, and this module has already decided — on purpose, and under four adversarial
// reviews (H06-H08, N01, H19) — that no resolver-supplied text goes into a sealed receipt: the text
// belongs to whoever produced it, and the resolver is the party under audit. Copying the observation
// in was implemented, measured against those four tests, and withdrawn; it would have traded a
// containment property for a field nobody asked for.
//
// What is left is the honest fix and it is small: `provenanceSource` says, in one word, whether the
// block this receipt seals was verified (`verified`) or is only what the skill declared (`declared`).
// It is derived from the verdict, so nothing on the decision or on the resolver's answer can promote
// a declaration, and it rides inside the seal with the rest of the block.
//
// 4.2 · A `Buffer` in `content` was indistinguishable from having not answered. The contract is text
// and a buffer is not text, so the verdict was never in question; the sentence was. The reason named
// neither the type nor the contract, so a host whose resolver reads bytes out of a repository was
// told the resolver stayed quiet, and was left an hour of debugging for a refusal that was right from
// the start. The bytes are still refused and still never decoded: decoding is an interpretation, and
// this module does not pick one on the resolver's behalf.
//
// 4.4 · `not_verifiable` and `not_verified` both write `not_verified` in `RECEIPT_STATUS`, so a host
// reading one field could not tell which layer it was reading. The mapping is now written out in the
// receipt (`provenanceReceiptStatus`) instead of left to be remembered.
//
// 4.3 · `name` travels as if it were verified and nothing compares it. The owner decided it (2026-10-04,
// the owner's own words: «tu recomendación»): option B of the report, the name stays in the receipt and
// the receipt says out loud that it is a declaration and a search hint, not an identity anybody checked.
// The kernel cannot compare the name because it does not know which path inside the commit holds the
// artifact, and inventing a shape check on the name would be theatre: a pseudonym with the shape of a
// path would pass. So nothing about `name` is verified and the receipt says so in one word.

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
const { buildReceipt, verifyReceipt } = require('../src/receipt.js');

const SPEC = Object.freeze({
  name: 'hp-skill',
  repository: 'https://example.test/obra/hp-skill.git',
  commit: 'e'.repeat(40),
  author: 'Ada Example <ada@example.test>',
  content: '# hp\nAnswer only what you observed.\n',
  authority: ['read:project'],
});

const RECEIPT_SPEC = Object.freeze({
  operation: { id: 'hp-load', goal: 'load a skill whose provenance this receipt names' },
  capabilityId: 'skill-loader',
  authority: { spend: [] },
  outcome: { exercised: [] },
  at: '2040-01-01T00:00:00.000Z',
});

const OTHER_COMMIT = 'f'.repeat(40);
const OTHER_AUTHOR = 'Mallory <mallory@example.test>';
const DECLARED = Object.freeze({
  repository: SPEC.repository,
  commit: SPEC.commit,
  author: SPEC.author,
  contentDigest: sha256(SPEC.content),
});

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Written out by hand, the way an honest resolver would have observed it.
function observedEvidence(overrides = {}) {
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

function receiptOf(decision) {
  const receipt = buildSkillReceipt(RECEIPT_SPEC, decision);
  assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
  return receipt;
}

// --- 4.1 · the receipt says which of the two things it is sealing ---

test('HP1 a verified receipt seals the value it compared, and says that is what it is', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence());
  assert.equal(result.status, 'verified');
  const receipt = receiptOf(authorizeSkill(claim, result, ['read:project']));
  // Each of the four checks is an equality, so in this state the declaration the block carries is also
  // string for string what the resolver observed. That is what a reader is owed by a verified receipt,
  // and the receipt says it in a word instead of leaving it to the field name.
  assert.equal(receipt.skill.provenanceSource, 'verified');
  assert.deepEqual(receipt.skill.provenance, DECLARED);
  assert.deepEqual(receipt.skill.coverage, ['author', 'commit_exists', 'content_digest', 'repository']);
  assert.deepEqual(receipt.skill.notCovered, []);
  assert.equal(receipt.skill.provenanceStatus, 'verified');
  assert.equal(receipt.skill.provenanceReceiptStatus, 'verified');
  assert.equal(receipt.status, 'verified');
});

test('HP2 a refuted receipt seals the declaration and labels it as one', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence({ author: OTHER_AUTHOR }));
  assert.equal(result.status, 'discrepant');
  const receipt = receiptOf(authorizeSkill(claim, result, ['read:project']));
  // The P2b reproduction: the declared author is in the sealed receipt, and now the receipt cannot be
  // read as if the kernel had verified it.
  assert.equal(receipt.skill.provenance.author, SPEC.author);
  assert.equal(receipt.skill.provenanceSource, 'declared');
  assert.equal(receipt.skill.provenanceStatus, 'discrepant');
  assert.equal(receipt.skill.provenanceReceiptStatus, 'failed');
  assert.equal(receipt.skill.status, 'discrepant');
  assert.equal(receipt.status, 'failed');
  // The refutation itself is reported in the fields the module has always reported it in.
  assert.equal(receipt.verification.checks.author, false);
  assert.ok(receipt.skill.notCovered.includes('author'));
  assert.match(receipt.skill.reason, /author/);
});

test('HP3 an incomplete verification is a declaration too, and it names the check left open', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence({ author: undefined }));
  assert.equal(result.status, 'not_verifiable');
  const receipt = receiptOf(authorizeSkill(claim, result, ['read:project']));
  assert.equal(receipt.skill.provenanceSource, 'declared');
  assert.equal(receipt.skill.provenanceStatus, 'not_verifiable');
  assert.equal(receipt.skill.provenanceReceiptStatus, 'not_verified');
  assert.deepEqual([...receipt.skill.notCovered], ['author']);
  assert.equal(receipt.skill.provenance.author, SPEC.author, 'the declaration is still what is sealed');
});

test('HP4 nothing the resolver wrote can promote a declaration to a verified one', async () => {
  const claim = registered();
  // The attack the field has to survive: an answer that carries the word itself, plus a block that
  // looks like a provenance, plus a verdict of its own. The word is derived from the verdict this
  // kernel settled on, so none of it arrives.
  const result = await verifySkillProvenance(claim, () => ({
    ...observedEvidence({ author: OTHER_AUTHOR, repository: OTHER_AUTHOR }),
    provenanceSource: 'verified',
    provenanceStatus: 'verified',
    status: 'verified',
    verified: true,
    provenance: { repository: 'https://attacker.test/x.git', commit: OTHER_COMMIT, author: OTHER_AUTHOR, contentDigest: sha256('attacker') },
    declared: DECLARED,
  }));
  assert.equal(result.status, 'discrepant');
  const receipt = receiptOf(authorizeSkill(claim, result, ['read:project']));
  assert.equal(receipt.skill.provenanceSource, 'declared');
  assert.equal(receipt.skill.provenanceStatus, 'discrepant');
  assert.equal(receipt.skill.provenance.author, SPEC.author, 'the sealed block is the registration');
  assert.equal(JSON.stringify(receipt).includes('attacker.test'), false);
  assert.equal(JSON.stringify(receipt).includes(OTHER_AUTHOR), false, 'the resolver text reached the receipt');
});

test('HP5 a decision that this kernel did not make cannot bring its own word along', () => {
  const forged = Object.freeze({
    authorized: true,
    status: 'verified',
    provenanceStatus: 'verified',
    provenanceSource: 'verified',
    provenanceReceiptStatus: 'verified',
    reason: 'forged',
    checks: Object.freeze({}),
    coverage: Object.freeze([]),
    notCovered: Object.freeze([]),
    provenance: { repository: 'https://attacker.test/x.git', commit: OTHER_COMMIT, author: OTHER_AUTHOR, contentDigest: sha256('x') },
    name: 'hp-skill',
    granted: Object.freeze(['delete']),
    requested: Object.freeze(['delete']),
    contentRecomputed: true,
  });
  assert.throws(() => buildSkillReceipt(RECEIPT_SPEC, forged), /decision this kernel produced/);
});

test('HP6 the word is inside the seal, so a rewrite of it is a broken receipt', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence({ author: OTHER_AUTHOR }));
  const receipt = receiptOf(authorizeSkill(claim, result, ['read:project']));
  assert.equal(receipt.skill.provenanceSource, 'declared');
  // Only a different word counts as a rewrite: writing back what is already there changes nothing,
  // which is what a digest is for.
  const tampered = { ...receipt, skill: { ...receipt.skill, provenanceSource: 'verified' } };
  assert.equal(verifyReceipt(tampered).ok, false, 'the digest does not cover provenanceSource');
  assert.equal(Object.isFrozen(receipt.skill), true);
  assert.throws(() => { 'use strict'; receipt.skill.provenanceSource = 'verified'; }, TypeError);
});

test('HP7 the label follows the load, and a swap between the check and the load is still a refutation', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence());
  const loaded = loadSkill(claim, result, SPEC.content, ['read:project']);
  assert.equal(loaded.authorized, true);
  const receipt = receiptOf(loaded);
  // The load hashed the bytes it was handed, so the block the receipt seals is the value that was
  // checked and it says so.
  assert.equal(receipt.skill.provenanceSource, 'verified');
  assert.equal(receipt.skill.loadedDigest, sha256(SPEC.content));

  // Bytes swapped in the gap: the provenance was verified and stays described as verified, because it
  // was — the discrepancy is the load's, and it is reported as the load's.
  const swapped = receiptOf(loadSkill(claim, result, `${SPEC.content}# swapped in the gap\n`, ['read:project']));
  assert.equal(swapped.skill.provenanceSource, 'verified');
  assert.equal(swapped.skill.provenanceStatus, 'verified');
  assert.equal(swapped.skill.status, 'discrepant');
  assert.equal(swapped.status, 'failed');
  assert.equal(swapped.skill.loadedDigest, sha256(`${SPEC.content}# swapped in the gap\n`));
  assert.equal(swapped.skill.checks, undefined, 'the checks live in the verification block and in the decision');
});

test('HP8 the result and the decision keep the shape they had, and the registry is unchanged', async () => {
  const before = listSkillProvenance().length;
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence());
  // Nothing was added to what a verification hands back: the fix lives in the receipt, which is the
  // only place a claim can be read as evidence by someone who was not there.
  assert.deepEqual(Object.keys(result).sort(), [
    'checks', 'contentRecomputed', 'coverage', 'notCovered', 'provenance', 'provenanceStatus', 'reason', 'status',
  ]);
  const decision = authorizeSkill(claim, result, ['read:project']);
  assert.deepEqual(Object.keys(decision).sort(), [
    'authorized', 'checks', 'contentRecomputed', 'coverage', 'granted', 'name', 'notCovered',
    'provenance', 'provenanceStatus', 'reason', 'requested', 'status',
  ]);
  const after = listSkillProvenance();
  assert.equal(after.length, before + 1);
  assert.deepEqual(Object.keys(after[after.length - 1]).sort(), ['author', 'commit', 'contentDigest', 'name', 'repository']);
});

test('HP9 the digest of a receipt without provenance does not move', () => {
  // Pinned before any of this changed, built from `src/receipt.js` alone. `buildSkillReceipt` attaches
  // its block after `buildReceipt` sealed, and `receipt.js` was not touched, so nothing here can reach
  // a receipt that has no skill in it.
  const receipt = buildReceipt({
    operation: { id: 'hp-plain', goal: 'a receipt with no provenance at all' },
    capabilityId: 'reader',
    authority: { spend: [] },
    outcome: { exercised: [], detail: 'nothing new' },
    verification: { verified: true, checks: { read: true }, reason: 'it was read' },
    decidedBy: 'hp-plain-check',
    at: '2040-01-01T00:00:00.000Z',
  });
  assert.equal(receipt.digest, '9a9cab33da31e649c46b7ef5f342aac93163c121f855889993c0e78324367451');
  assert.deepEqual(Object.keys(receipt), [
    'status', 'operation', 'capability', 'authority', 'outcome', 'evidence', 'verification',
    'coverage', 'notCovered', 'anchor', 'detail', 'decidedBy', 'at', 'digest',
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(receipt, 'skill'), false);
});

test('HP10 a skill this kernel never registered has no block to misread', async () => {
  const claim = registered();
  const stranger = { ...claim, digest: undefined };
  const result = await verifySkillProvenance(stranger, () => observedEvidence());
  assert.equal(result.status, 'not_verifiable');
  assert.equal(result.provenance, null);
  const decision = authorizeSkill(stranger, result, ['read:project']);
  assert.equal(decision.authorized, false);
  // Stronger than an empty block: no receipt at all. `buildSkillReceipt` needs a decision this kernel
  // decided on a record it holds, and a stranger has none, so there is nothing sealed here for a
  // reader to mistake for provenance.
  assert.throws(() => buildSkillReceipt(RECEIPT_SPEC, decision), /decision this kernel produced/);
});

// --- 4.2 · bytes where the contract asks for text ---

test('HP11 a Buffer where text was contracted is refused with a reason that names what arrived', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence({ content: Buffer.from(SPEC.content, 'utf8') }));
  assert.equal(result.status, 'not_verifiable');
  assert.match(result.reason, /Buffer/);
  assert.match(result.reason, /text/);
  // The verdict is unchanged from before: the other three checks really did run, and no digest really
  // was compared.
  assert.equal(result.contentRecomputed, false);
  assert.deepEqual([...result.coverage].sort(), ['author', 'commit_exists', 'repository']);
  assert.deepEqual([...result.notCovered], ['content_digest']);
  assert.equal(authorizeSkill(claim, result, ['read:project']).authorized, false);
  assert.equal(receiptOf(authorizeSkill(claim, result, ['read:project'])).skill.provenanceSource, 'declared');
});

test('HP12 bytes are never decoded, so a Buffer of exactly the right bytes is not verified', async () => {
  const claim = registered();
  const bytes = Buffer.from(SPEC.content, 'utf8');
  assert.equal(bytes.toString('utf8'), SPEC.content, 'the buffer holds the registered text');
  const byBuffer = await verifySkillProvenance(claim, () => observedEvidence({ content: bytes }));
  const byView = await verifySkillProvenance(claim, () => observedEvidence({ content: new Uint8Array(bytes) }));
  const bySpread = await verifySkillProvenance(claim, () => observedEvidence({ content: [...bytes] }));
  for (const result of [byBuffer, byView, bySpread]) {
    assert.notEqual(result.status, 'verified', 'a byte payload was read as text and verified');
    assert.ok(result.notCovered.includes('content_digest'));
    assert.equal(result.contentRecomputed, false);
  }
  // Three shapes, three sentences: the reason names what arrived.
  assert.match(byBuffer.reason, /a Buffer/);
  assert.match(byView.reason, /typed array/);
  assert.match(bySpread.reason, /array of bytes/);
});

test('HP13 bytes do not erase a refutation an earlier check already found', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence({
    author: OTHER_AUTHOR,
    commit: OTHER_COMMIT,
    content: Buffer.from(SPEC.content, 'utf8'),
  }));
  assert.equal(result.status, 'discrepant');
  assert.equal(result.checks.author, false);
  assert.equal(result.checks.commit_exists, false);
  assert.match(result.reason, /author/);
  assert.match(result.reason, /Buffer/);
  assert.ok(result.reason.length <= 512, `the reason was cut at 512: ${result.reason.length}`);
  assert.equal(receiptOf(authorizeSkill(claim, result, ['read:project'])).skill.provenanceSource, 'declared');
});

test('HP14 a hostile payload cannot turn the naming of a type into an exception or a digest', async () => {
  const claim = registered();
  const payloads = [
    new Proxy(Buffer.from(SPEC.content, 'utf8'), {}),
    new Proxy(new Uint8Array([1, 2, 3]), { get() { throw new Error('PRIVATE_proxy_get'); } }),
    new Proxy([1, 2, 3], { get() { throw new Error('PRIVATE_array_get'); } }),
    { toString() { throw new Error('PRIVATE_toString'); } },
    42,
    true,
    Symbol('content'),
  ];
  for (const content of payloads) {
    const result = await verifySkillProvenance(claim, () => observedEvidence({ content }));
    assert.notEqual(result.status, 'verified', `${typeof content} payload was verified`);
    assert.ok(result.notCovered.includes('content_digest'));
    assert.ok(result.reason.length > 0, 'a refusal with no reason');
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false, 'a thrown value reached the result');
    assert.doesNotThrow(() => receiptOf(authorizeSkill(claim, result, ['read:project'])));
  }
});

test('HP15 a digest string still covers the check when the bytes beside it are not text', async () => {
  const claim = registered();
  const { content, ...withoutBytes } = observedEvidence();
  const result = await verifySkillProvenance(claim, () => ({
    ...withoutBytes,
    content: Buffer.from(SPEC.content, 'utf8'),
    contentDigest: sha256(SPEC.content),
  }));
  assert.equal(result.status, 'verified');
  // The digest string was the thing compared, and the result says so: the bytes were not hashed.
  assert.equal(result.contentRecomputed, false);
  // The word follows the verdict, not the payload: the check did run and it did match.
  assert.equal(receiptOf(authorizeSkill(claim, result, ['read:project'])).skill.provenanceSource, 'verified');
});

test('HP16 no content at all keeps the reason it always had', async () => {
  const claim = registered();
  const { content, ...withoutBytes } = observedEvidence();
  const result = await verifySkillProvenance(claim, () => withoutBytes);
  assert.equal(result.status, 'not_verifiable');
  assert.equal(result.reason, 'the resolver reported neither the content at that commit nor its digest');
  assert.deepEqual([...result.notCovered], ['content_digest']);
});

test('HP17 a load of bytes is refused in its own words, the way it already was', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence());
  const loaded = loadSkill(claim, result, Buffer.from(SPEC.content, 'utf8'), ['read:project']);
  assert.equal(loaded.authorized, false);
  assert.equal(loaded.reason, 'the content offered for loading is not text, so no digest can be compared');
  assert.equal(loaded.loadedDigest, null);
});

// --- 4.4 · the statuses that write the same word, told apart in the receipt ---

test('HP18 the receipt writes out how each provenance verdict lands in the status ladder', async () => {
  const claim = registered();
  const verdicts = [
    { name: 'verified', evidence: () => observedEvidence(), status: 'verified', skillStatus: 'verified', ladder: 'verified', source: 'verified' },
    { name: 'refuted author', evidence: () => observedEvidence({ author: OTHER_AUTHOR }), status: 'discrepant', skillStatus: 'discrepant', ladder: 'failed', source: 'declared' },
    { name: 'silent author', evidence: () => observedEvidence({ author: undefined }), status: 'not_verifiable', skillStatus: 'not_verifiable', ladder: 'not_verified', source: 'declared' },
  ];
  for (const verdict of verdicts) {
    const result = await verifySkillProvenance(claim, verdict.evidence);
    assert.equal(result.status, verdict.status, verdict.name);
    const receipt = receiptOf(authorizeSkill(claim, result, ['read:project']));
    assert.equal(receipt.skill.provenanceStatus, verdict.status, `${verdict.name}: the exact verdict`);
    assert.equal(receipt.skill.provenanceReceiptStatus, verdict.ladder, `${verdict.name}: the ladder word`);
    assert.equal(receipt.skill.status, verdict.skillStatus, `${verdict.name}: the decision status`);
    assert.equal(receipt.status, verdict.ladder, `${verdict.name}: the status of the receipt`);
    assert.equal(receipt.skill.provenanceSource, verdict.source, `${verdict.name}: which of the two it is`);
  }
});

test('HP19 a host can tell the two verdicts that write the same word without knowing the vocabulary', async () => {
  const claim = registered();
  // `not_verifiable` (nothing proven, nothing refuted) and `not_verified` (the decision never granted
  // anything) both write `not_verified` in the ladder. Each field says which layer it is about.
  const incomplete = await verifySkillProvenance(claim, () => observedEvidence({ author: undefined }));
  const complete = await verifySkillProvenance(claim, () => observedEvidence());
  const refused = authorizeSkill(claim, incomplete, ['read:project']);
  const empty = authorizeSkill(claim, complete, []);
  assert.equal(refused.status, 'not_verifiable');
  assert.equal(empty.status, 'not_verified');

  const first = receiptOf(refused);
  const second = receiptOf(empty);
  // Both write the same word in the ladder...
  assert.equal(first.status, 'not_verified');
  assert.equal(second.status, 'not_verified');
  // ...and each one says which layer it is talking about.
  assert.equal(first.skill.status, 'not_verifiable');
  assert.equal(second.skill.status, 'not_verified');
  assert.equal(first.skill.provenanceStatus, 'not_verifiable');
  assert.equal(second.skill.provenanceStatus, 'verified');
  assert.equal(first.skill.provenanceReceiptStatus, 'not_verified');
  assert.equal(second.skill.provenanceReceiptStatus, 'verified');
  assert.equal(first.skill.provenanceSource, 'declared');
  assert.equal(second.skill.provenanceSource, 'verified');
  // And the case with no status of its own: an empty request is refused with a reason, not a state.
  assert.match(second.skill.reason, /no capability was requested/);
});

// 4.3 · `name` travels as if it were verified and nothing compares it

test('HP22 `name` is sealed as declared, and the word says it is not a checked identity', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence());
  assert.equal(result.status, 'verified');
  const receipt = receiptOf(authorizeSkill(claim, result, ['read:project']));
  // The name is still there: it is what a host uses to find the skill again and what a debugging reader
  // needs. What changed is that it can no longer be read as an identity this kernel checked.
  assert.equal(receipt.skill.name, SPEC.name);
  assert.equal(receipt.skill.nameSource, 'declared');
  // The same word `provenanceSource` uses for «what the skill claimed and nothing more», so a host that
  // learned one of them in a receipt of this shape reads the other one without a second vocabulary.
  assert.equal(receipt.skill.provenanceSource, 'verified', 'the four checks did run and did match');
  // And no check, and no coverage, counts the name as verified or even as something that was asked for.
  assert.equal(receipt.skill.checks, undefined, 'the checks live in the verification block and in the decision');
  assert.equal(receipt.verification.checks.name, undefined, 'no check was ever invented for the name');
  assert.ok(!receipt.skill.coverage.includes('name'));
  assert.ok(!receipt.skill.notCovered.includes('name'));
  assert.ok(!receipt.coverage.includes('name'));
  assert.ok(!receipt.notCovered.includes('name'));
  // What this test can show, all of it still true: the name is in the question and in the receipt, and
  // no check covers it. Two skills that differ only in name, in the same commit, both verify.
  assert.equal(claim.name, SPEC.name, 'the question carries the name so a resolver can find the skill');
  const sibling = await verifySkillProvenance(registered({ name: 'hp-skill-2' }), () => observedEvidence());
  assert.equal(sibling.status, 'verified');
  assert.equal(sibling.checks.content_digest, true, 'the same bytes, under another name, verify the same');
  assert.equal(receiptOf(authorizeSkill(claim, sibling, ['read:project'])).skill.nameSource, 'declared');
});

test('HP23 the name is declared in every state of the decision, verified provenance or not', async () => {
  const claim = registered();
  // Four states, one per place a decision can end: checked and matched, refuted, unanswered, and
  // refused on scope with the provenance verified. The label follows the name, not the verdict.
  const refuted = await verifySkillProvenance(claim, () => observedEvidence({ author: OTHER_AUTHOR }));
  const unanswered = await verifySkillProvenance(claim, () => observedEvidence({ author: undefined }));
  const verified = await verifySkillProvenance(claim, () => observedEvidence());
  const states = [
    ['verified provenance', authorizeSkill(claim, verified, ['read:project']), 'verified'],
    ['refuted provenance', authorizeSkill(claim, refuted, ['read:project']), 'declared'],
    ['unanswered provenance', authorizeSkill(claim, unanswered, ['read:project']), 'declared'],
    ['out of scope request', authorizeSkill(claim, verified, ['delete:other']), 'verified'],
  ];
  for (const [label, decision, source] of states) {
    const receipt = receiptOf(decision);
    assert.equal(receipt.skill.name, SPEC.name, `${label}: the name is still sealed`);
    assert.equal(receipt.skill.nameSource, 'declared', `${label}: the label followed the state`);
    assert.equal(receipt.skill.provenanceSource, source, `${label}: the provenance label did not move`);
    assert.ok(!receipt.skill.coverage.includes('name'), `${label}: covered the name`);
    assert.ok(!receipt.notCovered.includes('name'), `${label}: reported the name as a check left open`);
  }
});

test('HP24 nothing anyone wrote can promote the name to a verified identity', async () => {
  const claim = registered();
  // The attack this label has to survive: an answer that carries the word, a flag, and a name of its own,
  // plus a provenance block of its own. Nothing the resolver wrote was ever read for the name — it comes
  // from the registration record — and the label is derived here, so none of it arrives.
  const result = await verifySkillProvenance(claim, (question) => ({
    ...observedEvidence(),
    name: 'hp-skill-that-was-never-registered',
    nameSource: 'verified',
    nameVerified: true,
    nameIsVerified: true,
    declaredName: 'attacker',
    provenanceSource: 'verified',
    provenance: { repository: 'https://attacker.test/x.git', commit: OTHER_COMMIT, author: OTHER_AUTHOR, contentDigest: sha256('attacker') },
    question,
  }));
  assert.equal(result.status, 'verified');
  const receipt = receiptOf(authorizeSkill(claim, result, ['read:project']));
  assert.equal(receipt.skill.name, SPEC.name, 'the sealed name is the registered one');
  assert.equal(receipt.skill.nameSource, 'declared');
  assert.equal(JSON.stringify(receipt).includes('attacker.test'), false);
  assert.equal(JSON.stringify(receipt).includes('never-registered'), false, 'the resolver text reached the receipt');
  // A decision forged by hand, carrying the word for itself, is not a decision this kernel produced.
  const forged = Object.freeze({
    ...authorizeSkill(claim, result, ['read:project']),
    name: 'hp-skill-that-was-never-registered',
    nameSource: 'verified',
  });
  assert.throws(() => buildSkillReceipt(RECEIPT_SPEC, forged), /decision this kernel produced/);
});

test('HP25 the label rides inside the seal, so rewriting it is a broken receipt', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence());
  const receipt = receiptOf(authorizeSkill(claim, result, ['read:project']));
  assert.equal(receipt.skill.nameSource, 'declared');
  const tampered = { ...receipt, skill: { ...receipt.skill, nameSource: 'verified' } };
  assert.equal(verifyReceipt(tampered).ok, false, 'the digest does not cover nameSource');
  const renamed = { ...receipt, skill: { ...receipt.skill, name: 'hp-skill-that-was-never-registered' } };
  assert.equal(verifyReceipt(renamed).ok, false, 'the digest does not cover the name it labels');
  // A load that finds different bytes is still the load's discrepancy, and the name is still declared.
  const swapped = receiptOf(loadSkill(claim, result, `${SPEC.content}# swapped in the gap\n`, ['read:project']));
  assert.equal(swapped.skill.nameSource, 'declared');
  assert.equal(swapped.skill.status, 'discrepant');
  assert.equal(swapped.status, 'failed');
  // The same bytes under another name, loaded: still declared, still unverified, still sealed.
  const other = registered({ name: 'hp-skill-2' });
  const otherResult = await verifySkillProvenance(other, () => observedEvidence());
  const otherReceipt = receiptOf(loadSkill(other, otherResult, SPEC.content, ['read:project']));
  assert.equal(otherReceipt.skill.name, 'hp-skill-2');
  assert.equal(otherReceipt.skill.nameSource, 'declared');
  assert.equal(otherReceipt.skill.provenanceSource, 'verified');
});