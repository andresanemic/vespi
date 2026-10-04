'use strict';

// H-P: what real use showed about skill provenance (Vela, P2b report section 4).
//
// Three of the four kernel findings in that report are defects or API matters with a reproduction, and
// this file takes them one at a time. The fourth is the owner's question and is left as a `todo`.
//
// 4.1 · The receipt carries the declaration, not what was verified. The reproduction is twelve lines:
// a declared author the resolver refuted still turns up inside the sealed receipt. Reading the code
// says why, and it is not a copy-paste slip. `verifySkillProvenance` reads the resolver's answer,
// compares it, and then throws it away: `settle()` rebuilds the result from the registration record,
// so the only provenance that survives is `provenanceOf(record)` — a copy of what the skill said
// about itself. There is no observed provenance in the module to seal, because the observation was
// never kept. Everything downstream (`authorizeSkill`, `loadSkill`, `buildSkillReceipt`) reads from
// that copy, so a host that persists receipts persists a claim the kernel just refused, inside an
// object the kernel sealed.
//
// What a verified receipt should seal is what was observed: for a `verified` verdict the observed
// strings equal the declared ones (each check is `found === declared`), so sealing the observation
// changes nothing there, and for every other verdict it is the only way a reader can see what the
// resolver actually said. So `observed` is added, alongside `provenance`, not instead of it:
// `provenance` keeps meaning exactly what it means today and `observed` says what the resolver
// answered, field by field, `null` where it stayed silent. A receipt built without any of this keeps
// its digest, which is checked here against a value pinned before the change.
//
// 4.2 · A `Buffer` in `content` is indistinguishable from having not answered. The contract is text
// and a buffer is not text, so nothing is wrong with the verdict; what is wrong is the sentence: the
// reason named neither the type nor the contract, so a host whose resolver reads bytes from a
// repository was told the resolver stayed quiet and was left with an hour of debugging. The bytes are
// still refused and still never decoded; now the reason says what arrived.
//
// 4.4 · `not_verifiable` and `not_verified` both write `not_verified` in `RECEIPT_STATUS`, and a host
// has to know which layer it is reading to tell a refutation from an incomplete answer. The mapping
// is now written out in the receipt instead of left to be remembered.
//
// 4.3 · `name` travels as if it were verified and it is not: nothing compares it, because the kernel
// does not know which path inside the commit holds the artifact. That is the owner's decision, it is
// not taken here, and the case lives at the bottom as a `todo`.

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
  operation: { id: 'hp-load', goal: 'load a skill whose provenance was observed' },
  capabilityId: 'skill-loader',
  authority: { spend: [] },
  outcome: { exercised: [] },
  at: '2040-01-01T00:00:00.000Z',
});

const OTHER_COMMIT = 'f'.repeat(40);
const OTHER_AUTHOR = 'Mallory <mallory@example.test>';

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

const NOTHING_OBSERVED = Object.freeze({
  repository: null,
  commit: null,
  author: null,
  contentDigest: null,
});

async function verified(overrides = {}) {
  const claim = registered(overrides);
  const result = await verifySkillProvenance(claim, () => observedEvidence());
  assert.equal(result.status, 'verified', `expected verified, got ${result.status}: ${result.reason}`);
  return { claim, result };
}

// --- 4.1 · the observation is kept, and it is what a receipt seals ---

test('HP1 a verified result carries what the resolver observed next to what was declared', async () => {
  const { result } = await verified();
  assert.deepEqual(result.observed, {
    repository: SPEC.repository,
    commit: SPEC.commit,
    author: SPEC.author,
    contentDigest: sha256(SPEC.content),
  });
  // The declaration is still there and still means what it always meant.
  assert.deepEqual(result.provenance, {
    repository: SPEC.repository,
    commit: SPEC.commit,
    author: SPEC.author,
    contentDigest: sha256(SPEC.content),
  });
  // For a verified verdict the two agree, which is the point: this is the comparison that was made,
  // not a second opinion about it.
  assert.deepEqual(result.observed, { ...result.provenance });
});

test('HP2 a refuted author travels as observed, so the receipt says who the resolver named', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence({ author: OTHER_AUTHOR }));
  assert.equal(result.status, 'discrepant');
  assert.equal(result.observed.author, OTHER_AUTHOR, 'the observation is what the resolver reported');
  assert.equal(result.provenance.author, SPEC.author, 'the declaration is untouched');
  assert.notEqual(result.observed.author, result.provenance.author);

  const receipt = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['read:project']));
  assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
  assert.equal(receipt.skill.observed.author, OTHER_AUTHOR);
  assert.equal(receipt.skill.provenance.author, SPEC.author);
  assert.equal(receipt.skill.status, 'failed');
  assert.equal(receipt.skill.provenanceStatus, 'discrepant');
});

test('HP3 a field the resolver left silent is null in the observation, not a copy of the declaration', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence({ author: undefined }));
  assert.equal(result.status, 'not_verifiable');
  assert.deepEqual([...result.notCovered], ['author']);
  // This is what the report could not show before: a declared value and a value nobody answered with
  // are the same string in `provenance`, and only the observation tells them apart.
  assert.equal(result.provenance.author, SPEC.author);
  assert.equal(result.observed.author, null);
  assert.deepEqual(result.observed, { ...NOTHING_OBSERVED, repository: SPEC.repository, commit: SPEC.commit, contentDigest: sha256(SPEC.content) });

  const receipt = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['read:project']));
  assert.equal(receipt.skill.observed.author, null);
});

test('HP4 the observation is built from the kernel reads, never from a field the resolver named', async () => {
  const claim = registered();
  // A resolver that answers with its own `observed` block, trying to write the record the receipt will
  // seal. Only the four fields this kernel read under its own guards can be there, and the value in
  // `observed.author` is the one that was compared, not the one the resolver asked for.
  const result = await verifySkillProvenance(claim, () => ({
    ...observedEvidence(),
    observed: { repository: 'https://attacker.test/other.git', commit: OTHER_COMMIT, author: OTHER_AUTHOR, contentDigest: sha256('attacker') },
    provenance: { author: 'Somebody Else' },
    content_digest: true,
  }));
  assert.equal(result.status, 'verified');
  assert.deepEqual(Object.keys(result.observed).sort(), ['author', 'commit', 'contentDigest', 'repository']);
  assert.deepEqual(result.observed, { ...result.provenance });
  assert.equal(JSON.stringify(result.observed).includes('attacker.test'), false);
  assert.equal(JSON.stringify(result).includes('Somebody Else'), false);

  const receipt = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['read:project']));
  assert.equal(JSON.stringify(receipt).includes('attacker.test'), false);
  assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
});

test('HP5 a getter that throws on an observed field leaves it null and never reaches the receipt', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => ({
    exists: true,
    repository: SPEC.repository,
    commit: SPEC.commit,
    contentDigest: sha256(SPEC.content),
    get author() { throw new Error('PRIVATE_author_getter'); },
    get content() { throw new Error('PRIVATE_content_getter'); },
  }));
  assert.equal(result.status, 'not_verifiable');
  assert.deepEqual([...result.notCovered], ['author']);
  assert.equal(result.observed.author, null);
  // The content could not be read, so no digest of it was compared: nothing to report as observed.
  assert.equal(result.observed.contentDigest, sha256(SPEC.content), 'the digest it did report was compared and is observed');
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);

  const decision = authorizeSkill(claim, result, ['read:project']);
  const receipt = buildSkillReceipt(RECEIPT_SPEC, decision);
  assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
  assert.equal(receipt.skill.observed.author, null);
  assert.equal(JSON.stringify(receipt).includes('PRIVATE_'), false);
});

test('HP6 the observation is frozen and cannot be rewritten after the verdict', async () => {
  const { result } = await verified();
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.observed), true);
  assert.throws(() => { 'use strict'; result.observed.author = OTHER_AUTHOR; }, TypeError);
  assert.equal(result.observed.author, SPEC.author);
});

test('HP7 nothing observed means four nulls, whatever stopped the verification', async () => {
  const claim = registered();
  const cases = {
    'no resolver injected': await verifySkillProvenance(claim, undefined),
    'the resolver threw': await verifySkillProvenance(claim, () => { throw new Error('PRIVATE_boom'); }),
    'the answer was not a record': await verifySkillProvenance(claim, () => 'not a record'),
    'the answer was the question': await verifySkillProvenance(claim, (question) => question),
    'the answer was the declaration': await verifySkillProvenance(claim, () => claim),
  };
  for (const [label, result] of Object.entries(cases)) {
    assert.notEqual(result.status, 'verified', `${label} came out verified`);
    assert.deepEqual(result.observed, NOTHING_OBSERVED, `${label} reported an observation`);
    const receipt = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['read:project']));
    assert.deepEqual(receipt.skill.observed, NOTHING_OBSERVED, `${label} sealed an observation`);
    assert.equal(JSON.stringify(receipt).includes('PRIVATE_'), false, `${label} leaked the thrown value`);
  }
});

test('HP8 the observation follows the resolver across a load, and a swap is still a refutation', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence());
  const loaded = loadSkill(claim, result, SPEC.content, ['read:project']);
  assert.equal(loaded.authorized, true);
  assert.deepEqual(loaded.observed, { ...NOTHING_OBSERVED, repository: SPEC.repository, commit: SPEC.commit, author: SPEC.author, contentDigest: sha256(SPEC.content) });

  const receipt = buildSkillReceipt(RECEIPT_SPEC, loaded);
  assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
  assert.deepEqual(receipt.skill.observed, loaded.observed);

  // Bytes swapped between the check and the load: the observation is the one the check made, and the
  // digest the load computed is reported next to it rather than in place of it.
  const swapped = buildSkillReceipt(RECEIPT_SPEC, loadSkill(claim, result, `${SPEC.content}# swapped in the gap\n`, ['read:project']));
  assert.equal(swapped.skill.status, 'failed');
  assert.equal(swapped.skill.observed.contentDigest, sha256(SPEC.content), 'the observation is still what the resolver was checked against');
  assert.equal(swapped.skill.loadedDigest, sha256(`${SPEC.content}# swapped in the gap\n`));
});

test('HP9 a skill the kernel never registered has no observation to seal either', async () => {
  const claim = registered();
  const result = await verifySkillProvenance({ ...claim, digest: undefined }, () => observedEvidence());
  assert.equal(result.status, 'not_verifiable');
  assert.deepEqual(result.observed, NOTHING_OBSERVED);
  assert.equal(result.provenance, null);
  const decision = authorizeSkill({ ...claim, digest: undefined }, result, ['read:project']);
  assert.equal(decision.authorized, false);
  assert.deepEqual(decision.observed, NOTHING_OBSERVED);
});

test('HP10 the digest of a receipt without provenance does not move', () => {
  // Pinned before any of this changed, from `src/receipt.js` alone. `buildSkillReceipt` attaches its
  // block after `buildReceipt` sealed, so nothing here can reach a receipt that has no skill in it.
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

// --- 4.2 · bytes where the contract asks for text ---

test('HP11 a Buffer where text was contracted is refused with a reason that names what arrived', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence({ content: Buffer.from(SPEC.content, 'utf8') }));
  assert.equal(result.status, 'not_verifiable');
  assert.match(result.reason, /Buffer/);
  assert.match(result.reason, /text/);
  // The verdict is unchanged from before: the other three checks really did run, and the digest
  // really was not compared.
  assert.equal(result.contentRecomputed, false);
  assert.deepEqual([...result.coverage].sort(), ['author', 'commit_exists', 'repository']);
  assert.deepEqual([...result.notCovered], ['content_digest']);
  assert.equal(result.observed.contentDigest, null, 'nothing was hashed, so there is no digest observed');
  assert.equal(result.observed.repository, SPEC.repository);
  assert.equal(authorizeSkill(claim, result, ['read:project']).authorized, false);
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
  assert.ok(result.reason.length <= 512);
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
    assert.notEqual(result.status, 'verified', `${String(typeof content)} payload was verified`);
    assert.ok(result.notCovered.includes('content_digest'));
    assert.equal(result.observed.contentDigest, null);
    assert.ok(result.reason.length > 0, 'a refusal with no reason');
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false, 'a thrown value reached the result');
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
  assert.equal(result.observed.contentDigest, sha256(SPEC.content));

  const mismatch = await verifySkillProvenance(claim, () => ({
    ...withoutBytes,
    content: Buffer.from('other bytes', 'utf8'),
    contentDigest: sha256(SPEC.content),
  }));
  assert.equal(mismatch.status, 'verified', 'a digest string is what was compared, and it matches');
  assert.equal(mismatch.contentRecomputed, false);
});

test('HP16 no content at all keeps the reason it always had', async () => {
  const claim = registered();
  const { content, ...withoutBytes } = observedEvidence();
  const result = await verifySkillProvenance(claim, () => withoutBytes);
  assert.equal(result.status, 'not_verifiable');
  assert.equal(result.reason, 'the resolver reported neither the content at that commit nor its digest');
  assert.deepEqual(result.observed, { ...NOTHING_OBSERVED, repository: SPEC.repository, commit: SPEC.commit, author: SPEC.author });
});

test('HP17 a load of bytes is refused in its own words, the way it already was', async () => {
  const { claim, result } = await verified();
  const loaded = loadSkill(claim, result, Buffer.from(SPEC.content, 'utf8'), ['read:project']);
  assert.equal(loaded.authorized, false);
  assert.equal(loaded.reason, 'the content offered for loading is not text, so no digest can be compared');
  assert.equal(loaded.loadedDigest, null);
  // The observation is the check's, untouched by a load that never hashed anything.
  assert.equal(loaded.observed.contentDigest, sha256(SPEC.content));
});

// --- 4.4 · the two statuses that collide, told apart in the receipt ---

test('HP18 the receipt writes out which layer each status belongs to', async () => {
  const claim = registered();
  const verdicts = [
    { name: 'verified', evidence: () => observedEvidence(), status: 'verified', skillStatus: 'verified', receiptStatus: 'verified' },
    { name: 'refuted author', evidence: () => observedEvidence({ author: OTHER_AUTHOR }), status: 'discrepant', skillStatus: 'failed', receiptStatus: 'failed' },
    { name: 'silent author', evidence: () => observedEvidence({ author: undefined }), status: 'not_verifiable', skillStatus: 'not_verified', receiptStatus: 'not_verified' },
  ];
  for (const verdict of verdicts) {
    const result = await verifySkillProvenance(claim, verdict.evidence);
    assert.equal(result.status, verdict.status, verdict.name);
    const receipt = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['read:project']));
    assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
    assert.equal(receipt.skill.provenanceStatus, verdict.status, `${verdict.name}: the exact verdict`);
    assert.equal(receipt.skill.provenanceReceiptStatus, verdict.receiptStatus, `${verdict.name}: how it lands in the ladder`);
    assert.equal(receipt.skill.status, verdict.skillStatus, `${verdict.name}: the decision status`);
  }
});

test('HP19 the two statuses that write the same word are separated by a field a host can read alone', async () => {
  const claim = registered();
  // `not_verifiable` (nothing proven, nothing refuted) and `not_verified` (the decision never granted
  // anything) both write `not_verified` in the status ladder. Before, telling them apart meant knowing
  // the vocabulary; now the mapping is in the receipt.
  const incomplete = await verifySkillProvenance(claim, () => observedEvidence({ author: undefined }));
  const notVerified = await verifySkillProvenance(claim, () => observedEvidence());
  assert.equal(incomplete.provenanceStatus, 'not_verifiable');
  assert.equal(notVerified.provenanceStatus, 'verified');

  const refused = authorizeSkill(claim, incomplete, ['read:project']);
  const empty = authorizeSkill(claim, notVerified, []);
  assert.equal(refused.status, 'not_verifiable');
  assert.equal(empty.status, 'not_verified');

  const first = buildSkillReceipt(RECEIPT_SPEC, refused);
  const second = buildSkillReceipt(RECEIPT_SPEC, empty);
  assert.equal(first.skill.status, 'not_verified');
  assert.equal(second.skill.status, 'not_verified');
  assert.equal(first.skill.provenanceStatus, 'not_verifiable');
  assert.equal(second.skill.provenanceStatus, 'verified');
  assert.equal(first.skill.provenanceReceiptStatus, 'not_verified');
  assert.equal(second.skill.provenanceReceiptStatus, 'verified');
  // And the case with no status of its own: an empty request is refused with a reason, not a state.
  assert.match(second.skill.reason, /no capability was requested/);
});

test('HP20 a decision the kernel did not make carries no observation to seal', () => {
  const forged = Object.freeze({
    authorized: true,
    status: 'verified',
    provenanceStatus: 'verified',
    reason: 'forged',
    checks: Object.freeze({}),
    coverage: Object.freeze([]),
    notCovered: Object.freeze([]),
    provenance: { repository: 'https://attacker.test/x.git', commit: OTHER_COMMIT, author: OTHER_AUTHOR, contentDigest: sha256('x') },
    observed: { repository: 'https://attacker.test/x.git', commit: OTHER_COMMIT, author: OTHER_AUTHOR, contentDigest: sha256('x') },
    name: 'hp-skill',
    granted: Object.freeze(['delete']),
    requested: Object.freeze(['delete']),
    contentRecomputed: true,
  });
  assert.throws(() => buildSkillReceipt(RECEIPT_SPEC, forged), /decision this kernel produced/);
});

test('HP21 the registry listing is unchanged by any of this', async () => {
  const before = listSkillProvenance().length;
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence({ author: OTHER_AUTHOR }));
  buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['read:project']));
  await verifySkillProvenance(claim, () => observedEvidence({ content: Buffer.from('x') }));
  const after = listSkillProvenance();
  assert.equal(after.length, before + 1);
  assert.deepEqual(Object.keys(after[after.length - 1]).sort(), ['author', 'commit', 'contentDigest', 'name', 'repository']);
});

// --- 4.3 · the owner's question, left open on purpose ---

test('HP22 `name` travels as if it were verified and nothing compares it', { todo: "decisión del dueño: ¿se verifica `name`, se marca como declarado, o se quita del recibo? El kernel no sabe qué ruta dentro del commit guarda el artefacto, así que hoy `name` viaja como identidad verificada sin que ninguna de las cuatro comparaciones lo mire. Ver `docs/` y el informe de H-P para las tres opciones y la recomendación." }, async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observedEvidence());
  assert.equal(result.status, 'verified');
  // Everything this test can show today: the name is in the question and in the receipt, and no check
  // covers it. Two skills that differ only in name, in the same commit, both verify.
  const receipt = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, result, ['read:project']));
  assert.equal(receipt.skill.name, SPEC.name);
  assert.ok(!Object.prototype.hasOwnProperty.call(receipt.skill.checks || {}, 'name'));
  const sibling = await verifySkillProvenance(registered({ name: 'hp-skill-2' }), () => observedEvidence());
  assert.equal(sibling.status, 'verified');
  assert.equal(sibling.observed.contentDigest, sha256(SPEC.content), 'the same bytes, under another name, verify the same');
});