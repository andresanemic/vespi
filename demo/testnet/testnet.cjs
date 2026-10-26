'use strict';

// Pago en Stellar testnet bajo el kernel de Vespi, que cualquiera puede correr sin cuenta.
// La transacción se arma antes de preguntar: su hash es el contexto de la operación, así que la
// persona aprueba esa transacción y no otra. El kernel vuelve a leer el contexto justo antes del
// efecto; si el hash cambió, bloquea. La firma solo ocurre dentro de `perform`, después del sí:
// sin aprobación no hay firma, y por lo tanto no hay pago. La verificación lee el ledger y exige
// que la transacción registrada sea la aprobada.

const { createOperation, runOperation } = require('../../src/operation.js');
const { verifyPollarPayment, stroops } = require('../pollar/verify.cjs');

const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
const HEX64 = /^[0-9a-f]{64}$/;

function contextFor({ hash, from, to, amount }) {
  return {
    manifestDigest: hash,
    scope: `stellar:testnet pay ${amount} XLM from ${from} to ${to}`,
    sources: [{ ref: `stellar:testnet:tx:${hash}`, owner: 'the person at the human gate', revision: hash, state: 'approved' }],
  };
}

// `prepared`: { hash, from, to, amount, currentHash(), signAndSubmit() -> { hash } }.
async function runTestnetPayment({ prepared, ask, fetchImpl = fetch, horizon = HORIZON_TESTNET }) {
  if (!HEX64.test(prepared.hash)) throw new TypeError('prepared transaction hash must be 64 hex characters');
  const amountStroops = stroops(prepared.amount);
  if (!amountStroops) throw new TypeError('amount must be a positive XLM amount with up to 7 decimals');
  const context = contextFor(prepared);
  const op = createOperation({
    goal: `pay ${prepared.amount} XLM on Stellar testnet to ${prepared.to}`,
    authority: { spend: [] },
    agent: 'vespi-testnet-demo',
    action: 'pay-xlm-testnet',
    context,
  });
  let submitted = false;
  const capability = {
    id: 'stellar-testnet-payment-xlm',
    required: () => ({ spend: [{ asset: 'XLM', amount: amountStroops, to: prepared.to }] }),
    perform: async () => {
      if (prepared.currentHash() !== context.manifestDigest) {
        return { ok: false, error: 'TX_CHANGED', reason: 'the transaction is not the one the person approved' };
      }
      let reported;
      try {
        reported = await prepared.signAndSubmit();
      } catch (err) {
        return { ok: false, error: 'SUBMIT_FAILED', reason: String(err && err.message ? err.message : err) };
      }
      submitted = true;
      const hash = reported && typeof reported.hash === 'string' ? reported.hash : '';
      if (!HEX64.test(hash)) return { ok: false, error: 'NO_TX_HASH', reason: 'Horizon returned no transaction hash' };
      return { ok: true, output: { txHash: hash }, evidence: { type: 'stellar-payment', network: 'stellar:testnet', hash } };
    },
  };
  // El kernel da 15 s por defecto a cada paso; una persona y una red necesitan más.
  const result = await runOperation(op, capability, {
    askTimeoutMs: 10 * 60 * 1000,
    performTimeoutMs: 2 * 60 * 1000,
    verifyTimeoutMs: 60 * 1000,
    ask: (payload) => ask(payload, context),
    readContext: () => contextFor({ ...prepared, hash: prepared.currentHash() }),
    verify: async (evidence) => {
      const ledger = await verifyPollarPayment(evidence, { destination: prepared.to, amountStroops, fetchImpl, horizon });
      const approvedTxOnLedger = !!evidence && evidence.hash === context.manifestDigest && ledger.checks.txFound === true;
      const checks = { ...ledger.checks, approvedTxOnLedger };
      const verified = ledger.verified && approvedTxOnLedger;
      return {
        verified,
        checks,
        reason: verified
          ? 'the ledger shows the exact transaction the person approved, paying the approved amount to the approved destination'
          : approvedTxOnLedger ? ledger.reason : 'the transaction on the ledger is not the one the person approved',
      };
    },
  });
  return { ...result, context, submitted };
}

module.exports = { runTestnetPayment, contextFor, HORIZON_TESTNET };
