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
};

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
    return {
      settlementUnknown: result?.settlementUnknown === true,
      ok: result?.ok === true,
      error: typeof error === 'string' ? error : (error == null ? null : 'capability returned an invalid error'),
      evidence: result?.evidence ?? null,
      output: result?.output,
    };
  } catch (error) {
    return {
      settlementUnknown: true,
      ok: false,
      error: `capability result invalid: ${errorText(error)}`,
      evidence: null,
      output: undefined,
    };
  }
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
    if (!Array.isArray(rawSpend)) return { spend: [], invalid: true };
    const spend = rawSpend.map((grant) => {
      if (!grant || typeof grant !== 'object') return grant;
      return { asset: grant.asset, maxAmount: grant.maxAmount, to: grant.to };
    });
    const snapshot = { spend };
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
      if (spec?.outcome?.status === 'not_verified' || spec?.outcome?.status === 'needs_human_decision' || spec?.outcome?.status === 'failed') status = spec.outcome.status;
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

function createOperation({ goal, authority }) {
  return {
    id: `op-${Date.now().toString(36)}-${seq++}`,
    goal: snapshotGoal(goal),
    authority: snapshotAuthority(authority),
    state: 'created',
    history: [],
    receipt: null,
    output: null,
    inFlight: false,
  };
}

function finish(op, receipt, output) {
  if (receipt?.status === 'not_verified' && op.state === STATES.SUCCEEDED) op.state = STATES.NOT_VERIFIED;
  if (receipt?.status === 'failed' && op.state === STATES.SUCCEEDED) op.state = STATES.FAILED;
  op.receipt = receipt;
  if (output !== undefined && op.state === STATES.SUCCEEDED) op.output = output;
  return { status: op.state, receipt, output: op.output };
}

async function runOperation(op, capability, io) {
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
  if (op.state === STATES.RUNNING) throw new Error('operation is already running');
  if (op.receipt && op.state !== STATES.NEEDS_DECISION) return { status: op.state, receipt: op.receipt, output: op.output };

  let requirements;
  try {
    const declared = capability.required(op);
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
    let gateApproved = false;
    let gateRejected = false;
    let gateError = null;
    try {
      const askFn = io && typeof io.ask === 'function' ? io.ask : null;
      const gate = askFn
        ? await withTimeout(Promise.resolve().then(() => askFn.call(io, requirements)), readTimeout(io, 'askTimeoutMs'), 'human gate')
        : null;
      if (gate !== null && gate !== undefined) {
        gateApproved = gate.approved === true;
        gateRejected = gate.approved === false;
      }
    } catch (err) {
      gateError = `human gate error: ${errorText(err)}`;
    }
    if (gateError || !gateApproved) {
      op.state = STATES.NEEDS_DECISION;
      const receipt = safeBuildReceipt({
        operation: op,
        capabilityId: capabilityId,
        authority: { ...op.authority, approval: gateRejected ? 'human_gate_rejected' : 'human_gate_no_decision' },
        outcome: { status: 'needs_human_decision', exercised: [], ...(gateError ? { detail: gateError } : {}) },
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

module.exports = { createOperation, runOperation, STATES };
