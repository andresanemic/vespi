'use strict';

// Minimal executable Vespi operation.
//
// Capability contract (a function-shaped object, nothing more):
//   { id, required(op) -> { spend: [{asset, amount, to}] }, perform(ctx) -> { ok, evidence?, error? } }
// The kernel never imports a specific capability. x402, Stellar, USDC live outside.
//
// runOperation(op, capability, { verify(evidence)->{verified,checks,reason}, ask(requirements)->{approved} }):
//   requirements -> authority sufficient? no -> NEEDS_HUMAN_DECISION (perform is not called; capability code is trusted in-process)
//   yes -> perform once -> failure? FAILED -> verify evidence -> verified? SUCCEEDED : NOT_VERIFIED
// The gate opens when the authority on hand does not cover the requirement, and also whenever the
// authority declares `signers`: a declared multi-person authority is always put to its people,
// because a grant that already covers the spend still needs its named identities to be counted.
// A grant that covers the spend and declares no `signers` runs without asking.

const { sufficient } = require('./authority.js');
const { buildReceipt } = require('./receipt.js');
const { createHash } = require('node:crypto');
const { parseTime } = require('./time.js');

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

function errorText(error) {
  try {
    if (error && typeof error.message === 'string') return error.message;
    return String(error);
  } catch {
    return 'unknown error';
  }
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
  return Promise.race([Promise.resolve(value), timeout]).finally(() => clearTimeout(timer));
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
// (decisions 16 and 19; orchestrator review R42 of the 0.1.3 build).
async function consultDecisionModel(io, question) {
  try {
    const decideFn = io && typeof io.decide === 'function' ? io.decide : null;
    if (!decideFn) return null;
    const threshold = readDecideThreshold(io);
    let result;
    try {
      result = await withTimeout(Promise.resolve().then(() => decideFn.call(io, question)), readDecideTimeoutMs(io), 'decision model');
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
    const error = result?.error;
    const reason = result?.reason;
    const exit = result?.exit;
    return {
      settlementUnknown: result?.settlementUnknown === true,
      impossible: result?.impossible === true,
      ok: result?.ok === true,
      error: typeof error === 'string' ? error : (error == null ? null : 'capability returned an invalid error'),
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
      error: `capability result invalid: ${errorText(error)}`,
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
    return { asset: requirement.asset, amount: requirement.amount, to: requirement.to };
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
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
  return createHash('sha256').update(JSON.stringify(canonicalize(content)), 'utf8').digest('hex');
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
    value = clock.call(io);
  } catch {
    return { present: true, valid: false };
  }
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    try {
      if (typeof value.then === 'function') {
        // Consume any eventual rejection while refusing to wait for an asynchronous clock.
        Promise.resolve(value).catch(() => {});
        return { present: true, valid: false };
      }
    } catch {
      return { present: true, valid: false };
    }
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

function createOperation({ goal, authority, agent, exit, action }) {
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
  return {
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
  const buildReceiptForRun = (spec) => {
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

  let requirements;
  try {
    const declared = capability.required(op);
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
    if (!declared || typeof declared.then === 'function' || !Array.isArray(declared.spend)) {
      throw new Error('capability required must return a spend array');
    }
    requirements = snapshotRequirements(declared.spend);
  } catch (err) {
    op.state = STATES.FAILED;
    const receipt = buildReceiptForRun({
      operation: op,
      capabilityId: capabilityId,
      authority: op.authority,
      outcome: { status: 'failed', exercised: [], detail: errorText(err) },
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
      outcome: { status: 'failed', exercised: [], detail: errorText(err) },
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
      try {
        const askFn = io && typeof io.ask === 'function' ? io.ask : null;
        const suggestion = await consultDecisionModel(io, { requirements: requirements.map((r) => ({ ...r })), goal: op.goal });
      const askPayload = Object.assign(requirements.map((r) => ({ ...r })), {
          requirements: requirements.map((r) => ({ ...r })),
          cost: requirements.map((r) => ({ ...r })),
          publicByDefault: false,
          ...(suggestion ? { suggestion } : {}),
          exit: gateExit,
          signers: { required: signersCfg.required, allowed: [...signersCfg.allowed] },
        });
        gate = askFn
          ? await withTimeout(Promise.resolve().then(() => askFn.call(io, askPayload)), readTimeout(io, 'askTimeoutMs'), 'human gate')
          : null;
      } catch (err) {
        gateError = `human gate error: ${errorText(err)}`;
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
          return { asset: requirement.asset, maxAmount: requirement.amount, to: requirement.to };
        });
      } catch (err) {
        op.state = STATES.FAILED;
        const receipt = buildReceiptForRun({
          operation: op,
          capabilityId: capabilityId,
          authority: { ...op.authority, approval: 'human_gate_approved' },
          outcome: { status: 'failed', exercised: [], detail: errorText(err) },
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
    try {
      const askFn = io && typeof io.ask === 'function' ? io.ask : null;
      // Legacy callers (demo/x402) receive an array; the four gate gestures ride on it as properties.
      const suggestion = await consultDecisionModel(io, { requirements: requirements.map((r) => ({ ...r })), goal: op.goal });
      const askPayload = Object.assign(requirements.map((r) => ({ ...r })), {
        requirements: requirements.map((r) => ({ ...r })),
        cost: requirements.map((r) => ({ ...r })),
        publicByDefault: false,
        ...(suggestion ? { suggestion } : {}),
        exit: gateExit,
      });
      const gate = askFn
        ? await withTimeout(Promise.resolve().then(() => askFn.call(io, askPayload)), readTimeout(io, 'askTimeoutMs'), 'human gate')
        : null;
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
      gateError = `human gate error: ${errorText(err)}`;
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
        return { asset: requirement.asset, maxAmount: requirement.amount, to: requirement.to };
      });
    } catch (err) {
      op.state = STATES.FAILED;
      const receipt = buildReceiptForRun({
        operation: op,
        capabilityId: capabilityId,
        authority: { ...op.authority, approval: 'human_gate_approved' },
        outcome: { status: 'failed', exercised: [], detail: errorText(err) },
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

  op.state = STATES.RUNNING;
  let result;
  let finalCheck = null;
  const controller = new AbortController();
  try {
    const performPromise = Promise.resolve().then(() => {
      finalCheck = checkSufficient(requirements, op.authority, io);
      if (!finalCheck.ok) return undefined;
      return capability.perform({ operation: op, authority: op.authority, signal: controller.signal, idempotencyKey: operationIdempotencyKey(op, requirements) });
    });
    result = await withTimeout(performPromise, readTimeout(io, 'performTimeoutMs'), 'capability perform', () => controller.abort());
  } catch (err) {
    if (isTimeout(err)) {
      op.state = STATES.NOT_VERIFIED;
      const receipt = buildReceiptForRun({
        operation: op,
        capabilityId,
        authority: { ...op.authority, approval },
        outcome: { status: 'not_verified', exercised: requirements.map((r) => ({ ...r })), detail: errorText(err) },
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
      outcome: { status: 'failed', exercised: [], detail: errorText(err) },
      evidence: null,
      verification: null,
      ...(decidedBy ? { decidedBy } : {}),
    });
    return finish(op, receipt);
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
    const reason = capabilityResult.reason || capabilityResult.error || 'impossible';
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
        detail: capabilityResult.error || 'settlement outcome unknown',
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
      outcome: { status: 'failed', exercised: [], detail: capabilityResult.error || 'capability failed' },
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
    const verifyFn = io && typeof io.verify === 'function' ? io.verify : null;
    verification = verifyFn
      ? await withTimeout(Promise.resolve().then(() => verifyFn.call(io, capabilityResult.evidence)), readTimeout(io, 'verifyTimeoutMs'), 'verifier')
      : { verified: false, checks: {}, reason: 'no verifier' };
  } catch (err) {
    verification = { verified: false, checks: {}, reason: `verifier error: ${errorText(err)}` };
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
  } catch (err) {
    normalizedVerification = {
      verified: false,
      checks: {},
      reason: `verifier error: ${errorText(err)}`,
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

module.exports = { createOperation, runOperation, pauseOperation, resumeOperation, STATES, DEFAULT_EXIT };
