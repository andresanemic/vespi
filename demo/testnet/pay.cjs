#!/usr/bin/env node
'use strict';

// Uso, desde demo/testnet (Node 24+):
//   npm ci && node pay.cjs            pago en testnet con la puerta humana (pregunta y/N)
//   node pay.cjs --yes | --no         responde la puerta sin teclado (solo testnet)
//   node pay.cjs --amount=2.5         otro monto en XLM de testnet
//   node pay.cjs --verify-mainnet     re-verifica, en solo lectura, las dos tx reales de mainnet (sin npm ci)
//   node pay.cjs --network=mainnet    pago real en mainnet con una cuenta propia: la llave secreta se lee
//                                     de STELLAR_SECRET o se pide sin eco; monto por defecto 0.0001 XLM,
//                                     tope 0.01 XLM; destino por defecto la wallet Pollar del 25 oct
//                                     (--to=G... para otro); la puerta se responde siempre a mano.

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
const POLLAR_WALLET = 'GALQPWE7LAMFKRWKX4SICCHUPPW4NPSOWWICLMI2KLHJDBYZIYEAO7OA';
const MAINNET_CAP_STROOPS = 100000n; // 0.01 XLM

function printChecks(checks) {
  for (const [name, ok] of Object.entries(checks)) say(`    ${mark(ok)} ${name}`);
}

async function verifyMainnet() {
  const { verifyPollarMainnet, verifyKernelSignedMainnet, verifyReceiptAnchor, POLLAR_PAYMENT, KERNEL_SIGNED_PAYMENT, RECEIPT_ANCHOR } = require('./mainnet.cjs');
  say('Re-verifying the three real Stellar mainnet transactions of 25–26 Oct 2026 against Horizon (read-only).');
  say();
  const pay = await verifyPollarMainnet();
  say(`Pollar payment under the kernel's human gate  ${pay.verified ? 'VERIFIED' : 'NOT VERIFIED'}`);
  say(`  tx ${POLLAR_PAYMENT.hash}`);
  printChecks(pay.checks);
  say(`  ${pay.reason}`);
  say(`  https://stellar.expert/explorer/public/tx/${POLLAR_PAYMENT.hash}`);
  say();
  const signed = await verifyKernelSignedMainnet();
  say(`Demo capability signed after kernel-gated approval of the transaction hash (26 Oct 2026)  ${signed.verified ? 'VERIFIED' : 'NOT VERIFIED'}`);
  say(`  tx ${KERNEL_SIGNED_PAYMENT.hash}`);
  printChecks(signed.checks);
  say(`  https://stellar.expert/explorer/public/tx/${KERNEL_SIGNED_PAYMENT.hash}`);
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
  return pay.verified && signed.verified && anchor.verified;
}

async function fund(publicKey) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) throw new Error(`Friendbot answered ${res.status} for ${publicKey}`);
}

// Lee una línea sin mostrarla en pantalla (la llave secreta nunca se imprime ni se guarda).
function hiddenLine(question) {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let data = '';
      const done = () => { process.stdin.off('data', onData); process.stdin.pause(); resolve(data.split(/\r?\n/)[0].trim()); };
      const onData = (chunk) => { data += chunk.toString('utf8'); if (/\r?\n/.test(data)) done(); };
      process.stdin.on('data', onData);
      process.stdin.once('end', done);
      process.stdin.resume();
    });
  }
  process.stdout.write(question);
  return new Promise((resolve, reject) => {
    let buffer = '';
    const stdin = process.stdin;
    const finish = (fn) => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); fn(); };
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return finish(() => resolve(buffer.trim()));
        if (ch === '\u0003') return finish(() => reject(new Error('cancelled')));
        if (ch === '\u007f' || ch === '\b') buffer = buffer.slice(0, -1);
        else buffer += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function availableStroops(server, publicKey) {
  const account = await server.loadAccount(publicKey);
  const native = account.balances.find((b) => b.asset_type === 'native');
  const toStroops = (v) => BigInt(Math.round(Number(v || 0) * 1e7));
  const reserve = BigInt(2 + Number(account.subentry_count || 0) + Number(account.num_sponsoring || 0) - Number(account.num_sponsored || 0)) * 5_000_000n;
  return { account, available: toStroops(native && native.balance) - reserve - toStroops(native && native.selling_liabilities) };
}

async function pay(network) {
  let sdk;
  try {
    sdk = require('@stellar/stellar-sdk');
  } catch {
    say('This mode needs the Stellar SDK. Run `npm ci` in demo/testnet first.');
    return false;
  }
  const { Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset, BASE_FEE, StrKey } = sdk;
  const { runStellarPayment, NETWORKS } = require('./testnet.cjs');
  const { stroops } = require('../pollar/verify.cjs');
  const mainnet = network === 'mainnet';
  const amount = option('amount', mainnet ? '0.0001' : '1');
  const amountStroops = stroops(amount);
  if (!amountStroops || BigInt(amountStroops) <= 0n) { say(`Invalid amount: ${amount}`); return false; }
  const server = new Horizon.Server(NETWORKS[network].horizon);

  let payer;
  let to;
  if (mainnet) {
    if (BigInt(amountStroops) > MAINNET_CAP_STROOPS) { say('Mainnet amount is capped at 0.01 XLM in this demo.'); return false; }
    if (flag('yes')) { say('On mainnet the gate is always answered by hand: --yes is not accepted.'); return false; }
    to = option('to', POLLAR_WALLET);
    if (!StrKey.isValidEd25519PublicKey(to)) { say(`Invalid destination: ${to}`); return false; }
    say('Stellar MAINNET: this sends REAL XLM from your own account.');
    const secret = process.env.STELLAR_SECRET || await hiddenLine('Secret key of the paying account (input hidden, never printed or saved): ');
    try {
      payer = Keypair.fromSecret(secret);
    } catch {
      say('That is not a valid Stellar secret key.');
      return false;
    }
    const { available } = await availableStroops(server, payer.publicKey());
    const needed = BigInt(amountStroops) + BigInt(BASE_FEE);
    say(`1/5  Paying account ${payer.publicKey()}; available above the reserve: ${(Number(available) / 1e7).toFixed(7)} XLM.`);
    if (available < needed) { say('Not enough XLM above the account reserve for this payment and its fee.'); return false; }
  } else {
    say('1/5  Two fresh Stellar testnet accounts, funded by Friendbot (free test XLM, no real money).');
    payer = Keypair.random();
    const payee = Keypair.random();
    await Promise.all([fund(payer.publicKey()), fund(payee.publicKey())]);
    to = payee.publicKey();
    say(`     payer ${payer.publicKey()}`);
    say(`     payee ${to}`);
  }

  const account = await server.loadAccount(payer.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: mainnet ? Networks.PUBLIC : Networks.TESTNET })
    .addOperation(Operation.payment({ destination: to, asset: Asset.native(), amount }))
    .setTimeout(600)
    .build();
  const hashOf = () => tx.hash().toString('hex');
  const prepared = {
    hash: hashOf(),
    from: payer.publicKey(),
    to,
    amount,
    currentHash: hashOf,
    signAndSubmit: async () => {
      say(`3/5  Approved: the kernel lets the capability sign this one transaction and submit it to ${mainnet ? 'MAINNET' : 'testnet'}.`);
      tx.sign(payer);
      const res = await server.submitTransaction(tx);
      return { hash: res.hash };
    },
  };

  const ask = async (payload) => {
    say('2/5  Human gate. The agent holds no authority to spend, so the kernel stops and asks a person.');
    say(`     network      Stellar ${mainnet ? 'MAINNET (real XLM)' : 'testnet'}`);
    say(`     pay          ${amount} XLM`);
    say(`     to           ${prepared.to}`);
    say(`     transaction  ${prepared.hash}`);
    say(`     approval     ${payload.approvalRequest.digest}  (kernel approval request)`);
    say('     Only this transaction can be signed. Without a yes there is no signature and no payment.');
    let answer;
    if (!mainnet && flag('yes')) answer = 'y';
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

  const result = await runStellarPayment({ prepared, ask, network });
  const receipt = result.receipt;
  if (!result.submitted) say('3/5  No approval: nothing was signed and nothing was sent.');
  else say(`4/5  The kernel read the transaction on Horizon ${mainnet ? 'mainnet' : 'testnet'} and compared it with the approval.`);
  if (receipt && receipt.verification && receipt.verification.checks) printChecks(receipt.verification.checks);
  say(`5/5  Receipt: ${receipt ? receipt.status : result.status}`);
  if (receipt) {
    say(`     digest      ${receipt.digest}`);
    if (receipt.decidedBy) say(`     decided by  ${receipt.decidedBy}`);
    say(`     coverage    ${JSON.stringify(receipt.coverage)}`);
    say(`     notCovered  ${JSON.stringify(receipt.notCovered)}`);
    const dir = path.join(__dirname, 'out');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${network}-receipt-${prepared.hash.slice(0, 16)}.json`);
    writeFileSync(file, `${JSON.stringify({ network: NETWORKS[network].id, transaction: prepared.hash, payer: prepared.from, payee: prepared.to, amount, receipt }, null, 2)}\n`);
    say(`     saved       ${file}`);
  }
  if (result.submitted) say(`     open it     https://stellar.expert/explorer/${mainnet ? 'public' : 'testnet'}/tx/${prepared.hash}`);
  const verified = receipt && receipt.status === 'verified';
  const declined = !result.submitted && !flag('yes');
  return verified || declined;
}

async function main() {
  const network = option('network', 'testnet');
  if (!['testnet', 'mainnet'].includes(network)) throw new Error('--network must be testnet or mainnet');
  const ok = flag('verify-mainnet') ? await verifyMainnet() : await pay(network);
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  process.stderr.write(`${err && err.message ? err.message : err}\n`);
  process.exitCode = 1;
});
