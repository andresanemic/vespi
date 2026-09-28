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
// Human gate fires only when authority is insufficient. Approved grants continue silently.

const { sufficient } = require('./authority.js');
const { buildReceipt } = require('./receipt.js');

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

function snapshotAuthority(authority) {
  try {
    if (!authority || typeof authority !== 'object') return { spend: [] };
    const rawSpend = authority.spend;
    if (!Array.isArray(rawSpend)) {
      const snapshot = { spend: [], invalid: true };
      const rawPausers = authority.pausers;
      if (Array.isArray(rawPausers)) snapshot.pausers = rawPausers.filter((p) => typeof p === 'string' && p.length > 0);
      if (authority.approval) snapshot.approval = authority.approval;
      return snapshot;
    }
    const spend = rawSpend.map((grant) => {
      if (!grant || typeof grant !== 'object') return grant;
      return { asset: grant.asset, maxAmount: grant.maxAmount, to: grant.to };
    });
    const snapshot = { spend };
    try {
      const rawPausers = authority.pausers;
      if (Array.isArray(rawPausers)) snapshot.pausers = rawPausers.filter((p) => typeof p === 'string' && p.length > 0);
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

function createOperation({ goal, authority, agent, exit }) {
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
      const receipt = safeBuildReceipt({
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
    const receipt = safeBuildReceipt({
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
    const receipt = safeBuildReceipt({
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
    check = sufficient(requirements, op.authority);
  } catch (err) {
    op.state = STATES.FAILED;
    const receipt = safeBuildReceipt({
      operation: op,
      capabilityId,
      authority: op.authority,
      outcome: { status: 'failed', exercised: [], detail: errorText(err) },
      evidence: null,
      verification: null,
    });
    return finish(op, receipt);
  }

  let approval = 'preauthorized';
  if (!check.ok) {
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
      const askPayload = Object.assign(requirements.map((r) => ({ ...r })), {
        requirements: requirements.map((r) => ({ ...r })),
        cost: requirements.map((r) => ({ ...r })),
        publicByDefault: false,
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
      }
      const receipt = safeBuildReceipt({
        operation: op,
        capabilityId: capabilityId,
        authority: { ...op.authority, approval: gateRejected ? 'human_gate_rejected' : 'human_gate_no_decision' },
        outcome: { status: 'needs_human_decision', exercised: [], ...(detail ? { detail } : {}), exit: gateExit },
        evidence: null,
        verification: null,
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
      const receipt = safeBuildReceipt({
        operation: op,
        capabilityId: capabilityId,
        authority: { ...op.authority, approval: 'human_gate_approved' },
        outcome: { status: 'failed', exercised: [], detail: errorText(err) },
        evidence: null,
        verification: null,
      });
      return finish(op, receipt);
    }
    op.authority = { spend: approvedGrants };
    check = sufficient(requirements, op.authority);
    approval = 'human_gate_approved';
    if (!check.ok) {
      op.state = STATES.FAILED;
      const receipt = safeBuildReceipt({
        operation: op,
        capabilityId: capabilityId,
        authority: { ...op.authority, approval },
        outcome: { status: 'failed', exercised: [], detail: check.reason },
        evidence: null,
        verification: null,
      });
      return finish(op, receipt);
    }
  }

  op.state = STATES.RUNNING;
  let result;
  const controller = new AbortController();
  try {
    const performPromise = Promise.resolve().then(() => capability.perform({ operation: op, authority: op.authority, signal: controller.signal }));
    result = await withTimeout(performPromise, readTimeout(io, 'performTimeoutMs'), 'capability perform', () => controller.abort());
  } catch (err) {
    if (isTimeout(err)) {
      op.state = STATES.NOT_VERIFIED;
      const receipt = safeBuildReceipt({
        operation: op,
        capabilityId,
        authority: { ...op.authority, approval },
        outcome: { status: 'not_verified', exercised: requirements.map((r) => ({ ...r })), detail: errorText(err) },
        evidence: null,
        verification: { verified: false, checks: {}, reason: 'capability outcome unknown after timeout' },
      });
      return finish(op, receipt);
    }
    op.state = STATES.FAILED;
    const receipt = safeBuildReceipt({
      operation: op,
      capabilityId,
      authority: { ...op.authority, approval },
      outcome: { status: 'failed', exercised: [], detail: errorText(err) },
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
    const receipt = safeBuildReceipt({
      operation: op,
      capabilityId: capabilityId,
      authority: { ...op.authority, approval },
      outcome: { status: 'blocked', exercised: [], detail: reason, reason, exit },
      evidence: capabilityResult.evidence,
      verification: null,
    });
    return finish(op, receipt);
  }
  if (capabilityResult.settlementUnknown) {
    op.state = STATES.NOT_VERIFIED;
    const receipt = safeBuildReceipt({
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
    });
    return finish(op, receipt);
  }

  if (!capabilityResult.ok) {
    op.state = STATES.FAILED;
    const receipt = safeBuildReceipt({
      operation: op,
      capabilityId: capabilityId,
      authority: { ...op.authority, approval },
      outcome: { status: 'failed', exercised: [], detail: capabilityResult.error || 'capability failed' },
      evidence: capabilityResult.evidence,
      verification: null,
    });
    return finish(op, receipt);
  }

  if (!hasEvidence(capabilityResult.evidence)) {
    op.state = STATES.NOT_VERIFIED;
    const receipt = safeBuildReceipt({
      operation: op,
      capabilityId,
      authority: { ...op.authority, approval },
      outcome: { status: 'not_verified', exercised: requirements.map((r) => ({ ...r })), detail: 'capability evidence is missing' },
      evidence: null,
      verification: { verified: false, checks: {}, reason: 'capability evidence is missing' },
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
  const receipt = safeBuildReceipt({
    operation: op,
    capabilityId: capabilityId,
    authority: { ...op.authority, approval },
    outcome: { status: verified ? 'verified' : 'not_verified', exercised },
    evidence: capabilityResult.evidence,
    verification: normalizedVerification,
  });
  return finish(op, receipt, verified ? capabilityResult.output : undefined);
}

module.exports = { createOperation, runOperation, pauseOperation, resumeOperation, STATES, DEFAULT_EXIT };
