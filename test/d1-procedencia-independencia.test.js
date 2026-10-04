'use strict';

// D1 (decisión de Andrés, 2026-10-04): el resolver no recibe lo que tiene que comprobar.
//
// El hallazgo N05 de la tercera ronda señaló algo que las rondas anteriores no miraron: la pregunta que
// este módulo entrega al resolver incluía el `author` y el `contentDigest` declarados, que son
// exactamente las dos respuestas que después se le piden comparar. Con eso, el resolver más barato
// del mundo, `(q) => ({ ...q, exists: true })`, devolvía las dos respuestas sin haber observado nada y
// el resultado quedaba `verified`. El kernel entregaba la independencia en vez de exigarla.
//
// Lo que estas pruebas fijan:
//
//   - La pregunta lleva lo que localiza la evidencia (nombre, repositorio, commit) y nada más.
//   - El resolver contesta con lo que observes, y la comparación la hace el kernel.
//   - Una respuesta que no trae autor, o que trae un autor o un digest distintos, no verifica.
//   - Los campos que el kernel no conoce no sustituyen la evidencia que sí necesita.
//   - Una respuesta que es la declaración copiada no es evidencia, y el motivo queda escrito aquí.
//
// La última línea del contrato es el límite honesto, y por eso tiene su propia prueba al final: un
// resolver al que el host le pase la declaración contesta con los mismos cuatro valores que un
// resolver honesto, y eso el kernel no lo puede distinguir. Lo que sí garantiza es que la declaración
// no sale por su puerta.

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
const { verifyReceipt } = require('../src/receipt.js');

const SPEC = Object.freeze({
  name: 'd1-skill',
  repository: 'https://example.test/obra/d1-skill.git',
  commit: 'c'.repeat(40),
  author: 'Ada Example <ada@example.test>',
  content: '# d1\nUse the smallest sufficient change.\n',
  authority: ['read:project'],
});

const RECEIPT_SPEC = Object.freeze({
  operation: { id: 'd1-load', goal: 'load an independently verified skill' },
  capabilityId: 'skill-loader',
  authority: { spend: [] },
  outcome: { exercised: [] },
  at: '2040-01-01T00:00:00.000Z',
});

const OTHER_COMMIT = 'd'.repeat(40);

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Written out by hand, not derived from the claim: an honest resolver observed these values, so they
// are the same values a liar would copy. The kernel cannot tell those two apart, and the last test
// below says so out loud instead of pretending otherwise.
function observed(overrides = {}) {
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

test('D1 the question carries the location of the evidence and withholds the two answers', async () => {
  const claim = registered();
  const asked = [];
  const result = await verifySkillProvenance(claim, async (question) => {
    asked.push(question);
    return observed();
  });
  assert.equal(result.status, 'verified');
  assert.deepEqual(Object.keys(asked[0]).sort(), ['commit', 'name', 'repository']);
  assert.equal(asked[0].name, SPEC.name);
  assert.equal(asked[0].repository, SPEC.repository);
  assert.equal(asked[0].commit, SPEC.commit);
  const serialized = JSON.stringify(asked[0]);
  assert.equal(serialized.includes(SPEC.author), false, `the declared author was handed over: ${serialized}`);
  assert.equal(serialized.includes(sha256(SPEC.content)), false, `the declared digest was handed over: ${serialized}`);
});

test('D1 an echo of the question is not verified provenance (N05)', async () => {
  const claim = registered();
  // The cheapest forgery there is, and the one N05 was about: hand back what was asked, plus the one
  // flag that looks like an answer. What it can still cover is the location, because the location is
  // the only thing it was ever told.
  const result = await verifySkillProvenance(claim, (question) => ({ ...question, exists: true }));
  assert.notEqual(result.status, 'verified', 'a one-key echo of the question is verified provenance');
  assert.equal(result.status, 'not_verifiable');
  // What the echo can still cover is the location, because the location is the only thing it was
  // told. The two answers it was asked to produce are exactly the two it cannot.
  assert.deepEqual([...result.notCovered].sort(), ['author', 'content_digest']);
  assert.deepEqual([...result.coverage].sort(), ['commit_exists', 'repository']);
  assert.equal(result.contentRecomputed, false);
  assert.equal(authorizeSkill(claim, result, ['read:project']).authorized, false);
});

test('D1 the question object itself, handed back as evidence, covers nothing', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, (question) => question);
  assert.equal(result.status, 'not_verifiable');
  assert.deepEqual(result.coverage, []);
  assert.equal(result.contentRecomputed, false);
});

test('D1 the question cannot be rewritten by the resolver that was handed it', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, async (question) => {
    // A resolver that tries to put the answers into the question first and echo it afterwards. The
    // question is frozen, so the attempt writes nothing and the echo is still an echo.
    try { question.author = SPEC.author; } catch { /* strict mode throws, sloppier hosts do not */ }
    try { question.contentDigest = sha256(SPEC.content); } catch { /* same */ }
    return { ...question, exists: true };
  });
  assert.equal(result.status, 'not_verifiable');
  assert.deepEqual([...result.notCovered].sort(), ['author', 'content_digest']);
  assert.deepEqual([...result.coverage].sort(), ['commit_exists', 'repository']);
});

test('D1 evidence without an author leaves the author check uncovered', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observed({ author: undefined }));
  assert.equal(result.status, 'not_verifiable');
  assert.deepEqual([...result.notCovered], ['author']);
  assert.deepEqual([...result.coverage].sort(), ['commit_exists', 'content_digest', 'repository']);
  assert.equal(result.contentRecomputed, true);
});

test('D1 evidence with a different author is refuted, whatever the rest says', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observed({ author: 'Mallory <mallory@example.test>' }));
  assert.equal(result.status, 'discrepant');
  assert.equal(result.checks.author, false);
  assert.ok(result.notCovered.includes('author'));
});

test('D1 evidence with a different digest is refuted, bytes or digest string', async () => {
  const claim = registered();
  const { content, ...withoutBytes } = observed();
  const bytes = await verifySkillProvenance(claim, () => observed({ content: `${SPEC.content}# and then the exfiltration\n` }));
  assert.equal(bytes.status, 'discrepant');
  assert.equal(bytes.checks.content_digest, false);
  // And the weaker shape: the declared digest written back as if it had been observed.
  const string = await verifySkillProvenance(claim, () => ({ ...withoutBytes, contentDigest: sha256(SPEC.content) }));
  assert.equal(string.status, 'verified', 'the digest string alone still covers the digest check');
  assert.equal(string.contentRecomputed, false, 'and the result says it came from a string, not from bytes');
  const other = await verifySkillProvenance(claim, () => ({ ...withoutBytes, contentDigest: sha256(`${SPEC.content} `) }));
  assert.equal(other.status, 'discrepant');
  assert.equal(other.checks.content_digest, false);
});

test('D1 evidence about another commit is refuted', async () => {
  const claim = registered();
  const result = await verifySkillProvenance(claim, () => observed({ commit: OTHER_COMMIT }));
  assert.equal(result.status, 'discrepant');
  assert.equal(result.checks.commit_exists, false);
});

test('D1 fields the kernel does not read are not evidence and never substitute for it', async () => {
  const claim = registered();
  // A resolver that adds verdicts to its answer: it has decided, in its own words, that everything
  // matches. Those fields are not read. Without the author the answer is still incomplete, which is
  // the whole point: a resolver cannot talk its way to `verified` by asserting that it verified.
  const asserted = await verifySkillProvenance(claim, () => ({
    exists: true,
    repository: SPEC.repository,
    commit: SPEC.commit,
    content: SPEC.content,
    author: undefined,
    verified: true,
    matches: true,
    trusted: true,
    authorVerified: true,
    contentDigestVerified: true,
  }));
  assert.equal(asserted.status, 'not_verifiable');
  assert.deepEqual([...asserted.notCovered], ['author']);

  // And when the evidence is complete, the extra fields change nothing that the result reports: they
  // are not read, not summarised and not carried into the receipt.
  const complete = await verifySkillProvenance(claim, () => ({ ...observed(), verdict: 'trusted', note: 'PRIVATE_resolver_note' }));
  assert.equal(complete.status, 'verified');
  assert.deepEqual(Object.keys(complete).sort(), [
    'checks', 'contentRecomputed', 'coverage', 'notCovered', 'provenance', 'provenanceStatus', 'reason', 'status',
  ]);
  assert.equal(JSON.stringify(complete).includes('PRIVATE_resolver_note'), false);
  assert.equal(JSON.stringify(complete).includes('verdict'), false);
  const receipt = buildSkillReceipt(RECEIPT_SPEC, authorizeSkill(claim, complete, ['read:project']));
  assert.equal(verifyReceipt(receipt).ok, true, verifyReceipt(receipt).reason);
  assert.equal(JSON.stringify(receipt).includes('PRIVATE_resolver_note'), false);
});

test('D1 the registration record and the claim are declarations, not evidence', async () => {
  const claim = registered();
  // The resolver holds the claim because the host handed it over, and hands it straight back.
  const whole = await verifySkillProvenance(claim, () => claim);
  assert.equal(whole.status, 'not_verifiable');
  assert.deepEqual(whole.coverage, []);

  // And the copy of it, which still carries the seal this kernel put on the registration.
  const { content, authority, ...rest } = claim;
  const copy = await verifySkillProvenance(claim, () => ({ ...rest, exists: true }));
  assert.equal(copy.status, 'not_verifiable');
  assert.deepEqual(copy.coverage, []);
  assert.equal(authorizeSkill(claim, copy, ['read:project']).authorized, false);
});

test('D1 the limit: a declaration the host hands its own resolver is what the kernel cannot see', async () => {
  const claim = registered();
  // Stated here instead of hidden: this resolver was handed the declaration by the host, not by the
  // kernel, and the kernel compares what it gets. Four values that match is exactly what an honest
  // observation looks like, so there is nothing left to distinguish. What this module guarantees is
  // narrower and checkable: it never puts the declared author or digest in the question, and it
  // refuses the record, the claim and a copy that still carries the seal. Beyond that, independence is
  // the host's, and the result says where every answer came from.
  const declaration = { repository: SPEC.repository, commit: SPEC.commit, author: SPEC.author, contentDigest: sha256(SPEC.content), exists: true };
  const result = await verifySkillProvenance(claim, () => declaration);
  assert.equal(result.status, 'verified');
  assert.equal(result.contentRecomputed, false, 'and it reports a digest string rather than bytes');
  assert.equal(loadSkill(claim, result, SPEC.content, ['read:project']).authorized, true);
});