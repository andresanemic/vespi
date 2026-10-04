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
//   - What the kernel can check is checked by the kernel. If the resolver hands over bytes, the digest
//     is computed here. A resolver that reports a matching digest string while shipping different
//     bytes is refuted, not believed (decision 22: the verification record is computed by the code,
//     not asserted by the agent).
//   - Nothing on the claim is trusted, including fields written after registration. The registered
//     values live in a private binding, the way the bound orchestrator lives in `delegation.js` (S11):
//     a claim that anyone can rewrite is not a grant, it is a suggestion.
//
// What this does NOT buy, stated plainly. It proves that an injected resolver said the repository,
// the commit, the author and the bytes line up with what was declared. It does not prove the resolver
// told the truth: a resolver pointed at an attacker's own fork answers honestly about that fork. It
// does not authenticate the person who registered the skill. It does not read the network, so a
// correct answer has to be brought to it. And it does not vet what the skill *does* — that is the
// granted authority, checked exactly, and the rest is the person's decision.

const { createHash } = require('node:crypto');
const { buildReceipt, computeDigest } = require('./receipt.js');

// The four states, spelled once. `verified` / `not_verified` are already receipt states; `discrepant`
// and `not_verifiable` are the two ways a verification can fail without the receipt ladder needing a
// new rung (see RECEIPT_STATUS below).
const SKILL_PROVENANCE_STATUSES = Object.freeze(['verified', 'not_verified', 'discrepant', 'not_verifiable']);

// The four checks a verification can cover. Names are stable: they travel into the receipt's
// `verification.checks`, so a receipt written today reads the same way to `readChecks` as any other.
const PROVENANCE_CHECKS = Object.freeze(['repository', 'commit_exists', 'author', 'content_digest']);

// How a skill status becomes a receipt status. `discrepant` is a claim that evidence refuted, which
// is a failure and not a pause; `not_verifiable` is nothing proven and nothing refuted, which is what
// the ladder already calls `not_verified`. The exact four-valued verdict is not lost: it rides in
// `receipt.skill.provenanceStatus`.
const RECEIPT_STATUS = Object.freeze({
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
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

function text(value) {
  return typeof value === 'string' && value.valueOf().trim().length > 0;
}

// Reading a field off caller-supplied data can run a getter. Every read here is contained: a hostile
// object fails the check instead of deciding the outcome.
function readString(source, key) {
  try {
    const value = source[key];
    return text(value) ? value : null;
  } catch {
    return null;
  }
}

// A capability name a person can grant: non-blank text, no wildcard. `read:*` is not expanded into
// `read:project` here. A grant means the exact names on it, and widening it is the person's edit to
// make in the open, not a rule hidden in the kernel.
function capabilityName(value) {
  if (!text(value)) return null;
  const name = value.valueOf();
  return name.includes('*') ? null : name;
}

function grantedList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of capability names`);
  const names = [];
  for (const item of value) {
    const name = capabilityName(item);
    if (name === null) throw new Error(`${label} must hold capability names without wildcards`);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function registerSkillProvenance(spec) {
  const source = spec !== null && typeof spec === 'object' && !Array.isArray(spec) ? spec : {};
  const name = readString(source, 'name');
  const repository = readString(source, 'repository');
  const commit = readString(source, 'commit');
  const author = readString(source, 'author');
  if (name === null) throw new Error('a skill needs a name');
  if (repository === null) throw new Error('a skill needs the repository it comes from');
  if (commit === null) throw new Error('a skill needs the exact commit it was read at');
  if (!COMMIT_ID.test(commit)) {
    throw new Error(`a skill needs a fixed commit id, not a moving reference: ${commit.slice(0, 64)}`);
  }
  if (author === null) throw new Error('a skill needs the author of that commit');
  let content;
  try {
    content = source.content;
  } catch {
    content = null;
  }
  if (typeof content !== 'string') throw new Error('a skill needs the content that will be loaded');
  const authority = Object.freeze(grantedList(source.authority, 'authority'));
  const parts = {
    name,
    repository,
    commit,
    author,
    contentDigest: sha256(content),
    authority,
  };
  const digest = seal(parts);
  const record = Object.freeze({ ...parts, digest });
  BOUND.set(record, record);
  REGISTERED.add(record);
  // The claim the caller holds is a frozen view of the same record, so reading it and acting on it
  // cannot come apart. `BOUND.set(claim, record)` is what makes an unregistered look-alike inert.
  const claim = Object.freeze({
    name: record.name,
    repository: record.repository,
    commit: record.commit,
    author: record.author,
    contentDigest: record.contentDigest,
    authority: Object.freeze([...record.authority]),
    digest: record.digest,
  });
  BOUND.set(claim, record);
  return claim;
}

// Reading the registry. Identity and digests only: the content itself never sits in a list, because
// the list is the part most likely to be logged.
function listSkillProvenance() {
  const out = [];
  for (const record of REGISTERED) {
    out.push({
      name: record.name,
      repository: record.repository,
      commit: record.commit,
      author: record.author,
      contentDigest: record.contentDigest,
    });
  }
  return out.sort((a, b) => (a.name === b.name ? (a.commit < b.commit ? -1 : 1) : (a.name < b.name ? -1 : 1)));
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
  return value.length > 512 ? `${value.slice(0, 509)}...` : value;
}

function withChecks(values) {
  const out = {};
  for (const key of Object.keys(values).sort()) out[key] = values[key] === true;
  return Object.freeze(out);
}

function provenanceChecks(values) {
  const out = {};
  for (const key of PROVENANCE_CHECKS) out[key] = values[key] === true;
  return Object.freeze(out);
}

function coverageOf(checks) {
  return PROVENANCE_CHECKS.filter((key) => checks[key] === true);
}

function notCoveredOf(checks) {
  return PROVENANCE_CHECKS.filter((key) => checks[key] !== true);
}

// Coverage read off every key, for the stages that add checks of their own (the load re-hash). The
// receipt shows what was covered, so a check that ran and passed has to be in the list.
function coveredKeys(checks) {
  return Object.keys(checks).filter((key) => checks[key] === true).sort();
}

function uncoveredKeys(checks) {
  return Object.keys(checks).filter((key) => checks[key] !== true).sort();
}

function refuse(record, reason) {
  // No record means nothing can be covered: a claim this kernel never registered has no provenance to
  // check, so all four checks are reported as not covered rather than quietly passing.
  const checks = provenanceChecks({});
  const result = Object.freeze({
    status: 'not_verifiable',
    provenanceStatus: 'not_verifiable',
    reason: short(reason),
    checks,
    coverage: Object.freeze(coverageOf(checks)),
    notCovered: Object.freeze(notCoveredOf(checks)),
    provenance: record === null ? null : provenanceOf(record),
  });
  if (record !== null) VERIFIED_FOR.set(result, record);
  return result;
}

function provenanceOf(record) {
  return Object.freeze({
    repository: record.repository,
    commit: record.commit,
    author: record.author,
    contentDigest: record.contentDigest,
  });
}

function settle(record, status, reason, checks) {
  // Every one of the four checks is present and boolean here, so `checks` cannot answer `undefined`
  // for a check this kernel did not cover while `coverage` and `notCovered`, read off the same object,
  // do report it. A check that was left unanswered is reported as false, never as absent.
  const values = { ...provenanceChecks(checks) };
  for (const key of Object.keys(checks)) values[key] = checks[key] === true;
  const sealed = withChecks(values);
  const result = Object.freeze({
    status,
    provenanceStatus: status,
    reason: short(reason),
    checks: sealed,
    coverage: Object.freeze(coverageOf(sealed)),
    notCovered: Object.freeze(notCoveredOf(sealed)),
    provenance: provenanceOf(record),
  });
  // Bound to the record, so this result cannot be replayed against another skill later.
  VERIFIED_FOR.set(result, record);
  return result;
}

// The resolver answers one question: is this repository, at this commit, by this author, these bytes?
// A resolver that is handed more than that can be talked into more than that.
//
// The deadline rejects with a value this module made, so a missed deadline can be told apart from
// anything the resolver threw without reading what it threw.
const DEADLINE = Object.freeze({ deadline: true });

async function askResolver(resolve, question, timeoutMs) {
  if (timeoutMs === undefined) return await resolve(question);
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(resolve(question)),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(DEADLINE), timeoutMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
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
function compare(label, declared, found, checks) {
  if (found === null) return null;
  if (found !== declared) {
    checks[label] = false;
    return `the ${label} the resolver reported (${String(found).slice(0, 120)}) is not the one declared (${String(declared).slice(0, 120)})`;
  }
  checks[label] = true;
  return null;
}

async function verifySkillProvenance(claim, resolve, options = {}) {
  const record = recordOf(claim);
  if (record === null) {
    return refuse(null, 'this skill was not registered in this kernel: there is no provenance to verify');
  }
  const settings = options !== null && typeof options === 'object' ? options : {};
  const timeoutMs = settings.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
    throw new Error('timeoutMs must be a positive integer');
  }
  if (typeof resolve !== 'function') {
    return refuse(record, 'no resolver was injected: nothing outside the skill has answered yet');
  }
  const question = Object.freeze({
    name: record.name,
    repository: record.repository,
    commit: record.commit,
    author: record.author,
    contentDigest: record.contentDigest,
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
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return refuse(record, 'the resolver answered with something that is not a record of evidence');
  }

  const checks = {};
  const refuted = [];

  // A stage that stops early must not erase a refutation an earlier stage already found: `exists:
  // false` is still `discrepant` when the resolver also left the repository out of its answer
  // (A07). What was refuted stays refuted, whatever came up unanswered after it.
  function stoppedAt(reason) {
    if (refuted.length > 0) {
      return settle(record, 'discrepant', `${refuted.join('; ')}; ${reason}`, checks);
    }
    return refuse(record, reason);
  }

  // Every field is read once, inside one guard, so a hostile evidence record either yields all of
  // itself or none of it.
  let exists;
  let repository = null;
  let author = null;
  let content = null;
  let contentDigest = null;
  let evidenceCommit = null;
  try {
    exists = evidence.exists;
    repository = readString(evidence, 'repository');
    author = readString(evidence, 'author');
    content = evidence.content;
    contentDigest = readString(evidence, 'contentDigest');
    evidenceCommit = readString(evidence, 'commit');
  } catch {
    return stoppedAt('the evidence could not be read');
  }

  // The commit has to be there at all, and the evidence has to be about *this* commit. `exists: true`
  // with no id says that some commit exists somewhere; the question was about one particular id, so
  // without the id nothing is covered and nothing is refuted. Evidence about another id answers a
  // question nobody asked, and that is a refutation (A04).
  if (exists === false) {
    checks.commit_exists = false;
    refuted.push(`commit ${record.commit} is not in ${record.repository}`);
  } else if (exists !== true) {
    return refuse(record, 'the resolver did not say whether the commit exists');
  } else if (evidenceCommit !== null) {
    if (evidenceCommit !== record.commit) {
      checks.commit_exists = false;
      refuted.push(`the resolver answered about commit ${evidenceCommit.slice(0, 120)}, not about ${record.commit.slice(0, 120)}`);
    } else {
      checks.commit_exists = true;
    }
  }

  const repoReason = compare('repository', record.repository, repository, checks);
  if (repoReason !== null) refuted.push(repoReason);
  const authorReason = compare('author', record.author, author, checks);
  if (authorReason !== null) refuted.push(authorReason);

  // Bytes beat a digest string. If the resolver brought the content, the digest is computed here and
  // the string it may also have written is not consulted.
  const hasContent = typeof content === 'string';
  const hasDigest = contentDigest !== null;
  if (!hasContent && !hasDigest) {
    return stoppedAt('the resolver reported neither the content at that commit nor its digest');
  }
  const resolvedDigest = hasContent ? sha256(content) : contentDigest;
  if (resolvedDigest !== record.contentDigest) {
    checks.content_digest = false;
    refuted.push(`the content at ${record.commit.slice(0, 12)} hashes to ${resolvedDigest.slice(0, 12)}, not to the digest of what was registered (${record.contentDigest.slice(0, 12)})`);
  } else {
    checks.content_digest = true;
  }

  // An explicit false outranks an unanswered field: a resolver that refuted the author and left the
  // repository out has discrepant provenance, not merely unverifiable provenance.
  const known = PROVENANCE_CHECKS.filter((key) => checks[key] !== undefined);
  const unknown = notCoveredOf(checks).filter((key) => !known.includes(key));
  const failures = Object.keys(checks).filter((key) => checks[key] === false);
  if (failures.length > 0) {
    return settle(record, 'discrepant', refuted.join('; '), checks);
  }
  if (unknown.length > 0) {
    return settle(record, 'not_verifiable', `the resolver left ${unknown.join(', ')} unanswered, so nothing can be covered there`, checks);
  }
  return settle(record, 'verified', 'the resolver reported this repository, commit, author and content, and all four match', checks);
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
function captureRequest(value) {
  if (!Array.isArray(value)) {
    return { ok: false, names: [], reason: 'the requested authority must be an array of capability names' };
  }
  const names = [];
  let length;
  try {
    length = value.length;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
      return { ok: false, names: [], reason: 'the requested authority could not be read as a list of names' };
    }
    for (let index = 0; index < length; index += 1) names.push(value[index]);
  } catch {
    return { ok: false, names: [], reason: 'the requested authority could not be read as a list of names' };
  }
  return { ok: true, names, reason: null };
}

// The authority question, kept apart from the load question: may this skill act, and within what the
// person granted. Bytes belong to `loadSkill`, where the time-of-check gap actually opens.
function authorizeSkill(claim, result, requested) {
  const record = recordOf(claim);
  const provenance = record === null ? null : provenanceOf(record);
  const base = { provenance, name: record === null ? null : record.name, granted: record === null ? [] : [...record.authority] };

  // A refusal reports the coverage it really has: a request out of scope does not erase the three
  // provenance checks that passed, and a provenance that failed does not invent an `authority_scope`
  // problem that was never checked. `provenanceStatus` is the provenance on its own and `status` is
  // what this stage decided, so asking for a capability outside the grant does not turn a verified
  // provenance into an unverified one (A09).
  function refuseDecision(status, reason, provenanceValues, extra, provenanceStatus) {
    const values = {};
    for (const key of PROVENANCE_CHECKS) values[key] = provenanceValues[key] === true;
    for (const key of extra) values[key] = false;
    const checks = withChecks(values);
    const decision = Object.freeze({
      authorized: false,
      status,
      provenanceStatus,
      reason: short(reason),
      checks,
      coverage: Object.freeze(coveredKeys(checks)),
      notCovered: Object.freeze(uncoveredKeys(checks)),
      provenance: base.provenance,
      name: base.name,
      granted: Object.freeze([...base.granted]),
      requested: Object.freeze([]),
    });
    DECIDED_FROM.set(decision, record);
    return decision;
  }

  if (record === null) {
    return refuseDecision('not_verifiable', 'this skill was not registered in this kernel, so no authority can be granted', {}, [], 'not_verifiable');
  }
  if (result === null || typeof result !== 'object' || VERIFIED_FOR.get(result) !== record) {
    return refuseDecision('not_verifiable', 'this verification result was not produced for this skill by this kernel', {}, [], 'not_verifiable');
  }
  const provenanceStatus = result.status;
  const provenanceChecks = result.checks !== null && typeof result.checks === 'object' ? result.checks : {};

  const capture = captureRequest(requested);
  if (!capture.ok) {
    return refuseDecision('not_verified', capture.reason, provenanceChecks, ['authority_scope'], provenanceStatus);
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
        seen.push(name);
      }
    }
  }
  if (malformed !== null) {
    return refuseDecision('not_verified', malformed, provenanceChecks, ['authority_scope'], provenanceStatus);
  }
  const outside = ask.filter((item) => !listedIn(record.authority, item));
  if (outside.length > 0) {
    return refuseDecision(
      'not_verified',
      `the person granted ${record.authority.length === 0 ? 'no capability at all' : record.authority.join(', ')}, and ${outside.join(', ')} is not among them`,
      provenanceChecks,
      ['authority_scope'],
      provenanceStatus,
    );
  }
  if (provenanceStatus !== 'verified') {
    return refuseDecision(
      provenanceStatus,
      `the provenance of this skill is ${provenanceStatus}, so no authority is granted`,
      provenanceChecks,
      [],
      provenanceStatus,
    );
  }
  const checks = withChecks(provenanceChecks);
  const decision = Object.freeze({
    authorized: true,
    status: 'verified',
    provenanceStatus: 'verified',
    reason: result.reason,
    checks,
    coverage: Object.freeze(coveredKeys(checks)),
    notCovered: Object.freeze(uncoveredKeys(checks)),
    provenance: base.provenance,
    name: base.name,
    granted: Object.freeze([...base.granted]),
    requested: Object.freeze([...ask]),
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
  try {
    loaded = typeof content === 'string' ? sha256(content) : null;
  } catch {
    loaded = null;
  }
  if (loaded === null) {
    return withLoad(decision, record, loaded, false, 'discrepant', 'the content offered for loading is not text, so no digest can be compared');
  }
  if (record === null) {
    // The bytes were hashed, and that is all that happened. Hashing is not a comparison: with no
    // registered digest there is nothing to compare against, so the check is not covered (A08).
    return withLoad(decision, record, loaded, false, decision.status, decision.reason);
  }
  if (loaded !== record.contentDigest) {
    return withLoad(decision, record, loaded, false, 'discrepant', `the content offered for loading hashes to ${loaded.slice(0, 12)}, not to the verified digest ${record.contentDigest.slice(0, 12)}: it changed between the check and the load`);
  }
  return withLoad(decision, record, loaded, true, decision.status, decision.reason);
}

// A load is the decision plus what the bytes turned out to hash to. The digest is recomputed from the
// bytes in hand and nothing is carried over from the verification, so the receipt says what was
// loaded rather than what was checked.
function withLoad(decision, record, loadedDigest, matched, status, reason) {
  const checks = withChecks({ ...decision.checks, loaded_content_digest: matched === true });
  const loaded = Object.freeze({
    authorized: matched === true ? decision.authorized : false,
    status,
    // The provenance is the one the decision carried. A load that found different bytes is a
    // discrepancy of the load, and it says so in `status` and in `loaded_content_digest`; it is not
    // a claim that the provenance of the skill stopped being what it was (A09).
    provenanceStatus: decision.provenanceStatus,
    reason: short(reason),
    checks,
    coverage: Object.freeze(coveredKeys(checks)),
    notCovered: Object.freeze(uncoveredKeys(checks)),
    provenance: decision.provenance,
    name: decision.name,
    granted: decision.granted,
    requested: decision.requested,
    loadedDigest,
  });
  if (record !== null) DECIDED_FROM.set(loaded, record);
  return loaded;
}

// The receipt. Built through `buildReceipt` so coverage, `notCovered`, the anchor and the digest all
// come from the same place they come from for any other receipt, and then sealed again with the skill
// block attached — the block is inside the seal, which is what makes a skill swapped between two
// receipts of the same operation visible instead of plausible.
function buildSkillReceipt(spec, decision) {
  const record = deciderRecord(decision);
  if (record === null) {
    throw new Error('a skill receipt needs a decision this kernel produced');
  }
  const status = Object.prototype.hasOwnProperty.call(RECEIPT_STATUS, decision.status) ? decision.status : 'not_verified';
  const source = spec !== null && typeof spec === 'object' ? spec : {};
  const outcome = source.outcome !== null && typeof source.outcome === 'object' ? source.outcome : {};
  const receipt = buildReceipt({
    ...source,
    outcome: { ...outcome, status: RECEIPT_STATUS[status] },
    verification: {
      verified: status === 'verified',
      checks: decision.checks,
      reason: decision.reason,
    },
  });
  receipt.skill = Object.freeze({
    name: decision.name,
    status,
    provenanceStatus: decision.provenanceStatus,
    coverage: [...decision.coverage].sort(),
    notCovered: [...decision.notCovered].sort(),
    granted: [...decision.granted],
    requested: [...decision.requested],
    provenance: { ...decision.provenance },
    reason: decision.reason,
    loadedDigest: decision.loadedDigest === undefined ? null : decision.loadedDigest,
  });
  // `buildReceipt` sealed the body without the skill block; sealing again puts the block inside. The
  // anchor stays `pending` and is outside the digest, so this cannot move it.
  receipt.digest = computeDigest(receipt);
  return receipt;
}

module.exports = {
  registerSkillProvenance,
  verifySkillProvenance,
  authorizeSkill,
  loadSkill,
  buildSkillReceipt,
  listSkillProvenance,
  SKILL_PROVENANCE_STATUSES,
};
