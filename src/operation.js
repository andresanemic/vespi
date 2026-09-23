'use strict';

// Minimal executable Vespi operation.
//
// Capability contract (a function-shaped object, nothing more):
//   { id, required(op) -> { spend: [{asset, amount, to}] }, perform(ctx) -> { ok, evidence?, error? } }
// The kernel never imports a specific capability. x402, Stellar, USDC live outside.
//
// runOperation(op, capability, { verify(evidence)->{verified,checks,reason}, ask(requirements)->{approved} }):
//   requirements -> authority sufficient? no -> NEEDS_HUMAN_DECISION (no side effect, ever)
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

let seq = 0;

function createOperation({ goal, authority }) {
  return {
    id: `op-${Date.now().toString(36)}-${seq++}`,
    goal,
    authority: authority || { spend: [] },
    state: 'created',
    history: [],
  };
}

async function runOperation(op, capability, io) {
  const requirements = capability.required(op).spend || [];
  let check = sufficient(requirements, op.authority);

  let approval = 'preauthorized';
  if (!check.ok) {
    const gate = io && io.ask ? await io.ask(requirements) : { approved: false };
    if (!gate.approved) {
      op.state = STATES.NEEDS_DECISION;
      const receipt = buildReceipt({
        operation: op,
        capabilityId: capability.id,
        authority: { ...op.authority, approval: 'human_gate_rejected' },
        outcome: { status: 'needs_human_decision', exercised: [] },
        evidence: null,
        verification: null,
      });
      return { status: op.state, receipt };
    }
    // Approved at the gate: proceed under the requirements themselves as the exercised grant,
    // destination included — a grant without counterparty is blind.
    op.authority = { spend: requirements.map((r) => ({ asset: r.asset, maxAmount: r.amount, to: r.to })) };
    check = sufficient(requirements, op.authority);
    approval = 'human_gate_approved';
  }

  op.state = STATES.RUNNING;
  let result;
  try {
    result = await capability.perform({ operation: op, authority: op.authority });
  } catch (err) {
    op.state = STATES.FAILED;
    const receipt = buildReceipt({
      operation: op,
      capabilityId: capability.id,
      authority: { ...op.authority, approval },
      outcome: { status: 'failed', exercised: [], detail: String((err && err.message) || err) },
      evidence: null,
      verification: null,
    });
    return { status: op.state, receipt };
  }

  if (!result || result.ok !== true) {
    op.state = STATES.FAILED;
    const receipt = buildReceipt({
      operation: op,
      capabilityId: capability.id,
      authority: { ...op.authority, approval },
      outcome: { status: 'failed', exercised: [], detail: (result && result.error) || 'capability failed' },
      evidence: (result && result.evidence) || null,
      verification: null,
    });
    return { status: op.state, receipt };
  }

  const exercised = requirements.map((r) => ({ ...r }));
  // A verifier exception after a side effect must never leave the operation
  // without a durable receipt. The side effect may have happened: keep evidence,
  // do NOT rerun, do NOT claim verified.
  let verification;
  try {
    verification = io && io.verify ? await io.verify(result.evidence) : { verified: false, checks: {}, reason: 'no verifier' };
  } catch (err) {
    verification = { verified: false, checks: {}, reason: `verifier error: ${String((err && err.message) || err)}` };
  }
  op.state = verification.verified ? STATES.SUCCEEDED : STATES.NOT_VERIFIED;
  const receipt = buildReceipt({
    operation: op,
    capabilityId: capability.id,
    authority: { ...op.authority, approval },
    outcome: { status: verification.verified ? 'verified' : 'not_verified', exercised },
    evidence: result.evidence,
    verification,
  });
  return { status: op.state, receipt };
}

module.exports = { createOperation, runOperation, STATES };
