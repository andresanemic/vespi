'use strict';

// K2 (decision 24), the fifth independent review round: the fifteen attacks the Advisor wrote against
// this branch, case by case. Every test keeps the reviewer's code in its title, so a failure traces
// back to the numbered finding that asked for it.
//
// Three of them were red when the report was written, and all three are one class: data a host left on
// `Object.prototype` — what a merge that honored `__proto__` produces, with no function replaced
// anywhere — was read as evidence (G514), as a grant (G506) and as an option (G515). The fourth round
// closed the constructor and left these reads open, which is F410 in the neighboring site.
//
// The rest are the boundary itself, and it is the narrower one the coordinator accepted in writing:
// this module defends against hostile data, including a polluted prototype, and does not defend
// against code that replaces a built-in function after this module was loaded, whether before the call,
// from a getter, or from inside the resolver. G501, G502 and G503 are marked `todo` for that reason:
// they document the edge rather than assert a defense this module does not make. G504 to G508 are
// there as the same characterization from other angles, G509 to G512 are the ones that must stay
// green, and G513 characterizes the declared risk in `computeDigest`.
//
// The names and the assertions are the reviewer's; the spacing, the helper and the shape are this
// repository's.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  registerSkillProvenance,
  verifySkillProvenance,
  authorizeSkill,
  loadSkill,
  buildSkillReceipt,
} = require('../src/skill-provenance.js');
const { verifyReceipt, computeDigest } = require('../src/receipt.js');

const CONTENT = '# r5 independently fetched artifact';
const EVIL = '# r5 MALICIOUS replacement artifact';

const SPEC = Object.freeze({
  name: 'r5',
  repository: 'https://example.test/r5',
  commit: 'd'.repeat(40),
  author: 'Independent author',
  content: CONTENT,
  authority: ['read'],
});

const RECEIPT_SPEC = Object.freeze({
  operation: { id: 'r5', goal: 'review' },
  capabilityId: 'loader',
  authority: { spend: [] },
  outcome: { exercised: [] },
  at: '2026-10-04T23:00:00.000Z',
});

const HASH_PROTOTYPE = Object.getPrototypeOf(crypto.createHash('sha256'));

function sha(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

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

function claim(extra = {}) {
  return registerSkillProvenance({ ...SPEC, ...extra });
}

async function verifiedFor(registered) {
  return verifySkillProvenance(registered, () => observed());
}

function receiptOf(decision) {
  return buildSkillReceipt(RECEIPT_SPEC, decision);
}

// A prototype is saved and restored through a Map of own descriptors, for the reason the fourth round
// wrote down: reading that state through a plain object would consult the very prototype under test.
function pollute(prototype, properties) {
  const keys = Object.keys(properties);
  const saved = new Map();
  for (const key of keys) saved.set(key, Object.getOwnPropertyDescriptor(prototype, key));
  for (const key of keys) {
    Object.defineProperty(prototype, key, { value: properties[key], writable: true, configurable: true });
  }
  return () => {
    for (const key of keys) {
      const descriptor = saved.get(key);
      if (descriptor !== undefined) Object.defineProperty(prototype, key, descriptor);
      else delete prototype[key];
    }
  };
}

// --- Data-only pollution: closed by this round (arreglo 1) ---

test('G506 an inherited authority on Object.prototype becomes a grant for a spec that has none', () => {
  const spec = { ...SPEC };
  delete spec.authority;
  const restore = pollute(Object.prototype, { authority: ['delete'] });
  let out;
  let threw = null;
  try {
    out = registerSkillProvenance(spec);
  } catch (err) {
    threw = err.message;
  } finally {
    restore();
  }
  assert.ok(threw !== null, `registered with authority=${out && JSON.stringify(out.authority)}`);
});

test('G514 data-only pollution of Object.prototype answers three evidence fields the resolver never gave', async () => {
  const registered = claim();
  const restore = pollute(Object.prototype, {
    exists: true,
    repository: SPEC.repository,
    commit: SPEC.commit,
    author: SPEC.author,
  });
  let result;
  let decision;
  try {
    result = await verifySkillProvenance(registered, () => ({ content: CONTENT }));
    decision = loadSkill(registered, result, CONTENT, ['read']);
  } finally {
    restore();
  }
  assert.notEqual(
    result.status,
    'verified',
    `status=${result.status} coverage=${result.coverage} authorized=${decision.authorized} source=${receiptOf(decision).skill.provenanceSource}`,
  );
});

test('G515 an inherited timeoutMs on Object.prototype sets a deadline nobody passed', async () => {
  const registered = claim();
  const restore = pollute(Object.prototype, { timeoutMs: 1 });
  let result;
  try {
    result = await verifySkillProvenance(registered, () => new Promise((ok) => setTimeout(() => ok(observed()), 30)));
  } finally {
    restore();
  }
  assert.equal(result.status, 'verified', `status=${result.status} reason=${result.reason}`);
});

// --- Two reads of the same class the grep for this round turned up, B05 and B06 ---
//
// The Advisor's six lines are the reads a test could reach. The grep over every read of caller or
// resolver data turned up one more, `byteShapeOf`'s `value[index]`, and one more the six lines
// already cover without a case of its own: `receiptField`, so an inherited field of the receipt spec
// cannot reach a receipt. Both are data, both arrive through a merge that honored `__proto__`, and
// neither can change a verdict: the byte check is uncovered either way, and an unreadable top-level
// field produces an ordinary receipt that says nothing. What they can change is the sentence and
// whether caller code runs at all, which is what these two ask about.

test('B06 an inherited receipt field does not reach a receipt and an unreadable one is ordinary', async () => {
  const registered = claim();
  const result = await verifiedFor(registered);
  const decision = loadSkill(registered, result, CONTENT, ['read']);
  const spec = { ...RECEIPT_SPEC };
  delete spec.capabilityId;
  const restore = pollute(Object.prototype, { capabilityId: 'inherited-from-the-prototype' });
  let receipt = null;
  let threw = null;
  try {
    receipt = buildSkillReceipt(spec, decision);
  } catch (err) {
    threw = err.message;
  } finally {
    restore();
  }
  assert.equal(threw, null, `a receipt that reads nothing is still a receipt: ${threw}`);
  assert.notEqual(receipt.capability, 'inherited-from-the-prototype', `capability=${receipt.capability}`);
  assert.equal(receipt.capability, 'unknown');
  assert.equal(verifyReceipt(receipt).ok, true);
});

test('B05 an inherited numeric index does not make a holey byte array read as bytes', async () => {
  const registered = claim();
  // A data property, which is the class this round closes: a merge that honored `__proto__` writes
  // values, and a numeric index left on `Array.prototype` is one a value can reach. A holey array
  // then reads that number as its own byte, and a payload of three holes names itself as three bytes.
  // An accessor there is not used on purpose: a getter with no setter turns `Array.prototype.push`
  // into a throw for the whole process, test runner included, and one with a setter breaks promise
  // resolution the same way. Reading an evidence getter once is F406 and G509's business, not this.
  const restore = pollute(Array.prototype, { 0: 104, 1: 105, 2: 106 });
  const holey = new Array(3);
  let result;
  try {
    result = await verifySkillProvenance(registered, () => observed({ content: holey }));
  } finally {
    restore();
  }
  assert.equal(result.status, 'not_verifiable');
  assert.equal(result.contentRecomputed, false);
  assert.match(result.reason, /an array that is not text/);
  // The verdict was never in question: nothing was hashed, so nothing could be covered on the digest.
  assert.ok(result.notCovered.includes('content_digest'));
  assert.equal(loadSkill(registered, result, CONTENT, ['read']).authorized, false);
});

// --- Replacing built-in functions: outside the contract, and kept as the written edge ---

test('G501 a replaced WeakMap.prototype.get links a hand-written result and authority is granted with no verification', {
  todo: 'out of contract: a host that replaces a built-in function after this module was loaded owns the process; the header says so',
}, () => {
  const registered = claim();
  const original = WeakMap.prototype.get;
  const fake = {
    status: 'verified',
    reason: 'forged',
    contentRecomputed: true,
    checks: { repository: true, commit_exists: true, author: true, content_digest: true },
  };
  let stash;
  WeakMap.prototype.get = function get(key) {
    const value = original.call(this, key);
    if (value !== undefined) stash = value;
    return key === fake ? stash : value;
  };
  let decision;
  try {
    decision = authorizeSkill(registered, fake, ['read']);
  } finally {
    WeakMap.prototype.get = original;
  }
  assert.equal(decision.authorized, false, `authorized=${decision.authorized} status=${decision.status}`);
});

test('G502 a requested getter installs a WeakMap.prototype.get that later turns a hand-written decision into a verified receipt', {
  todo: 'out of contract: the replacement is installed during the call by caller code, which the header names as outside the boundary',
}, async () => {
  const registered = claim();
  const real = await verifiedFor(registered);
  const original = WeakMap.prototype.get;
  const forged = {
    authorized: true,
    status: 'verified',
    provenanceStatus: 'verified',
    reason: 'forged',
    checks: {
      repository: true,
      commit_exists: true,
      author: true,
      content_digest: true,
      loaded_content_digest: true,
    },
    coverage: ['author', 'commit_exists', 'content_digest', 'loaded_content_digest', 'repository'],
    notCovered: [],
    provenance: {
      repository: SPEC.repository,
      commit: SPEC.commit,
      author: SPEC.author,
      contentDigest: sha(CONTENT),
    },
    name: 'r5',
    granted: ['read'],
    requested: ['delete'],
    loadedDigest: sha(EVIL),
    contentRecomputed: true,
  };
  let stash;
  const requested = ['read'];
  Object.defineProperty(requested, 0, {
    get() {
      WeakMap.prototype.get = function get(key) {
        const value = original.call(this, key);
        if (value !== undefined) stash = value;
        return key === forged ? stash : value;
      };
      return 'read';
    },
  });
  let receipt = null;
  let threw = null;
  try {
    authorizeSkill(registered, real, requested);
    authorizeSkill(registered, {}, ['read']);
    try {
      receipt = receiptOf(forged);
    } catch (err) {
      threw = err.message;
    }
  } finally {
    WeakMap.prototype.get = original;
  }
  assert.ok(
    threw !== null || receipt.skill.provenanceSource !== 'verified',
    `receipt built: status=${receipt && receipt.status} source=${receipt && receipt.skill.provenanceSource} requested=${receipt && receipt.skill.requested} verifyReceipt.ok=${receipt && verifyReceipt(receipt).ok}`,
  );
});

test('G503 a requested getter replaces Hash.prototype.digest and changed bytes load as the verified ones', {
  todo: 'out of contract: replacing a built-in function from caller code during the call is the host side of the boundary',
}, async () => {
  const registered = claim();
  const result = await verifiedFor(registered);
  assert.equal(result.status, 'verified');
  const original = HASH_PROTOTYPE.digest;
  const registeredDigest = registered.contentDigest;
  const requested = ['read'];
  Object.defineProperty(requested, 0, {
    get() {
      HASH_PROTOTYPE.digest = function digest() {
        original.call(this, 'hex');
        return registeredDigest;
      };
      return 'read';
    },
  });
  let decision;
  try {
    decision = loadSkill(registered, result, EVIL, requested);
  } finally {
    HASH_PROTOTYPE.digest = original;
  }
  assert.equal(
    decision.authorized,
    false,
    `authorized=${decision.authorized} loaded_content_digest=${decision.checks.loaded_content_digest} loadedDigest=${decision.loadedDigest}`,
  );
});

test('G504 an evidence getter replaces Hash.prototype.update and different bytes are reported as recomputed here and matching', {
  todo: 'out of contract: same class as G503, from the resolver side instead of the caller side',
}, async () => {
  const registered = claim();
  const original = HASH_PROTOTYPE.update;
  const evidence = { exists: true, repository: SPEC.repository, commit: SPEC.commit, author: SPEC.author };
  Object.defineProperty(evidence, 'content', {
    enumerable: true,
    get() {
      HASH_PROTOTYPE.update = function update(data, encoding) {
        return original.call(this, CONTENT, encoding);
      };
      return EVIL;
    },
  });
  let result;
  try {
    result = await verifySkillProvenance(registered, () => evidence);
  } finally {
    HASH_PROTOTYPE.update = original;
  }
  assert.notEqual(result.status, 'verified', `status=${result.status} contentRecomputed=${result.contentRecomputed}`);
});

test('G505 a spec getter replaces RegExp.prototype.exec and a moving reference is registered as a commit', {
  todo: 'out of contract: the commit id test is RegExp.prototype.exec, and caller code replaces it',
}, () => {
  const original = RegExp.prototype.exec;
  const spec = { ...SPEC, commit: 'HEAD' };
  Object.defineProperty(spec, 'name', {
    enumerable: true,
    get() {
      RegExp.prototype.exec = function exec() {
        return ['x'];
      };
      return 'r5';
    },
  });
  let out = null;
  let threw = null;
  try {
    out = registerSkillProvenance(spec);
  } catch (err) {
    threw = err.message;
  } finally {
    RegExp.prototype.exec = original;
  }
  assert.ok(threw !== null, `registered with commit=${out && out.commit}`);
});

test('G507 a resolver that replaces setTimeout while it runs defeats timeoutMs', {
  todo: 'out of contract: the deadline is setTimeout, and the resolver replaced it while running',
}, async () => {
  const registered = claim();
  const original = globalThis.setTimeout;
  const resolver = () => {
    globalThis.setTimeout = () => 0;
    return new Promise(() => {});
  };
  const pending = verifySkillProvenance(registered, resolver, { timeoutMs: 50 });
  globalThis.setTimeout = original;
  const outcome = await Promise.race([
    pending.then(() => 'answered'),
    new Promise((ok) => original(() => ok('hung'), 600)),
  ]);
  assert.equal(outcome, 'answered', 'verifySkillProvenance did not answer within 600 ms despite timeoutMs: 50');
});

test('G508 an authority getter replaces JSON.stringify and two different registrations share one digest', {
  todo: 'out of contract: the seal is JSON.stringify over the record, and a getter replaced it',
}, () => {
  const original = JSON.stringify;
  const authority = ['read'];
  Object.defineProperty(authority, 0, {
    get() {
      JSON.stringify = () => 'constant';
      return 'read';
    },
  });
  let a;
  let b;
  try {
    a = registerSkillProvenance({ ...SPEC, repository: 'https://example.test/a', authority });
    b = registerSkillProvenance({ ...SPEC, repository: 'https://example.test/b' });
  } finally {
    JSON.stringify = original;
  }
  assert.notEqual(a.digest, b.digest, 'two registrations with different repositories got the same seal');
});

// --- The ones that must stay green ---

test('G509 a proxy spec that answers differently on each read is read once per key', () => {
  const reads = {};
  const spec = new Proxy({ ...SPEC }, {
    get(target, key) {
      reads[key] = (reads[key] || 0) + 1;
      if (key === 'authority' && reads[key] > 1) return ['delete'];
      return target[key];
    },
  });
  const registered = registerSkillProvenance(spec);
  assert.deepEqual([...registered.authority], ['read']);
  for (const key of ['name', 'repository', 'commit', 'author', 'content', 'authority']) {
    assert.equal(reads[key], 1, key);
  }
});

test('G510 replaced iterator, filter, includes, trim and hasOwn after load do not widen read to delete', async () => {
  const registered = claim();
  const result = await verifiedFor(registered);
  const saved = [
    Array.prototype[Symbol.iterator],
    Array.prototype.filter,
    Array.prototype.includes,
    String.prototype.trim,
    Object.hasOwn,
    Array.isArray,
  ];
  Array.prototype[Symbol.iterator] = function* iterate() {
    yield 'read';
  };
  Array.prototype.filter = () => [];
  Array.prototype.includes = () => true;
  String.prototype.trim = () => 'read';
  Object.hasOwn = () => true;
  Array.isArray = () => true;
  let decision;
  try {
    decision = authorizeSkill(registered, result, ['delete']);
  } finally {
    Array.prototype[Symbol.iterator] = saved[0];
    Array.prototype.filter = saved[1];
    Array.prototype.includes = saved[2];
    String.prototype.trim = saved[3];
    Object.hasOwn = saved[4];
    Array.isArray = saved[5];
  }
  assert.equal(decision.authorized, false);
});

test('G511 String objects with toString, valueOf and toPrimitive are not capability names', async () => {
  const registered = claim();
  const result = await verifiedFor(registered);
  const wrapped = new String('delete');
  wrapped.toString = () => 'read';
  wrapped.valueOf = () => 'read';
  wrapped[Symbol.toPrimitive] = () => 'read';
  const impostor = { toString: () => 'read', valueOf: () => 'read' };
  for (const value of [wrapped, impostor]) {
    assert.equal(authorizeSkill(registered, result, [value]).authorized, false);
  }
  assert.throws(() => registerSkillProvenance({ ...SPEC, authority: [wrapped] }));
});

test('G512 the list bound holds at 256 and a 257-long proxy is refused before any element is read', async () => {
  const names = Array.from({ length: 256 }, (unused, index) => `cap${index}`);
  const registered = registerSkillProvenance({ ...SPEC, authority: names });
  assert.equal(registered.authority.length, 256);
  let reads = 0;
  const proxy = new Proxy(new Array(257).fill('read'), {
    get(target, key) {
      if (key !== 'length' && typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
      return target[key];
    },
  });
  const anchor = claim();
  const result = await verifiedFor(anchor);
  const decision = authorizeSkill(anchor, result, proxy);
  assert.equal(decision.authorized, false);
  assert.equal(reads, 0);
});

test('G513 a replaced Array.prototype.sort changes what computeDigest covers but not the status the kernel wrote', async () => {
  const registered = claim();
  const result = await verifySkillProvenance(registered, () => ({
    exists: true,
    repository: 'https://example.test/other',
    commit: SPEC.commit,
    author: SPEC.author,
    content: CONTENT,
  }));
  const decision = loadSkill(registered, result, CONTENT, ['read']);
  const original = Array.prototype.sort;
  Array.prototype.sort = function sort() {
    const keep = [];
    for (let index = 0; index < this.length; index += 1) {
      if (this[index] === 'at') keep[keep.length] = 'at';
    }
    return keep;
  };
  let receipt = null;
  let forgedOk = null;
  try {
    receipt = receiptOf(decision);
    const edited = {
      ...receipt,
      status: 'verified',
      skill: { ...receipt.skill, provenanceSource: 'verified', status: 'verified' },
    };
    edited.digest = receipt.digest;
    forgedOk = computeDigest(edited) === receipt.digest;
  } finally {
    Array.prototype.sort = original;
  }
  assert.equal(receipt.skill.provenanceSource, 'declared');
  assert.equal(receipt.status, 'failed');
  assert.equal(verifyReceipt(receipt).ok, false);
  assert.equal(forgedOk, true);
});
