'use strict';

// Offline, dependency-free demonstration. A terminal operator approves explicitly; the host
// observation callback is a local fixture. The kernel operation, receipt and second process are real.
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');
const { createOperation, runOperation } = require('../src/operation.js');
const { resumeFromReceipts } = require('../src/continuity.js');

const REQUIREMENT = { asset: 'NOTE', amount: '1', to: 'local-ledger' };

async function execute() {
  const ledger = [];
  const op = createOperation({
    goal: 'write one local note',
    action: 'write_note',
    authority: { spend: [] },
  });
  const capability = {
    id: 'local-note',
    required: () => ({ spend: [REQUIREMENT] }),
    perform: async () => {
      ledger.push({ to: 'local-ledger', note: 'hello vespi' });
      return { ok: true, evidence: { status: 'written', operationId: op.id } };
    },
  };
  const result = await runOperation(op, capability, {
    ask: async () => {
      process.stdout.write('gate: needs_human_decision (insufficient permission; no effect ran)\n');
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await terminal.question('human approval [Name: approve]: ');
      terminal.close();
      const match = /^([A-Za-z][A-Za-z0-9 _-]*):\s*approve$/i.exec(answer.trim());
      return match ? { approved: true, by: match[1] } : { approved: false };
    },
    verify: async () => {
      const observed = ledger.some((entry) => entry.to === REQUIREMENT.to && entry.note === 'hello vespi');
      return {
        verified: observed,
        checks: { effect_present: observed, recipient_matches: observed, network_anchor: false },
        reason: 'separate host observation of the local ledger',
      };
    },
  });
  return result.receipt;
}

function resume(receipt) {
  const result = resumeFromReceipts([receipt], {
    approved: [
      { action: 'write_note', localReversible: true },
      { action: 'publish_summary' },
    ],
  }, {
    verifyLocal: (action, digest) => action === 'write_note' && digest === receipt.digest,
  });
  process.stdout.write(`${JSON.stringify({
    lastState: result.lastState,
    nextAction: result.nextAction?.action ?? null,
    needsPerson: result.needsPerson,
    reason: result.reason,
  })}\n`);
}

async function main() {
  if (process.argv[2] === '--execute') {
    process.stdout.write(`${JSON.stringify(await execute())}\n`);
    return;
  }
  if (process.argv[2] === '--resume') {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    resume(JSON.parse(input));
    return;
  }

  const receipt = await execute();
  if (receipt.status !== 'verified') throw new Error(`operation stopped with ${receipt.status}`);
  process.stdout.write(`approval: approved by ${receipt.decidedBy}\n`);
  process.stdout.write('effect: ledger note written\n');
  process.stdout.write('observation: note present (separate verifier)\n');
  process.stdout.write(`receipt: ${JSON.stringify({
    status: receipt.status,
    digest: receipt.digest,
    coverage: receipt.coverage,
    notCovered: receipt.notCovered,
  })}\n`);

  const second = spawnSync(process.execPath, [__filename, '--resume'], {
    encoding: 'utf8',
    input: JSON.stringify(receipt),
  });
  if (second.status !== 0) throw new Error(second.stderr || 'second process failed');
  const resumed = JSON.parse(second.stdout);
  process.stdout.write(`second process: ${resumed.reason.startsWith('resumes') ? `resumes next action ${resumed.nextAction}` : resumed.reason}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
