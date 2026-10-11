'use strict';

// Offline, dependency-free. The other half of the walkthrough: what an agent is NOT allowed to do.
// The agent holds a grant of 5 NOTE to one destination. It asks for 25: the gate stops it and no
// effect runs. It asks for 3: inside the grant, it runs without asking, a separate observation checks
// it, and the receipt says what was checked and what was not. The effect and the observation are a
// local fixture; the kernel operation and its receipt are real.
const { createOperation, runOperation } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');

const ASSET = 'NOTE';
const TO = 'local-ledger';
const CEILING = '5';

async function attempt(number, amount) {
  const ledger = [];
  const op = createOperation({
    goal: `spend ${amount} ${ASSET}`,
    action: 'write_note',
    authority: grantSpend(ASSET, CEILING, TO),
  });
  const capability = {
    id: 'local-spend',
    required: () => ({ spend: [{ asset: ASSET, amount, to: TO }] }),
    perform: async () => {
      ledger.push({ to: TO, amount });
      return { ok: true, evidence: { status: 'written', operationId: op.id } };
    },
  };
  process.stdout.write(`operation ${number}: spend ${amount} ${ASSET} (granted ceiling: ${CEILING})\n`);
  const result = await runOperation(op, capability, {
    ask: async () => {
      process.stdout.write('  gate: needs_human_decision (over the granted ceiling; no effect ran)\n');
      process.stdout.write('  person: declined\n');
      return { approved: false };
    },
    verify: async () => {
      const observed = ledger.some((entry) => entry.to === TO && entry.amount === amount);
      return {
        verified: observed,
        checks: { effect_present: observed, recipient_matches: observed, network_anchor: false },
        reason: 'separate host observation of the local ledger',
      };
    },
  });
  const receipt = result.receipt;
  if (ledger.length === 0) process.stdout.write('  effect: none\n');
  else process.stdout.write('  effect: ledger entry written (inside the grant, no question asked)\n');
  process.stdout.write(`  receipt: ${JSON.stringify({
    status: receipt.status,
    digest: receipt.digest,
    coverage: receipt.coverage,
    notCovered: receipt.notCovered,
  })}\n`);
  return receipt;
}

async function main() {
  const refused = await attempt(1, '25');
  if (refused.status === 'verified') throw new Error('an over-limit operation must not verify');
  const allowed = await attempt(2, '3');
  if (allowed.status !== 'verified') throw new Error(`an in-limit operation stopped with ${allowed.status}`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
