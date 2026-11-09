'use strict';

// Sandbox core. One SIMULATED role pays approved contributions under a person's one-time concession.
// The kernel (src/) decides before every effect; this file only wires it. Nothing here touches src/.
//
// Receipt shape, and why: the receipt digest has to be in the memo of the payment transaction, so the
// digest cannot depend on the transaction (its hash would be circular). The kernel therefore issues an
// AUTHORIZATION receipt before the effect (what was asked, which grant covered it, who the role is),
// and the payment is made as the kernel's own anchor step: the memo is the receipt digest, and
// `receipt.anchor` (excluded from the digest by the kernel) carries the transaction hash. Ledger
// settlement is NOT claimed by the receipt (it is listed in notCovered as `ledger_settlement`); the
// verifier checks it against Horizon.

const { createHash } = require('node:crypto');
const { createOperation, runOperation } = require('../../../src/operation.js');
const { attenuates } = require('../../../src/authority.js');
const { anchorReceiptAsync } = require('../../../src/receipt.js');

const NETWORK = 'stellar:testnet';
const ASSET = 'XLM';

function toStroops(text) {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(String(text));
  if (!m) throw new TypeError(`invalid XLM amount: ${text}`);
  return (BigInt(m[1]) * 10_000_000n + BigInt(((m[2] || '') + '0000000').slice(0, 7))).toString();
}

function fromStroops(value) {
  const n = BigInt(value);
  const whole = n / 10_000_000n;
  const frac = (n % 10_000_000n).toString().padStart(7, '0');
  return `${whole}.${frac}`;
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function validateRole(role) {
  if (!role || role.simulated !== true) throw new Error('the role file must be marked "simulated": true');
  for (const key of ['name', 'objective', 'limits']) if (!role[key]) throw new Error(`role file lacks ${key}`);
  return role;
}

// The concession is the person's one-time grant: one spend grant per listed destination, each with the
// whole budget as its ceiling and the same expiry. Budget across destinations is tracked by the runner
// (the kernel's ceilings are per operation); see deriveAuthority.
function buildConcession(config, resolve, role, now = new Date()) {
  const c = config.concession;
  const budget = toStroops(c.budgetXLM);
  if (BigInt(budget) > BigInt(toStroops(role.limits.maxBudgetXLM))) throw new Error('the concession exceeds the role limits');
  if (!role.limits.assets.includes(c.asset)) throw new Error('the concession asset is outside the role limits');
  const expiresAt = new Date(now.getTime() + c.validForMinutes * 60_000).toISOString();
  const spend = c.allowedDestinations.map((label) => ({ asset: c.asset, maxAmount: budget, to: resolve(label), network: NETWORK, expiresAt }));
  return { grantedBy: c.grantedBy, budget, expiresAt, authority: { spend } };
}

function buildStaleConcession(config, live) {
  const expiresAt = config.staleConcession.expiresAt;
  const spend = live.authority.spend.map((g) => ({ ...g, expiresAt }));
  return { grantedBy: live.grantedBy, budget: live.budget, expiresAt, authority: { spend } };
}

// What the role holds for one operation: the concession with the ceiling lowered to what is left of the
// budget. attenuates() is the kernel's own proof that the role never holds more than the person granted.
function deriveAuthority(concession, spentStroops) {
  const left = BigInt(concession.budget) - BigInt(spentStroops);
  const remaining = (left > 0n ? left : 0n).toString();
  const derived = { spend: concession.authority.spend.map((g) => ({ ...g, maxAmount: remaining })) };
  if (!attenuates(derived, concession.authority)) throw new Error('derived authority is not covered by the concession');
  return { derived, remaining };
}

function contextFor(role, concession) {
  const manifest = JSON.stringify({ role, grantedBy: concession.grantedBy, budget: concession.budget, expiresAt: concession.expiresAt, spend: concession.authority.spend });
  return {
    manifestDigest: sha256(manifest),
    scope: `SIMULATED ROLE ${role.name}; one concession by ${concession.grantedBy}; budget ${fromStroops(concession.budget)} XLM; expires ${concession.expiresAt}; ${NETWORK}`,
    sources: [{ ref: `role:${role.name}`, owner: concession.grantedBy, revision: sha256(JSON.stringify(role)), state: 'approved' }],
  };
}

// One step: the kernel decides; if it authorizes, the payment is made as the anchor of the receipt.
async function operateStep({ step, role, concession, spent, resolve, adapter, now }) {
  const asset = step.asset || ASSET;
  const to = resolve(step.to);
  const amount = toStroops(step.amountXLM);
  const { derived, remaining } = deriveAuthority(concession, spent);
  const listed = new Set(concession.authority.spend.map((g) => g.to));
  const context = contextFor(role, concession);
  const op = createOperation({
    goal: `[SIMULATED ROLE ${role.name}] pay ${step.amountXLM} ${asset} to ${step.to} for: ${step.contribution}`,
    authority: derived,
    agent: role.name,
    action: 'sim-pay-contribution',
    context,
  });
  const capability = {
    id: 'sandbox-contribution-payment',
    required: () => ({ spend: [{ asset, amount, to, network: NETWORK }] }),
    perform: async () => ({ ok: true, evidence: { type: 'stellar-payment-authorization', network: NETWORK, amount: step.amountXLM } }),
  };
  const io = {
    readContext: () => context,
    // nobody is at the gate: the role runs unattended, so the gate is answered "no" (echoing the request digest)
    ask: async (payload) => ({ approved: false, ...(payload && payload.approvalRequest ? { request: payload.approvalRequest.digest } : {}) }),
    verify: async () => ({
      verified: true,
      checks: {
        within_grant: true,
        destination_listed: listed.has(to),
        amount_within_remaining_budget: BigInt(amount) <= BigInt(remaining),
        ledger_settlement: false, // not claimed here: the verifier reads Horizon
      },
      reason: 'the kernel authorized the payment under the concession; settlement is checked against the ledger by the verifier',
    }),
    ...(now ? { now } : {}),
  };
  const result = await runOperation(op, capability, io);
  const record = { id: step.id, kind: step.type, requested: { to: step.to, toAddress: to, asset, amountXLM: step.amountXLM }, kernelStatus: result.receipt.status, detail: result.receipt.detail || null };
  if (step.reason) record.attemptReason = step.reason;
  if (result.receipt.status !== 'verified') {
    record.outcome = 'blocked';
    record.receipt = result.receipt;
    return record;
  }
  let lastError = null;
  const anchored = await anchorReceiptAsync(
    result.receipt,
    async (digest) => {
      try {
        return { txHash: await adapter.pay({ to, amountStroops: amount, memoHex: digest }), network: NETWORK };
      } catch (err) {
        lastError = String(err && err.message ? err.message : err);
        return null;
      }
    },
    async (txHash, digest) => adapter.confirm({ txHash, memoHex: digest, to, amountStroops: amount }),
  );
  record.receipt = anchored;
  record.txHash = anchored.anchor && anchored.anchor.txHash ? anchored.anchor.txHash : null;
  record.outcome = anchored.anchor.status === 'anchored' ? 'paid' : (record.txHash ? 'submitted_unconfirmed' : 'failed');
  if (lastError) record.error = lastError;
  return record;
}

module.exports = { NETWORK, ASSET, toStroops, fromStroops, sha256, validateRole, buildConcession, buildStaleConcession, deriveAuthority, contextFor, operateStep };
