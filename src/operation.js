'use strict';

// Minimal executable Vespi operation.
//
// Capability contract (a function-shaped object, nothing more):
//   { id, required(op) -> { spend: [{asset, amount, to}] }, perform(ctx) -> { ok, evidence?, error? } }
// The kernel never imports a specific capability. x402, Stellar, USDC live outside.
//
// Host callbacks may return a synchronous value or a native Promise. A non-native object/function
// that announces async work through `then` (including an accessor) is rejected closed without
// reading the accessor or invoking `then`; hosts must use native Promises for async callbacks.
// A proxy, or an object whose prototype chain holds one, is rejected before any trap runs, both as a
// direct return and as the value a native promise resolves to. The injected clock never has `then`
// read: any object it returns is an invalid time.
// runOperation(op, capability, { verify(evidence)->{verified,checks,reason}, ask(requirements)->{approved} }):
//   requirements -> authority sufficient? no -> NEEDS_HUMAN_DECISION (perform is not called; capability code is trusted in-process)
//   yes -> perform once -> failure? FAILED -> verify evidence -> verified? SUCCEEDED : NOT_VERIFIED
// The gate opens when the authority on hand does not cover the requirement, and also whenever the
// authority declares `signers`: a declared multi-person authority is always put to its people,
// because a grant that already covers the spend still needs its named identities to be counted.
// A grant that covers the spend and declares no `signers` runs without asking.

const { snapshotContext, readContextProperty, dataFields } = require('./context.js');
const { isPromise, isProxy } = require('node:util').types;
const { sufficient, attenuates } = require('./authority.js');
const { buildReceipt, computeDigest } = require('./receipt.js');
const { readZkClaim, readCatalogChecks, reconcileZk, ZK_INCONSISTENT_REASON, ZK_FOREIGN_CHECK_REASON,
  ZK_ECHO_REASON } = require('./zk.js');
const { createHash } = require('node:crypto');
const { parseTime } = require('./time.js');
const apply = Reflect.apply;
const stringify = JSON.stringify;
const NativePromise = Promise;
const promiseResolve = NativePromise.resolve.bind(NativePromise);
const promiseRace = NativePromise.race.bind(NativePromise);
const promiseThen = NativePromise.prototype.then;
const promiseFinally = NativePromise.prototype.finally;
const defer = (fn) => apply(promiseThen, promiseResolve(), [fn]);
// Un callback hostil en el mismo proceso puede alterar los intrínsecos de JavaScript; el aislamiento real requiere otro proceso.

function asyncReturnError() {
  const error = new Error('host callback returned a non-native thenable or an uninspectable value');
  error.code = 'VESPI_ASYNC_RETURN';
  return error;
}

// The value is kept only after it passed the guard: a refused return is never handed to a caller.
// A native promise is awaited, and what it resolves to passes the proxy guard too, because reading a
// proxy runs host code at every property the kernel touches.
function startHostCall(fn, args) {
  let value;
  const ready = defer(() => {
    const returned = apply(fn, undefined, args);
    if (isPromise(returned)) {
      return apply(promiseThen, returned, [(result) => {
        if (uninspectable(result)) throw asyncReturnError();
        value = result;
      }]);
    }
    if (announcesAsync(returned)) throw asyncReturnError();
    value = returned;
    return undefined;
  });
  return { ready, get value() { return value; } };
}

// A proxy, or an object that inherits from one, cannot be inspected without running host code: every
// descriptor, prototype or key query is a trap. `isProxy` answers from the engine without calling a
// trap, and `Object.getPrototypeOf` of an object that is not a proxy runs no host code either, so the
// walk below never executes code the host wrote. Every other object, exotic or not, answers
// descriptor queries without host code.
function uninspectable(value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    for (let current = value; current !== null; current = Object.getPrototypeOf(current)) {
      if (isProxy(current)) return true;
    }
  } catch {
    return true;
  }
  return false;
}

// True when the value announces asynchronous work (`then` callable or an accessor, own or inherited)
// or cannot be inspected without host code (a proxy anywhere in its chain). Proxies are refused before
// any trap is consulted; accessors are refused by their descriptor, never read.
function announcesAsync(value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    for (let current = value; current !== null; current = Object.getPrototypeOf(current)) {
      if (isProxy(current)) return true;
      const descriptor = Object.getOwnPropertyDescriptor(current, 'then');
      if (descriptor) return !('value' in descriptor) || typeof descriptor.value === 'function';
    }
  } catch {
    return true;
  }
  return false;
}

const STATES = {
  NEEDS_DECISION: 'needs_human_decision',
  RUNNING: 'running',
  SUCCEEDED: 'verified',
  FAILED: 'failed',
  NOT_VERIFIED: 'not_verified',
  BLOCKED: 'blocked',
  PAUSED: 'paused',
};

const DEFAULT_EXIT = 'return to the person: change the agreement or cancel';

// What a failure says. The text a port threw is not copied into a receipt, and not into the
// digest either: `detail` is sealed, so a raw SDK message carrying a url with a key in it would
// end up inside the chain of trust instead of outside it. This is the rule emergency.js and
// x402.js already apply; operation.js was the one module that did not.
// The only thing copied is `error.code`, and only when it looks like a code: uppercase letters,
// digits and underscores, at most 64. That is a token a host chose, not a sentence, and it
// cannot smuggle a url, a path or a body. Each call site supplies its own fixed phrase, because
// the phrase has to say which step failed, and the code alone never does.
// A port can also hand that text back as data instead of throwing it. `returnedCode` applies the
// same closed vocabulary to the returned `error`, because a sentence travels the same distance a
// thrown sentence does once it is sealed.
function failureCode(error) {
  try {
    const code = error && error.code;
    return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? ` [${code}]` : '';
  } catch {
    return '';
  }
}

function refused(error, phrase) {
  return `${phrase}${failureCode(error)}`;
}

// The sibling channel of the thrown text: `perform` may answer `{ ok: false, error }` instead of
// throwing, and that string was copied whole into `detail`, which is sealed. So a port could put a
// url with a key in it inside the chain of trust and verifyReceipt would bless it (R1 finding H1b,
// the channel H1 did not charter). The same rule as the thrown text: a free sentence never travels.
// What can travel is a token shaped like a code, uppercase letters, digits and underscores, at
// most 64, because that is a token the host chose rather than a sentence and it cannot smuggle a
// url, a path or a body. Everything else answers null and the call site says its own fixed phrase.
function returnedCode(error) {
  try {
    if (typeof error === 'string') return /^[A-Z0-9_]{1,64}$/.test(error) ? error : null;
    if (error == null || typeof error !== 'object') return null;
    const code = error.code;
    return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

// The closed vocabulary, spoken the way the port that wrote it already speaks it: when a port names
// its failure with a code-shaped token that token is the detail, which is the contract x402.js has
// always had (`PREPARE_FAILED`, `SEND_UNKNOWN`). When it hands free text over, the kernel answers its
// own fixed phrase and the text stays in the port. Either way `detail` is sealed and carries no
// sentence a host wrote.
function capabilityFailure(code, phrase) {
  return code ?? phrase;
}

const DEFAULT_OPERATION_TIMEOUT_MS = 15_000;

function readTimeout(io, key) {
  try {
    const value = io?.[key];
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_OPERATION_TIMEOUT_MS;
  } catch {
    return DEFAULT_OPERATION_TIMEOUT_MS;
  }
}

function isTimeout(error) {
  try {
    return error?.code === 'VESPI_TIMEOUT';
  } catch {
    return false;
  }
}

function withTimeout(value, timeoutMs, label, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
      }
      const error = new Error(`${label} timeout after ${timeoutMs}ms`);
      error.code = 'VESPI_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  return apply(promiseFinally, promiseRace([promiseResolve(value), timeout]), [() => clearTimeout(timer)]);
}

function readDecideThreshold(io) {
  try {
    const value = io?.decideThreshold;
    return Number.isFinite(value) ? value : 0.9;
  } catch {
    return 0.9;
  }
}

function readDecideTimeoutMs(io) {
  try {
    if (Number.isFinite(io?.decideTimeoutMs) && io.decideTimeoutMs > 0) return io.decideTimeoutMs;
  } catch {
  }
  return readTimeout(io, 'askTimeoutMs');
}

// Jev, Paper2Agent or any decision model: an optional connection (decision 20 of Vespi). It ADVISES:
// a confident suggestion is shown to the person on the ask payload, and it never consents for them
// (decisions 16 and 19; orchestrator review R42 before the 0.1.4 release).
async function consultDecisionModel(io, question) {
  try {
    const decideFn = io && typeof io.decide === 'function' ? io.decide : null;
    if (!decideFn) return null;
    const threshold = readDecideThreshold(io);
    let result;
    try {
      const call = startHostCall(decideFn, [question]);
      await withTimeout(call.ready, readDecideTimeoutMs(io), 'decision model');
      result = call.value;
    } catch {
      return null;
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const probability = result.probability;
    if (!Number.isFinite(probability) || probability < threshold) return null;
    const choice = result.choice;
    if (typeof choice !== 'boolean' && typeof choice !== 'string') return null;
    return { choice, probability, by: 'decision-model' };
  } catch {
    return null;
  }
}

function hasEvidence(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readCapabilityResult(result) {
  try {
    const code = returnedCode(result?.error);
    const reason = result?.reason;
    const exit = result?.exit;
    return {
      settlementUnknown: result?.settlementUnknown === true,
      impossible: result?.impossible === true,
      ok: result?.ok === true,
      // A code-shaped token or null, never the words of the port: `capabilityFailure` adds it to
      // the fixed phrase of the site that asks for it.
      error: code,
      reason: typeof reason === 'string' && reason.length > 0 ? reason : null,
      exit: typeof exit === 'string' && exit.length > 0 ? exit : null,
      evidence: result?.evidence ?? null,
      output: result?.output,
    };
  } catch (error) {
    return {
      settlementUnknown: true,
      impossible: false,
      ok: false,
      error: refused(error, 'the capability result could not be read'),
      reason: null,
      exit: null,
      evidence: null,
      output: undefined,
    };
  }
}

function readImpossibleDeclaration(declared) {
  try {
    if (!declared || typeof declared !== 'object') return null;
    if (declared.impossible !== true) return null;
    const reason = typeof declared.reason === 'string' && declared.reason.length > 0 ? declared.reason : 'impossible';
    const exit = typeof declared.exit === 'string' && declared.exit.length > 0 ? declared.exit : null;
    return { reason, exit };
  } catch {
    return null;
  }
}

function operationExit(op) {
  try {
    if (typeof op?.exit === 'string' && op.exit.length > 0) return op.exit;
  } catch {
  }
  return DEFAULT_EXIT;
}

let seq = 0;

function snapshotGoal(goal) {
  try {
    return typeof goal === 'string' ? goal : '';
  } catch {
    return '';
  }
}

// The action is the name the agreement knows this step by. A goal is free text written by a
// person; an action is the key continuity pairs a receipt with, so it travels in the receipt
// (R1 finding A2: a receipt that never writes its action cannot be paired with any agreement).
function snapshotAction(action) {
  try {
    return typeof action === 'string' && action.length > 0 ? action : null;
  } catch {
    return null;
  }
}

function snapshotAuthority(authority) {
  try {
    if (!authority || typeof authority !== 'object') return { spend: [] };
    const rawSpend = authority.spend;
    if (!Array.isArray(rawSpend)) {
      const snapshot = { spend: [], invalid: true };
      const rawPausers = authority.pausers;
      if (Array.isArray(rawPausers)) snapshot.pausers = rawPausers.filter((p) => typeof p === 'string' && p.length > 0);
      try {
        const rawSigners = authority.signers;
        if (rawSigners && typeof rawSigners === 'object' && !Array.isArray(rawSigners)) {
          const snapSigners = {};
          if (rawSigners.required !== undefined) snapSigners.required = rawSigners.required;
          if (Array.isArray(rawSigners.allowed)) snapSigners.allowed = rawSigners.allowed.filter((s) => typeof s === 'string' && s.length > 0);
          snapshot.signers = snapSigners;
        }
      } catch {
      }
      if (authority.approval) snapshot.approval = authority.approval;
      return snapshot;
    }
    const spend = rawSpend.map((grant) => {
      if (!grant || typeof grant !== 'object') return grant;
      const copy = { asset: grant.asset, maxAmount: grant.maxAmount, to: grant.to };
      for (const key of ['network', 'resource']) {
        const value = grant[key];
        if (value !== undefined) copy[key] = value;
      }
      if ((typeof grant.expiresAt === 'string' && grant.expiresAt.length > 0)
        || (typeof grant.expiresAt === 'number' && Number.isFinite(grant.expiresAt))) copy.expiresAt = grant.expiresAt;
      return copy;
    });
    const snapshot = { spend };
    try {
      const rawPausers = authority.pausers;
      if (Array.isArray(rawPausers)) snapshot.pausers = rawPausers.filter((p) => typeof p === 'string' && p.length > 0);
    } catch {
    }
    try {
      const rawSigners = authority.signers;
      if (rawSigners && typeof rawSigners === 'object' && !Array.isArray(rawSigners)) {
        const snapSigners = {};
        if (rawSigners.required !== undefined) snapSigners.required = rawSigners.required;
        if (Array.isArray(rawSigners.allowed)) snapSigners.allowed = rawSigners.allowed.filter((s) => typeof s === 'string' && s.length > 0);
        if (Array.isArray(rawSigners.approvals)) snapSigners.approvals = rawSigners.approvals.slice(0, 64);
        snapshot.signers = snapSigners;
      }
    } catch {
    }
    if (authority.approval) snapshot.approval = authority.approval;
    return snapshot;
  } catch {
    return { spend: [], invalid: true };
  }
}

function snapshotRequirements(requirements) {
  return requirements.map((requirement) => {
    if (!requirement || typeof requirement !== 'object') return requirement;
    return { asset: requirement.asset, amount: requirement.amount, to: requirement.to,
      ...(requirement.network !== undefined ? { network: requirement.network } : {}),
      ...(requirement.resource !== undefined ? { resource: requirement.resource } : {}) };
  });
}

function safeCapabilityId(capability) {
  try {
    const id = capability?.id;
    return typeof id === 'string' && id ? id : 'unknown';
  } catch {
    return 'unknown';
  }
}

function safeBuildReceipt(spec) {
  try {
    return buildReceipt(spec);
  } catch {
    let status = 'failed';
    try {
      if (spec?.outcome?.status === 'not_verified' || spec?.outcome?.status === 'needs_human_decision' || spec?.outcome?.status === 'failed' || spec?.outcome?.status === 'blocked') status = spec.outcome.status;
      if (spec?.outcome?.status === 'verified') status = 'not_verified';
    } catch {
      status = 'failed';
    }
    return {
      status,
      operation: { id: 'unknown', goal: '' },
      capability: 'unknown',
      authority: { grants: [], exercised: [] },
      outcome: status,
      evidence: null,
      verification: status === 'not_verified' ? { verified: false, checks: {}, reason: 'receipt construction failed' } : null,
      detail: 'receipt construction failed',
      at: new Date().toISOString(),
    };
  }
}

// The copy is built without a prototype on purpose. Assigning to `{}` runs the inherited
// `__proto__` setter, so a body carrying that key as its own property (JSON.parse makes one, and a
// receipts file read from disk is full of them) either changed this copy's prototype and lost the
// key or replaced it, and the key then never reached the sealed text: two different bodies hashed to
// the same digest and verifyReceipt answered ok on both (R1 finding H5). With no prototype there is
// no inherited setter, every key of the body becomes exactly the data property it was, and the
// string this returns for a body without that key is byte for byte the one a plain object gave.
// This is the copy emergency.js:497 already builds, and the reason it does.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function operationIdempotencyKey(op, requirements) {
  // Hash the canonical effect, never renewable permission metadata.
  const content = {
    goal: op.goal,
    action: op.action,
    requirements: Array.isArray(requirements) ? requirements.map((requirement) => {
      const amount = requirement?.amount;
      let canonicalAmount = amount;
      try {
        if (typeof amount === 'string' && /^\d+$/.test(amount)) canonicalAmount = BigInt(amount).toString();
      } catch {}
      return { asset: requirement?.asset, amount: canonicalAmount, to: requirement?.to };
    }) : requirements,
  };
  return createHash('sha256').update(stringify(canonicalize(content)), 'utf8').digest('hex');
}

// A checkpoint is the operation as data. It is sealed with the same `computeDigest` the receipt
// already uses, so nothing here is a second canonicalization. What the seal proves is integrity:
// the bytes did not move after the host wrote them. It does not prove authorship, because the digest
// has no key and whoever can rewrite the checkpoint can rewrite its digest and the `expectedDigest`
// the host keeps. That store belongs to the host (see decision §4).
const CHECKPOINT_KIND = 'vespi.operation.checkpoint';
const CHECKPOINT_VERSION = 1;
const CHECKPOINT_STATES = new Set(['created', ...Object.values(STATES)]);
// A terminal checkpoint carries no receipt, so reopening one cannot prove the effect was not
// exercised. It comes back blocked for reconciliation instead of running again.
const CHECKPOINT_TERMINAL = new Set([STATES.SUCCEEDED, STATES.FAILED, STATES.NOT_VERIFIED, STATES.BLOCKED]);

function checkpointRefusal(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function checkpointText(value) {
  return typeof value === 'string' && value.length > 0;
}

function checkpointAmount(value) {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
}

// The closed schema reads by data descriptor, reusing `dataFields` from context.js: an accessor or
// a proxy is refused, not consulted. `required` must be present and nothing outside both lists is
// allowed, so a key a later host invents does not travel into the sealed body.
function checkpointRecord(value, required, optional = []) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const own = Reflect.ownKeys(value);
    if (own.some((key) => typeof key !== 'string')) throw new TypeError();
    if (required.some((key) => !own.includes(key))) throw new TypeError();
    if (own.some((key) => !required.includes(key) && !optional.includes(key))) throw new TypeError();
    return dataFields(value, own);
  } catch {
    throw checkpointRefusal('checkpoint_invalid');
  }
}

// `dataFields` refuses empty arrays because context.sources needs at least one approved source.
// A checkpoint's spend and pausers are legitimately empty ("ask the person"), so the empty array is
// read here with the same descriptor rules: own `length` of zero and nothing else.
function checkpointEntries(array) {
  try {
    const length = Array.isArray(array) ? Object.getOwnPropertyDescriptor(array, 'length') : undefined;
    if (length && Object.hasOwn(length, 'value') && length.value === 0) {
      if (Object.getPrototypeOf(array) !== Array.prototype || Reflect.ownKeys(array).length !== 1) throw new TypeError();
      return [];
    }
    const fields = dataFields(array, null, true);
    const out = [];
    for (let i = 0; i < fields.length; i += 1) out.push(fields[i]);
    return out;
  } catch {
    throw checkpointRefusal('checkpoint_invalid');
  }
}

function checkpointAuthority(authority) {
  const fields = checkpointRecord(authority, ['spend'], ['pausers', 'signers']);
  if (!Array.isArray(fields.spend)) throw checkpointRefusal('checkpoint_invalid');
  const spend = checkpointEntries(fields.spend).map((grant) => {
    const entry = checkpointRecord(grant, ['asset', 'maxAmount'], ['to', 'network', 'resource', 'expiresAt']);
    if (!checkpointText(entry.asset) || checkpointAmount(entry.maxAmount) === null) throw checkpointRefusal('checkpoint_invalid');
    const out = { asset: entry.asset, maxAmount: entry.maxAmount };
    if (entry.to !== undefined) {
      if (!checkpointText(entry.to)) throw checkpointRefusal('checkpoint_invalid');
      out.to = entry.to;
    }
    for (const key of ['network', 'resource']) {
      if (entry[key] === undefined) continue;
      if (!checkpointText(entry[key])) throw checkpointRefusal('checkpoint_invalid');
      out[key] = entry[key];
    }
    if (entry.expiresAt !== undefined) {
      if (typeof entry.expiresAt !== 'string' && !(typeof entry.expiresAt === 'number' && Number.isFinite(entry.expiresAt))) {
        throw checkpointRefusal('checkpoint_invalid');
      }
      if (parseTime(entry.expiresAt) === null) throw checkpointRefusal('checkpoint_invalid');
      out.expiresAt = entry.expiresAt;
    }
    return out;
  });
  const out = { spend };
  if (fields.pausers !== undefined) {
    if (!Array.isArray(fields.pausers)) throw checkpointRefusal('checkpoint_invalid');
    out.pausers = checkpointEntries(fields.pausers);
    if (out.pausers.some((who) => !checkpointText(who))) throw checkpointRefusal('checkpoint_invalid');
  }
  if (fields.signers !== undefined) {
    const signers = checkpointRecord(fields.signers, ['required', 'allowed']);
    if (!Number.isInteger(signers.required) || signers.required < 1) throw checkpointRefusal('checkpoint_invalid');
    if (!Array.isArray(signers.allowed)) throw checkpointRefusal('checkpoint_invalid');
    const allowed = checkpointEntries(signers.allowed);
    if (allowed.length === 0 || allowed.some((who) => !checkpointText(who))) throw checkpointRefusal('checkpoint_invalid');
    out.signers = { required: signers.required, allowed };
  }
  return out;
}

// The sealed copy of what the operation holds, restricted to the fields a checkpoint declares.
function sealAuthority(authority) {
  const snapshot = snapshotAuthority(authority);
  const spend = (Array.isArray(snapshot.spend) ? snapshot.spend : []).map((grant) => {
    if (!grant || typeof grant !== 'object') return grant;
    const copy = { asset: grant.asset, maxAmount: grant.maxAmount };
    for (const key of ['to', 'network', 'resource', 'expiresAt']) {
      if (grant[key] !== undefined) copy[key] = grant[key];
    }
    return copy;
  });
  const out = { spend };
  if (Array.isArray(snapshot.pausers)) out.pausers = [...snapshot.pausers];
  if (snapshot.signers) {
    const signers = {};
    if (snapshot.signers.required !== undefined) signers.required = snapshot.signers.required;
    if (Array.isArray(snapshot.signers.allowed)) signers.allowed = [...snapshot.signers.allowed];
    out.signers = signers;
  }
  return out;
}

function checkpointOperation(op, effect) {
  let context;
  try {
    context = readContextProperty(op);
  } catch {
    throw checkpointRefusal('checkpoint_context_invalid');
  }
  const body = {
    kind: CHECKPOINT_KIND,
    version: CHECKPOINT_VERSION,
    binding: context === undefined ? 'unbound' : 'bound',
    operation: {
      id: checkpointText(op?.id) ? op.id : '',
      goal: typeof op?.goal === 'string' ? op.goal : '',
      action: typeof op?.action === 'string' ? op.action : null,
      agent: typeof op?.agent === 'string' ? op.agent : null,
      exit: operationExit(op),
      state: typeof op?.state === 'string' ? op.state : 'created',
      generation: Number.isInteger(op?.generation) ? op.generation : 0,
    },
    authority: sealAuthority(op?.authority),
  };
  if (context !== undefined) body.context = context;
  if (effect !== undefined) body.effect = { idempotencyKey: effect.idempotencyKey, phase: effect.phase };
  body.digest = computeDigest(body);
  return body;
}

function readCheckpoint(checkpoint) {
  try {
    const top = checkpointRecord(checkpoint, ['kind', 'version', 'binding', 'operation', 'authority', 'digest'], ['context', 'effect']);
    if (top.kind !== CHECKPOINT_KIND || top.version !== CHECKPOINT_VERSION) throw checkpointRefusal('checkpoint_invalid');
    const binding = top.binding;
    if (binding !== 'bound' && binding !== 'unbound') throw checkpointRefusal('checkpoint_invalid');
    const hasContext = Object.hasOwn(top, 'context');
    if ((binding === 'bound') !== hasContext) throw checkpointRefusal('checkpoint_invalid');
    const operation = checkpointRecord(top.operation, ['id', 'goal', 'action', 'agent', 'exit', 'state', 'generation']);
    if (!checkpointText(operation.id) || typeof operation.goal !== 'string') throw checkpointRefusal('checkpoint_invalid');
    if (operation.action !== null && !checkpointText(operation.action)) throw checkpointRefusal('checkpoint_invalid');
    if (operation.agent !== null && !checkpointText(operation.agent)) throw checkpointRefusal('checkpoint_invalid');
    if (!checkpointText(operation.exit) || !CHECKPOINT_STATES.has(operation.state)) throw checkpointRefusal('checkpoint_invalid');
    if (!Number.isSafeInteger(operation.generation) || operation.generation < 0) throw checkpointRefusal('checkpoint_invalid');
    const authority = checkpointAuthority(top.authority);
    const context = hasContext ? snapshotContext(top.context) : undefined;
    let effect;
    if (Object.hasOwn(top, 'effect')) {
      const declared = checkpointRecord(top.effect, ['idempotencyKey', 'phase']);
      if (declared.phase !== 'intent' || typeof declared.idempotencyKey !== 'string' || !/^[0-9a-f]{64}$/.test(declared.idempotencyKey)) {
        throw checkpointRefusal('checkpoint_invalid');
      }
      effect = { idempotencyKey: declared.idempotencyKey, phase: 'intent' };
    }
    if (typeof top.digest !== 'string' || !/^[0-9a-f]{64}$/.test(top.digest)) throw checkpointRefusal('checkpoint_invalid');
    const fields = {
      kind: CHECKPOINT_KIND,
      version: CHECKPOINT_VERSION,
      binding,
      operation,
      authority,
      ...(hasContext ? { context } : {}),
      ...(effect ? { effect } : {}),
    };
    return { fields, digest: top.digest };
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('checkpoint_')) throw error;
    throw checkpointRefusal('checkpoint_invalid');
  }
}

// Reopening is the trust boundary: the host hands back the bytes it stored and the digest it stored
// beside them. Both have to agree, the body is read with a closed schema, and the authority may only
// narrow. A checkpoint taken mid-effect comes back terminal and uncertain, which is the path
// `resumeFromReceipts` already answers with `reconciliation_required`.
function restoreOperation(checkpoint, options) {
  const settings = options && typeof options === 'object' ? options : {};
  const { fields, digest } = readCheckpoint(checkpoint);
  if (computeDigest(fields) !== digest) throw checkpointRefusal('checkpoint_digest_mismatch');
  const expected = settings.expectedDigest;
  if (typeof expected !== 'string' || expected !== digest) throw checkpointRefusal('checkpoint_expected_digest_mismatch');
  // The kernel cannot know the last generation issued: the host must persist it durably, pass it as
  // minGeneration, and consume each checkpoint atomically to prevent replay across reopenings.
  const minGeneration = settings.minGeneration;
  if (minGeneration !== undefined) {
    if (!Number.isSafeInteger(minGeneration) || minGeneration < 0) throw checkpointRefusal('checkpoint_invalid');
    if (fields.operation.generation < minGeneration) throw checkpointRefusal('checkpoint_generation_stale');
  }

  let authority = fields.authority;
  if (Object.hasOwn(settings, 'authority')) {
    const supplied = checkpointAuthority(settings.authority);
    if (!attenuates(supplied, fields.authority)) throw checkpointRefusal('authority_widened');
    authority = supplied;
  }
  if (Object.hasOwn(settings, 'context')) {
    if (fields.binding === 'unbound') throw checkpointRefusal('checkpoint_context_unbound');
    const supplied = snapshotContext(settings.context);
    if (stringify(supplied) !== stringify(fields.context)) throw checkpointRefusal('checkpoint_context_mismatch');
  }

  const terminal = CHECKPOINT_TERMINAL.has(fields.operation.state);
  const uncertain = fields.operation.state === STATES.RUNNING
    || terminal
    || (fields.effect !== undefined && fields.effect.phase === 'intent');
  const op = {
    id: fields.operation.id,
    goal: fields.operation.goal,
    action: fields.operation.action,
    authority,
    agent: fields.operation.agent,
    exit: fields.operation.exit,
    state: uncertain ? (terminal ? STATES.BLOCKED : STATES.NOT_VERIFIED) : fields.operation.state,
    history: [],
    receipt: null,
    output: null,
    inFlight: false,
  };
  if (fields.context !== undefined) {
    Object.defineProperty(op, 'context', { value: fields.context, enumerable: true, writable: false, configurable: false });
    op.generation = fields.operation.generation;
  }
  if (uncertain) {
    op.receipt = buildReceipt({
      operation: op,
      capabilityId: 'unknown',
      authority: { spend: authority.spend },
      outcome: terminal
        ? { status: 'blocked', exercised: [], detail: 'reconciliation_required' }
        : { status: 'not_verified', exercised: [], detail: 'reconciliation_required' },
      evidence: { exercisedUnknown: true },
      verification: { verified: false, checks: {}, reason: 'operation may have exercised an effect' },
      ...(fields.context !== undefined ? { context: fields.context } : {}),
    });
  }
  return op;
}

// A receipt already written is the one that decides whether this operation may run again. `op.state`
// is a field a host can set; the seal is not (R1: same object, different lifetime).
function receiptIsUncertain(receipt) {
  try {
    if (!receipt) return false;
    if (receipt.status === 'not_verified') return true;
    const exercised = receipt.authority && receipt.authority.exercised;
    if (Array.isArray(exercised) && exercised.length > 0) return true;
    return Boolean(receipt.evidence && receipt.evidence.exercisedUnknown === true);
  } catch {
    return true;
  }
}

function approvalRequestDigest(op, requirements, context, signers, exit) {
  return computeDigest({
    operationId: op.id,
    action: op.action,
    goal: op.goal,
    requirements: snapshotRequirements(requirements),
    context,
    signers,
    exit,
    generation: op.generation,
  });
}

function approvalRequestFor(op, requirements, context, signers, exit) {
  if (context === undefined) return null;
  const generation = Number.isSafeInteger(op.generation) && op.generation >= 0 ? op.generation + 1 : 1;
  if (!Number.isSafeInteger(generation)) throw new Error('approval generation exhausted');
  op.generation = generation;
  return { generation, digest: approvalRequestDigest(op, requirements, context, signers, exit) };
}

// The echo proves the answer belongs to this attempt and this payload, not that a person gave it.
function staleApproval(gate, expectedDigest) {
  if (!expectedDigest || gate === null || gate === undefined) return false;
  if ((typeof gate !== 'object' && typeof gate !== 'function') || !Object.hasOwn(gate, 'request')) return true;
  const echoed = gate.request;
  return echoed !== expectedDigest;
}

// An injected clock is a synchronous contract; asynchronous clocks cannot authorize an effect.
function readInjectedTime(io) {
  let clock;
  try {
    clock = io?.now;
  } catch {
    return { present: true, valid: false };
  }
  if (typeof clock !== 'function') return { present: false, valid: true };

  let value;
  try {
    value = apply(clock, undefined, []);
  } catch {
    return { present: true, valid: false };
  }
  // A clock answers a number or a string. Any object is refused without reading it: no `then` getter
  // is read and no non-native thenable is subscribed to. Only a native promise is consumed, so its
  // eventual rejection does not escape as an unhandled rejection.
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    if (isPromise(value)) {
      try {
        apply(promiseThen, value, [undefined, () => {}]);
      } catch {
      }
    }
    return { present: true, valid: false };
  }
  const now = parseTime(value);
  return now === null ? { present: true, valid: false } : { present: true, valid: true, now };
}

function checkSufficient(requirements, authority, io) {
  const clock = readInjectedTime(io);
  if (!clock.present) return sufficient(requirements, authority);
  if (!clock.valid) {
    return { ok: false, reason: 'injected clock returned an invalid or unrepresentable time', invalidClock: true };
  }
  const now = clock.now;
  if (now === null) return { ok: false, reason: 'injected clock returned an invalid or unrepresentable time', invalidClock: true };
  return sufficient(requirements, authority, { now });
}

function createOperation(options) {
  const context = readContextProperty(options);
  const { goal, authority, agent, exit, action } = options;
  let agentId = null;
  try {
    if (typeof agent === 'string' && agent.length > 0) agentId = agent;
  } catch {
    agentId = null;
  }
  let exitText = DEFAULT_EXIT;
  try {
    if (typeof exit === 'string' && exit.length > 0) exitText = exit;
  } catch {
  }
  const op = {
    id: `op-${Date.now().toString(36)}-${seq++}`,
    goal: snapshotGoal(goal),
    action: snapshotAction(action),
    authority: snapshotAuthority(authority),
    agent: agentId,
    exit: exitText,
    state: 'created',
    history: [],
    receipt: null,
    output: null,
    inFlight: false,
  };
  if (context !== undefined) {
    Object.defineProperty(op, 'context', { value: context, enumerable: true });
    // A generation only exists where an approval can outlive its payload.
    op.generation = 0;
  }
  return op;
}

function readPausers(op) {
  try {
    const pausers = op?.authority?.pausers;
    return Array.isArray(pausers) ? pausers.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

const TERMINAL_STATES = new Set(['verified', 'failed', 'not_verified', 'blocked']);

function readSignersConfig(authority) {
  try {
    const signers = authority && authority.signers;
    if (signers === undefined || signers === null) return null;
    if (!signers || typeof signers !== 'object' || Array.isArray(signers)) {
      return { present: true, valid: false };
    }
    const required = signers.required;
    const allowed = signers.allowed;
    if (!Number.isInteger(required) || required < 1) return { present: true, valid: false };
    if (!Array.isArray(allowed) || allowed.length === 0) return { present: true, valid: false };
    const clean = allowed.filter((s) => typeof s === 'string' && s.length > 0);
    if (clean.length === 0) return { present: true, valid: false };
    if (required > clean.length) return { present: true, valid: false };
    return { present: true, valid: true, required, allowed: [...new Set(clean)] };
  } catch {
    return { present: true, valid: false };
  }
}

function readAgentId(op) {
  try {
    return typeof op?.agent === 'string' && op.agent.length > 0 ? op.agent : null;
  } catch {
    return null;
  }
}

function pushSignerIds(value, out) {
  try {
    if (value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (value.length > 0) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) pushSignerIds(item, out);
      return;
    }
    if (typeof value === 'object') {
      if (typeof value.by === 'string' && value.by.length > 0) out.push(value.by);
    }
  } catch {
  }
}

function collectSignerIds(sources, agentId, allowedSet) {
  const raw = [];
  try {
    for (const source of sources) pushSignerIds(source, raw);
  } catch {
  }
  const seen = new Set();
  for (const id of raw) {
    if (typeof id !== 'string' || id.length === 0) continue;
    if (agentId && id === agentId) continue;
    if (!allowedSet.has(id)) continue;
    seen.add(id);
  }
  return [...seen];
}

function missingSignersDetail(required, have) {
  const missing = required - have;
  return `missing ${missing} approval${missing === 1 ? '' : 's'} (${have} of ${required})`;
}

function pauseOperation(op, who) {
  const pausers = readPausers(op);
  if (!pausers.includes(who)) {
    throw new Error(`not authorized to pause: pausers are [${pausers.join(', ')}]`);
  }
  if (op.inFlight || op.state === STATES.RUNNING) throw new Error('operation is already running');
  if (TERMINAL_STATES.has(op.state)) throw new Error('cannot pause a terminal operation');
  if (op.state === STATES.PAUSED) return op;
  op.state = STATES.PAUSED;
  try {
    op.history.push({ state: STATES.PAUSED, by: who, at: new Date().toISOString() });
  } catch {
  }
  return op;
}

function resumeOperation(op, who) {
  const pausers = readPausers(op);
  if (!pausers.includes(who)) {
    throw new Error(`not authorized to resume: pausers are [${pausers.join(', ')}]`);
  }
  if (op.state !== STATES.PAUSED) throw new Error('operation is not paused');
  op.state = 'created';
  try {
    op.history.push({ state: 'created', by: who, at: new Date().toISOString() });
  } catch {
  }
  return op;
}

function finish(op, receipt, output) {
  if (receipt?.status === 'not_verified' && op.state === STATES.SUCCEEDED) op.state = STATES.NOT_VERIFIED;
  if (receipt?.status === 'failed' && op.state === STATES.SUCCEEDED) op.state = STATES.FAILED;
  op.receipt = receipt;
  if (output !== undefined && op.state === STATES.SUCCEEDED) op.output = output;
  return { status: op.state, receipt, output: op.output };
}

async function runOperation(op, capability, io) {
  if (op.state === STATES.PAUSED) return { status: STATES.PAUSED, receipt: op.receipt, output: op.output };
  if (op.inFlight || op.state === STATES.RUNNING) throw new Error('operation is already running');
  op.inFlight = true;
  try {
    return await runOperationOnce(op, capability, io);
  } finally {
    op.inFlight = false;
  }
}

async function runOperationOnce(op, capability, io) {
  let context;
  let invalidContext = false;
  try {
    context = readContextProperty(op);
    if (context !== undefined) {
      const descriptor = Object.getOwnPropertyDescriptor(op, 'context');
      if (descriptor.configurable) Object.defineProperty(op, 'context', { value: context, enumerable: true, writable: false, configurable: false });
      else if (descriptor.writable) Object.defineProperty(op, 'context', { value: context, writable: false });
    }
  } catch { invalidContext = true; }

  const buildReceiptForRun = (spec) => {
    if (context !== undefined) spec = { ...spec, context };
    // Preserve the legacy receipt body unless the host injects a clock.
    let at;
    let clockFailure = false;
    try {
      const clock = readInjectedTime(io);
      if (!clock.present) return safeBuildReceipt(spec);
      if (!clock.valid) throw new Error('invalid injected time');
      at = new Date(clock.now).toISOString();
    } catch {
      at = new Date(Date.now()).toISOString();
      clockFailure = true;
    }
    const receiptSpec = clockFailure
      ? { ...spec, outcome: { ...spec.outcome, detail: [spec.outcome?.detail, 'receipt time used system clock after an invalid injected clock'].filter(Boolean).join('; ') } }
      : spec;
    try {
      return buildReceipt({ ...receiptSpec, at });
    } catch {
      return safeBuildReceipt({ ...receiptSpec, at });
    }
  };
  const capabilityId = safeCapabilityId(capability);
  if (op.state === STATES.PAUSED) return { status: STATES.PAUSED, receipt: op.receipt, output: op.output };
  if (op.state === STATES.RUNNING) throw new Error('operation is already running');
  if (op.receipt && op.state !== STATES.NEEDS_DECISION) return { status: op.state, receipt: op.receipt, output: op.output };
  // An uncertain effect is not replayed because somebody moved `state` to needs_human_decision.
  // The sealed receipt decides, not a field the host can rewrite after the pause.
  if (op.receipt && receiptIsUncertain(op.receipt)) {
    op.state = STATES.BLOCKED;
    return finish(op, buildReceiptForRun({ operation: op, capabilityId, authority: op.authority,
      outcome: { status: 'blocked', exercised: [], detail: 'reconciliation_required', exit: operationExit(op) },
      // The mark travels with the blocking receipt; otherwise a second state write would launder it.
      evidence: { exercisedUnknown: true }, verification: null }));
  }

  if (invalidContext) {
    op.state = STATES.BLOCKED;
    return finish(op, buildReceiptForRun({ operation: op, capabilityId, authority: op.authority,
      outcome: { status: 'blocked', exercised: [], detail: 'context declaration is invalid' }, evidence: null, verification: null }));
  }

  let requirements;
  try {
    const declared = capability.required(op);
    // Inspected before any property is read: a proxy or a `then` accessor is refused without host code.
    if (announcesAsync(declared)) throw new Error('capability required must return a spend array');
    const impossible = readImpossibleDeclaration(declared);
    if (impossible) {
      const exit = impossible.exit || operationExit(op);
      op.state = STATES.BLOCKED;
      const receipt = buildReceiptForRun({
        operation: op,
        capabilityId: capabilityId,
        authority: op.authority,
        outcome: { status: 'blocked', exercised: [], detail: impossible.reason, reason: impossible.reason, exit },
        evidence: null,
        verification: null,
      });
      return finish(op, receipt);
    }
    if (!declared || announcesAsync(declared) || !Array.isArray(declared.spend)) {
      throw new Error('capability required must return a spend array');
    }
    requirements = snapshotRequirements(declared.spend);
  } catch (err) {
    op.state = STATES.FAILED;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId: capabilityId,
      authority: op.authority,
      outcome: { status: 'failed', exercised: [], detail: refused(err, 'the capability requirements could not be read') },
      evidence: null,
      verification: null,
    });
    return finish(op, receipt);
  }
  if (!Array.isArray(requirements)) {
    op.state = STATES.FAILED;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId: capabilityId,
      authority: op.authority,
      outcome: { status: 'failed', exercised: [], detail: 'requirements must be an array' },
      evidence: null,
      verification: null,
    });
    return finish(op, receipt);
  }
  let check;
  try {
    check = checkSufficient(requirements, op.authority, io);
  } catch (err) {
    op.state = STATES.FAILED;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId,
      authority: op.authority,
      outcome: { status: 'failed', exercised: [], detail: refused(err, 'the authority check could not be read') },
      evidence: null,
      verification: null,
    });
    return finish(op, receipt);
  }
  if (check.invalidClock) {
    op.state = STATES.FAILED;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId,
      authority: op.authority,
      outcome: { status: 'failed', exercised: [], detail: check.reason },
      evidence: null,
      verification: null,
    });
    return finish(op, receipt);
  }

  let approval = 'preauthorized';
  let decidedBy = null;
  const signersCfg = readSignersConfig(op.authority);
  if (signersCfg && signersCfg.present && !signersCfg.valid) {
    const gateExit = operationExit(op);
    op.state = STATES.NEEDS_DECISION;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId: capabilityId,
      authority: { ...op.authority, approval: 'human_gate_no_decision' },
      outcome: { status: 'needs_human_decision', exercised: [], detail: 'invalid signers config: required must be an integer >= 1 within allowed', exit: gateExit },
      evidence: null,
      verification: null,
    });
    return finish(op, receipt);
  }
  if (context !== undefined && ((signersCfg && signersCfg.valid) || !check.ok)
      && (!Number.isSafeInteger(op.generation) || op.generation < 0 || op.generation >= Number.MAX_SAFE_INTEGER)) {
    op.state = STATES.BLOCKED;
    return finish(op, buildReceiptForRun({ operation: op, capabilityId, authority: op.authority,
      outcome: { status: 'blocked', exercised: [], detail: 'approval generation exhausted', exit: operationExit(op) },
      evidence: null, verification: null }));
  }
  if (signersCfg && signersCfg.valid) {
    const gateExit = operationExit(op);
    const agentId = readAgentId(op);
    const allowedSet = new Set(signersCfg.allowed);
    // Only approvals that arrive through the human gate count (R42 review: pre-loaded approvals would bypass it).
    const registeredHave = 0;
    let gate = null;
    let gateError = null;
    let gateRejected = false;
    if (registeredHave < signersCfg.required) {
      let approvalRequest = null;
      try {
        const askFn = io && typeof io.ask === 'function' ? io.ask : null;
        const suggestion = await consultDecisionModel(io, { requirements: requirements.map((r) => ({ ...r })), goal: op.goal });
      approvalRequest = approvalRequestFor(op, requirements, context, { required: signersCfg.required, allowed: [...signersCfg.allowed] }, gateExit);
      const expectedApprovalDigest = approvalRequest?.digest;
      const askPayload = Object.assign(requirements.map((r) => ({ ...r })), {
          requirements: requirements.map((r) => ({ ...r })),
          cost: requirements.map((r) => ({ ...r })),
          publicByDefault: false,
          ...(context !== undefined ? { context } : {}),
          ...(approvalRequest ? { approvalRequest: Object.freeze({ ...approvalRequest }) } : {}),
          ...(suggestion ? { suggestion } : {}),
          exit: gateExit,
          signers: { required: signersCfg.required, allowed: [...signersCfg.allowed] },
        });
        if (askFn) {
          const call = startHostCall(askFn, [askPayload]);
          await withTimeout(call.ready, readTimeout(io, 'askTimeoutMs'), 'human gate');
          gate = call.value;
        } else gate = null;
        if (staleApproval(gate, expectedApprovalDigest)) {
          gateError = 'stale approval';
          gate = null;
        }
      } catch (err) {
        gateError = refused(err, 'human gate failed');
      }
    }
    let explicitReject = false;
    try {
      if (gate !== null && gate !== undefined && !Array.isArray(gate) && typeof gate === 'object' && gate.approved === false) explicitReject = true;
    } catch {
    }
    gateRejected = explicitReject;
    const gateSources = [];
    if (gate !== null && gate !== undefined) {
      if (Array.isArray(gate)) gateSources.push(gate);
      else if (typeof gate === 'object') {
        if (Array.isArray(gate.approvals)) gateSources.push(gate.approvals);
        if (Array.isArray(gate.signers)) gateSources.push(gate.signers);
        if (gate.approved === true && typeof gate.by === 'string') gateSources.push([gate.by]);
        else if (gate.approved === true && gate.by === undefined && !Array.isArray(gate.approvals) && !Array.isArray(gate.signers)) {
          // approved without identities: counts as zero distinct signers
        }
      }
    }
    const haveIds = collectSignerIds(gateSources, agentId, allowedSet);
    const have = haveIds.length;
    // The receipt names the identities that showed up, on an approval and on a partial one alike,
    // so "a human gate approved" is never a claim without a subject (R1 finding M1).
    if (haveIds.length > 0) decidedBy = haveIds.join(', ');
    // The gate counts identities and nothing else: a decision model advises (decisions 16 and 19),
    // so there is no path here where an approval arrives without someone being named.
    if (gateError || explicitReject || have < signersCfg.required) {
      op.state = STATES.NEEDS_DECISION;
      let detail;
      if (gateError) {
        detail = `${gateError}; ${missingSignersDetail(signersCfg.required, have)}`;
      } else {
        detail = missingSignersDetail(signersCfg.required, have);
      }
      const receipt = buildReceiptForRun({
        operation: op,
        capabilityId: capabilityId,
        authority: { ...op.authority, approval: gateRejected ? 'human_gate_rejected' : 'human_gate_no_decision' },
        outcome: { status: 'needs_human_decision', exercised: [], detail, exit: gateExit },
        evidence: null,
        verification: null,
        ...(decidedBy ? { decidedBy } : {}),
      });
      return finish(op, receipt);
    }
    if (!check.ok) {
      let approvedGrants;
      try {
        approvedGrants = requirements.map((requirement) => {
          if (!requirement || typeof requirement !== 'object') throw new Error('invalid spend requirement');
          return { asset: requirement.asset, maxAmount: requirement.amount, to: requirement.to,
            ...(requirement.network !== undefined ? { network: requirement.network } : {}),
            ...(requirement.resource !== undefined ? { resource: requirement.resource } : {}) };
        });
      } catch (err) {
        op.state = STATES.FAILED;
        const receipt = buildReceiptForRun({
          operation: op,
          capabilityId: capabilityId,
          authority: { ...op.authority, approval: 'human_gate_approved' },
          outcome: { status: 'failed', exercised: [], detail: refused(err, 'the granted spend could not be read') },
          evidence: null,
          verification: null,
          ...(decidedBy ? { decidedBy } : {}),
        });
        return finish(op, receipt);
      }
      // The gate replaces the granted spend and nothing else: who can pause is part of the
      // authority the person gave, and a later approval may not take it away (R1 finding M4).
      const pausers = readPausers(op);
      op.authority = {
        spend: approvedGrants,
        signers: { required: signersCfg.required, allowed: [...signersCfg.allowed] },
        ...(pausers.length > 0 ? { pausers } : {}),
      };
      check = checkSufficient(requirements, op.authority, io);
      if (!check.ok) {
        op.state = STATES.FAILED;
        const receipt = buildReceiptForRun({
          operation: op,
          capabilityId: capabilityId,
          authority: { ...op.authority, approval: 'human_gate_approved' },
          outcome: { status: 'failed', exercised: [], detail: check.reason },
          evidence: null,
          verification: null,
          ...(decidedBy ? { decidedBy } : {}),
        });
        return finish(op, receipt);
      }
    }
    approval = 'human_gate_approved';
  } else if (!check.ok) {
    const gateExit = operationExit(op);
    let gateApproved = false;
    let gateRejected = false;
    let gateError = null;
    let gateBy = undefined;
    let selfApproval = false;
    let missingDecider = false;
    let approvalRequest = null;
    try {
      const askFn = io && typeof io.ask === 'function' ? io.ask : null;
      // Legacy callers (demo/x402) receive an array; the four gate gestures ride on it as properties.
      const suggestion = await consultDecisionModel(io, { requirements: requirements.map((r) => ({ ...r })), goal: op.goal });
      approvalRequest = approvalRequestFor(op, requirements, context, undefined, gateExit);
      const expectedApprovalDigest = approvalRequest?.digest;
      const askPayload = Object.assign(requirements.map((r) => ({ ...r })), {
        requirements: requirements.map((r) => ({ ...r })),
        cost: requirements.map((r) => ({ ...r })),
        publicByDefault: false,
        ...(context !== undefined ? { context } : {}),
        ...(approvalRequest ? { approvalRequest: Object.freeze({ ...approvalRequest }) } : {}),
        ...(suggestion ? { suggestion } : {}),
        exit: gateExit,
      });
      let gate = null;
      if (askFn) {
        const call = startHostCall(askFn, [askPayload]);
        await withTimeout(call.ready, readTimeout(io, 'askTimeoutMs'), 'human gate');
        gate = call.value;
      }
      if (staleApproval(gate, expectedApprovalDigest)) gateError = 'stale approval';
      if (gate !== null && gate !== undefined) {
        let approvedFlag = false;
        let rejectedFlag = false;
        try {
          approvedFlag = gate.approved === true;
          rejectedFlag = gate.approved === false;
        } catch (readErr) {
          throw readErr;
        }
        let byValue;
        try {
          byValue = gate.by;
        } catch (readErr) {
          throw readErr;
        }
        gateApproved = approvedFlag;
        gateRejected = rejectedFlag;
        gateBy = byValue;
        let agentId = null;
        try {
          agentId = typeof op?.agent === 'string' && op.agent.length > 0 ? op.agent : null;
        } catch {
          agentId = null;
        }
        if (approvedFlag && agentId) {
          if (byValue === agentId) {
            selfApproval = true;
            gateApproved = false;
            gateRejected = true;
          } else if (typeof byValue !== 'string' || byValue.length === 0) {
            missingDecider = true;
            gateApproved = false;
            gateRejected = true;
          }
        }
        // The receipt names the person whose approval let this run (R1 finding M1). An approval
        // that names nobody stays unnamed: the receipt may not invent a decider.
        if (gateApproved && typeof byValue === 'string' && byValue.length > 0) decidedBy = byValue;
      }
    } catch (err) {
      gateError = refused(err, 'human gate failed');
    }
    if (gateError || !gateApproved) {
      op.state = STATES.NEEDS_DECISION;
      let detail;
      if (gateError) {
        detail = gateError;
      } else if (selfApproval) {
        let agentLabel = '?';
        try {
          agentLabel = typeof op?.agent === 'string' ? op.agent : '?';
        } catch {
        }
        detail = `agent cannot consent for the person: by (${String(gateBy)}) must differ from agent (${agentLabel})`;
      } else if (missingDecider) {
        let agentLabel = '?';
        try {
          agentLabel = typeof op?.agent === 'string' ? op.agent : '?';
        } catch {
        }
        detail = `approval requires a human decider: by must differ from agent (${agentLabel})`;
      } else if (!check.ok && typeof check.reason === 'string' && check.reason.length > 0) {
        // The authority check already named why the declared effect is not covered. Losing that
        // sentence left three different refusals — nobody at the gate, an explicit no, and a grant
        // that does not reach the declared scope — indistinguishable in the receipt (T2-R1).
        detail = check.reason;
      }
      const receipt = buildReceiptForRun({
        operation: op,
        capabilityId: capabilityId,
        authority: { ...op.authority, approval: gateRejected ? 'human_gate_rejected' : 'human_gate_no_decision' },
        outcome: { status: 'needs_human_decision', exercised: [], ...(detail ? { detail } : {}), exit: gateExit },
        evidence: null,
        verification: null,
        ...(decidedBy ? { decidedBy } : {}),
      });
      return finish(op, receipt);
    }
    let approvedGrants;
    try {
      approvedGrants = requirements.map((requirement) => {
        if (!requirement || typeof requirement !== 'object') throw new Error('invalid spend requirement');
        return { asset: requirement.asset, maxAmount: requirement.amount, to: requirement.to,
          ...(requirement.network !== undefined ? { network: requirement.network } : {}),
          ...(requirement.resource !== undefined ? { resource: requirement.resource } : {}) };
      });
    } catch (err) {
      op.state = STATES.FAILED;
      const receipt = buildReceiptForRun({
        operation: op,
        capabilityId: capabilityId,
        authority: { ...op.authority, approval: 'human_gate_approved' },
        outcome: { status: 'failed', exercised: [], detail: refused(err, 'the granted spend could not be read') },
        evidence: null,
        verification: null,
        ...(decidedBy ? { decidedBy } : {}),
      });
      return finish(op, receipt);
    }
    // Same as the signers branch: the approved spend replaces the grants, the rest of the
    // authority survives (R1 finding M4).
    const pausers = readPausers(op);
    op.authority = { spend: approvedGrants, ...(pausers.length > 0 ? { pausers } : {}) };
    check = checkSufficient(requirements, op.authority, io);
    approval = 'human_gate_approved';
    if (!check.ok) {
      op.state = STATES.FAILED;
      const receipt = buildReceiptForRun({
        operation: op,
        capabilityId: capabilityId,
        authority: { ...op.authority, approval },
        outcome: { status: 'failed', exercised: [], detail: check.reason },
        evidence: null,
        verification: null,
        ...(decidedBy ? { decidedBy } : {}),
      });
      return finish(op, receipt);
    }
  }

  // The effect's identity is fixed before the checkpoint and reused by `perform`, so a host that
  // reopens this intent still tells the destination the same key.
  const idempotencyKey = operationIdempotencyKey(op, requirements);
  const checkpointFn = io && typeof io.checkpoint === 'function' ? io.checkpoint : null;
  if (checkpointFn) {
    try {
      const snapshot = checkpointOperation(op, { idempotencyKey, phase: 'intent' });
      // Its own timeout: a checkpoint that never answers keeps the effect at zero.
      const call = startHostCall(checkpointFn, [snapshot]);
      await withTimeout(call.ready, readTimeout(io, 'checkpointTimeoutMs'), 'checkpoint');
    } catch (error) {
      op.state = STATES.BLOCKED;
      return finish(op, buildReceiptForRun({ operation: op, capabilityId, authority: { ...op.authority, approval },
        outcome: { status: 'blocked', exercised: [], detail: refused(error, 'operation checkpoint failed'), exit: operationExit(op) },
        evidence: null, verification: null, ...(decidedBy ? { decidedBy } : {}) }));
    }
  }

  if (context !== undefined) {
    try {
      const reader = io && io.readContext;
      if (typeof reader !== 'function') throw new TypeError();
      // A timed-out reader has no continuation that can reach perform.
      const contextMatches = (value) => stringify(snapshotContext(value)) === stringify(context);
      const call = startHostCall(reader, [context.scope]);
      await withTimeout(call.ready, readTimeout(io, 'contextTimeoutMs'), 'context read');
      const matches = contextMatches(call.value);
      if (matches !== true) throw new TypeError();
    } catch {
      op.state = STATES.BLOCKED;
      return finish(op, buildReceiptForRun({ operation: op, capabilityId, authority: { ...op.authority, approval },
        outcome: { status: 'blocked', exercised: [], detail: 'context requires revalidation', exit: operationExit(op) },
        evidence: null, verification: null, ...(decidedBy ? { decidedBy } : {}) }));
    }
  }

  op.state = STATES.RUNNING;
  let result;
  let finalCheck = null;
  const controller = new AbortController();
  try {
    const performPromise = defer(() => {
      finalCheck = checkSufficient(requirements, op.authority, io);
      if (!finalCheck.ok) return undefined;
      return capability.perform({ operation: op, authority: op.authority, signal: controller.signal, idempotencyKey });
    });
    result = await withTimeout(performPromise, readTimeout(io, 'performTimeoutMs'), 'capability perform', () => controller.abort());
  } catch (err) {
    if (isTimeout(err)) {
      op.state = STATES.NOT_VERIFIED;
      const receipt = buildReceiptForRun({
        operation: op,
        capabilityId,
        authority: { ...op.authority, approval },
        outcome: { status: 'not_verified', exercised: requirements.map((r) => ({ ...r })), detail: refused(err, 'the capability did not answer before the timeout') },
        evidence: null,
        verification: { verified: false, checks: {}, reason: 'capability outcome unknown after timeout' },
        ...(decidedBy ? { decidedBy } : {}),
      });
      return finish(op, receipt);
    }
    op.state = STATES.FAILED;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId,
      authority: { ...op.authority, approval },
      outcome: { status: 'failed', exercised: [], detail: refused(err, 'the capability could not be read') },
      evidence: null,
      verification: null,
      ...(decidedBy ? { decidedBy } : {}),
    });
    return finish(op, receipt);
  } finally {
    controller.abort();
  }

  if (finalCheck && !finalCheck.ok) {
    op.state = finalCheck.invalidClock ? STATES.FAILED : STATES.NEEDS_DECISION;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId,
      authority: { ...op.authority },
      outcome: {
        status: finalCheck.invalidClock ? 'failed' : 'needs_human_decision',
        exercised: [],
        detail: finalCheck.reason,
        ...(finalCheck.invalidClock ? {} : { exit: operationExit(op) }),
      },
      evidence: null,
      verification: null,
    });
    return finish(op, receipt);
  }

  const capabilityResult = readCapabilityResult(result);
  if (capabilityResult.impossible) {
    const reason = capabilityResult.reason || capabilityFailure(capabilityResult.error, 'impossible');
    const exit = capabilityResult.exit || operationExit(op);
    op.state = STATES.BLOCKED;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId: capabilityId,
      authority: { ...op.authority, approval },
      outcome: { status: 'blocked', exercised: [], detail: reason, reason, exit },
      evidence: capabilityResult.evidence,
      verification: null,
      ...(decidedBy ? { decidedBy } : {}),
    });
    return finish(op, receipt);
  }
  if (capabilityResult.settlementUnknown) {
    op.state = STATES.NOT_VERIFIED;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId: capabilityId,
      authority: { ...op.authority, approval },
      outcome: {
        status: 'not_verified',
        exercised: requirements.map((r) => ({ ...r })),
        detail: capabilityFailure(capabilityResult.error, 'settlement outcome unknown'),
      },
      evidence: capabilityResult.evidence,
      verification: { verified: false, checks: {}, reason: 'settlement outcome unknown' },
      ...(decidedBy ? { decidedBy } : {}),
    });
    return finish(op, receipt);
  }

  if (!capabilityResult.ok) {
    op.state = STATES.FAILED;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId: capabilityId,
      authority: { ...op.authority, approval },
      outcome: { status: 'failed', exercised: [], detail: capabilityFailure(capabilityResult.error, 'capability failed') },
      evidence: capabilityResult.evidence,
      verification: null,
      ...(decidedBy ? { decidedBy } : {}),
    });
    return finish(op, receipt);
  }

  if (!hasEvidence(capabilityResult.evidence)) {
    op.state = STATES.NOT_VERIFIED;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId,
      authority: { ...op.authority, approval },
      outcome: { status: 'not_verified', exercised: requirements.map((r) => ({ ...r })), detail: 'capability evidence is missing' },
      evidence: null,
      verification: { verified: false, checks: {}, reason: 'capability evidence is missing' },
      ...(decidedBy ? { decidedBy } : {}),
    });
    return finish(op, receipt);
  }

  const exercised = requirements.map((r) => ({ ...r }));
  // A verifier exception after a side effect is caught in the returned receipt.
  // The side effect may have happened: keep evidence,
  // do NOT rerun, do NOT claim verified.
  let verification;
  try {
    // Read once. `typeof io.verify` followed by `io.verify` is two reads of the same property, and
    // the function that gets checked is then not the function that gets called.
    const ioVerify = io ? io.verify : undefined;
    const verifyFn = typeof ioVerify === 'function' ? ioVerify : null;
    if (verifyFn) {
      const call = startHostCall(verifyFn, [capabilityResult.evidence]);
      await withTimeout(call.ready, readTimeout(io, 'verifyTimeoutMs'), 'verifier');
      verification = call.value;
    } else verification = { verified: false, checks: {}, reason: 'no verifier' };
  } catch (err) {
    verification = { verified: false, checks: {}, reason: refused(err, 'verifier failed') };
  }
  // The answer has to be the verifier's own object. `io.verify` was handed this evidence, and if it
  // hands the very same object back then the executor answered itself: `verified: true` in the
  // evidence is not a verification, and a `zk` the executor carried is not a claim. Identity is the
  // whole test, because a copy of the same fields is a legitimate answer and cannot be told from a
  // forgery by this kernel.
  if (verification === capabilityResult.evidence) {
    verification = { verified: false, checks: {}, reason: ZK_ECHO_REASON };
  }
  let verified = false;
  let normalizedVerification;
  try {
    const verifierResult = verification && typeof verification === 'object' ? verification : {};
    verified = verifierResult.verified === true;
    const rawChecks = verifierResult.checks;
    const checks = {};
    if (rawChecks && typeof rawChecks === 'object' && !Array.isArray(rawChecks)) {
      for (const key of Object.keys(rawChecks)) {
        const value = rawChecks[key];
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) checks[key] = value;
      }
    }
    const candidateReason = verifierResult.reason;
    const validReason = typeof candidateReason === 'string' && candidateReason.length > 0;
    if (verified && !validReason) verified = false;
    normalizedVerification = {
      verified,
      checks,
      reason: validReason ? candidateReason : (verified ? 'verified' : 'verification not confirmed'),
    };
    // A zk claim is read from the verifier's answer and nowhere else: never from `perform`, never
    // from the evidence. It is validated with the closed schema and reconciled with the verdict and
    // the checks, so an operation cannot end `succeeded` on a claim that does not hold up — which
    // would leave the state disagreeing with the receipt it just wrote.
    const zkClaim = readZkClaim(verifierResult);
    const vocabulary = readCatalogChecks(checks, { claimed: zkClaim.claimed });
    const reconciled = reconcileZk({ verified, checks: vocabulary.checks, claimed: zkClaim.claimed, zk: zkClaim.value });
    normalizedVerification.checks = vocabulary.checks;
    if (reconciled.zk !== null) normalizedVerification.zk = reconciled.zk;
    if (vocabulary.foreign) {
      normalizedVerification.verified = false;
      normalizedVerification.reason = ZK_FOREIGN_CHECK_REASON;
    } else if (!reconciled.consistent) {
      normalizedVerification.verified = false;
      normalizedVerification.reason = ZK_INCONSISTENT_REASON;
    }
    verified = normalizedVerification.verified === true;
  } catch (err) {
    normalizedVerification = {
      verified: false,
      checks: {},
      reason: refused(err, 'verifier failed'),
    };
    verified = false;
  }
  op.state = verified ? STATES.SUCCEEDED : STATES.NOT_VERIFIED;
  const receipt = buildReceiptForRun({
    operation: op,
    capabilityId: capabilityId,
    authority: { ...op.authority, approval },
    outcome: { status: verified ? 'verified' : 'not_verified', exercised },
    evidence: capabilityResult.evidence,
    verification: normalizedVerification,
    ...(decidedBy ? { decidedBy } : {}),
  });
  return finish(op, receipt, verified ? capabilityResult.output : undefined);
}

module.exports = { createOperation, runOperation, pauseOperation, resumeOperation, checkpointOperation,
  restoreOperation, STATES, DEFAULT_EXIT };
