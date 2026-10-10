'use strict';

// K2 (decision 24), the fourth independent review round: the twenty attacks the Advisor wrote against
// this branch, case by case.
//
// Nine of the twenty were red when the report was written (F408 to F414, F417 and F418) and each one
// keeps the reviewer's code in its title, so a failure here traces back to the numbered finding that
// asked for it. The eleven that already passed are here too: a defense nobody re-runs is a defense
// that decays.
//
// The nine reds were five defects and one cause. The cause is the boundary between the caller's data
// and the caller's code: between the moment a value arrives and the moment this kernel decides
// anything about it, the module consulted `Object.prototype`, `Array.prototype`, array iterators and
// `ArrayBuffer` predicates it did not hold a reference to. Someone who can put `repository: true` on
// `Object.prototype`, or a hole where a capability name should be, or a `filter` that returns nothing,
// decides what the kernel verifies. So the nine are fixed as one class and not site by site, which is
// why the eleventh, twelfth, thirteenth and fourteenth cases below are about the boundary itself.
//
// The names and the assertions are the reviewer's; the spacing and the helpers are this repository's.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const {
  registerSkillProvenance,
  verifySkillProvenance,
  authorizeSkill,
  loadSkill,
  listSkillProvenance,
  buildSkillReceipt,
} = require('../src/skill-provenance.js');
const { verifyReceipt } = require('../src/receipt.js');

const CONTENT = '# r4 independently fetched artifact';

const SPEC = Object.freeze({
  name: 'r4',
  repository: 'https://example.test/r4',
  commit: 'c'.repeat(40),
  author: 'Independent Author',
  content: CONTENT,
  authority: ['read'],
});

const RECEIPT_SPEC = Object.freeze({
  operation: { id: 'r4', goal: 'review' },
  capabilityId: 'loader',
  authority: { spend: [] },
  outcome: { exercised: [] },
  at: '2040-01-01T00:00:00.000Z',
});

// What a resolver that looked at the repository on its own would answer. Written out here rather than
// derived from the claim, so an echo of the declaration could not pass.
function observed(extra = {}) {
  return {
    exists: true,
    repository: SPEC.repository,
    commit: SPEC.commit,
    author: SPEC.author,
    content: CONTENT,
    ...extra,
  };
}

function claim() {
  return registerSkillProvenance({ ...SPEC });
}

// A result is bound to the record it was produced for, so the helper takes the claim rather than
// registering a second one behind the caller's back.
async function verifiedFor(registered, overrides = {}) {
  return verifySkillProvenance(registered, () => observed(overrides));
}

function receiptOf(decision) {
  return buildSkillReceipt(RECEIPT_SPEC, decision);
}

// A prototype is saved and restored through a Map of own descriptors. Reading the map through a plain
// object would consult the very prototype under test, which is the bug that made the reviewer's first
// harness report ten failures that were not there (`adversarial-first.txt` in the report).
function pollute(prototype, properties) {
  const keys = Object.keys(properties);
  const saved = new Map();
  for (const key of keys) saved.set(key, Object.getOwnPropertyDescriptor(prototype, key));
  for (const key of keys) {
    Object.defineProperty(prototype, key, { value: properties[key], writable: true, configurable: true });
  }
  // `keys` is kept beside the Map on purpose: reading a Map through `Object.keys` asks the object for
  // its own keys, and the object being asked here is the prototype under test.
  return () => {
    for (const key of keys) {
      const descriptor = saved.get(key);
      if (descriptor !== undefined) Object.defineProperty(prototype, key, descriptor);
      else delete prototype[key];
    }
  };
}

// --- The eleven that already resisted: they must stay green ---

test('F401 echo plus asserted verified/source/checks cannot create independent evidence', async () => {
  const registered = claim();
  const result = await verifySkillProvenance(registered, (question) => ({
    ...question,
    exists: true,
    status: 'verified',
    provenanceSource: 'verified',
    checks: { author: true, content_digest: true },
  }));
  assert.equal(result.status, 'not_verifiable');
  const decision = loadSkill(registered, result, CONTENT, ['read']);
  assert.equal(decision.authorized, false);
  const receipt = receiptOf(decision);
  assert.equal(receipt.skill.provenanceSource, 'declared');
  assert.equal(receipt.skill.provenanceStatus, 'not_verifiable');
  assert.equal(receipt.skill.provenanceReceiptStatus, 'not_verified');
  assert.equal(receipt.skill.nameSource, 'declared');
});

test('F402 rewriting the frozen question cannot insert the withheld answers', async () => {
  const registered = claim();
  const result = await verifySkillProvenance(registered, (question) => {
    assert.equal(Reflect.set(question, 'author', SPEC.author), false);
    assert.equal(Reflect.set(question, 'contentDigest', registered.contentDigest), false);
    return { ...question, exists: true };
  });
  assert.notEqual(result.status, 'verified');
  assert.equal(authorizeSkill(registered, result, ['read']).authorized, false);
});

test('F403 each partial evidence response remains declared despite injected verified labels', async () => {
  for (const field of ['exists', 'repository', 'commit', 'author', 'content']) {
    const evidence = observed({ provenanceSource: 'verified', provenanceReceiptStatus: 'verified', contentRecomputed: true });
    delete evidence[field];
    const registered = claim();
    const result = await verifySkillProvenance(registered, () => evidence);
    assert.equal(result.status, 'not_verifiable', field);
    const decision = authorizeSkill(registered, result, ['read']);
    assert.equal(decision.authorized, false, field);
    assert.equal(receiptOf(decision).skill.provenanceSource, 'declared', field);
  }
});

test('F404 relabelled or copied unverified results cannot acquire authority', async () => {
  const registered = claim();
  const result = await verifySkillProvenance(registered, () => ({ repository: SPEC.repository, content: CONTENT }));
  const copied = {
    ...result,
    status: 'verified',
    provenanceStatus: 'verified',
    provenanceSource: 'verified',
    checks: { repository: true, commit_exists: true, author: true, content_digest: true },
  };
  const decision = authorizeSkill(registered, copied, ['read']);
  assert.equal(decision.authorized, false);
  assert.equal(receiptOf(decision).skill.provenanceSource, 'declared');
});

test('F405 changed load content cannot turn a verified provenance into authorized changed bytes', async () => {
  const registered = claim();
  const result = await verifiedFor(registered);
  const decision = loadSkill(registered, result, `${CONTENT} malicious suffix`, ['read']);
  assert.equal(decision.authorized, false);
  assert.equal(decision.status, 'discrepant');
  const receipt = receiptOf(decision);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.skill.provenanceSource, 'verified');
  assert.equal(receipt.skill.provenanceStatus, 'verified');
  assert.equal(receipt.skill.nameSource, 'declared');
  assert.equal(verifyReceipt(receipt).ok, true);
});

test('F406 evidence getters are captured once and later rewrites do not upgrade the result', async () => {
  const registered = claim();
  let reads = 0;
  const evidence = observed();
  Object.defineProperty(evidence, 'content', {
    get() {
      reads += 1;
      return reads === 1 ? `${CONTENT}bad` : CONTENT;
    },
  });
  const result = await verifySkillProvenance(registered, () => evidence);
  assert.equal(reads, 1);
  assert.equal(result.status, 'discrepant');
  assert.equal(loadSkill(registered, result, CONTENT, ['read']).authorized, false);
});

test('F407 a revoked evidence proxy is refused instead of rejecting the API', async () => {
  const registered = claim();
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  let result;
  await assert.doesNotReject(async () => {
    result = await verifySkillProvenance(registered, () => revoked.proxy);
  });
  assert.equal(result.status, 'not_verifiable');
});

// --- F408, F409: the shape diagnosis threw out of the API ---

test('F408 a revoked content proxy preserves the partial checks and is contained', async () => {
  // The three comparisons that really ran are facts about what this kernel verified, and a hostile
  // payload in the fourth field must not take them away. Before the fix, naming the shape of the
  // payload walked the prototype chain of a revoked proxy and the `TypeError` left the API.
  const registered = claim();
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  let result;
  await assert.doesNotReject(async () => {
    result = await verifySkillProvenance(registered, () => observed({ content: revoked.proxy }));
  });
  assert.equal(result.status, 'not_verifiable');
  assert.equal(result.checks.repository, true);
  assert.equal(result.checks.content_digest, false);
});

test('F409 inspecting non-text content does not run a hostile getPrototypeOf trap', async () => {
  // `Buffer.isBuffer` is an `instanceof`, and an `instanceof` walks the prototype chain, so naming a
  // payload used to be a way to run the payload's own code. The promise is kept by not asking: the
  // predicate that answers about a view reports false for every proxy without reaching a trap.
  const registered = claim();
  let traps = 0;
  const trap = new Proxy({}, {
    getPrototypeOf() {
      traps += 1;
      throw new Error('SYNTHETIC_PRIVATE_CONTENT_TRAP');
    },
  });
  let result;
  await assert.doesNotReject(async () => {
    result = await verifySkillProvenance(registered, () => observed({ content: trap }));
  });
  assert.equal(traps, 0);
  assert.equal(result.status, 'not_verifiable');
  assert.doesNotMatch(result.reason, /SYNTHETIC_PRIVATE/);
});

// --- F410, F411: three comparisons that never ran, read as three comparisons that passed ---

test('F410 inherited check booleans cannot fabricate verification and authority', async () => {
  // The accumulator was a plain object, so `checks[key] !== undefined` asked the prototype what had
  // been compared. With `Object.prototype.repository`, `.author` and `.commit_exists` set to true, a
  // resolver that answers with the content and nothing else left all three comparisons unrun and
  // still produced `verified`, a `verified` receipt and a load that authorized. Three comparisons
  // this kernel never made were reported as three it did.
  const registered = claim();
  let result;
  const restore = pollute(Object.prototype, { repository: true, author: true, commit_exists: true });
  try {
    result = await verifySkillProvenance(registered, () => ({ content: CONTENT }));
  } finally {
    restore();
  }
  assert.notEqual(result.status, 'verified', 'three checks were never compared');
  assert.equal(result.checks.repository, false);
  assert.equal(result.checks.author, false);
  assert.equal(result.checks.commit_exists, false);
  const decision = loadSkill(registered, result, CONTENT, ['read']);
  assert.equal(decision.authorized, false);
  const receipt = receiptOf(decision);
  assert.equal(receipt.skill.provenanceSource, 'declared');
  assert.equal(verifyReceipt(receipt).ok, true);
});

test('F411 one resolver getter cannot fill missing checks through Object.prototype', async () => {
  // The same class of defect with no prior preparation: the resolver's own `content` getter is the
  // thing that pollutes the prototype, while the kernel is reading the answer. So a resolver the
  // module already accepted as evidence could manufacture the three comparisons it did not make.
  const registered = claim();
  let restore = () => {};
  const evidence = {
    get content() {
      restore = pollute(Object.prototype, { repository: true, author: true, commit_exists: true });
      return CONTENT;
    },
  };
  let result;
  try {
    result = await verifySkillProvenance(registered, () => evidence);
  } finally {
    restore();
  }
  assert.notEqual(result.status, 'verified');
  assert.equal(authorizeSkill(registered, result, ['read']).authorized, false);
});

// --- F412, F413: a hole in the list is not an entry, and the prototype is not a grant ---

test('F412 a hole in a grant does not import an Array.prototype capability', () => {
  // `new Array(1)` has a length of 1 and no element at index 0, so `value[0]` answers whatever
  // `Array.prototype[0]` says. Reading the index without asking whether the array owns it imported a
  // capability name from the prototype, and a grant is exactly what decides authority.
  const authority = new Array(1);
  let registered = false;
  const restore = pollute(Array.prototype, { 0: 'delete' });
  try {
    try {
      registerSkillProvenance({ ...SPEC, authority });
      registered = true;
    } catch {
      registered = false;
    }
  } finally {
    restore();
  }
  assert.equal(registered, false, 'a sparse empty grant acquired delete from Array.prototype');
});

test('F413 a sparse request does not import inherited authority names', async () => {
  const registered = claim();
  const result = await verifiedFor(registered);
  const requested = new Array(1);
  const restore = pollute(Array.prototype, { 0: 'read' });
  let decision;
  try {
    decision = authorizeSkill(registered, result, requested);
  } finally {
    restore();
  }
  assert.equal(decision.authorized, false);
  assert.equal(decision.checks.authority_scope, false);
});

// --- F414: the scope check was one replaceable method away from not running ---

test('F414 a request getter cannot suppress scope checking through Array.prototype.filter', async () => {
  // The list was captured by index, and then the scope decision ran `ask.filter(...)` on it, which
  // consults `Array.prototype.filter` — after the caller's getter had already run. Replacing that
  // one method made every requested capability look in scope, so `delete` was authorized under a
  // grant of `read`. A capture is only a capture if the decision reads the copy and nothing else.
  const registered = claim();
  const result = await verifiedFor(registered);
  const saved = Object.getOwnPropertyDescriptor(Array.prototype, 'filter');
  const requested = [];
  Object.defineProperty(requested, '0', {
    get() {
      Array.prototype.filter = function filter() { return []; };
      return 'delete';
    },
    configurable: true,
  });
  let decision;
  try {
    decision = authorizeSkill(registered, result, requested);
  } finally {
    Object.defineProperty(Array.prototype, 'filter', saved);
  }
  assert.equal(decision.authorized, false, 'delete exceeded the read grant');
  assert.equal(decision.checks.authority_scope, false);
});

// --- F415 to F420: the residue, half of it already green ---

test('F415 opaque evidence carrying only asserted status never grants registered authority', async () => {
  const registered = claim();
  const result = await verifySkillProvenance(registered, () => ({
    verified: true,
    status: 'verified',
    provenanceSource: 'verified',
  }));
  assert.notEqual(result.status, 'verified');
  assert.equal(loadSkill(registered, result, CONTENT, ['read']).authorized, false);
  assert.equal(receiptOf(authorizeSkill(registered, result, ['read'])).skill.provenanceSource, 'declared');
});

test('F416 byte diagnostics must not erase an explicit refutation through an array getter', async () => {
  const registered = claim();
  const bytes = [1];
  Object.defineProperty(bytes, '0', { get() { throw new Error('SYNTHETIC_PRIVATE_BYTE'); } });
  const result = await verifySkillProvenance(registered, () => observed({ exists: false, content: bytes }));
  assert.equal(result.status, 'discrepant');
  assert.doesNotMatch(result.reason, /SYNTHETIC_PRIVATE/);
  assert.equal(receiptOf(authorizeSkill(registered, result, ['read'])).status, 'failed');
});

// The two length attacks ran in a child process with a heap cap, because a synchronous loop over a
// caller-declared length cannot be interrupted by a timer: the only thing a parent can do is kill the
// process, and a killed process proves the kernel blocked, not that it refused.
function oversizedProcess(mode) {
  const module = require.resolve('../src/skill-provenance.js');
  // Los datos viajan por el entorno y se leen con JSON.parse dentro del hijo: ninguna cadena se
  // compone dentro del codigo que ejecuta el proceso.
  const code = [
    "const data = JSON.parse(process.env.K2_CASE);",
    "const kernel = require(data.module);",
    '(async () => {',
    "  const list = new Proxy([], { get(target, key) { return key === 'length' ? Number.MAX_SAFE_INTEGER : 'read'; } });",
    "  console.log('ENTERING_KERNEL');",
    "  if (data.mode === 'grant') kernel.registerSkillProvenance({ ...data.spec, authority: list });",
    '  else {',
    '    const registered = kernel.registerSkillProvenance(data.spec);',
    '    const result = await kernel.verifySkillProvenance(registered, () => data.observed);',
    '    kernel.authorizeSkill(registered, result, list);',
    '  }',
    "  console.log('RETURNED');",
    "})().catch(() => console.log('REFUSED'));",
  ].join('\n');
  return spawnSync(process.execPath, ['--max-old-space-size=64', '-e', code], {
    encoding: 'utf8',
    env: { ...process.env, K2_CASE: JSON.stringify({ module, mode, spec: SPEC, observed: observed() }) },
    timeout: 5000,
    windowsHide: true,
  });
}

test('F417 oversized proxy grant length is rejected before unbounded copying', () => {
  // A `length` is a claim about how much work there is, and this module has no reason to believe it.
  // The bound is explicit and checked before the copy starts, because after the copy starts nothing
  // in this process can stop it.
  const child = oversizedProcess('grant');
  assert.match(child.stdout, /ENTERING_KERNEL/);
  assert.equal(child.error?.code, undefined, `child timed out: ${child.error?.code}`);
  assert.match(child.stdout, /REFUSED/);
  assert.equal(child.status, 0, `child terminated: ${child.signal}; ${child.stderr.slice(-400)}`);
});

test('F418 oversized proxy request length is rejected before unbounded copying', () => {
  const child = oversizedProcess('request');
  assert.match(child.stdout, /ENTERING_KERNEL/);
  assert.equal(child.error?.code, undefined, `child timed out: ${child.error?.code}`);
  assert.match(child.stdout, /REFUSED|RETURNED/);
  assert.equal(child.status, 0, `child terminated: ${child.signal}; ${child.stderr.slice(-400)}`);
});

test('F419 content swap in host after argument capture is outside the load binding', async () => {
  // A characterization of a limit, not a defense: the kernel authorized the text primitive it was
  // handed before the getter changed the host's variable, and it does not execute the skill. What
  // the host does with its own variable afterwards is the host's, and no check here can see it.
  const registered = claim();
  const result = await verifiedFor(registered);
  let hostContent = CONTENT;
  const requested = [];
  Object.defineProperty(requested, '0', {
    get() {
      hostContent = `${CONTENT}unverified host mutation`;
      return 'read';
    },
  });
  const decision = loadSkill(registered, result, hostContent, requested);
  assert.equal(decision.authorized, true);
  assert.notEqual(hostContent, CONTENT);
  assert.equal(decision.loadedDigest, registered.contentDigest);
});

test('F420 forged provenance source and name source in receipt spec cannot overwrite sealed labels', async () => {
  const registered = claim();
  const result = await verifySkillProvenance(registered, () => ({ content: CONTENT }));
  const decision = authorizeSkill(registered, result, ['read']);
  const receipt = buildSkillReceipt(
    { ...RECEIPT_SPEC, skill: { provenanceSource: 'verified', nameSource: 'verified' }, provenanceSource: 'verified' },
    decision,
  );
  assert.equal(receipt.skill.provenanceSource, 'declared');
  assert.equal(receipt.skill.nameSource, 'declared');
  assert.equal(receipt.verification.verified, false);
  assert.equal(verifyReceipt(receipt).ok, true);
});

// --- The boundary itself, stated as tests so it cannot quietly reopen ---
//
// The nine fixes above are nine sites. These four are the rule the sites obey: nothing between the
// caller's data and this kernel's decision is asked of a prototype, and nothing the caller declared
// about how much there is is believed before the copy starts.

test('B01 a replaced Array.prototype.filter cannot decide anything after a caller getter ran', async () => {
  const registered = claim();
  const result = await verifiedFor(registered);
  const saved = Object.getOwnPropertyDescriptor(Array.prototype, 'filter');
  const requested = [];
  Object.defineProperty(requested, '0', { get() { return 'delete'; }, configurable: true });
  Array.prototype.filter = function filter() { return []; };
  let decision;
  try {
    decision = authorizeSkill(registered, result, requested);
  } finally {
    Object.defineProperty(Array.prototype, 'filter', saved);
  }
  assert.equal(decision.authorized, false);
  assert.equal(decision.status, 'not_verified');
});

test('B02 a replaced Object.hasOwn cannot make an absent check answer true', async () => {
  const registered = claim();
  const saved = Object.getOwnPropertyDescriptor(Object, 'hasOwn');
  Object.hasOwn = () => true;
  let result;
  try {
    result = await verifySkillProvenance(registered, () => ({ content: CONTENT }));
  } finally {
    Object.defineProperty(Object, 'hasOwn', saved);
  }
  assert.notEqual(result.status, 'verified');
  assert.equal(authorizeSkill(registered, result, ['read']).authorized, false);
});

test('B03 a replaced Array.prototype.sort cannot move what a receipt covers', async () => {
  // What this branch owns is the ordering of the lists it writes into the receipt, and those are read
  // with the comparison this module captured at load. The digest is not claimed here: `computeDigest`
  // in `src/receipt.js` is base code and canonicalizes with `Object.keys(value).sort()`, a live lookup,
  // so a receipt hashed while `sort` is replaced does not verify afterwards. That is a surface of the
  // base kernel and is listed as an open risk in this round's report, not asserted as fixed here.
  const registered = claim();
  const result = await verifiedFor(registered);
  const saved = Object.getOwnPropertyDescriptor(Array.prototype, 'sort');
  Array.prototype.sort = function sort() { return this; };
  let receipt;
  try {
    receipt = receiptOf(authorizeSkill(registered, result, ['read']));
  } finally {
    Object.defineProperty(Array.prototype, 'sort', saved);
  }
  assert.equal(receipt.status, 'verified');
  assert.equal(receipt.skill.provenanceSource, 'verified');
  assert.deepEqual(receipt.skill.coverage, ['author', 'commit_exists', 'content_digest', 'repository']);
  assert.deepEqual(receipt.skill.notCovered, []);
  assert.deepEqual(receipt.skill.requested, ['read']);
  assert.deepEqual(Object.keys(receipt.verification.checks), ['author', 'commit_exists', 'content_digest', 'repository']);
});

test('B04 a list longer than the module accepts is refused instead of copied', () => {
  // The bound is on the declared length, checked before a single element is read, and the reason is
  // this module's own text: a caller does not get its own numbers quoted back at it.
  const long = [];
  for (let index = 0; index < 4096; index += 1) long.push(`read:${index}`);
  assert.throws(() => registerSkillProvenance({ ...SPEC, authority: long }), /could not be read as a list|more than/);
});

test('B05 a replaced String.prototype cannot widen a grant or hide a wildcard', () => {
  // The same argument as the array primitives, on the four string methods this module reaches for.
  // A `trim` that answers empty made a blank capability name look grantable, and an `includes` that
  // answers false would have let `read:*` through the only place wildcards are refused.
  const saved = Object.getOwnPropertyDescriptors(String.prototype);
  let blankRefused = false;
  let wildcardRefused = false;
  String.prototype.trim = function trim() { return ''; };
  String.prototype.includes = function includes() { return false; };
  try {
    assert.throws(() => registerSkillProvenance({ ...SPEC, authority: ['   '] }), /capability names/);
    blankRefused = true;
    assert.throws(() => registerSkillProvenance({ ...SPEC, authority: ['read:*'] }), /without wildcards/);
    wildcardRefused = true;
  } finally {
    for (const key of Object.keys(saved)) Object.defineProperty(String.prototype, key, saved[key]);
  }
  assert.equal(blankRefused, true, 'a blank capability name was not refused');
  assert.equal(wildcardRefused, true, 'a wildcard was registered while the primitive was replaced');
  // And the module still refuses both once the realm is back to normal.
  assert.throws(() => registerSkillProvenance({ ...SPEC, authority: ['   '] }), /capability names/);
  const blank = registerSkillProvenance({ ...SPEC, authority: ['read'] });
  assert.deepEqual([...blank.authority], ['read']);
});

test('B06 a replaced Symbol.iterator cannot rewrite a grant, a request or a receipt', async () => {
  // `for...of` is a call to `Symbol.iterator` looked up at the moment it runs, so the loop that walks
  // a list of own keys or a set of records was one replaced generator away from seeing something else.
  // The internal walks are index loops and the registry walk is `forEach`; this pins that.
  const registered = claim();
  const result = await verifiedFor(registered);
  const saved = Object.getOwnPropertyDescriptors(Array.prototype);
  const savedIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  const savedSetIterator = Object.getOwnPropertyDescriptor(Set.prototype, Symbol.iterator);
  Array.prototype[Symbol.iterator] = function* substituted() { yield 'delete'; };
  Set.prototype[Symbol.iterator] = function* substituted() { yield { name: 'ghost', repository: 'ghost', commit: 'ghost', author: 'ghost', contentDigest: 'ghost' }; };
  let receipt;
  let listing;
  try {
    receipt = receiptOf(authorizeSkill(registered, result, ['read']));
    listing = listSkillProvenance().filter((entry) => entry.name === 'r4');
  } finally {
    for (const key of Object.keys(saved)) {
      const descriptor = saved[key];
      if (descriptor !== undefined) Object.defineProperty(Array.prototype, key, descriptor);
    }
    Object.defineProperty(Array.prototype, Symbol.iterator, savedIterator);
    Object.defineProperty(Set.prototype, Symbol.iterator, savedSetIterator);
  }
  assert.equal(receipt.status, 'verified');
  assert.deepEqual(receipt.skill.requested, ['read']);
  assert.deepEqual(receipt.skill.granted, ['read']);
  assert.deepEqual(receipt.skill.coverage, ['author', 'commit_exists', 'content_digest', 'repository']);
  // Every case in this file registers the same skill, so the listing holds many of them. What matters
  // is that none of them is the record the substituted set iterator was yielding.
  assert.ok(listing.length > 0, 'the registry listing came back empty');
  for (const entry of listing) assert.equal(entry.repository, SPEC.repository, 'a substituted registry entry reached the listing');
  for (const entry of listSkillProvenance()) assert.notEqual(entry.name, 'ghost', 'a substituted entry is in the registry');
});