'use strict';

// K2: skill provenance (decision 24, the ecosystem study behind it).
//
// A skill is a capability with permission to act. The supply chain it arrives through has no party
// answerable for it: the study found security holes in 36% of 3984 skills, 76 confirmed malicious
// loads, and several unrelated repositories publishing a skill called `superpowers`. So a skill enters
// this kernel the way an agent enters it (decisions 16 and 22): with written provenance, with the
// authority the person grants, and verified **outside** what the skill says about itself.
//
// What that last part means concretely, and it is the whole design:
//   - The declaration is not evidence. A claim is only a claim.
//   - The evidence arrives from a resolver the caller injects. This module never opens a socket, never
//     shells out to git, never reads a file. Whoever runs the kernel decides where the answer comes
//     from; the kernel only decides whether the answer matches.
//   - The resolver is not handed what it is asked to produce. The question carries where to look (the
//     skill's name, its repository, the exact commit) and withholds the declared author and the
//     declared content digest. The resolver answers with what it observed and the kernel compares it
//     against what the skill declared; an answer that is the declaration, or an echo of the question,
//     is refused rather than believed (D1, review N05).
//   - What the kernel can check is checked by the kernel. If the resolver hands over bytes, the digest
//     is computed here. A resolver that reports a matching digest string while shipping different
//     bytes is refuted, not believed (decision 22: the verification record is computed by the code,
//     not asserted by the agent).
//   - What a receipt seals says which of the two things it is. The provenance block in a receipt is the
//     declaration; `provenanceSource` says so, and says `verified` only when each of the four
//     comparisons came out equal — which is when the block is also, string for string, what the
//     resolver observed. Nothing the resolver wrote is copied into a sealed receipt (A18, reviews
//     H06-H08, N01, H19), so a refutation is reported as a refutation and not as a value.
//   - The name is the one value in a receipt that nothing checks, and it says so. The kernel cannot
//     compare a name: it does not know which path inside the commit holds the artifact. So `name` is a
//     search hint and `nameSource` is `declared` in every state — the same word `provenanceSource`
//     uses — and no check, and no coverage, ever counts it (P2b finding 4.3).
//   - Nothing on the claim is trusted, including fields written after registration. The registered
//     values live in a private binding, the way the bound orchestrator lives in `delegation.js` (S11):
//     a claim that anyone can rewrite is not a grant, it is a suggestion.
//   - The word `verified` is written only from four comparisons this kernel ran, never from four
//     booleans it read. A check that was not compared is an uncovered check, and an inherited one is
//     not a check at all: both the accumulator and the evidence each comparison reads are read as own
//     properties, so a field on `Object.prototype` can answer neither (see the boundary below).
//
// What this does NOT buy, stated plainly. It proves that an injected resolver said the repository,
// the commit, the author and the bytes line up with what was declared, and that it was never given
// the declared author or digest to say so with. It does not prove the resolver told the truth: a
// resolver pointed at an attacker's own fork answers honestly about that fork, and a host that hands
// its own resolver the declaration gets back four values that match, which is exactly what an honest
// observation looks like. That last door is the host's, and no check here can see through it. The
// module does not authenticate the person who registered the skill. It does not read the network, so
// a correct answer has to be brought to it. And it does not vet what the skill *does* — that is the
// granted authority, checked exactly, and the rest is the person's decision.
//
// Two operational bounds, both stated rather than discovered. A list of capability names may hold at
// most `MAX_LIST_LENGTH` entries and a declared length above it is refused before anything is copied,
// because the copy is synchronous and no timer reaches it. And a resolver with no deadline set can wait
// as long as it likes: the timers here are not injectable.
//
// The boundary, said as it is, in both directions.
//
// What this module defends. The data a caller or a resolver hands over. Every value is read once, only
// as an own property, into an object this module built, so a getter cannot answer twice, and a field
// left on `Object.prototype` or `Array.prototype` -- a polluted prototype, what a merge that honored
// `__proto__` produces -- is never read as evidence, as a grant or as an option (F410 to F418, G506,
// G514, G515). The reads that can still run a caller's own code, which are the ones on a caller's own
// object, are each inside a guard whose catch answers with this module's own refusal.
//
// What this module does not defend. Code. It trusts the realm it runs in, before and during every
// call. Code that replaces a built-in function -- `WeakMap.prototype.get`, `Set.add`, the hash
// methods, `RegExp.prototype.exec`, `JSON.stringify`, `Buffer.from`, `setTimeout`, `Promise.race`,
// `Array.prototype.sort` -- whether before the call, from a getter, or from inside the resolver, can
// make this module grant authority and seal a `verified` receipt that no verification produced, and so
// can any code that can reach this module's exports. The same code that replaced
// `WeakMap.prototype.get` can replace this module's `authorizeSkill` in `require.cache`; that is not
// a bug to fix here, it is the process being taken over (G501 to G505, G507, G508). A host that runs
// untrusted code in the same process must freeze the intrinsics at startup and must not pass objects
// with getters or proxies that come from that code.
//
// The receipt digest is a further matter and belongs to `receipt.js`: `computeDigest` canonicalizes
// with a live `Object.keys(...).sort()`, so replacing `Array.prototype.sort` changes what a receipt
// digest covers, and it has no key, so whoever can edit a receipt can reseal it (G513). That is base
// code and is not touched here.
//
// One cost of the own-property rule, named because it is observable: a resolver that answers with a
// class instance, or any object that keeps its fields on its prototype, has those fields left
// uncovered now. A field the resolver does not own is not evidence it observed.

const { createHash } = require('node:crypto');
const { buildReceipt, computeDigest } = require('./receipt.js');

// --- The boundary between the caller's data and the caller's code ---
//
// Everything below this line was one site away from asking the caller's world a question, and the
// fourth review round showed what that costs (F408 to F418). Between the moment a value arrives from
// a caller or from a resolver and the moment this kernel decides anything about it, this module used
// to consult `Object.prototype`, `Array.prototype`, array iterators and `ArrayBuffer` predicates that
// it did not hold a reference to. Four separate consequences, one cause:
//   - a boolean a host had left on `Object.prototype` answered a comparison this kernel never made,
//     and `verified` was written from it (F410, F411);
//   - a hole where a capability name should be imported one from `Array.prototype`, and a grant is
//     what decides authority (F412, F413);
//   - one replaceable `Array.prototype.filter` was enough to make every requested capability look in
//     scope, so `delete` was authorized under a grant of `read` (F414);
//   - naming the shape of a payload ran the payload's own `getPrototypeOf`, and a declared `length`
//     of two quadrillion was copied element by element before anything was validated (F408, F409,
//     F417, F418).
//
// So the primitives that used to be reached by a lookup are taken here, once, at load, before any
// caller can run. That settles the reads on this module's own side, and it is the whole of what it
// settles: holding a reference to `hasOwn` is not what stops a polluted prototype, asking it is, and
// `WeakMap.prototype.get`, `Set.add`, `Hash.prototype.update` and `digest`, `RegExp.prototype.exec`,
// `JSON.stringify`, `Buffer.from`, `setTimeout` and `Promise.race` are still live lookups on the way
// out. Code that replaces them, or that reaches this module's exports, owns the process, and the
// boundary above is where this module stops being able to say anything about that. This is a boundary
// against the data, not a sandbox for JavaScript.
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const viewIsArrayBufferView = ArrayBuffer.isView;
const ownKeysOf = Object.keys;
const wholeNumber = Number.isInteger;
const safeInteger = Number.isSafeInteger;
const nullObject = Object.create;
const frozen = Object.freeze;
// The collection walk, for the same reason as the primitives above: `for...of` over anything is a call
// to `Symbol.iterator` looked up on a prototype at the moment it runs, so a host that replaced it
// after this module was loaded would have chosen what the loop saw. One probe caught this: with a
// generator installed on `Array.prototype[Symbol.iterator]`, a grant of `read` registered as `delete`.
const setEach = Set.prototype.forEach;
// The comparison `Array.prototype.sort` performs, held onto as the function itself and not as a
// lookup on the prototype: a host that replaced `Array.prototype.sort` after this module was loaded
// would otherwise decide what a receipt says it covered (B03). The keys and names sorted below are
// all strings, so the order is the UTF-16 order of the strings themselves; the comparator form keeps
// the order a list of records had.
const sortByDefault = Array.prototype.sort;
const defaultSort = (list) => sortByDefault.call(list);
const recordSort = (list, compare) => sortByDefault.call(list, compare);
// The four string primitives this module reaches for, on the same terms. A replaced `trim` would let
// a blank capability name read as a grantable one, and a replaced `includes` would let a wildcard
// through the only place wildcards are refused. `slice` and `valueOf` come along because the same
// argument applies to them and they are the reason text and the text test.
const stringValueOf = String.prototype.valueOf;
const stringTrim = String.prototype.trim;
const stringIncludes = String.prototype.includes;
const stringSlice = String.prototype.slice;
const valueOfString = (value) => stringValueOf.call(value);
const trimmed = (value) => stringTrim.call(value);
const holds = (value, needle) => stringIncludes.call(value, needle);
const head = (value, count) => stringSlice.call(value, 0, count);

// The bound on any list this module copies. A list of capability names is a short list, and a `length`
// is a claim about how much work there is rather than a fact: reading `Number.MAX_SAFE_INTEGER`
// elements before validating a single one of them is a way to stop the process from answering at all
// (F417, F418). The length is checked before the copy starts, because after the copy starts nothing in
// this synchronous function can be interrupted, and the refusal carries this module's own words.
const MAX_LIST_LENGTH = 256;

// How many elements of a caller-supplied array this module reads while naming what it is. The bytes
// are never decoded and never hashed, so the shape sentence is the only thing at stake, and a longer
// array is named as too long to look at rather than walked.
const MAX_SHAPE_SCAN = 65536;

// Copy a list this module built into another list this module owns, by index. No spread, no
// iterator, no method: a caller who replaced `Symbol.iterator` gets nothing to work with here.
function copyList(list) {
  const out = [];
  for (let index = 0; index < list.length; index += 1) out[index] = list[index];
  return out;
}

// `Array.prototype.join`, written out. The reasons below quote lists this module filled with strings,
// and a host that replaced `join` could otherwise write the sentence a host logs.
function joinWith(list, separator) {
  let out = '';
  for (let index = 0; index < list.length; index += 1) {
    if (index > 0) out += separator;
    const item = list[index];
    out += item === null || item === undefined ? '' : item;
  }
  return out;
}

// Copy the own enumerable keys of an object into an object of this module's own, without spreading it.
// A spread asks the source to list its keys and reads each one, which is caller code; this asks the
// same question of an object this module built, with the reference it captured at load.
function copyOwn(source, target) {
  const keys = ownKeysOf(source);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    target[key] = source[key];
  }
  return target;
}

// The four states, spelled once. `verified` / `not_verified` are already receipt states; `discrepant`
// and `not_verifiable` are the two ways a verification can fail without the receipt ladder needing a
// new rung (see RECEIPT_STATUS below).
const SKILL_PROVENANCE_STATUSES = frozen(['verified', 'not_verified', 'discrepant', 'not_verifiable']);

// The four checks a verification can cover. Names are stable: they travel into the receipt's
// `verification.checks`, so a receipt written today reads the same way to `readChecks` as any other.
const PROVENANCE_CHECKS = frozen(['repository', 'commit_exists', 'author', 'content_digest']);

// How a skill status becomes a receipt status. `discrepant` is a claim that evidence refuted, which
// is a failure and not a pause; `not_verifiable` is nothing proven and nothing refuted, which is what
// the ladder already calls `not_verified`. The exact four-valued verdict is not lost: it rides in
// `receipt.skill.provenanceStatus`.
const RECEIPT_STATUS = frozen({
  verified: 'verified',
  not_verified: 'not_verified',
  discrepant: 'failed',
  not_verifiable: 'not_verified',
});

// The registry of record. WeakMaps, not fields: whoever holds a claim can rewrite its fields, so the
// values this module acts on are the ones bound at registration and nothing else (decision 16 —
// authority is granted, it does not emerge from the object you were handed).
const BOUND = new WeakMap();          // claim  -> frozen registration record
const VERIFIED_FOR = new WeakMap();   // result -> the record it was produced for
const DECIDED_FROM = new WeakMap();   // decision -> the record it was decided on
const REGISTERED = new Set();         // read-only listing of the records this process registered

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// SHA-256 is computed over UTF-8 bytes, and UTF-8 cannot carry an unpaired surrogate: the encoder
// replaces it with U+FFFD. So `'head\ud800tail'` and `'head\ufffdtail'` are two different strings that
// hash to the same digest, and a load offering the second one would pass a check that was made on the
// first. The module documents the digest as being over the exact bytes, so the content has to be text
// that survives its own encoding round trip; nothing that used to be refused is refused now, and text
// that a person can read is untouched (A18, review H12).
function wellFormedText(value) {
  return Buffer.from(value, 'utf8').toString('utf8') === value;
}

function canonicalize(value) {
  if (isArray(value)) {
    const list = [];
    for (let index = 0; index < value.length; index += 1) list[index] = canonicalize(value[index]);
    return list;
  }
  if (value !== null && typeof value === 'object') {
    const out = nullObject(null);
    const keys = defaultSort(ownKeysOf(value));
    for (let index = 0; index < keys.length; index += 1) out[keys[index]] = canonicalize(value[keys[index]]);
    return out;
  }
  return value;
}

// The registration record is sealed over exactly what was registered, so two skills that share a name
// and differ in repository produce two different records (the borrowed-name case) while the same
// registration produces the same seal every time.
function seal(record) {
  return sha256(JSON.stringify(canonicalize({
    name: record.name,
    repository: record.repository,
    commit: record.commit,
    author: record.author,
    contentDigest: record.contentDigest,
    authority: record.authority,
  })));
}

// A commit is a fixed object id, never a moving reference. `HEAD`, `main` and a seven-character
// abbreviation all name something whose content can change tomorrow while the string on the claim
// stays the same, and a registry that accepted them would hand out provenance for bytes nobody pinned.
// Git prints full lowercase hex; the two accepted lengths are sha-1 and sha-256.
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// The largest delay a timer can hold on this platform. Node stores a timer in a signed 32-bit
// millisecond count, so anything above this wraps instead of waiting (A14).
const MAX_TIMER_MS = 2147483647;

function text(value) {
  return typeof value === 'string' && trimmed(valueOfString(value)).length > 0;
}

// The two fixes of this review round share one code, A18, and are named apart by the reviewer's own
// case numbers (R201-R206). The code belongs to the round, the cases belong to the defect.
// Reading a field off caller-supplied data can run a getter. Every read here is contained: a hostile
// object fails the check instead of deciding the outcome.
function readString(source, key) {
  try {
    const value = hasOwn(source, key) ? source[key] : undefined;
    return text(value) ? value : null;
  } catch {
    return null;
  }
}

// A boolean flag, read under its own guard and answered with three values instead of two. `null`
// means the resolver did not answer, which is not `false`: it is one check left uncovered, and the
// rest of the answer is still worth reading (A18).
function readFlag(source, key) {
  try {
    const value = hasOwn(source, key) ? source[key] : undefined;
    return value === true ? true : value === false ? false : null;
  } catch {
    return null;
  }
}

// A capability name a person can grant: non-blank text, no wildcard. `read:*` is not expanded into
// `read:project` here. A grant means the exact names on it, and widening it is the person's edit to
// make in the open, not a rule hidden in the kernel.
function capabilityName(value) {
  if (!text(value)) return null;
  const name = valueOfString(value);
  return holds(name, '*') ? null : name;
}

// The one door into this module, and the only place a caller's object is read. Everything a
// registration hands over is read once, here, under its own guard, into an object with no prototype at
// all and only the six keys this contract knows. What the rest of the file works on is that copy, so a
// getter that answers once cannot answer differently later, and a field a host left on
// `Object.prototype` is not a field the registry can see: only what the spec carries as its own reaches
// the copy (F410, F411, G506). The keys are the contract's, so nothing a
// caller wrote on a spec beyond them is even looked at. A shape that cannot be read at all
// (a revoked proxy reaches `isArray` and throws) leaves an empty record behind, and an empty record
// refuses everything with this module's own reasons (review H01, R206).
const REGISTRATION_KEYS = frozen(['name', 'repository', 'commit', 'author', 'content', 'authority']);

function registrationSource(spec) {
  const out = nullObject(null);
  try {
    if (spec === null || typeof spec !== 'object' || isArray(spec)) return out;
    for (let index = 0; index < REGISTRATION_KEYS.length; index += 1) {
      const key = REGISTRATION_KEYS[index];
      try {
        out[key] = hasOwn(spec, key) ? spec[key] : undefined;
      } catch {
        out[key] = undefined;
      }
    }
  } catch {
    // A shape this module cannot even read leaves an empty record behind, and an empty record refuses
    // everything with this module's own reasons. Nothing the caller did is repeated back at them.
  }
  return out;
}

// The grant is captured the same way the request is: by index, out of an array this module checked,
// with a length it validated and every element read exactly once. Nothing the caller put on the
// array is consulted, so the granted authority is the declared list and not what an overridden
// `Symbol.iterator` decides to yield: the same rule the request capture was given (A02), applied to
// the list that decides authority rather than to the one that asks for it (A18, review H04).
//
// Three refusals live here, and all three are about the list rather than its contents. It is not an
// array, its length is not a length, and it is longer than `MAX_LIST_LENGTH`: the last one used to be
// copied first and questioned afterwards, which turns a declared `Number.MAX_SAFE_INTEGER` into a
// synchronous loop that a timer cannot reach (F417, F418). And an index the array does not own is not
// an entry: `new Array(1)` reads `Array.prototype[0]` at every index, so a grant written as a hole
// imported a capability name from the prototype (F412, F413). The copy is dense, owned and built here,
// and everything downstream reads only that.
function captureList(value, label) {
  const names = [];
  try {
    if (!isArray(value)) {
      return { ok: false, names, reason: `${label} must be an array of capability names` };
    }
    const length = value.length;
    if (!safeInteger(length) || length < 0) {
      return { ok: false, names, reason: `${label} could not be read as a list of names` };
    }
    if (length > MAX_LIST_LENGTH) {
      return { ok: false, names, reason: `${label} holds more than ${MAX_LIST_LENGTH} entries, which no list of capability names needs` };
    }
    for (let index = 0; index < length; index += 1) {
      if (!hasOwn(value, index)) {
        return { ok: false, names, reason: `${label} has a gap at index ${index}, so it is not a list of names` };
      }
      names[index] = value[index];
    }
  } catch {
    return { ok: false, names, reason: `${label} could not be read as a list of names` };
  }
  return { ok: true, names, reason: null };
}

function grantedList(value, label) {
  const capture = captureList(value, label);
  if (!capture.ok) throw new Error(capture.reason);
  const names = [];
  for (let index = 0; index < capture.names.length; index += 1) {
    const name = capabilityName(capture.names[index]);
    if (name === null) throw new Error(`${label} must hold capability names without wildcards`);
    if (!listedIn(names, name)) names[index] = name;
  }
  return names;
}

function registerSkillProvenance(spec) {
  const source = registrationSource(spec);
  const name = readString(source, 'name');
  const repository = readString(source, 'repository');
  const commit = readString(source, 'commit');
  const author = readString(source, 'author');
  if (name === null) throw new Error('a skill needs a name');
  if (repository === null) throw new Error('a skill needs the repository it comes from');
  if (commit === null) throw new Error('a skill needs the exact commit it was read at');
  if (!COMMIT_ID.test(commit)) {
    throw new Error(`a skill needs a fixed commit id, not a moving reference: ${head(commit, 64)}`);
  }
  if (author === null) throw new Error('a skill needs the author of that commit');
  const content = source.content;
  if (typeof content !== 'string') throw new Error('a skill needs the content that will be loaded');
  if (!wellFormedText(content)) {
    throw new Error('a skill needs content that is well-formed UTF-8 text, not text carrying unpaired surrogates');
  }
  const authority = frozen(grantedList(source.authority, 'authority'));
  const parts = {
    name,
    repository,
    commit,
    author,
    contentDigest: sha256(content),
    authority,
  };
  const digest = seal(parts);
  const record = frozen({ ...parts, digest });
  BOUND.set(record, record);
  REGISTERED.add(record);
  // The claim the caller holds is a frozen view of the same record, so reading it and acting on it
  // cannot come apart. `BOUND.set(claim, record)` is what makes an unregistered look-alike inert.
  const claim = frozen({
    name: record.name,
    repository: record.repository,
    commit: record.commit,
    author: record.author,
    contentDigest: record.contentDigest,
    authority: frozen(copyList(record.authority)),
    digest: record.digest,
  });
  BOUND.set(claim, record);
  return claim;
}

// Reading the registry. Identity and digests only: the content itself never sits in a list, because
// the list is the part most likely to be logged. The walk is `forEach` and not `for...of`, so it does
// not go through `Set.prototype[Symbol.iterator]`, which is a prototype this module does not own.
function listSkillProvenance() {
  const out = [];
  let count = 0;
  setEach.call(REGISTERED, (record) => {
    out[count] = {
      name: record.name,
      repository: record.repository,
      commit: record.commit,
      author: record.author,
      contentDigest: record.contentDigest,
    };
    count += 1;
  });
  return recordSort(out, (a, b) => (a.name === b.name ? (a.commit < b.commit ? -1 : 1) : (a.name < b.name ? -1 : 1)));
}

function recordOf(claim) {
  try {
    const record = claim !== null && typeof claim === 'object' ? BOUND.get(claim) : null;
    return record !== undefined && record !== null ? record : null;
  } catch {
    return null;
  }
}

// The same private lookup, for the other side of the API: a decision only counts when this kernel is
// the one that decided it. `WeakMap.get` answers `undefined` for a key it never saw, and a gate that
// only tests for `null` lets an object the caller wrote itself straight through (A01).
function deciderRecord(decision) {
  try {
    const record = decision !== null && typeof decision === 'object' ? DECIDED_FROM.get(decision) : null;
    return record !== undefined && record !== null ? record : null;
  } catch {
    return null;
  }
}

// `safeText` in receipt.js drops anything over 512 characters, and a reason longer than that would
// reach a receipt as an empty string anyway. Composing reasons from resolver-reported text is bounded
// per field, but the join of four of them is not, so the cap is applied here rather than discovered
// later as a missing reason.
function short(reason) {
  const value = typeof reason === 'string' ? reason : String(reason);
  return value.length > 512 ? `${head(value, 509)}...` : value;
}

// The checks, as a map with no prototype at all. This is the heart of the fourth round's first class:
// the accumulator used to be a plain object, and the code that asked whether a check had been done
// asked `checks[key] !== undefined`, which is a question about the prototype chain. A host that left
// `repository: true`, `author: true` and `commit_exists: true` on `Object.prototype` — before the
// call, or from a getter this module had already accepted while it read a resolver's answer — got
// three comparisons reported that were never run, a `verified` receipt out of them and a load that
// authorized (F410, F411). With no prototype, an absent key answers `undefined`, and `undefined` is
// not a comparison. Only the sites below write here, and only when they compared.
const newChecks = () => nullObject(null);

// One own-property read of a check. `undefined` means this kernel did not compare that one; nothing
// else in this file may read a check any other way.
function checkOf(checks, key) {
  return hasOwn(checks, key) ? checks[key] : undefined;
}

function withChecks(values) {
  const out = nullObject(null);
  const keys = defaultSort(ownKeysOf(values));
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    out[key] = values[key] === true;
  }
  return frozen(out);
}

function provenanceChecks(values) {
  const out = nullObject(null);
  for (let index = 0; index < PROVENANCE_CHECKS.length; index += 1) {
    const key = PROVENANCE_CHECKS[index];
    out[key] = checkOf(values, key) === true;
  }
  return frozen(out);
}

function coverageOf(checks) {
  const out = [];
  let count = 0;
  for (let index = 0; index < PROVENANCE_CHECKS.length; index += 1) {
    const key = PROVENANCE_CHECKS[index];
    if (checkOf(checks, key) === true) {
      out[count] = key;
      count += 1;
    }
  }
  return out;
}

function notCoveredOf(checks) {
  const out = [];
  let count = 0;
  for (let index = 0; index < PROVENANCE_CHECKS.length; index += 1) {
    const key = PROVENANCE_CHECKS[index];
    if (checkOf(checks, key) !== true) {
      out[count] = key;
      count += 1;
    }
  }
  return out;
}

// Whether all four comparisons were produced and passed. This is the gate `verified` is written
// behind, in both places that can write it: the comparison sites above are the only producers of these
// four own keys, so a check that is absent, inherited or anything but `true` means one comparison did
// not come out equal, and an absent check is an uncovered check rather than a passing one. Reading the
// four booleans without asking whether this kernel put them there is what F410 and F411 did.
function everyCheckPassed(checks) {
  for (let index = 0; index < PROVENANCE_CHECKS.length; index += 1) {
    if (checkOf(checks, PROVENANCE_CHECKS[index]) !== true) return false;
  }
  return true;
}

// Coverage read off every key, for the stages that add checks of their own (the load re-hash). The
// receipt shows what was covered, so a check that ran and passed has to be in the list.
function coveredKeys(checks) {
  const out = [];
  const keys = defaultSort(ownKeysOf(checks));
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (checks[key] === true) out[out.length] = key;
  }
  return out;
}

function uncoveredKeys(checks) {
  const out = [];
  const keys = defaultSort(ownKeysOf(checks));
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (checks[key] !== true) out[out.length] = key;
  }
  return out;
}

// Which of the two things a receipt's `provenance` block is, said out loud instead of left to the
// field name. The block itself is the declaration — it is `provenanceOf(record)`, the values the skill
// was registered with — and a receipt could not say so, so a host that persists receipts had no way
// to tell a verified provenance from a refuted one except by reading the status next to it. That is
// what `provenanceSource` is for, and it is one word:
//
//   'verified'  the four values were each compared and each one matched. Each check is an equality
//               (`found === declared`), so in this state the block is *also* what the resolver
//               observed: the observed value and the declared value are the same string. A verified
//               receipt therefore seals the value that was checked, which is what a reader expects
//               from a field named `provenance`, and it says here that this is the case.
//   'declared'  the values are what the skill claimed and nothing more. Whatever the resolver
//               observed is not in the receipt: this module does not copy the resolver's text into a
//               sealed record (A18, reviews H06-H08, N01, H19), so the refutation lives in `checks`,
//               in `reason` and in `notCovered`, and this word is what keeps the block from reading
//               as evidence.
//
// What this does not buy, stated plainly: 'verified' is a statement about four string comparisons
// against an injected resolver, not about the repository. The resolver's independence is the host's
// (see the header), and nothing here narrows that.
const PROVENANCE_SOURCES = frozen({ verified: 'verified', declared: 'declared' });

// Which of the two things a receipt's `name` is, in the vocabulary `provenanceSource` already taught
// a host reading this same block.
//
// Nothing compares the name. The four comparisons are the repository, the commit, the author and the
// bytes, and the name cannot become a fifth without this kernel knowing which path inside the commit
// holds the artifact — which it does not, and will not guess. A shape check on the name would be
// theatre: a borrowed name with the shape of a path would pass it (the borrowed-name case the study
// found, several unrelated repositories publishing a skill called `superpowers`). So the name stays
// what it is and always was, a search hint a host uses to find the skill again, and the receipt says
// in one word that nobody checked it.
//
// One word is the whole vocabulary: there is no second value to reach for, because there is no state
// in which this kernel could honestly write the other one. The label is this constant and never a
// field read from the decision, so nothing a host, a resolver or a hand-written decision can write can
// promote a declared name into a checked identity (P2b finding 4.3; decided by the owner on
// 2026-10-04, option B of the H-P report).
const NAME_SOURCE = 'declared';

function refuse(record, reason) {
  // No record means nothing can be covered: a claim this kernel never registered has no provenance to
  // check, so all four checks are reported as not covered rather than quietly passing. Nothing was
  // hashed on the way here either, so `contentRecomputed` is false.
  const checks = provenanceChecks(nullObject(null));
  const result = frozen({
    status: 'not_verifiable',
    provenanceStatus: 'not_verifiable',
    reason: short(reason),
    checks,
    coverage: frozen(coverageOf(checks)),
    notCovered: frozen(notCoveredOf(checks)),
    provenance: record === null ? null : provenanceOf(record),
    contentRecomputed: false,
  });
  if (record !== null) VERIFIED_FOR.set(result, record);
  return result;
}

function provenanceOf(record) {
  return frozen({
    repository: record.repository,
    commit: record.commit,
    author: record.author,
    contentDigest: record.contentDigest,
  });
}

// `contentRecomputed` is computed here and nowhere else: true only when the resolver handed over text
// and this kernel ran SHA-256 over those bytes. False when the check compared a digest the resolver
// wrote, or when no content arrived at all. A resolver cannot assert it — the flag is not read from
// the evidence — so a receipt can say whether the digest in it came from bytes or from a claim (A17).
function settle(record, status, reason, checks, contentRecomputed) {
  // Every one of the four checks is present and boolean here, so `checks` cannot answer `undefined`
  // for a check this kernel did not cover while `coverage` and `notCovered`, read off the same object,
  // do report it. A check that was left unanswered is reported as false, never as absent.
  const values = copyOwn(provenanceChecks(checks), nullObject(null));
  copyOwn(checks, values);
  const sealed = withChecks(values);
  const result = frozen({
    status,
    provenanceStatus: status,
    reason: short(reason),
    checks: sealed,
    coverage: frozen(coverageOf(sealed)),
    notCovered: frozen(notCoveredOf(sealed)),
    provenance: provenanceOf(record),
    contentRecomputed: contentRecomputed === true,
  });
  // Bound to the record, so this result cannot be replayed against another skill later.
  VERIFIED_FOR.set(result, record);
  return result;
}

// The resolver answers one question: is this repository, at this commit, by this author, these bytes?
// A resolver that is handed more than that can be talked into more than that.
//
// The deadline rejects with a value this module made, so a missed deadline can be told apart from
// anything the resolver threw without reading what it threw. The timer is not `unref`'d: this
// function owes an answer, and a process whose only handle is this deadline would otherwise exit
// before printing one (A15).
const DEADLINE = frozen({ deadline: true });

async function askResolver(resolve, question, timeoutMs) {
  if (timeoutMs === undefined) return await resolve(question);
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(resolve(question)),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(DEADLINE), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

// One check, one reason. Every comparator is exact: no URL normalization, no case folding, no author
// parsing. Two spellings of the same repository are two claims until the person writes one, and the
// disagreement is visible in the receipt instead of resolved silently here. A field the resolver left
// unanswered is not a disagreement: the check stays undefined and is reported as not covered.
//
// What the reported value is not given is a place in the reason. The resolver is the party being
// checked, it may put anything it likes in `author`, and the rule this module already applies to a
// thrown value (A05, A06) applies to the fields it answers with: the text belongs to whoever
// produced it. The declared value needs no repetition either, since the disagreement is already
// readable in `checks` and the declared value is already in `provenance` (A18, review H06).
function compare(label, declared, found, checks) {
  if (found === null) return null;
  if (found !== declared) {
    checks[label] = false;
    return `the ${label} the resolver reported is not the one declared`;
  }
  checks[label] = true;
  return null;
}

// What arrived where the contract asks for text. A host whose resolver reads the file out of a
// repository hands over a `Buffer`, a typed array, or the spread of one, and all three read from here
// as exactly what a resolver that said nothing reads as: `the resolver reported neither the content
// at that commit nor its digest`. That sentence is true and it is useless — it cost the P2b
// integration an hour of debugging for a refusal that was correct from the start (P2b finding 4.2).
//
// The bytes are not decoded. Decoding is an interpretation and this module does not pick one on the
// resolver's behalf: two decodings of one buffer disagree about what the skill is. The verdict was
// never in question either — nothing was hashed, so nothing could be covered on the digest — only the
// sentence was. Every read here is contained, so a payload that throws while being inspected is
// reported, not raised.
//
// None of the checks below reaches user code, and that is now the reason they are written the way
// they are rather than a claim about it. `Buffer.isBuffer` is an `instanceof`, and an `instanceof`
// walks the prototype chain, so naming a payload was a way to run the payload's own `getPrototypeOf`:
// a revoked proxy turned the API into a rejection and a live trap threw the party's own text out of
// the module (F408, F409). `ArrayBuffer.isView` asks the internal slot of the value instead and
// answers false for every proxy without reaching a trap, so the value that gets past it is a real
// view with nothing caller-controlled on it, and `constructor` is the one read that can tell a Buffer
// from any other typed array. `Array.isArray` also answers without a trap, but it throws on a revoked
// one, so the whole body is inside a guard and a shape that cannot be read gets a fixed sentence.
function byteShapeOf(value) {
  try {
    if (value === null || value === undefined) return null;
    if (viewIsArrayBufferView(value)) {
      return value.constructor === Buffer ? 'a Buffer' : 'a typed array of bytes';
    }
    if (!isArray(value)) {
      return typeof value === 'object' ? 'an object that is not text' : `a ${typeof value}`;
    }
    const length = value.length;
    if (!safeInteger(length) || length <= 0) return 'an array that is not text';
    if (length > MAX_SHAPE_SCAN) return 'an array too long to name here';
    for (let index = 0; index < length; index += 1) {
      // `hasOwn` before the read, for the reason every other read of the caller's data has it: an
      // index this array does not own is answered by `Array.prototype`, and three numbers left there
      // named a payload of three holes as bytes. The payload is not hashed either way, so this is
      // about the sentence being true and not about the verdict.
      if (!hasOwn(value, index) || typeof value[index] !== 'number') return 'an array that is not text';
    }
    return 'an array of bytes';
  } catch {
    return 'a payload whose shape could not be read';
  }
}

// The refusal for a content field that is not text. `null` is not a shape: nothing arrived, and that
// is the sentence this module has always used for it.
function contentRefusal(content) {
  const shape = byteShapeOf(content);
  if (shape === null) return 'the resolver reported neither the content at that commit nor its digest';
  return `the content arrived as ${shape} and this contract is text, so no digest could be compared`;
}

async function verifySkillProvenance(claim, resolve, options = {}) {
  const record = recordOf(claim);
  if (record === null) {
    return refuse(null, 'this skill was not registered in this kernel: there is no provenance to verify');
  }
  const settings = options !== null && typeof options === 'object' ? options : {};
  let timeoutMs;
  try {
    timeoutMs = hasOwn(settings, 'timeoutMs') ? settings.timeoutMs : undefined;
  } catch {
    throw new Error(`timeoutMs must be a whole number of milliseconds between 1 and ${MAX_TIMER_MS}`);
  }
  // The range is the platform's, not this module's preference: a timer set outside it does not keep
  // the value that was asked for, it becomes 1 ms and warns (A14). A deadline that silently becomes
  // another deadline is a deadline nobody granted.
  if (timeoutMs !== undefined && (!wholeNumber(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_MS)) {
    throw new Error(`timeoutMs must be a whole number of milliseconds between 1 and ${MAX_TIMER_MS}`);
  }
  if (typeof resolve !== 'function') {
    return refuse(record, 'no resolver was injected: nothing outside the skill has answered yet');
  }
  // The question carries the location of the evidence and nothing else: the name, so a resolver can
  // find the skill inside the repository, the repository, and the exact commit. The declared author
  // and the declared content digest are withheld, because those are the two answers this kernel asks
  // the resolver to produce. Handing them over made the cheapest possible resolver, one that returns
  // the question it was given with a flag, verified provenance out of nothing (D1, review N05).
  // Independence at this door is the kernel's; what the resolver does with the location it was given
  // is the host's, and a host that passes the declaration to its own resolver hands back an answer
  // this kernel cannot tell from an honest observation.
  const question = frozen({
    name: record.name,
    repository: record.repository,
    commit: record.commit,
  });
  let evidence;
  try {
    evidence = await askResolver(resolve, question, timeoutMs);
  } catch (err) {
    // The thrown value belongs to whoever threw it: it can carry a token, a path, or a `message`
    // getter that throws a second time while the kernel tries to report the first. None of it is
    // read, and none of it is written into a reason that can end up inside a receipt (A05, A06). The
    // only thing read here is the identity of the deadline, which this module made itself.
    return refuse(record, err === DEADLINE
      ? 'the resolver did not answer in time'
      : 'the resolver did not answer: the call was refused or rejected');
  }
  if (evidence === null || typeof evidence !== 'object' || isArray(evidence)) {
    return refuse(record, 'the resolver answered with something that is not a record of evidence');
  }
  // Three answers that carry the declaration instead of evidence about it. The question is what this
  // kernel asked, so handing it back proves nothing. The registration record and the claim view are
  // this kernel's own copy of the declaration: whoever holds one can hand it straight back, and what
  // the skill said about itself is not what it asked to be checked against. A copy of either that
  // still carries the registration seal is refused for the same reason. A copy with the seal stripped
  // is indistinguishable from an honest observation, and that is a limit, not a check (D1).
  if (evidence === question || recordOf(evidence) !== null || readString(evidence, 'digest') === record.digest) {
    return refuse(record, 'the resolver answered with the declaration instead of with evidence of its own');
  }

  const checks = newChecks();
  const refuted = [];

  // A stage that stops early must not erase a refutation an earlier stage already found: `exists:
  // false` is still `discrepant` when the resolver also left the repository out of its answer
  // (A07). What was refuted stays refuted, whatever came up unanswered after it.
  //
  // Nor may stopping early erase the checks that did run. Three successful comparisons are a fact
  // about what this kernel verified, and reporting them as a bare refusal with empty coverage hands
  // the reader a weaker record than the code actually holds (A18, review R203). Nothing was hashed on
  // the way here, so `contentRecomputed` is false.
  function stoppedAt(reason) {
    if (refuted.length > 0) {
      return settle(record, 'discrepant', `${joinWith(refuted, '; ')}; ${reason}`, checks, false);
    }
    return settle(record, 'not_verifiable', reason, checks, false);
  }

  // Every field is read exactly once, and each one under its own guard. A single guard around all of
  // them let a getter that throws on `content` take the whole answer down with it, including an
  // `exists: false` sitting right beside it: a field nobody could read is a field nobody answered,
  // which is never a refutation and must never be able to hide one (A18, review R204, R205). Nothing
  // thrown here is read, inspected or copied into a reason.
  const exists = readFlag(evidence, 'exists');
  const repository = readString(evidence, 'repository');
  const author = readString(evidence, 'author');
  const evidenceCommit = readString(evidence, 'commit');
  const contentDigest = readString(evidence, 'contentDigest');
  let content = null;
  try {
    content = hasOwn(evidence, 'content') ? evidence.content : null;
  } catch {
    content = null;
  }

  // The commit has to be there at all, and the evidence has to be about *this* commit. `exists: true`
  // with no id says that some commit exists somewhere; the question was about one particular id, so
  // without the id nothing is covered and nothing is refuted. Evidence about another id answers a
  // question nobody asked, and that is a refutation (A04). An unanswered `exists` says nothing at
  // all, so `commit_exists` is left uncovered and the repository, the author and the content are
  // still compared below: one missing field does not decide the other three.
  if (exists === false) {
    checks.commit_exists = false;
    refuted[refuted.length] = `commit ${record.commit} is not in ${record.repository}`;
  } else if (exists === true && evidenceCommit !== null) {
    if (evidenceCommit !== record.commit) {
      checks.commit_exists = false;
      refuted[refuted.length] = `the resolver answered about a commit that is not the one declared (${head(record.commit, 120)})`;
    } else {
      checks.commit_exists = true;
    }
  }

  const repoReason = compare('repository', record.repository, repository, checks);
  if (repoReason !== null) refuted[refuted.length] = repoReason;
  const authorReason = compare('author', record.author, author, checks);
  if (authorReason !== null) refuted[refuted.length] = authorReason;

  // Bytes beat a digest string. If the resolver brought the content, the digest is computed here and
  // the string it may also have written is not consulted.
  const hasContent = typeof content === 'string';
  const hasDigest = contentDigest !== null;
  if (!hasContent && !hasDigest) {
    return stoppedAt(contentRefusal(content));
  }
  const resolvedDigest = hasContent ? sha256(content) : contentDigest;
  const contentRecomputed = hasContent;
  if (resolvedDigest !== record.contentDigest) {
    checks.content_digest = false;
    // The prefix of the digest that was reported is quoted only when this kernel computed it. When
    // the resolver sent a digest instead of bytes, that prefix is its own text, and the rule this
    // module applies to everything else the resolver writes applies to it: it does not get quoted
    // back. The digest that was registered is this module's, and it is the one worth naming (N01).
    const reported = hasContent
      ? `the content at ${head(record.commit, 12)} hashes to ${head(resolvedDigest, 12)}`
      : `the digest the resolver reported for ${head(record.commit, 12)}`;
    refuted[refuted.length] = `${reported}, not to the digest of what was registered (${head(record.contentDigest, 12)})`;
  } else {
    checks.content_digest = true;
  }

  // An explicit false outranks an unanswered field: a resolver that refuted the author and left the
  // repository out has discrepant provenance, not merely unverifiable provenance.
  //
  // Both lists are read as own properties, so an unanswered check and an inherited one are the same
  // thing here: neither is a comparison. That is the whole of F410 and F411 — `known` used to be
  // `checks[key] !== undefined`, which the prototype could answer, so three checks nobody ran counted
  // as answered and the verdict below came out `verified`.
  const unknown = notCoveredOf(checks);
  const failures = [];
  const keys = ownKeysOf(checks);
  for (let index = 0; index < keys.length; index += 1) {
    if (checks[keys[index]] === false) failures[failures.length] = keys[index];
  }
  if (failures.length > 0) {
    // The flag travels with the refutation too. SHA-256 ran over the bytes before the verdict was
    // known, so a mismatch is a recomputation that happened, and dropping it here would have the
    // receipt claim the digest came from a string the resolver wrote (A18, review R201, R202).
    return settle(record, 'discrepant', joinWith(refuted, '; '), checks, contentRecomputed);
  }
  if (unknown.length > 0) {
    return settle(record, 'not_verifiable', `the resolver left ${joinWith(unknown, ', ')} unanswered, so nothing can be covered there`, checks, contentRecomputed);
  }
  if (!everyCheckPassed(checks)) {
    // Unreachable while the comparison sites above are the only producers, and kept on purpose: the
    // word `verified` is not written from four booleans, it is written from four comparisons that
    // this kernel ran.
    return settle(record, 'not_verifiable', 'not every comparison behind this result was produced here, so nothing is verified', checks, contentRecomputed);
  }
  return settle(record, 'verified', 'the resolver reported this repository, commit, author and content, and all four match', checks, contentRecomputed);
}

// Membership by plain loop. The lists compared here are built by this module, and no method handed
// over by the caller ever decides whether authority widens.
function listedIn(list, value) {
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === value) return true;
  }
  return false;
}

// One capture, one truth. A caller-supplied array can be re-read: a getter, an iterator and an
// overridden `filter` are free to answer differently every time, so a scope check over the original
// array and a snapshot of it are two different lists, and the second one wins. The request is
// therefore read exactly once, into an array this function owns, and names, duplicates, scope and the
// `requested` the decision reports all read only that copy. A capture that cannot be completed (a
// length that is not a length, a getter that throws) is refused with a fixed reason: nothing the
// caller did is repeated back at them (A02, A03, A16).
//
// `Array.isArray` is inside the guard for the same reason and not only for the revoked-proxy case: it
// reads the proxy's target, and a caller who revoked the proxy before handing it over would otherwise
// get a `TypeError` out of `authorizeSkill` instead of a refusal. Whether the value is an array at
// all still reads as its own fixed reason, and the refusal is the same either way (A18, review R206).
function captureRequest(value) {
  return captureList(value, 'the requested authority');
}

// The authority question, kept apart from the load question: may this skill act, and within what the
// person granted. Bytes belong to `loadSkill`, where the time-of-check gap actually opens.
function authorizeSkill(claim, result, requested) {
  const record = recordOf(claim);
  const provenance = record === null ? null : provenanceOf(record);
  const base = { provenance, name: record === null ? null : record.name, granted: record === null ? [] : copyList(record.authority) };
  // Read off the linked result, not off anything the caller passed: only this kernel knows whether it
  // hashed the bytes or believed a digest string. It stays false until a result of this kernel's own
  // has been found, because nothing else can set it.
  let contentRecomputed = false;

  // A refusal reports the coverage it really has: a request out of scope does not erase the three
  // provenance checks that passed, and a provenance that failed does not invent an `authority_scope`
  // problem that was never checked. `provenanceStatus` is the provenance on its own and `status` is
  // what this stage decided, so asking for a capability outside the grant does not turn a verified
  // provenance into an unverified one (A09).
  function refuseDecision(status, reason, provenanceValues, extra, provenanceStatus) {
    const values = nullObject(null);
    for (let index = 0; index < PROVENANCE_CHECKS.length; index += 1) {
      const key = PROVENANCE_CHECKS[index];
      values[key] = checkOf(provenanceValues, key) === true;
    }
    for (let index = 0; index < extra.length; index += 1) values[extra[index]] = false;
    const checks = withChecks(values);
    const decision = frozen({
      authorized: false,
      status,
      provenanceStatus,
      reason: short(reason),
      checks,
      coverage: frozen(coveredKeys(checks)),
      notCovered: frozen(uncoveredKeys(checks)),
      provenance: base.provenance,
      name: base.name,
      granted: frozen(copyList(base.granted)),
      requested: frozen([]),
      contentRecomputed,
    });
    DECIDED_FROM.set(decision, record);
    return decision;
  }

  if (record === null) {
    return refuseDecision('not_verifiable', 'this skill was not registered in this kernel, so no authority can be granted', nullObject(null), [], 'not_verifiable');
  }
  if (result === null || typeof result !== 'object' || VERIFIED_FOR.get(result) !== record) {
    return refuseDecision('not_verifiable', 'this verification result was not produced for this skill by this kernel', nullObject(null), [], 'not_verifiable');
  }
  const provenanceStatus = result.status;
  // The result is this kernel's own, and `settle` sealed its checks as an object of its own, so these
  // are read as own properties: a check this kernel never compared is not one the grant may lean on.
  const incomingChecks = result.checks !== null && typeof result.checks === 'object' ? result.checks : nullObject(null);
  contentRecomputed = result.contentRecomputed === true;

  // The scope of the request cannot decide the status on its own. A refuted provenance stays a
  // refutation whichever capability is asked for: otherwise the rule that runs first in this
  // function gets to pick the receipt, and whoever holds a refuted skill picks the softer one by
  // asking for something nobody granted. `provenanceStatus` keeps saying `discrepant` either way, so
  // this only aligns the status of the decision and of the receipt with it (review N04).
  const scopeStatus = provenanceStatus === 'discrepant' ? 'discrepant' : 'not_verified';

  const capture = captureRequest(requested);
  if (!capture.ok) {
    return refuseDecision(scopeStatus, capture.reason, incomingChecks, ['authority_scope'], provenanceStatus);
  }
  const ask = capture.names;
  let malformed = null;
  if (ask.length === 0) {
    // Nothing asked for is nothing granted. A decision that says `authorized` for an empty request
    // would be a receipt with no authority in it, which reads like a clean bill of health.
    malformed = 'no capability was requested, so there is no authority to grant';
  } else {
    const seen = [];
    for (let index = 0; index < ask.length && malformed === null; index += 1) {
      let name = null;
      try {
        name = capabilityName(ask[index]);
      } catch {
        malformed = 'the requested authority could not be read as a list of names';
      }
      if (malformed !== null) break;
      if (name === null) {
        malformed = 'the requested authority must hold capability names without wildcards';
      } else if (listedIn(seen, name)) {
        malformed = 'the requested authority repeats a capability';
      } else {
        ask[index] = name;
        seen[seen.length] = name;
      }
    }
  }
  if (malformed !== null) {
    return refuseDecision(scopeStatus, malformed, incomingChecks, ['authority_scope'], provenanceStatus);
  }
  // The out-of-scope names, found by walking the captured copy. This used to be
  // `ask.filter((item) => !listedIn(record.authority, item))`, which consults `Array.prototype.filter`
  // *after* the caller's getters have already run inside the capture: a getter that set `filter` to
  // return `[]` made every requested capability look granted, and a grant of `read` authorized
  // `delete` (F414). One index at a time, over an array this module built, is the whole fix, and it
  // only holds because `copyList` and `captureList` built that array themselves.
  const outside = [];
  for (let index = 0; index < ask.length; index += 1) {
    if (!listedIn(record.authority, ask[index])) outside[outside.length] = ask[index];
  }
  if (outside.length > 0) {
    return refuseDecision(
      scopeStatus,
      `the person granted ${record.authority.length === 0 ? 'no capability at all' : joinWith(record.authority, ', ')}, and ${joinWith(outside, ', ')} is not among them`,
      incomingChecks,
      ['authority_scope'],
      provenanceStatus,
    );
  }
  // Authority is granted only when every one of the four comparisons was produced here and passed, and
  // not merely because a status field says `verified`. The link above already proves the result is this
  // kernel's own; this proves what is inside it (F410, F411).
  if (provenanceStatus !== 'verified' || !everyCheckPassed(incomingChecks)) {
    return refuseDecision(
      provenanceStatus === 'verified' ? 'not_verified' : provenanceStatus,
      `the provenance of this skill is ${provenanceStatus}, so no authority is granted`,
      incomingChecks,
      [],
      provenanceStatus,
    );
  }
  const checks = withChecks(incomingChecks);
  const decision = frozen({
    authorized: true,
    status: 'verified',
    provenanceStatus: 'verified',
    reason: result.reason,
    checks,
    coverage: frozen(coveredKeys(checks)),
    notCovered: frozen(uncoveredKeys(checks)),
    provenance: base.provenance,
    name: base.name,
    granted: frozen(copyList(base.granted)),
    requested: frozen(copyList(ask)),
    contentRecomputed,
  });
  DECIDED_FROM.set(decision, record);
  return decision;
}

// Time-of-check to time-of-use. The verification compared the digest of the bytes that were
// registered; loading is a later moment and a later set of bytes, so they are hashed again here and a
// mismatch is a refutation, not a warning. Nothing about the digest is carried over from the result:
// it is recomputed from the bytes in hand.
function loadSkill(claim, result, content, requested) {
  const record = recordOf(claim);
  const decision = authorizeSkill(claim, result, requested);
  let loaded = null;
  let loadReason = 'the content offered for loading is not text, so no digest can be compared';
  try {
    if (typeof content !== 'string') {
      loaded = null;
    } else if (!wellFormedText(content)) {
      // Refused for the same reason it cannot be registered: two different strings hash alike here, so
      // a matching digest would not say which of them was the text that was verified.
      loaded = null;
      loadReason = 'the content offered for loading carries unpaired surrogates, so it cannot be the text whose digest was verified';
    } else {
      loaded = sha256(content);
    }
  } catch {
    loaded = null;
  }
  if (loaded === null) {
    return withLoad(decision, record, loaded, false, 'discrepant', loadReason);
  }
  if (record === null) {
    // The bytes were hashed, and that is all that happened. Hashing is not a comparison: with no
    // registered digest there is nothing to compare against, so the check is not covered (A08).
    return withLoad(decision, record, loaded, false, decision.status, decision.reason);
  }
  if (loaded !== record.contentDigest) {
    return withLoad(decision, record, loaded, false, 'discrepant', `the content offered for loading hashes to ${head(loaded, 12)}, not to the verified digest ${head(record.contentDigest, 12)}: it changed between the check and the load`);
  }
  return withLoad(decision, record, loaded, true, decision.status, decision.reason);
}

// A load is the decision plus what the bytes turned out to hash to. The digest is recomputed from the
// bytes in hand and nothing is carried over from the verification, so the receipt says what was
// loaded rather than what was checked.
function withLoad(decision, record, loadedDigest, matched, status, reason) {
  const values = copyOwn(decision.checks, nullObject(null));
  values.loaded_content_digest = matched === true;
  const rechecked = withChecks(values);
  const loaded = frozen({
    authorized: matched === true ? decision.authorized : false,
    status,
    // The provenance is the one the decision carried. A load that found different bytes is a
    // discrepancy of the load, and it says so in `status` and in `loaded_content_digest`; it is not
    // a claim that the provenance of the skill stopped being what it was (A09).
    provenanceStatus: decision.provenanceStatus,
    reason: short(reason),
    checks: rechecked,
    coverage: frozen(coveredKeys(rechecked)),
    notCovered: frozen(uncoveredKeys(rechecked)),
    provenance: decision.provenance,
    name: decision.name,
    granted: decision.granted,
    requested: decision.requested,
    loadedDigest,
    contentRecomputed: decision.contentRecomputed === true,
  });
  if (record !== null) DECIDED_FROM.set(loaded, record);
  return loaded;
}

// One field of the receipt spec, read once, under its own guard. `undefined` for a field that is
// absent, that is not an object, or that could not be read: `buildReceipt` already substitutes a safe
// value for every one of the seven, so an unreadable top-level field produces an ordinary receipt
// that says nothing. What lives inside a field is a step further down and is not contained:
// `buildReceipt` reads `operation.id`, `authority.spend` and the rest without guards, so a hostile
// getter nested in `operation` or `authority` still throws to the caller. That code is base and
// unchanged here, so this comment names the boundary instead of promising a crash it cannot prevent
// (review N08).
function receiptField(spec, key) {
  try {
    return spec !== null && typeof spec === 'object' && hasOwn(spec, key) ? spec[key] : undefined;
  } catch {
    return undefined;
  }
}

// The receipt. Built through `buildReceipt` so coverage, `notCovered`, the anchor and the digest all
// come from the same place they come from for any other receipt, and then sealed again with the skill
// block attached — the block is inside the seal, which is what makes a skill swapped between two
// receipts of the same operation visible instead of plausible.
//
// The spec is caller-supplied data like any other, so it is read field by field under guards and never
// spread: `{...spec}` enumerates keys the caller controls, and a revoked proxy or a throwing getter in
// any of the seven top-level fields `buildReceipt` reads threw out of this function into someone else's
// control flow. `buildReceipt` destructures exactly those seven, so nothing else the caller wrote
// could have reached the receipt through a spread of them; a value nested inside one of them is not
// covered by that sentence (A18, review H09; review N08). `outcome` is the sixth caller-supplied
// field and is read the same way now (N02, N03).
function buildSkillReceipt(spec, decision) {
  const record = deciderRecord(decision);
  if (record === null) {
    throw new Error('a skill receipt needs a decision this kernel produced');
  }
  const status = hasOwn(RECEIPT_STATUS, decision.status) ? decision.status : 'not_verified';
  // The same mapping for the provenance verdict, written out instead of left to be remembered:
  // `not_verifiable` and `not_verified` both write `not_verified` in the ladder, so a host reading
  // `status` alone cannot tell which layer it is looking at. `provenanceStatus` keeps the exact
  // verdict and this field says how that verdict lands in the status ladder, so neither has to be
  // guessed from the other (P2b finding 4.4).
  const provenanceVerdict = hasOwn(RECEIPT_STATUS, decision.provenanceStatus) ? decision.provenanceStatus : 'not_verified';
  const rawOutcome = receiptField(spec, 'outcome');
  const outcome = rawOutcome !== null && typeof rawOutcome === 'object' ? rawOutcome : {};
  const receipt = buildReceipt({
    operation: receiptField(spec, 'operation'),
    capabilityId: receiptField(spec, 'capabilityId'),
    authority: receiptField(spec, 'authority'),
    evidence: receiptField(spec, 'evidence'),
    decidedBy: receiptField(spec, 'decidedBy'),
    at: receiptField(spec, 'at'),
    // `outcome` is the sixth caller-supplied field, so it is read the same way as the other five and
    // never spread. `{ ...outcome }` asked the object to list its own keys: a revoked proxy answers
    // no `ownKeys`, and a getter that throws on `detail` ran while the spread read it. Only the five
    // fields `buildReceipt` reads out of `outcome` are passed on, each already read once under its
    // own guard, so nothing else the caller wrote on that object is even looked at (N02, N03).
    outcome: {
      exercised: receiptField(outcome, 'exercised'),
      detail: receiptField(outcome, 'detail'),
      reason: receiptField(outcome, 'reason'),
      exit: receiptField(outcome, 'exit'),
      decidedBy: receiptField(outcome, 'decidedBy'),
      status: RECEIPT_STATUS[status],
    },
    verification: {
      verified: status === 'verified',
      checks: decision.checks,
      reason: decision.reason,
    },
  });
  receipt.skill = frozen({
    name: decision.name,
    // The name the skill was registered under, and the word that says nothing here checked it. Placed
    // right under the name so a reader cannot reach the value without reading its label, and derived
    // from nothing the decision carries, so it cannot arrive as evidence (P2b finding 4.3).
    nameSource: NAME_SOURCE,
    status,
    provenanceStatus: decision.provenanceStatus,
    provenanceReceiptStatus: RECEIPT_STATUS[provenanceVerdict],
    // Which of the two things `provenance` is, so the block stops being read as evidence in every case
    // but the one where it is (P2b finding 4.1). Derived from the verdict, so nothing the decision or
    // the resolver wrote can promote a declaration to a verified one.
    provenanceSource: provenanceVerdict === 'verified'
      ? PROVENANCE_SOURCES.verified
      : PROVENANCE_SOURCES.declared,
    // Copied and ordered with the references this module took at load, so a host that replaced
    // `Array.prototype.sort` after this module was loaded cannot change what a receipt says it covered.
    coverage: defaultSort(copyList(decision.coverage)),
    notCovered: defaultSort(copyList(decision.notCovered)),
    granted: copyList(decision.granted),
    requested: copyList(decision.requested),
    // The declaration, sealed as the declaration: `provenanceSource` is what says so.
    provenance: copyOwn(decision.provenance, {}),
    reason: decision.reason,
    loadedDigest: decision.loadedDigest === undefined ? null : decision.loadedDigest,
    contentRecomputed: decision.contentRecomputed === true,
  });
  // `buildReceipt` sealed the body without the skill block; sealing again puts the block inside. The
  // anchor stays `pending` and is outside the digest, so this cannot move it.
  receipt.digest = computeDigest(receipt);
  return receipt;
}

// What the fourth round changed in what a caller can observe. None of it is a published API: the
// seven exports below keep their names and their types, and a receipt built without any of it keeps
// its digest (360 receipts across four registrations, fifteen shapes of evidence and six requests were
// compared byte for byte against the previous revision). What a reader of a receipt can see:
//   - two new refusals from `captureList`, both with this module's own words: a gap in the list at a
//     named index, and a list longer than `MAX_LIST_LENGTH`. Both are refusals where the list used to
//     be accepted, and both leave `authority_scope` false.
//   - two new sentences from `byteShapeOf`: `a payload whose shape could not be read` replaces
//     `an array that could not be read` for anything that throws while being inspected, and an array
//     past `MAX_SHAPE_SCAN` is named too long to name instead of walked. The bytes were never decoded
//     and are still not, so the verdict of every one of these is unchanged: `content_digest` uncovered.
//   - `checks`, `verification.checks` and every coverage map are now objects with no prototype. The
//     own keys, their order and their values are the same, so a receipt reads the same and hashes the
//     same; what changed is that a key this kernel did not write cannot be answered by a prototype.
//   - `authorizeSkill` can answer `not_verified` for a result whose status says `verified` and whose
//     four checks were not all produced here. That state was unreachable before and is refused rather
//     than trusted now, which is the point of the gate.
//
// What the fifth round changed in what a caller can observe. Same rule: the seven exports keep their
// names and their types, and a receipt built without any of it keeps its digest. Two things a caller
// can see, both about data rather than about the API:
//   - a spec, an options object, a receipt spec or a piece of evidence whose field is not its own is
//     now read as absent where the prototype would have answered. A resolver that returned
//     `{ content }` under a polluted `Object.prototype` used to reach `verified` with three
//     comparisons it never ran; it is `not_verifiable` now, and the reason names what was left
//     unanswered (G506, G514, G515).
//   - one sentence from `byteShapeOf`: an array with a hole in it is named `an array that is not text`
//     even when a number on `Array.prototype` answers the missing index (B05). The verdict of a byte
//     payload is unchanged, as it was in the fourth round: `content_digest` uncovered, load refused.
// And one thing this round took out of the contract rather than into it: replacing a built-in function
// after this module was loaded is now a declared limit (the header says so, and the seven attacks that
// show it are in the suite marked `todo` so the edge stays visible instead of being forgotten).
module.exports = {
  registerSkillProvenance,
  verifySkillProvenance,
  authorizeSkill,
  loadSkill,
  buildSkillReceipt,
  listSkillProvenance,
  SKILL_PROVENANCE_STATUSES,
};
