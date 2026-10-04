'use strict';

const { createHash } = require('node:crypto');
const { computeDigest } = require('./receipt.js');
const { parseTime } = require('./time.js');

// Emergency access (decision 27): authority a person grants IN ADVANCE, with a declared trigger,
// exercised against a signal somebody other than the exercising agent verified, sealed in an
// immediate receipt, and always leaving a post-use review that only a declared reviewer can close.
//
// Everything a grant binds lives outside the values, because every one of them is an identity claim
// the kernel cannot check on its own and must therefore receive from the host exactly once. One
// private binding per permission carries all of it:
//   · snapshot  — the normalized grant, read once and frozen, which is both what the host was asked
//                to authorize and what the kernel binds. Never read back from a caller afterwards.
//   · verifiers — the independent verifier of each declared trigger, bound when the person granted.
//   · approver  — the host callback that has to answer again before the clock may be extended.
//   · family    : the private identity of this one grant. Records are kept by the public id, which is
//                not an identity, so this is what says a counter, a review or a revocation belongs
//                to this grant and not to another person who happened to use the same id. It is also
//                the key of the ledger binding below, so a renewal keeps the record it had.
// A permission that did not come out of `createEmergencyPermission` is not in this table, so it
// carries no authority at all: its shape proves nothing, and nothing in this module may treat a
// readable object as a granted one.
//
// What the kernel does NOT do, and says so: it cannot tell a real host from a lying one. Whoever
// supplies `authorizeGrantor`, `resolveVerifier` and `authorizeRenewal` decides who may grant, what
// counts as the independent signal, and whether the clock may grow. The kernel's part is that an
// agent exercising the permission can never be the source of any of them, that a permission which
// did not come through this path holds nothing, and that a caller cannot get the kernel to bind one
// value and seal another by answering twice. Every field it hands over, nested triggers included,
// is read once, and what is validated is what gets bound. A barrier against the common forgery, not
// a proof against a Proxy that lies about its own descriptors.
//
// Two guarantees hold the surface up, and both are structural rather than promised:
//   · One record per grant family, in one ledger. A grant family is bound to the ledger it was first
//     used with, the binding is keyed by the family and not by the handle, and it survives a renewal.
//     The cap, the replay sets, the pause, the revocation and a rejected review all live in that one
//     record, so none of them can be restarted by handing the kernel a different ledger (H05).
//   · The post-use review is signed by somebody other than the agent that spent the authority. A
//     grant that names the grantee among the reviewers of its own use is refused at the door, and
//     what was spent is never verified either way (H04).
// What no code here can give the two: a ledger that survives its process, a reviewer whose identity
// was actually checked, and a human who reads the effect. Durability and identity are the host's to
// provide, and a receipt that says `not_verified` is this kernel saying exactly that.

const BINDINGS = new WeakMap();

// ─── The host's door: who a caller is ──────────────────────────────────────────────────────────
//
// This kernel does not know who anyone is. It never reads a name and believes it: every name in a
// grant is a claim, and a claim is exactly what a caller holding the permission and its ledger can
// write. What the kernel CAN check is a relation between principals the host vouched for, so the
// host injects one port and this module never accepts a self-declared name.
//
//   authenticate({ grantId, role, name }) → a principal: a frozen object, the SAME one for every call
//   that means the same person and a DIFFERENT one for a different person.
//
// The principal is branded on arrival and thereafter only ever compared by reference: the kernel
// stores an opaque handle per object and reads no field of it, copies none and seals none. So two
// names are the same person exactly when the port says so by handing back one object, an alias cannot
// be spelled in a grant to get around anything, and nobody can mint a principal here: possession of
// the permission, of the ledger and of every record in it is not possession of anybody's identity.
//
// What this does NOT do, and says so: the guarantee is exactly as strong as the host that issued the
// principals. A host that hands the reviewer principal to the exercising agent has broken it, and
// this kernel has no way to know. Independence, aliasing and delegation are the host's answers; what
// this module guarantees is that it will not let a name, an alias or a forged object stand in for
// one, and that it fails closed when the port is absent, malformed, slow or contradictory.
const PRINCIPALS = new WeakMap();
const NO_PRINCIPAL = 'this kernel cannot authenticate a name: whoever signed this call has to present a principal that the injected authenticate port issued, and a declared name is not one';
let principalSequence = 0;

// A principal is a frozen object this port produced, and nothing else. Frozen because a mutable one
// could be turned into somebody else after the kernel compared it; an object because a string, an
// array or a plain value is a claim, not an identity. No field of it is read.
function brandPrincipal(principal) {
  try {
    if (!principal || typeof principal !== 'object' || Array.isArray(principal)) return false;
    if (!Object.isFrozen(principal)) return false;
    if (!PRINCIPALS.has(principal)) {
      principalSequence += 1;
      PRINCIPALS.set(principal, principalSequence);
    }
    return true;
  } catch {
    return false;
  }
}

// Only ever a question between two branded principals, so an unbranded one is not equal to anything.
function samePrincipal(left, right) {
  try {
    const one = PRINCIPALS.get(left);
    return one !== undefined && one === PRINCIPALS.get(right);
  } catch {
    return false;
  }
}

// One question to the host about one declared name in one role. Synchronous for the same reason the
// renewal approver and the trigger verifier are: a door this kernel would have to wait for cannot
// close a transition. Every failure is a refusal and not a retry, and the reason never carries
// whatever the port said or threw on the way.
function askPrincipal(port, claim) {
  let answered;
  try {
    answered = port(claim);
  } catch {
    return { ok: false, reason: 'the injected authenticate port could not authenticate a declared name, so this kernel does not know who is calling' };
  }
  try {
    if (Boolean(answered) && (typeof answered === 'object' || typeof answered === 'function') && typeof answered.then === 'function') {
      Promise.resolve(answered).catch(() => {});
      return { ok: false, reason: 'the injected authenticate port answered asynchronously, which this kernel does not wait for' };
    }
  } catch {
    return { ok: false, reason: 'the injected authenticate port could not be read' };
  }
  if (!brandPrincipal(answered)) {
    return { ok: false, reason: 'the injected authenticate port answered with something that is not a frozen principal, and this kernel will not guess who that is' };
  }
  return { ok: true, principal: answered };
}

// Who everybody in this grant is, asked once, before the grantor is asked anything: the owner, the
// grantee, every declared reviewer, every declared pauser and every declared trigger verifier. The
// declared names stay in the snapshot exactly as authorized, because they are what a receipt carries
// and what the grant digest is made of; these principals stay in the private binding, because they
// are what a caller's `by` has to equal.
function askPeople(port, snapshot) {
  const asked = { owner: null, grantee: null, reviewers: [], pausers: [], verifiers: [] };
  const roles = [
    ['owner', snapshot.owner, asked, 'owner'],
    ['grantee', snapshot.grantee, asked, 'grantee'],
    ...snapshot.reviewers.map((name) => ['reviewer', name, asked.reviewers, null]),
    ...snapshot.pausers.map((name) => ['pauser', name, asked.pausers, null]),
    ...snapshot.triggers.map((trigger) => ['verifier', trigger.verifierId, asked.verifiers, null]),
  ];
  for (const [role, name, list, field] of roles) {
    const claim = Object.freeze({ grantId: snapshot.id, role, name });
    const answer = askPrincipal(port, claim);
    if (!answer.ok) return answer;
    if (field) asked[field] = answer.principal;
    else list.push({ name, principal: answer.principal });
  }
  // Independence is a relation between principals, so this is where it is decided. A grant that names
  // the grantee among the reviewers is still refused by name above; what is added here is that an
  // ALIAS of the grantee is refused too, because the port answered with one principal for two
  // different names (A01, R402).
  for (const reviewer of asked.reviewers) {
    if (samePrincipal(reviewer.principal, asked.grantee)) {
      return { ok: false, reason: `the reviewer ${reviewer.name} resolves to the same principal as the grantee ${snapshot.grantee}, so the post-use review would be signed by the agent that spends the authority: this kernel compares principals, not names` };
    }
  }
  for (const verifier of asked.verifiers) {
    if (samePrincipal(verifier.principal, asked.grantee) || samePrincipal(verifier.principal, asked.owner)) {
      return { ok: false, reason: `the verifier ${verifier.name} resolves to the same principal as ${samePrincipal(verifier.principal, asked.grantee) ? snapshot.grantee : snapshot.owner}, and an independent signal cannot come from the agent that will act on it or from the person who granted the authority` };
    }
  }
  // The person who granted this has to be able to stop it, and that too is a relation between
  // principals: a pauser entry the port does not resolve to the owner is not the owner.
  if (!asked.pausers.some((pauser) => samePrincipal(pauser.principal, asked.owner))) {
    return { ok: false, reason: `none of the declared pausers resolves to the principal of the owner ${snapshot.owner}, so the person who granted this could not stop it` };
  }
  // And a grant whose owner is its own grantee is not a grant: it is one principal on both sides of
  // the whole capability.
  if (samePrincipal(asked.owner, asked.grantee)) {
    return { ok: false, reason: `the owner ${snapshot.owner} and the grantee ${snapshot.grantee} resolve to the same principal, so this permission would let one principal sign the authority and spend it` };
  }
  return { ok: true, people: asked };
}

const CAPABILITY = 'emergency-access';
const DEFAULT_GOAL = 'emergency access under prior authority';
const PENDING_ANCHOR = { status: 'pending', network: 'stellar:testnet' };
// Every text this kernel seals whole answers to the bound the common receipt applies (`receipt.js`
// refuses anything over 512 characters). A grant or a request that names something longer is refused
// rather than shortened: two different identifiers that share their first 512 characters would seal
// the same receipt text, and the honest answer is that this kernel will not carry them (H06).
const MAX_TEXT = 512;
// A subject reaches a receipt, so it has to be a reference and not content: letters, digits and
// separators, bounded. What this kernel will not do is seal a piece of the patient's record into an
// object that travels.
const REFERENCE = /^[A-Za-z0-9._:-]{1,64}$/;
const NOT_REPRESENTABLE = Symbol('not-representable');
// The widest interval the calendar in time.js can hold, measured with the same strings that parser
// accepts at its two ends. A deadline longer than this cannot be stamped at any instant of it, so
// no clock will ever satisfy it and not one use of such a grant could reach the verifier.
const CALENDAR_SPAN_MS = Date.parse('9999-12-31T23:59:59.999Z') - Date.parse('0000-01-01T00:00:00.000Z');

function text(value) {
  return typeof value === 'string' && value.length > 0;
}

// A text this kernel can seal whole: non-empty and within the bound above. A reason is shortened
// instead, because the kernel writes those; anything a caller names is refused rather than cut.
function bounded(value, max = MAX_TEXT) {
  return text(value) && value.length <= max;
}

function safeText(value, max = MAX_TEXT) {
  return text(value) ? value.slice(0, max) : null;
}

function reference(value) {
  return text(value) && REFERENCE.test(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

// The budget this kernel spends on one body. Depth is what the walk costs in stack, and size is what
// it costs in time and memory, so both are counted while copying and both refuse the body when they
// are past what any signal this kernel is built for has any business carrying. Without them the only
// bound was the call stack, and a body a megabyte wide walked all of it on the caller's expense
// (H08, H20).
const MAX_DEPTH = 32;
const MAX_NODES = 4096;
// Bytes, and separately from values on purpose. A body can be enormous without being deep or wide:
// one string of a megabyte is a single value, so the value budget admitted it whole, it was then
// copied, serialized and hashed at this kernel's expense, and nothing in the receipt said so. The
// bound is on the total UTF-8 length of every key and every string of one walk, checked before the
// value is copied or hashed, so an oversized body is refused while it still costs a length and not a
// walk (A02, R412). 64 KiB is far past any signal this capability is built for: a hospital trigger
// carries a triage verdict, not a document.
const MAX_BYTES = 65536;

// Charges bytes against one walk and answers whether the walk may go on. The first reason recorded is
// the one kept: a body that is both over the value bound and over the byte bound is refused once, and
// the sentence that travels names the first bound it went past.
function chargeBytes(counted, length) {
  counted.bytes += length;
  if (counted.bytes <= MAX_BYTES) return true;
  if (!counted.reason) counted.reason = `it carries more than the ${MAX_BYTES} bytes of keys and text this kernel walks of one body`;
  return false;
}

// The canonical form of data this kernel is willing to hash and seal: JSON primitives, plain objects
// and arrays, keys sorted. Anything else — a function, a symbol, a bigint, an infinite number, a
// cycle, a class instance, an object from another realm — is refused rather than half-copied, because
// a receipt whose fingerprint cannot be recomputed is a receipt nobody can check later.
//
// The boundary of what travels is stated here and nowhere wider: a body is JSON data, whole, and
// inside the budget above. An array has to be dense and nothing but indices (no hole to fill from a
// prototype, no extra key that would be dropped), and an object may not carry a key of any kind that
// `Object.keys` cannot see. A symbol key used to be dropped silently: the copy the verifier received
// simply did not have it, the body was still hashed and the authority still spent on a fingerprint
// of something the verifier never saw (R303, R304). Non-enumerable properties are the one thing this
// contract does not speak about: they are outside JSON and this kernel does not claim them either way.
function canonical(value, seen, budget, depth) {
  // One budget per walk, and every bound is checked before anything of this value is read or copied,
  // so nothing of an oversized body is ever built. Every value counts, a scalar included: a body can
  // be enormous without being deep (H20). And every byte of it counts too (A02).
  const counted = budget || { nodes: 0, bytes: 0, reason: null };
  const level = depth || 0;
  if (level > MAX_DEPTH) {
    if (!counted.reason) counted.reason = `it is nested deeper than the ${MAX_DEPTH} levels this kernel walks`;
    return NOT_REPRESENTABLE;
  }
  if (counted.nodes >= MAX_NODES) {
    if (!counted.reason) counted.reason = `it carries more than the ${MAX_NODES} values this kernel walks of one body`;
    return NOT_REPRESENTABLE;
  }
  counted.nodes += 1;
  if (value === null) return null;
  const kind = typeof value;
  if (kind === 'string') {
    // Charged before it is copied and long before anything is serialized: `Buffer.byteLength` is an
    // exact length of a value already in hand, not a walk and not a second read of a caller's field.
    if (!chargeBytes(counted, Buffer.byteLength(value, 'utf8'))) return NOT_REPRESENTABLE;
    return value;
  }
  if (kind === 'boolean') return value;
  if (kind === 'number') return Number.isFinite(value) ? value : NOT_REPRESENTABLE;
  if (kind !== 'object') return NOT_REPRESENTABLE;
  const path = seen || new Set();
  if (path.has(value)) return NOT_REPRESENTABLE;
  path.add(value);
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    path.delete(value);
    return NOT_REPRESENTABLE;
  }
  // A key of its own that no enumeration can see is data this kernel would drop, so a body carrying
  // one is refused instead of copied, array or object alike (R304).
  for (const key of keys) {
    if (typeof key === 'symbol') { path.delete(value); return NOT_REPRESENTABLE; }
  }
  let out;
  if (Array.isArray(value)) {
    // Only indices 0..length-1, all of them own, and the enumerable keys exactly those. The old count
    // admitted a sparse array whose hole a custom prototype filled and whose extra key then vanished
    // from the copy (R303).
    out = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, String(index))) { path.delete(value); return NOT_REPRESENTABLE; }
      const item = canonical(value[index], path, counted, level + 1);
      if (item === NOT_REPRESENTABLE) { path.delete(value); return NOT_REPRESENTABLE; }
      out.push(item);
    }
    for (const key of Object.keys(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) { path.delete(value); return NOT_REPRESENTABLE; }
    }
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) { path.delete(value); return NOT_REPRESENTABLE; }
    // The copy is built without a prototype on purpose. Assigning to `{}` runs the inherited
    // `__proto__` setter, so a JSON body carrying that key either changed this copy's prototype and
    // lost the key, or made the copy unrepresentable a second time, which is how a verified signal
    // used to be sealed with a null fingerprint (R209, R210). With no prototype there is no
    // inherited setter: every key of the body becomes exactly the data property it was, and the
    // string this returns for an ordinary body is byte for byte the one a plain object gave.
    out = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      // A key is carried in the sealed text too, so it is charged like a string value: an object whose
      // keys alone are a megabyte is as oversized as one whose values are (A02).
      if (!chargeBytes(counted, Buffer.byteLength(key, 'utf8'))) { path.delete(value); return NOT_REPRESENTABLE; }
      const item = canonical(value[key], path, counted, level + 1);
      if (item === NOT_REPRESENTABLE) { path.delete(value); return NOT_REPRESENTABLE; }
      out[key] = item;
    }
  }
  path.delete(value);
  return out;
}

// A fingerprint of exactly what travels: unkeyed SHA-256, like the receipt digest itself. It proves
// binding, not authenticity: it says two receipts were made from different inputs, and anybody able
// to rewrite a receipt can recompute it. The independent evidence that would let a host check the
// binding again stays with the host.
function fingerprint(value) {
  const canonicalValue = canonical(value);
  if (canonicalValue === NOT_REPRESENTABLE) return null;
  return createHash('sha256').update(JSON.stringify(canonicalValue), 'utf8').digest('hex');
}

// Which bound a value went past, so a refusal can name it instead of only saying there is no
// fingerprint. The walk is repeated with a budget of its own and its first recorded reason is read
// back, which is only paid on the refusing path.
function fingerprintFailure(value) {
  const counted = { nodes: 0, bytes: 0, reason: null };
  return canonical(value, null, counted) === NOT_REPRESENTABLE
    ? counted.reason || 'it is data this kernel cannot represent as JSON'
    : null;
}

// A caller object that carries its own accessors cannot be read exactly once: the kernel reads each
// field one time and has no second look, so a getter that answers `read` and then something else is
// a shape it refuses rather than a shape it trusts. Prototype getters are untouched — only accessors
// the caller put on the object itself are refused. This is a barrier against the common forgery, not
// a proof against a Proxy that lies about its own descriptors.
function ownDataOnly(value) {
  try {
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') return false;
    }
    return true;
  } catch {
    return false;
  }
}

// The same rule for the options of the seven public entry points, read once as a whole. Every field
// this module asks a host for lives in the descriptors of one object, so that object is read exactly
// once and nothing else: a `ledger`, a `by`, a `now` or an `authorizeGrantor` whose getter throws, or
// answers twice, is not a shape this kernel reads. A failure returns null and every caller answers
// with its own fixed sentence, so an exception raised inside a caller's options never reaches the
// caller's caller (R301). Prototype getters are untouched: a host that puts its callbacks on a class
// is a host this kernel can still talk to.
function readOptions(options, fields) {
  try {
    if (options === undefined || options === null) return Object.fromEntries(fields.map((field) => [field, undefined]));
    if (typeof options !== 'object' || Array.isArray(options)) return null;
    if (!ownDataOnly(options)) return null;
    const out = {};
    for (const field of fields) out[field] = options[field];
    return out;
  } catch {
    return null;
  }
}

// The one sentence every refused options object gets, in each of the three places this module can
// answer: a grant and its administration throw (a grant was never created, so there is nothing to
// receipt), and an exercise or a state blocks or fails closed. It says what happened, not what the
// hostile object said while it happened.
const UNREADABLE_OPTIONS = 'the options this call was given could not be read safely';

// A non-empty list of unique non-empty strings within the receipt bound, or null. Null is what every
// reader below treats as "this permission cannot be trusted with anything".
function stringList(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = [];
  for (const item of value) {
    if (!bounded(item)) return null;
    out.push(item);
  }
  return new Set(out).size === out.length ? out : null;
}

// Nested structures get the same treatment as the top level: `id` and `verifierId` are read once
// each into variables, and the copy that ends up bound is built from those variables. Validating
// one value and binding another is how a grant ended up carrying a trigger whose id was undefined
// and could not produce a valid fingerprint (R211).
function triggerList(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = [];
  const ids = new Set();
  for (const trigger of value) {
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return null;
    let id;
    let verifierId;
    try {
      id = trigger.id;
      verifierId = trigger.verifierId;
    } catch {
      return null;
    }
    if (!bounded(id) || !bounded(verifierId)) return null;
    if (ids.has(id)) return null;
    ids.add(id);
    out.push({ id, verifierId });
  }
  return out;
}

// The kernel reads a value it did not write from a caller that may be hostile, so every read of the
// permission goes through here, one read per field, nested triggers included, which `triggerList`
// handles the same way, and the result is normalized. A permission nobody can read safely returns
// the reason it could not be read, and every caller fails closed on it: it exercises nothing.
function snapshotPermission(permission) {
  try {
    if (!permission || typeof permission !== 'object' || Array.isArray(permission)) {
      return { ok: false, reason: 'the emergency permission is not an object' };
    }
    if (!ownDataOnly(permission)) {
      return { ok: false, reason: 'it carries its own accessors, and this kernel reads each field only once' };
    }
    const id = permission.id;
    const owner = permission.owner;
    const grantee = permission.grantee;
    const destination = permission.destination;
    const purpose = permission.purpose;
    const actions = stringList(permission.actions);
    const scope = stringList(permission.scope);
    const triggers = triggerList(permission.triggers);
    const reviewers = stringList(permission.reviewers);
    const pausers = stringList(permission.pausers);
    const maxUses = permission.maxUses;
    const reviewDueMs = permission.reviewDueMs;
    const startsAt = parseTime(permission.startsAt);
    const expiresAt = parseTime(permission.expiresAt);
    if (!text(id)) return { ok: false, reason: 'it has no id' };
    if (!text(owner)) return { ok: false, reason: 'it names no person who granted it' };
    if (!text(grantee)) return { ok: false, reason: 'it names nobody allowed to exercise it' };
    if (!text(destination)) return { ok: false, reason: 'it names no destination' };
    if (!text(purpose)) return { ok: false, reason: 'it declares no motive, and an emergency without a declared motive is not a grant' };
    // And nothing a caller names is longer than the bound a receipt answers to. This is a refusal and
    // not a shortening: an identifier this kernel cannot carry whole is not one it will seal, and two
    // long identifiers sharing their first 512 characters would seal the same text (H06).
    for (const field of [['id', id], ['owner', owner], ['grantee', grantee], ['destination', destination], ['purpose', purpose]]) {
      if (!bounded(field[1])) return { ok: false, reason: `its ${field[0]} is ${field[1].length} characters long, and this kernel seals no text longer than ${MAX_TEXT} characters` };
    }
    if (!actions) return { ok: false, reason: `its actions must be a non-empty list of unique strings of at most ${MAX_TEXT} characters` };
    if (!scope) return { ok: false, reason: `its scope must be a non-empty list of unique strings of at most ${MAX_TEXT} characters` };
    if (!triggers) return { ok: false, reason: 'its triggers must be a non-empty list, each naming a trigger and its independent verifier' };
    if (!reviewers) return { ok: false, reason: `its reviewers must be a non-empty list of unique strings of at most ${MAX_TEXT} characters` };
    if (!pausers) return { ok: false, reason: `its pausers must be a non-empty list of unique strings of at most ${MAX_TEXT} characters` };
    // Safe integers, not merely integers: a deadline or a cap past the range a Date can hold is not
    // a permission this kernel can schedule, and accepting it would move the failure to the moment
    // the review falls due.
    if (!Number.isSafeInteger(maxUses) || maxUses < 1) return { ok: false, reason: 'maxUses must be a positive safe integer' };
    if (!Number.isSafeInteger(reviewDueMs) || reviewDueMs < 1) return { ok: false, reason: 'reviewDueMs must be a positive safe integer' };
    // And shorter than the whole calendar, which is the last value a safe integer can hold and still
    // be a deadline somebody could stamp. A grant that declares one is authorized, sealed as
    // verified and then refused at every single use, because `now + reviewDueMs` is not an instant:
    // a signature on a permission that can never be exercised is refused here instead (H02).
    if (reviewDueMs > CALENDAR_SPAN_MS) return { ok: false, reason: `reviewDueMs is longer than the whole calendar (${CALENDAR_SPAN_MS} ms), so no use of this permission could ever stamp its review` };
    if (startsAt === null || expiresAt === null || expiresAt <= startsAt) return { ok: false, reason: 'it needs a valid clock interval' };
    // The same question inside this permission's own interval, which is the one that matters. A span
    // the calendar holds in general can still be longer than every instant between this grant's
    // `startsAt` and its `expiresAt`: a grant that opens in October 2026 and asks for the whole of
    // recorded time as its review delay has no instant at which its review could be stamped, so every
    // one of its uses would be refused and nothing would ever reach the verifier. Refused before the
    // host is asked, because a deadline this permission can never meet is not authority (R305).
    if (parseTime(startsAt + reviewDueMs) === null) {
      return { ok: false, reason: `reviewDueMs (${reviewDueMs} ms) is a deadline no instant of this permission's own interval can stamp, so none of its uses could ever open a review` };
    }
    // The signal has to come from somebody who is neither the agent that will exercise the
    // permission nor the person who granted it. Independence is structural, not a promise.
    for (const trigger of triggers) {
      if (trigger.verifierId === grantee || trigger.verifierId === owner) {
        return { ok: false, reason: `the verifier of trigger ${trigger.id} must be independent: it cannot be the grantee (${grantee}) or the owner (${owner})` };
      }
    }
    // And the post-use review has to be signed by somebody else too, or there is no review left: the
    // agent that spends the authority is the grantee, so a grant that names the grantee among the
    // reviewers of its own use lets that agent close it. Declaring it is not an exception, it is the
    // shape this refuses (H04).
    if (reviewers.includes(grantee)) {
      return { ok: false, reason: `the grantee (${grantee}) cannot be a reviewer of its own use: the post-use review is taken away from the agent that exercised the authority, whoever the grant declares` };
    }
    if (!pausers.includes(owner)) return { ok: false, reason: 'the person who granted it must be allowed to pause it' };
    return {
      ok: true,
      snapshot: {
        id, owner, grantee, destination, purpose, actions, scope, triggers, reviewers, pausers,
        maxUses, reviewDueMs, startsAt, expiresAt, approval: null,
      },
    };
  } catch {
    return { ok: false, reason: 'it could not be read safely' };
  }
}

function readPermission(permission) {
  const read = snapshotPermission(permission);
  return read.ok ? read.snapshot : null;
}

function clone(value) {
  const copied = canonical(value);
  return copied === NOT_REPRESENTABLE ? null : copied;
}

// One read per field, and the signal copied exactly once: the id and source that get checked against
// the declaration, and the body the verifier receives, all come out of that single copy. Reading the
// caller's signal twice is how a receipt ends up naming a signal the verifier never saw.
function snapshotRequest(request) {
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
    if (!ownDataOnly(request)) return null;
    const useId = request.useId;
    const actor = request.actor;
    const action = request.action;
    const subject = request.subject;
    const destination = request.destination;
    const triggerId = request.triggerId;
    const signal = request.triggerSignal;
    let body = null;
    // Which bound a body went past, so a refusal can name it instead of only saying it was unreadable.
    let problem = null;
    if (signal && typeof signal === 'object' && !Array.isArray(signal)) {
      const budget = { nodes: 0, bytes: 0, reason: null };
      body = ownDataOnly(signal) ? canonical(signal, null, budget) : NOT_REPRESENTABLE;
      if (body === NOT_REPRESENTABLE) {
        problem = budget.reason || 'it carries something this kernel cannot represent as JSON data';
        body = null;
      }
    }
    // Nothing a request names is longer than the bound a receipt answers to either. The fields are
    // still read once, and the caller is told which of them was over the line instead of being given
    // a shorter identifier that would collide with another one (H06).
    const over = [];
    for (const field of [['useId', useId], ['actor', actor], ['action', action], ['destination', destination], ['triggerId', triggerId]]) {
      if (text(field[1]) && !bounded(field[1])) over.push(field[0]);
    }
    if (body && text(body.id) && !bounded(body.id)) over.push('triggerSignal.id');
    return {
      oversized: over,
      signalProblem: body ? null : problem,
      useId: text(useId) ? useId : null,
      actor: text(actor) ? actor : null,
      action: text(action) ? action : null,
      subject: reference(subject) ? subject : null,
      subjectRejected: text(subject) && !reference(subject),
      destination: text(destination) ? destination : null,
      triggerId: text(triggerId) ? triggerId : null,
      signal: body ? { id: text(body.id) ? body.id : null, source: text(body.source) ? body.source : null, body: freeze(body) } : null,
    };
  } catch {
    return null;
  }
}

// An injected clock is a synchronous contract: an asynchronous clock cannot authorize an effect, and
// an unreadable one blocks instead of throwing, because a caller with a bad clock still gets a receipt.
function readClock(now) {
  let value = now;
  if (value === undefined || value === null) value = Date.now();
  try {
    if (typeof value === 'object' || typeof value === 'function') {
      if (typeof value.then === 'function') {
        // Consume the eventual rejection while refusing to wait for it.
        Promise.resolve(value).catch(() => {});
        return { ok: false, reason: 'the injected emergency clock is asynchronous and cannot authorize a use' };
      }
      return { ok: false, reason: 'the injected emergency clock is not a time' };
    }
  } catch {
    return { ok: false, reason: 'the injected emergency clock could not be read' };
  }
  const parsed = parseTime(value);
  if (parsed === null) return { ok: false, reason: 'the injected emergency clock is not a time' };
  return { ok: true, now: parsed };
}

function iso(ms) {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid emergency clock');
  return date.toISOString();
}

function readRecords(ledger) {
  try {
    return LEDGER.get(ledger) || null;
  } catch {
    return null;
  }
}

const LEDGER = new WeakMap();

// The ledger a grant family lives in. The cap, the replay sets, the pause, the revocation and the
// rejected review all live in one record, so a record that a caller can move to a fresh ledger is a
// record that can be reset: a rejected use and a revoked grant exercised again on the next ledger,
// with the counter, the review and the cap all left behind (H05). So the ledger is bound to the
// private family at its first administrative call or exercise and never moves: another ledger is
// refused, a renewal keeps the same family and therefore the same ledger, and the two guarantees
// this capability rests on cannot be restarted by choosing a different object. The family, not the
// handle, is the key, so renewing a permission cannot hand the caller a fresh account.
//
// What this does NOT do: keep the ledger across a process. The binding lives in this process's
// memory, so a host that does not persist and restore its ledger has no counter to restore, and a
// restart is indistinguishable from a first grant. That is a durability limit, declared as one.
const FAMILY_LEDGER = new WeakMap();
const FOREIGN_LEDGER = 'this emergency permission is bound to the ledger it was first used with, and this kernel will not read or change its record through another one';

// Binds the family to the ledger on first sight, or refuses a ledger this family does not live in.
// Refusal is not an error the caller can retry away: it is the answer, and every reader of a record
// in the wrong ledger fails closed.
function bindLedger(ledger, family) {
  const held = FAMILY_LEDGER.get(family);
  if (held === undefined) {
    FAMILY_LEDGER.set(family, ledger);
    return true;
  }
  return held === ledger;
}

function newRecord() {
  return {
    family: null, uses: 0, paused: false, revoked: false, stopped: false, rejectedUse: null,
    pending: null, useIds: new Set(), signalIds: new Set(), busy: false,
  };
}

// The public id is not an identity. Two different people may hold two real grants that happen to
// share an id, and one person's reviewer must not close the other's review nor one person's owner
// revoke the other's authority. So every record remembers the private family that opened it, and
// only that family may read or move it. The token never travels and cannot be built by a caller,
// so a collision fails closed: nothing is spent, nothing changes and nothing is revealed (R201,
// R202). A renewal keeps the same token, because a longer clock is the same grant, not a new one.
const FOREIGN_RECORD = 'the emergency record under this id was opened by a different grant, so this kernel neither reads nor changes it';

// Opens the record for this family, or refuses: this is the only path that creates one, and it
// refuses rather than letting a second family take an id that is already in use.
function claimRecord(records, id, family) {
  const existing = records.get(id);
  if (!existing) {
    const record = newRecord();
    record.family = family;
    records.set(id, record);
    return { ok: true, record };
  }
  return existing.family === family ? { ok: true, record: existing } : { ok: false, reason: FOREIGN_RECORD };
}

// Reading is not claiming: a record nobody opened yet stays absent instead of being created, and a
// record that belongs to another family is not read at all.
function readRecord(records, id, family) {
  const existing = records.get(id);
  if (!existing) return { ok: true, record: null };
  return existing.family === family ? { ok: true, record: existing } : { ok: false, reason: FOREIGN_RECORD };
}

function assetOf(id) {
  return `emergency-use:${id}`;
}

function grantOf(snapshot) {
  if (!snapshot) return [];
  return [{
    asset: assetOf(snapshot.id),
    maxAmount: String(snapshot.maxUses),
    to: snapshot.destination,
    expiresAt: iso(snapshot.expiresAt),
  }];
}

// Coverage is read the way receipt.js reads it: a check counts only when it passed.
function coverageOf(checks) {
  const covered = [];
  for (const key of Object.keys(checks)) if (checks[key] === true) covered.push(key);
  return covered;
}

// And a check that did not pass is not covered, which is the other half of the same rule and what
// receipt.js puts at the head of `notCovered`. A blocked receipt used to name `trigger_verified` and
// stay silent about a `grantor_authority` that came back false, so a consumer reading `notCovered`
// to learn what was not proven was told nothing about the grant (H01).
function failedChecks(checks) {
  const failed = [];
  for (const key of Object.keys(checks)) if (checks[key] !== true) failed.push(key);
  return failed;
}

function seal(receipt) {
  const next = { ...receipt };
  delete next.digest;
  next.digest = computeDigest(next);
  return freeze(next);
}

// The normalized grant as the host and the permission see it: the same object shape, with the clock
// as the ISO strings a receipt can carry. Everything the kernel compares stays in milliseconds.
function grantView(snapshot) {
  return {
    id: snapshot.id,
    owner: snapshot.owner,
    grantee: snapshot.grantee,
    destination: snapshot.destination,
    purpose: snapshot.purpose,
    actions: [...snapshot.actions],
    scope: [...snapshot.scope],
    startsAt: iso(snapshot.startsAt),
    expiresAt: iso(snapshot.expiresAt),
    maxUses: snapshot.maxUses,
    triggers: snapshot.triggers.map((trigger) => ({ ...trigger })),
    reviewers: [...snapshot.reviewers],
    reviewDueMs: snapshot.reviewDueMs,
    pausers: [...snapshot.pausers],
  };
}

// What was authorized and what was asked for, sealed next to the digest. Without it a receipt said
// which permission it spent but not whose authority, not which agent, and not which subject was
// touched: two different uses of the same permission sealed the same body. Only normalized values
// go in, and the subject only as the operational reference it was validated to be.
function authorizationOf(snapshot, asked) {
  if (!snapshot) return null;
  return {
    owner: snapshot.owner,
    grantee: snapshot.grantee,
    destination: snapshot.destination,
    action: asked && asked.action ? asked.action : null,
    subject: asked && asked.subject ? asked.subject : null,
    grantDigest: fingerprint(grantView(snapshot)),
  };
}

function blockedReceipt({ snapshot, authority, action, signalId, reason, at }) {
  // `grantor_authority` is read from the binding that was actually checked, never from the shape of
  // an object: a forged permission that happens to be well formed claims nothing.
  const checks = { grantor_authority: authority === true, trigger_verified: false };
  const receipt = {
    status: 'blocked',
    operation: { id: snapshot ? snapshot.id : 'unknown', goal: snapshot ? snapshot.purpose : DEFAULT_GOAL },
    ...(action ? { action } : {}),
    capability: CAPABILITY,
    authority: {
      grants: grantOf(snapshot),
      exercised: [],
      ...(snapshot && snapshot.approval ? { approval: snapshot.approval } : {}),
    },
    outcome: 'blocked',
    evidence: signalId ? { signalId } : null,
    verification: { verified: false, checks, reason },
    coverage: coverageOf(checks),
    notCovered: [...failedChecks(checks), 'effect_verified', 'external anchor', 'exact_state'],
    anchor: { ...PENDING_ANCHOR },
    ...(authority === true ? { authorization: authorizationOf(snapshot, action ? { action } : null) } : {}),
    detail: reason,
    at,
  };
  return seal(receipt);
}

// The receipt is built here rather than through buildReceipt because the two facts this capability
// has to carry — which trigger verified the signal, and the review that is still open — have no
// field in the common shape. Everything buildReceipt guarantees is kept: status, capability,
// authority grants and exercised amounts, declared coverage, a pending anchor, and a digest that
// verifyReceipt recomputes. The effect itself is never claimed verified: the exercise is a grant
// spent, not an effect proven, and the operation goes back to the person (decision 27).
function useReceipt(snapshot, asked, trigger, checked, dueAtMs, signalDigest) {
  const signalId = asked.signal.id;
  const checks = { grantor_authority: true, trigger_verified: true, effect_verified: false };
  const receipt = {
    status: 'not_verified',
    operation: { id: snapshot.id, goal: snapshot.purpose },
    action: asked.action,
    capability: CAPABILITY,
    authority: {
      grants: grantOf(snapshot),
      exercised: [{ asset: assetOf(snapshot.id), maxAmount: '1', to: snapshot.destination }],
      ...(snapshot.approval ? { approval: snapshot.approval } : {}),
    },
    outcome: 'not_verified',
    evidence: { signalId },
    verification: {
      verified: false,
      checks,
      reason: 'trigger verified by an independent signal; the effect is unverified and the post-use review is open',
    },
    coverage: coverageOf(checks),
    // `exact_state` is named here because this module cannot see it: it never reads the repository,
    // the disk or the network, so decision 22 stays open and the receipt says so out loud.
    notCovered: ['effect_verified', 'post_use_review', 'external anchor', 'exact_state'],
    anchor: { ...PENDING_ANCHOR },
    authorization: authorizationOf(snapshot, asked),
    trigger: {
      id: trigger.id,
      verifierId: trigger.verifierId,
      signalId,
      // A digest of the very body the verifier received, so the receipt is bound to that signal and
      // not merely to an id anybody could reuse. The body itself never travels. The digest was
      // computed and checked before the verifier was asked, so it is a hash or this call never got
      // here: there is no path left that seals a null fingerprint next to a verified trigger.
      signalDigest,
      signalSource: asked.signal.source,
      verification: { verified: true, reason: checked.reason },
    },
    review: { status: 'pending', reviewers: [...snapshot.reviewers], dueAt: iso(dueAtMs) },
    useId: asked.useId,
    at: asked.at,
  };
  return seal(receipt);
}

// ─── The grant ────────────────────────────────────────────────────────────────────────────────

async function createEmergencyPermission(grant, options = {}) {
  const deps = readOptions(options, ['authenticate', 'authorizeGrantor', 'resolveVerifier', 'authorizeRenewal']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  const { authenticate, authorizeGrantor, resolveVerifier, authorizeRenewal } = deps;
  const read = snapshotPermission(grant);
  if (!read.ok) throw new Error(`emergency permission is malformed: ${read.reason}`);
  const snapshot = read.snapshot;
  // The door comes first, before the grantor is even asked: a permission whose callers cannot be
  // authenticated is not an authority this kernel is willing to hold, whoever signed it.
  if (typeof authenticate !== 'function') {
    throw new Error('an injected authenticate port is required: this kernel cannot see who is calling, and a declared name is not a caller');
  }
  const people = askPeople(authenticate, snapshot);
  if (!people.ok) throw new Error(people.reason);
  if (typeof authorizeGrantor !== 'function') throw new Error('an injected grantor authority check is required: the kernel cannot see who granted this');
  // The candidate is read once, frozen, and is the single source from here on: the host authorizes
  // this object and the permission is built from this object. A second read of the caller's grant
  // would let the grantor answer about one scope while the kernel binds another (ADV05).
  const candidate = freeze(grantView(snapshot));
  const grantDigest = fingerprint(candidate);
  // A grant this kernel cannot fingerprint is refused at the door, before the host is asked and
  // before anything is bound. The authority a receipt carries is a digest of the normalized grant, and
  // a null one is not a weaker proof: it is no proof, while the permission, the ledger and the counter
  // behind it behave exactly as if the grant had been signed. 4096 actions fit the value budget of
  // this walk only to be refused by it, and used to be authorized with `grantDigest: null` in every
  // receipt the permission ever sealed (A03, R413).
  if (!grantDigest) {
    throw new Error(`this emergency grant is refused because ${fingerprintFailure(candidate)}, and a grant this kernel cannot fingerprint carries no authority: no receipt of it could name what was granted`);
  }
  let granted;
  try {
    granted = await authorizeGrantor(candidate);
  } catch {
    throw new Error('the grantor authority could not be verified');
  }
  // The host's answer is read once per field and inside one error boundary. An answer whose
  // `verified` or `grantor` cannot be read has authorized nothing, and the text of whatever it threw
  // on the way belongs to the host: the caller is told a fixed sentence and nothing else (R204,
  // R205). A failing read never leaves a half-granted permission behind, because nothing has been
  // bound yet.
  let verified;
  let grantor;
  let rawReason;
  try {
    const answered = granted && typeof granted === 'object' ? granted : null;
    verified = answered ? answered.verified : undefined;
    grantor = answered ? answered.grantor : undefined;
    rawReason = answered ? answered.reason : undefined;
  } catch {
    throw new Error('the grantor authority answer could not be read safely');
  }
  if (verified !== true) {
    throw new Error('the grantor authority check did not verify this grant');
  }
  if (grantor !== snapshot.owner) {
    throw new Error(`grantor authority does not name the owner of this emergency permission (${snapshot.owner})`);
  }
  if (typeof resolveVerifier !== 'function') throw new Error('an injected trigger verifier resolver is required: the kernel cannot know what verifies a signal');
  const verifiers = new Map();
  for (const trigger of snapshot.triggers) {
    let verifier;
    try {
      verifier = await resolveVerifier(trigger.verifierId);
    } catch {
      throw new Error(`the independent verifier for trigger ${trigger.id} could not be resolved`);
    }
    // Same rule for the resolved verifier: read `id` and `verify` once each, validate those
    // variables, and bind exactly those. A getter that answers a good id first and a different
    // `verify` afterwards must not leave the kernel validating one function and calling another
    // (R203).
    let verifierId;
    let verify;
    try {
      const resolved = verifier && typeof verifier === 'object' ? verifier : null;
      verifierId = resolved ? resolved.id : undefined;
      verify = resolved ? resolved.verify : undefined;
    } catch {
      throw new Error(`the resolved verifier for trigger ${trigger.id} could not be read safely`);
    }
    if (verifierId !== trigger.verifierId || typeof verify !== 'function') {
      throw new Error(`the resolved verifier is not the independent verifier ${trigger.verifierId} declared for trigger ${trigger.id}`);
    }
    verifiers.set(trigger.id, { id: verifierId, verify });
  }
  const bound = {
    snapshot: { ...snapshot, approval: safeText(rawReason) || 'the grantor authority check named the owner of this permission' },
    verifiers,
    // A renewal grows the authority a person signed, so it needs a fresh answer from the host. The
    // approver is bound here and never chosen by whoever renews; when the host supplies none, the
    // clock simply cannot be extended (ADV04).
    approver: typeof authorizeRenewal === 'function' ? authorizeRenewal : null,
    grantDigest,
    // The private family of this one grant, born here and kept by every renewal of it.
    family: Object.freeze({}),
    // Who everybody in this grant is, as the host's port vouched for it at the moment of granting.
    // Never read back from a caller: a `by` is compared against these and against nothing else.
    people: people.people,
  };
  const permission = freeze({
    ...candidate,
    grantVerification: {
      verified: true,
      reason: bound.snapshot.approval,
    },
  });
  BINDINGS.set(permission, bound);
  return permission;
}

function createEmergencyLedger() {
  const ledger = Object.freeze({});
  LEDGER.set(ledger, new Map());
  return ledger;
}

function bindingOf(permission) {
  try {
    return BINDINGS.get(permission) || null;
  } catch {
    return null;
  }
}

function boundVerifier(bound, triggerId) {
  try {
    return bound ? bound.verifiers.get(triggerId) || null : null;
  } catch {
    return null;
  }
}

// ─── The exercise ─────────────────────────────────────────────────────────────────────────────

// The options of every entry point in this module are read by `readOptions`, once, through their own
// descriptors, and a missing or unusable one is answered with a fixed sentence. A destructuring
// default only answers for `undefined`, so a caller who passed `null` used to get a raw `TypeError`
// out of six public functions (H19), and a getter inside an options bag used to throw its own
// exception out of all seven (R301). This module promises to fail closed on an input it cannot read.

// Everything a nested call could have changed while the verifier ran: what the person decided about
// this permission, and what this very call already spent.
function pendingBlock(record, snapshot, asked) {
  if (record.revoked) return 'this emergency permission was revoked by the person who granted it';
  if (record.stopped) return `this emergency permission was stopped: the post-use review of ${record.rejectedUse} was rejected, and it needs a new grant`;
  if (record.paused) return 'this emergency permission is paused';
  if (record.uses >= snapshot.maxUses) return `the emergency use limit is exhausted (${record.uses} of ${snapshot.maxUses})`;
  if (record.useIds.has(asked.useId)) return `emergency use ${asked.useId} was already used; a replay under another request key is refused`;
  if (asked.signal && record.signalIds.has(asked.signal.id)) return `trigger signal ${asked.signal.id} already opened a use; one signal opens one use`;
  if (record.pending) return `the post-use review of ${record.pending.useId} is still pending, so no second use is allowed`;
  return null;
}

// The verdict is read once per field and inside the same error boundary as the call itself. A
// verifier whose `verified` or `reason` cannot be read has not verified anything, and the reason
// that travels to the receipt is the bounded primitive this function produced — never an object,
// never the text of an exception raised by a getter (ADV08, ADV09, ADV25).
function verifySignal(verifier, trigger, signal, signalDigest) {
  // Both copies are made, and the fingerprint of the body is required, before the verifier is
  // called: this kernel never hands a body it could not hash, and never reserves a use it could not
  // seal. NOT_REPRESENTABLE is an internal marker and never reaches the callback.
  let triggerCopy;
  let bodyCopy;
  let checked;
  try {
    triggerCopy = canonical(trigger);
    bodyCopy = canonical(signal.body);
    if (!signalDigest || triggerCopy === NOT_REPRESENTABLE || bodyCopy === NOT_REPRESENTABLE) {
      return { ok: false, reason: 'the trigger signal has no representation this kernel can hand over and seal, so nothing was verified' };
    }
    // The verifier gets copies: it may do whatever it likes with them, and the body the kernel seals a
    // digest of is the one it actually handed over.
    checked = verifier.verify(triggerCopy, bodyCopy);
  } catch {
    return { ok: false, reason: 'the independent trigger verification failed' };
  }
  try {
    if (checked && (typeof checked === 'object' || typeof checked === 'function') && typeof checked.then === 'function') {
      Promise.resolve(checked).catch(() => {});
      return { ok: false, reason: 'the independent trigger verification answered asynchronously, which this kernel does not wait for' };
    }
  } catch {
    return { ok: false, reason: 'the independent trigger verification could not be read' };
  }
  let verified;
  let rawReason;
  try {
    verified = checked && typeof checked === 'object' ? checked.verified : undefined;
    rawReason = checked && typeof checked === 'object' ? checked.reason : undefined;
  } catch {
    return { ok: false, reason: 'the independent trigger verification could not be read' };
  }
  if (verified !== true) return { ok: false, reason: 'the trigger signal was not independently verified' };
  return { ok: true, reason: safeText(rawReason) || 'verified by the injected independent verifier' };
}

function exerciseEmergency(permission, request, options = {}) {
  const read = snapshotPermission(permission);
  const snapshot = read.ok ? read.snapshot : null;
  const asked = snapshotRequest(request);
  const deps = readOptions(options, ['ledger', 'now']);
  const ledger = deps ? deps.ledger : undefined;
  const clock = deps ? readClock(deps.now) : { ok: false, reason: UNREADABLE_OPTIONS };
  const bound = bindingOf(permission);
  const authority = bound !== null;
  const fail = (reason, at, signalId) => ({
    state: 'blocked',
    reason,
    nextUse: 'blocked',
    receipt: blockedReceipt({
      snapshot, authority, at, reason, signalId,
      action: asked ? asked.action : null,
    }),
  });
  if (!clock.ok) return fail(clock.reason, iso(Date.now()));
  const at = iso(clock.now);
  if (!snapshot) return fail(`the emergency permission could not be read safely: ${read.reason}`, at);
  if (!asked) return fail('the emergency request could not be read safely', at);
  if (asked.oversized.length) {
    return fail(`the emergency request names ${asked.oversized.join(', ')} with more than ${MAX_TEXT} characters, and this kernel seals no text longer than that`, at);
  }
  const records = readRecords(ledger);
  if (!records) return fail('a kernel emergency ledger is required to exercise emergency access', at, asked.signal ? asked.signal.id : null);
  // Readable is not granted: only the object the grant path produced carries authority.
  if (!bound) return fail('no grant is bound to this emergency permission: an object that did not come through the grant path exercises nothing', at, asked.signal ? asked.signal.id : null);
  // And the record only answers in the ledger this grant was first used with. A second ledger is a
  // record that never saw the cap, the review or the revocation, so it is refused before anything is
  // looked at and nothing is spent (H05).
  if (!bindLedger(ledger, bound.family)) return fail(FOREIGN_LEDGER, at, asked.signal ? asked.signal.id : null);
  const claimed = claimRecord(records, snapshot.id, bound.family);
  if (!claimed.ok) return fail(claimed.reason, at, asked.signal ? asked.signal.id : null);
  const record = claimed.record;

  // Order matters twice over. Replay is checked before the pending review, so a caller replaying a
  // use is told it is a replay instead of being told the review is open. And revocation, pause and
  // the clock are checked before the signal is looked at, so a permission the person already stopped
  // never spends a verifier call.
  const blocked = pendingBlock(record, snapshot, asked);
  if (blocked) return fail(blocked, at, asked.signal ? asked.signal.id : null);
  if (clock.now < snapshot.startsAt) return fail(`this emergency permission is not valid before ${iso(snapshot.startsAt)}`, at, asked.signal ? asked.signal.id : null);
  if (clock.now >= snapshot.expiresAt) return fail(`this emergency permission expired at ${iso(snapshot.expiresAt)}`, at, asked.signal ? asked.signal.id : null);
  if (!asked.useId) return fail('the emergency request carries no stable use id, so it could not be told apart from a replay', at, asked.signal ? asked.signal.id : null);
  if (asked.actor !== snapshot.grantee) return fail(`the actor is outside the granted authority (${snapshot.grantee})`, at, asked.signal ? asked.signal.id : null);
  if (asked.subjectRejected) {
    return fail('the subject is not an operational reference, and this kernel will not seal record content into a receipt', at, asked.signal ? asked.signal.id : null);
  }
  if (!snapshot.actions.includes(asked.action) || !snapshot.scope.includes(asked.subject)
    || asked.destination !== snapshot.destination) {
    return fail('the requested action, subject or destination is outside the granted scope', at, asked.signal ? asked.signal.id : null);
  }
  const trigger = snapshot.triggers.find((item) => item.id === asked.triggerId);
  if (!trigger) return fail('the trigger was not declared in advance by the person who granted this permission', at, asked.signal ? asked.signal.id : null);
  if (!asked.signal) {
    return fail(`the emergency request carries no trigger signal${asked.signalProblem ? `, or one this kernel refused because ${asked.signalProblem}` : ', or one this kernel cannot read safely'}`, at);
  }
  if (asked.signal.source !== trigger.verifierId) return fail(`the trigger signal does not come from the declared verifier ${trigger.verifierId}`, at, asked.signal.id);
  if (!asked.signal.id) return fail('the trigger signal carries no id, so it could not be told apart from a replay', at);
  const verifier = boundVerifier(bound, trigger.id);
  if (!verifier) return fail(`no independent verifier is bound to this emergency permission for trigger ${trigger.id}; a permission that did not go through the grant path exercises nothing`, at, asked.signal.id);
  // The review deadline is checked before the verifier is asked and before anything is reserved: a
  // deadline no calendar can hold must not spend a verifier call and then fail to stamp a review.
  const dueAtMs = clock.now + snapshot.reviewDueMs;
  if (parseTime(dueAtMs) === null) {
    return fail('the post-use review deadline falls outside the calendar this kernel can hold, so the use spends nothing', at, asked.signal.id);
  }
  // The fingerprint of the signal is taken and required before anything is verified or reserved. A
  // body this kernel cannot hash faithfully is refused while it still costs nothing, rather than
  // being verified and then sealed with no evidence at all.
  const signalDigest = fingerprint(asked.signal.body);
  if (!signalDigest) {
    return fail('the trigger signal has no representation this kernel can hash and seal, so the use spends nothing', at, asked.signal.id);
  }

  // Synchronous is not the same as unreentrant. The verifier is caller code running inside this
  // call: a verifier that re-enters `exerciseEmergency` on the same permission would otherwise find
  // the cap unspent and open a second use out of one signal. The record is held for the whole run
  // and released in `finally`, so a nested call is blocked and spends nothing.
  if (record.busy) {
    return fail('a use of this emergency permission is already being checked in this same run; one signal opens one use', at, asked.signal.id);
  }
  record.busy = true;
  try {
    const checked = verifySignal(verifier, trigger, asked.signal, signalDigest);
    if (!checked.ok) return fail(checked.reason, at, asked.signal.id);
    // Everything the verifier could have changed with a side effect gets read again: a person who
    // revoked the permission while the sensor was thinking has already said no (ADV07).
    const changed = pendingBlock(record, snapshot, asked);
    if (changed) return fail(`${changed} while the signal was being verified`, at, asked.signal.id);
    // The receipt is sealed before the cap moves. A receipt that cannot be built spends nothing, and
    // the slot it would have taken stays available to the next honest caller.
    let receipt;
    try {
      receipt = useReceipt({ ...snapshot, approval: bound.snapshot.approval }, { ...asked, at }, trigger, checked, dueAtMs, signalDigest);
    } catch {
      return fail('the receipt for this use could not be sealed, so nothing was spent', at, asked.signal.id);
    }
    record.uses += 1;
    record.useIds.add(asked.useId);
    record.signalIds.add(asked.signal.id);
    // Only the open review keeps its receipt. A closed one was already handed to whoever exercised
    // the permission, and the record used to keep every receipt it ever sealed for the life of the
    // ledger, which is retention this kernel has no use for and no bound on.
    record.pending = { useId: asked.useId, triggerId: trigger.id, dueAtMs, receipt };
    return { state: 'review_pending', reason: null, nextUse: 'blocked_until_review', receipt };
  } finally {
    record.busy = false;
  }
}

// ─── The post-use review ─────────────────────────────────────────────────────────────────────

function requireBinding(permission, bound, verb) {
  if (bound) return bound;
  throw new Error(`this emergency permission carries no grant: no authority is bound to it, so it cannot be ${verb}`);
}

// Who signed this call, as far as this kernel can know: a principal the host's own port issued at the
// grant. A string is not one, an object nobody issued is not one, and the answer to anything else is
// the refusal below rather than a name this kernel would have to trust. The second question, which of
// the grant's principals this is, is asked by each transition below.
function signedBy(bound, by) {
  if (!by || typeof by !== 'object' || !PRINCIPALS.has(by)) throw new Error(NO_PRINCIPAL);
  return by;
}

// The agent that spends the authority is not a person who may decide about it, whatever the grant
// declares and whatever principal the host issued for it: independence is a relation between
// principals, so it is checked here as one (A01).
function refuseGrantee(bound, by) {
  if (samePrincipal(by, bound.people.grantee)) {
    throw new Error(`the principal that signed this call is the agent that exercised the authority (${bound.snapshot.grantee}), so it cannot decide about its own use`);
  }
}

// The name behind a principal, which is what a receipt carries. The receipt keeps reporting the
// declared name, because that is what the grant digest and the authorized grant were made of; the
// proof that the caller was that person is the host's and does not travel.
function namedPrincipal(list, by, message) {
  const entry = list.find((item) => samePrincipal(item.principal, by));
  if (!entry) throw new Error(message);
  return entry.name;
}

function reviewEmergencyUse(permission, useId, options = {}) {
  const deps = readOptions(options, ['ledger', 'by', 'decision', 'now']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  const { ledger, by, decision, now } = deps;
  const bound = requireBinding(permission, bindingOf(permission), 'reviewed');
  // Owner, reviewers and pausers are read from the grant that was actually authorized, not from the
  // object this caller happens to be holding.
  const snapshot = bound.snapshot;
  if (!text(useId)) throw new Error('a review names the use it closes');
  if (decision !== 'accept' && decision !== 'reject') throw new Error('review decision must be accept or reject');
  const signer = signedBy(bound, by);
  refuseGrantee(bound, signer);
  const reviewer = namedPrincipal(bound.people.reviewers, signer,
    `not authorized to close this emergency review: reviewers are [${snapshot.reviewers.join(', ')}]`);
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to close an emergency review');
  if (!bindLedger(ledger, bound.family)) throw new Error(FOREIGN_LEDGER);
  const found = readRecord(records, snapshot.id, bound.family);
  if (!found.ok) throw new Error(found.reason);
  const record = found.record;
  if (!record || !record.pending || record.pending.useId !== useId) throw new Error('no matching pending emergency review');
  // Read before anything moves: a review closed with a clock nobody injected would be stamped with
  // wall time and would look like the person decided at a moment she was never asked about.
  const clock = readClock(now);
  if (!clock.ok) throw new Error(clock.reason);
  const reviewedAt = iso(clock.now);
  const original = record.pending.receipt;
  if (!original || !original.review) throw new Error('the receipt for this use is not in the record, so nothing can be closed over it');
  // A review cannot predate the use it closes. A clock that walked backwards would stamp the
  // decision before the event, and the ledger and the open review stay exactly as they were.
  const usedAt = parseTime(original.at);
  if (usedAt === null || clock.now < usedAt) {
    throw new Error('a post-use review cannot be dated before the use it closes: the injected clock went backwards');
  }
  // Closing the review is a transition that actually happened, so the receipt says it happened: the
  // check is derived from this call, the reason stops saying the review is open, and the effect
  // stays unverified either way. Accepting a review does not claim anybody read the document.
  const checks = { ...original.verification.checks, post_use_review: true };
  const closed = seal({
    ...original,
    verification: {
      ...original.verification,
      checks,
      reason: decision === 'accept'
        ? 'trigger verified by an independent signal; the post-use review was closed by a declared reviewer; the effect is unverified'
        : 'trigger verified by an independent signal; the post-use review was rejected by a declared reviewer; the effect is unverified',
    },
    coverage: coverageOf(checks),
    notCovered: original.notCovered.filter((key) => key !== 'post_use_review'),
    review: { ...original.review, status: 'reviewed', decision, by: reviewer, reviewedAt },
  });
  record.pending = null;
  // A rejection is the person saying the use was not hers. It stops the permission: it cannot be
  // resumed, and undoing the effect is not something this kernel can do.
  if (decision === 'reject') {
    record.stopped = true;
    record.rejectedUse = useId;
  }
  return closed;
}

// ─── Pause, revocation and renewal (decision 16: the agreement says who may pause) ──────────────

// The state these three answer with is read with the clock the caller injected. It used to be read
// with `{ ledger }` alone, so a `now` in the options was dropped on the floor and the state was
// decided against the wall clock: a caller that had been working with a fixed clock all along got
// an answer about a moment nobody asked about, and the existing suite already passed a `now` to
// `revokeEmergencyPermission` without ever seeing it arrive (H03).
function pauseEmergencyPermission(permission, options = {}) {
  const deps = readOptions(options, ['ledger', 'by', 'now']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  const { ledger, by, now } = deps;
  const bound = requireBinding(permission, bindingOf(permission), 'paused');
  const snapshot = bound.snapshot;
  const signer = signedBy(bound, by);
  refuseGrantee(bound, signer);
  namedPrincipal(bound.people.pausers, signer, `not authorized to pause: pausers are [${snapshot.pausers.join(', ')}]`);
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to pause an emergency permission');
  if (!bindLedger(ledger, bound.family)) throw new Error(FOREIGN_LEDGER);
  const claimed = claimRecord(records, snapshot.id, bound.family);
  if (!claimed.ok) throw new Error(claimed.reason);
  claimed.record.paused = true;
  return emergencyState(permission, ledger, now);
}

function resumeEmergencyPermission(permission, options = {}) {
  const deps = readOptions(options, ['ledger', 'by', 'now']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  const { ledger, by, now } = deps;
  const bound = requireBinding(permission, bindingOf(permission), 'resumed');
  const snapshot = bound.snapshot;
  const signer = signedBy(bound, by);
  // A pause is the owner stopping the agent. Lifting it has to be somebody's decision and not
  // something the agent undoes by saying the owner's name, or accepting a pause would be a formality
  // the grantee could revoke whenever it suited (A01, R414).
  refuseGrantee(bound, signer);
  namedPrincipal(bound.people.pausers, signer, `not authorized to resume: pausers are [${snapshot.pausers.join(', ')}]`);
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to resume an emergency permission');
  if (!bindLedger(ledger, bound.family)) throw new Error(FOREIGN_LEDGER);
  const claimed = claimRecord(records, snapshot.id, bound.family);
  if (!claimed.ok) throw new Error(claimed.reason);
  const record = claimed.record;
  if (record.revoked) throw new Error('a revoked emergency permission cannot be resumed');
  if (record.stopped) throw new Error(`this emergency permission was stopped by the rejected review of ${record.rejectedUse}; resuming it is not what the person decided, so it needs a new grant`);
  record.paused = false;
  return emergencyState(permission, ledger, now);
}

function revokeEmergencyPermission(permission, options = {}) {
  const deps = readOptions(options, ['ledger', 'by', 'now']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  const { ledger, by, now } = deps;
  const bound = requireBinding(permission, bindingOf(permission), 'revoked');
  const snapshot = bound.snapshot;
  // Revocation is the owner's own act and nobody else's: not a pauser, not a reviewer, not the agent.
  const signer = signedBy(bound, by);
  refuseGrantee(bound, signer);
  if (!samePrincipal(signer, bound.people.owner)) throw new Error('only the person who granted this emergency permission may revoke it');
  const records = readRecords(ledger);
  if (!records) throw new Error('a kernel emergency ledger is required to revoke an emergency permission');
  if (!bindLedger(ledger, bound.family)) throw new Error(FOREIGN_LEDGER);
  const claimed = claimRecord(records, snapshot.id, bound.family);
  if (!claimed.ok) throw new Error(claimed.reason);
  claimed.record.revoked = true;
  return emergencyState(permission, ledger, now);
}

// Renewal moves the clock and nothing else. The grant a person signed does not grow because time
// passed, and the record of what was already spent stays with the same id. The clock growing is
// still a growth of authority, so it needs the approver the host bound at grant time: nobody holding
// the object can hand the kernel its own approval, and a host that bound no approver cannot have the
// clock extended at all.
function renewEmergencyPermission(permission, changes) {
  const bound = requireBinding(permission, bindingOf(permission), 'renewed');
  const snapshot = bound.snapshot;
  let keys;
  try {
    keys = changes && typeof changes === 'object' && !Array.isArray(changes) ? Object.keys(changes) : [];
  } catch {
    keys = [];
  }
  // A `changes` that carries its own accessor is NOT refused here, and that is a decision, not an
  // oversight. The rule elsewhere in this module is one read per own descriptor, and this is one
  // read: the accessor is invoked exactly once, the value that was validated is the value that gets
  // stored, and there is no second look to disagree with. Refusing the shape would only contradict
  // the promise two earlier reviews already hold this module to (ADV18, ADV18R), for no gain in
  // authority. An own accessor is refused where a permission, a request or an options bag is read
  // field by field, because there a getter that answers twice would bind one thing and validate
  // another (H21, still red and marked in the hardening file).
  if (keys.length !== 1 || keys[0] !== 'expiresAt') {
    throw new Error('renewal cannot widen or alter the grant: only expiresAt may change, because the person signed the rest');
  }
  // One read. The value that was validated is the value that gets stored: a second read is how a
  // renewal stamps a clock nobody approved (ADV18).
  let rawExpiresAt;
  try {
    rawExpiresAt = changes.expiresAt;
  } catch {
    throw new Error('a renewal must extend the existing clock, and never shorten it');
  }
  const expiresAt = parseTime(rawExpiresAt);
  if (expiresAt === null || expiresAt <= snapshot.expiresAt) {
    throw new Error('a renewal must extend the existing clock, and never shorten it');
  }
  if (!bound.approver) {
    throw new Error(`no renewal approver is bound to this emergency permission: extending the clock needs a fresh authorization from ${snapshot.owner}, and this kernel cannot stand in for it`);
  }
  const candidate = freeze(grantView({ ...snapshot, expiresAt }));
  // The same door as at the grant, for the same reason. With `expiresAt` the only field a renewal may
  // touch, a candidate that fingerprints here fingerprinted when the person signed it, so this cannot
  // be reached without the first door having been passed; it is here so that neither path to a wider
  // clock can reach the approver with an authorization it cannot be sealed against (A03).
  if (!fingerprint(candidate)) {
    throw new Error(`this emergency renewal is refused because ${fingerprintFailure(candidate)}, and a grant this kernel cannot fingerprint carries no authority`);
  }
  let answer;
  try {
    answer = bound.approver(candidate);
  } catch {
    throw new Error('the renewal authorization could not be read');
  }
  // Whether this host answered asynchronously is a fact about this call, not a word to look for in
  // somebody else's exception: a private error that happens to contain `asynchronously` used to be
  // recognized, republished and escape to the caller (R207). An internal flag decides it, and the
  // promise is drained and refused rather than awaited.
  let asynchronous = false;
  try {
    asynchronous = Boolean(answer) && (typeof answer === 'object' || typeof answer === 'function')
      && typeof answer.then === 'function';
  } catch {
    throw new Error('the renewal authorization could not be read');
  }
  if (asynchronous) {
    try {
      Promise.resolve(answer).catch(() => {});
    } catch {
      // A thenable that throws on the second read is still a refusal, not a reason to keep waiting.
    }
    throw new Error('the renewal authorization answered asynchronously, which this kernel does not wait for');
  }
  // One read per field, inside one error boundary, and one reason: the sentence that seals the
  // public permission and the one the private binding remembers are the same value, read once. A
  // read that throws refuses the renewal and leaves the original grant exactly as usable as it was
  // (R206, R208).
  let verified;
  let grantor;
  let rawReason;
  try {
    const answered = answer && typeof answer === 'object' ? answer : null;
    verified = answered ? answered.verified : undefined;
    grantor = answered ? answered.grantor : undefined;
    rawReason = answered ? answered.reason : undefined;
  } catch {
    throw new Error('the renewal authorization could not be read');
  }
  if (verified !== true) {
    throw new Error(`the renewal authorization did not approve extending this emergency permission`);
  }
  if (grantor !== snapshot.owner) {
    throw new Error(`the renewal authorization does not name the owner of this emergency permission (${snapshot.owner})`);
  }
  const approval = safeText(rawReason) || snapshot.approval;
  const renewed = freeze({ ...clone(candidate), grantVerification: { verified: true, reason: approval } });
  BINDINGS.set(renewed, { ...bound, snapshot: { ...snapshot, expiresAt, approval } });
  return renewed;
}

// ─── What the operation says about itself ─────────────────────────────────────────────────────

function getEmergencyState(permission, options = {}) {
  const deps = readOptions(options, ['ledger', 'now']);
  if (!deps) throw new Error(UNREADABLE_OPTIONS);
  return emergencyState(permission, deps.ledger, deps.now);
}

// The state, read from a ledger and a clock this module already holds. The three administrative calls
// below answer with it too, and they used to reach it by calling the public function with an options
// bag they had just invented: one public entry point was entering another through a shape no caller
// ever passes. The options of a caller are now read exactly once, in one place, and everything below
// reads the record and the clock directly.
function emergencyState(permission, ledger, now) {
  const snapshot = readPermission(permission);
  if (!snapshot) throw new Error('emergency permission is malformed and has no state');
  const bound = bindingOf(permission);
  const records = readRecords(ledger);
  // A record this family does not live in is not read at all. Reading it would answer with a counter
  // that never saw the uses, and refusing to read leaves the honest answer, which is that this kernel
  // cannot say anything about that other ledger (H05).
  const foreignLedger = Boolean(records) && Boolean(bound) && FAMILY_LEDGER.get(bound.family) !== undefined
    && FAMILY_LEDGER.get(bound.family) !== ledger;
  // A ledger that exists but has never seen this id is a permission nobody has touched yet, not a
  // missing one: the reads below need a record either way. A record that belongs to another family
  // is not read at all, so this call can neither reveal nor answer for it.
  const found = !records || !bound || foreignLedger ? { ok: true, record: null } : readRecord(records, snapshot.id, bound.family);
  const foreign = !found.ok;
  const record = found.ok ? (found.record || newRecord()) : null;
  // `null` when this family's record lives in another ledger and was not read: zero would be a number
  // nobody measured, and a caller reading a capacity out of it would be reading a counter that never
  // saw the uses. A record of another family is a different case and keeps its honest zero: this
  // family's own count in this ledger really is zero, the other family's stays unrevealed.
  const uses = foreignLedger ? null : (record ? record.uses : 0);
  const clock = readClock(now);
  // A clock nobody injected and nobody could read is not replaced with wall time to decide whether
  // the permission is available: the honest answer is that this kernel does not know.
  const at = clock.ok ? clock.now : null;
  const pending = record && record.pending ? record.pending : null;
  const expired = at !== null && at >= snapshot.expiresAt;
  const exhausted = uses >= snapshot.maxUses;
  let status = 'active';
  let nextUse = 'allowed';
  // Without the ledger the exercise is blocked, so the state that says "available" would be a lie.
  if (!records) {
    status = 'no_ledger';
    nextUse = 'blocked_no_ledger';
  } else if (!bound) {
    status = 'unbound';
    nextUse = 'blocked_unbound';
  } else if (foreignLedger) {
    // This grant lives in another ledger, so the record that holds its cap, its revocation and its
    // rejected review is somewhere this call was not given. The honest answer is that this kernel
    // cannot answer for it.
    status = 'ledger_conflict';
    nextUse = 'blocked_ledger_conflict';
  } else if (foreign) {
    // The id belongs to another grant. The honest answer is that this kernel cannot answer for it,
    // and it says so instead of reporting another person's availability.
    status = 'record_conflict';
    nextUse = 'blocked_record_conflict';
  } else if (record.revoked) {
    status = 'revoked';
    nextUse = 'blocked_revoked';
  } else if (record.stopped) {
    status = 'stopped_by_review';
    nextUse = 'blocked_stopped';
  } else if (record.paused) {
    status = 'paused';
    nextUse = 'blocked_paused';
  } else if (pending) {
    status = 'review_pending';
    nextUse = 'blocked_until_review';
  } else if (record.busy) {
    // A use of this permission is being checked in this very run. A nested call would be refused
    // for that, and a state that answered `allowed` in the middle of it would be advertising a
    // slot the kernel is about to close. What the person revoked, stopped, paused or left pending
    // still outranks it.
    status = 'verifying';
    nextUse = 'blocked_verifying';
  } else if (!clock.ok) {
    status = 'unknown_clock';
    nextUse = 'blocked_unknown_clock';
  } else if (at < snapshot.startsAt) {
    status = 'not_yet_valid';
    nextUse = 'blocked_not_started';
  } else if (expired) {
    status = 'expired';
    nextUse = 'blocked_expired';
  } else if (exhausted) {
    status = 'exhausted';
    nextUse = 'blocked_exhausted';
  }
  return {
    id: snapshot.id,
    status,
    // A record this kernel did not read has no count, and zero would be a number nobody measured: a
    // caller reading a capacity out of it would be reading a counter that never saw the uses. Null
    // is the honest answer, and `status` says why (H05).
    uses,
    maxUses: snapshot.maxUses,
    remainingUses: uses === null ? null : Math.max(0, snapshot.maxUses - uses),
    expiresAt: iso(snapshot.expiresAt),
    paused: Boolean(record && record.paused),
    revoked: Boolean(record && record.revoked),
    pendingReview: pending ? pending.useId : null,
    reviewDueAt: pending ? iso(pending.dueAtMs) : null,
    reviewOverdue: pending !== null && at !== null && at > pending.dueAtMs,
    rejectedUse: record && record.rejectedUse ? record.rejectedUse : null,
    nextUse,
  };
}

module.exports = {
  createEmergencyPermission,
  createEmergencyLedger,
  exerciseEmergency,
  reviewEmergencyUse,
  pauseEmergencyPermission,
  resumeEmergencyPermission,
  revokeEmergencyPermission,
  getEmergencyState,
  renewEmergencyPermission,
};