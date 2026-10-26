#!/usr/bin/env node
'use strict';

// Uso, desde demo/testnet (Node 24+):
//   npm ci && node pay.cjs            pago en testnet con la puerta humana (pregunta y/N)
//   node pay.cjs --yes | --no         responde la puerta sin teclado
//   node pay.cjs --amount=2.5         otro monto en XLM de testnet
//   node pay.cjs --verify-mainnet     re-verifica, en solo lectura, las dos tx reales de mainnet (sin npm ci)

const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline/promises');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const say = (line = '') => process.stdout.write(`${line}\n`);
const mark = (ok) => (ok ? 'ok ' : 'NO ');

function printChecks(checks) {
  for (const [name, ok] of Object.entries(checks)) say(`    ${mark(ok)} ${name}`);
}

async function verifyMainnet() {
  const { verifyPollarMainnet, verifyReceiptAnchor, POLLAR_PAYMENT, RECEIPT_ANCHOR } = require('./mainnet.cjs');
  say('Re-verifying the two real Stellar mainnet transactions of 25 Oct 2026 against Horizon (read-only).');
  say();
  const pay = await verifyPollarMainnet();
  say(`Pollar payment under the kernel's human gate  ${pay.verified ? 'VERIFIED' : 'NOT VERIFIED'}`);
  say(`  tx ${POLLAR_PAYMENT.hash}`);
  printChecks(pay.checks);
  say(`  ${pay.reason}`);
  say(`  https://stellar.expert/explorer/public/tx/${POLLAR_PAYMENT.hash}`);
  say();
  const anchor = await verifyReceiptAnchor();
  say(`Vespi receipt anchor  ${anchor.verified ? 'VERIFIED' : 'NOT VERIFIED'}`);
  say(`  tx ${RECEIPT_ANCHOR.hash}`);
  say(`  receipt digest ${RECEIPT_ANCHOR.digest}`);
  printChecks(anchor.checks);
  say(`  ${anchor.reason}`);
  say(`  https://stellar.expert/explorer/public/tx/${RECEIPT_ANCHOR.hash}`);
  say();
  say('This re-reads the ledger. It does not replay the approval or the payment.');
  return pay.verified && anchor.verified;
}

async function fund(publicKey) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) throw new Error(`Friendbot answered ${res.status} for ${publicKey}`);
}

async function payOnTestnet() {
  let sdk;
  try {
    sdk = require('@stellar/stellar-sdk');
  } catch {
    say('This mode needs the Stellar SDK. Run `npm ci` in demo/testnet first.');
    return false;
  }
  const { Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset, BASE_FEE } = sdk;
  const { runTestnetPayment, HORIZON_TESTNET } = require('./testnet.cjs');
  const amount = option('amount', '1');

  say('1/5  Two fresh Stellar testnet accounts, funded by Friendbot (free test XLM, no real money).');
  const payer = Keypair.random();
  const payee = Keypair.random();
  await Promise.all([fund(payer.publicKey()), fund(payee.publicKey())]);
  say(`     payer ${payer.publicKey()}`);
  say(`     payee ${payee.publicKey()}`);

  const server = new Horizon.Server(HORIZON_TESTNET);
  const account = await server.loadAccount(payer.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: payee.publicKey(), asset: Asset.native(), amount }))
    .setTimeout(600)
    .build();
  const hashOf = () => tx.hash().toString('hex');
  const prepared = {
    hash: hashOf(),
    from: payer.publicKey(),
    to: payee.publicKey(),
    amount,
    currentHash: hashOf,
    signAndSubmit: async () => {
      say('3/5  Approved: the kernel lets the capability sign this one transaction and submit it to testnet.');
      tx.sign(payer);
      const res = await server.submitTransaction(tx);
      return { hash: res.hash };
    },
  };

  const ask = async (payload) => {
    say('2/5  Human gate. The agent holds no authority to spend, so the kernel stops and asks a person.');
    say(`     network      Stellar testnet`);
    say(`     pay          ${amount} XLM`);
    say(`     to           ${prepared.to}`);
    say(`     transaction  ${prepared.hash}`);
    say(`     approval     ${payload.approvalRequest.digest}  (kernel approval request)`);
    say('     Only this transaction can be signed. Without a yes there is no signature and no payment.');
    let answer;
    if (flag('yes')) answer = 'y';
    else if (flag('no')) answer = 'n';
    else {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      answer = await terminal.question('     Approve this exact transaction? [y/N] ');
      terminal.close();
    }
    const yes = /^y(es)?$/i.test(String(answer).trim());
    say(`     answer: ${yes ? 'yes' : 'no'}`);
    return yes ? { approved: true, by: 'person-at-terminal', request: payload.approvalRequest.digest } : { approved: false };
  };

  const result = await runTestnetPayment({ prepared, ask });
  const receipt = result.receipt;
  if (!result.submitted) {
    say('3/5  No approval: nothing was signed and nothing was sent.');
  }
  if (result.submitted) say('4/5  The kernel read the transaction on Horizon testnet and compared it with the approval.');
  if (receipt && receipt.verification && receipt.verification.checks) printChecks(receipt.verification.checks);
  say(`5/5  Receipt: ${receipt ? receipt.status : result.status}`);
  if (receipt) {
    say(`     digest      ${receipt.digest}`);
    if (receipt.decidedBy) say(`     decided by  ${receipt.decidedBy}`);
    say(`     coverage    ${JSON.stringify(receipt.coverage)}`);
    say(`     notCovered  ${JSON.stringify(receipt.notCovered)}`);
    const dir = path.join(__dirname, 'out');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `testnet-receipt-${prepared.hash.slice(0, 16)}.json`);
    writeFileSync(file, `${JSON.stringify({ transaction: prepared.hash, payer: prepared.from, payee: prepared.to, amount, receipt }, null, 2)}\n`);
    say(`     saved       ${file}`);
  }
  if (result.submitted) say(`     open it     https://stellar.expert/explorer/testnet/tx/${prepared.hash}`);
  const verified = receipt && receipt.status === 'verified';
  const declined = !result.submitted && !flag('yes');
  return verified || declined;
}

async function main() {
  const ok = flag('verify-mainnet') ? await verifyMainnet() : await payOnTestnet();
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  process.exitCode = 1;
});
