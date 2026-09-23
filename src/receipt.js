'use strict';

// Receipt: durable answer to what happened. No secrets, no user context dump.
function buildReceipt({ operation, capabilityId, authority, outcome, evidence, verification }) {
  return {
    status: outcome.status,
    operation: { id: operation.id, goal: operation.goal },
    capability: capabilityId,
    authority: {
      grants: ((authority && authority.spend) || []).map((g) => ({ ...g })),
      exercised: outcome.exercised || [],
      // How authority was obtained: 'preauthorized' | 'human_gate_approved' | 'human_gate_rejected'.
      // Answers: was this delegated, or did it need a human during this operation?
      ...(authority && authority.approval ? { approval: authority.approval } : {}),
    },
    outcome: outcome.status,
    evidence: evidence || null,
    verification: verification || null,
    detail: outcome.detail || null,
    at: new Date().toISOString(),
  };
}

module.exports = { buildReceipt };
