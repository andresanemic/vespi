'use strict';

const { createOperation, runOperation } = require('../../src/operation.js');
const { pollarCapability } = require('./capability.cjs');
const { verifyPollarPayment } = require('./verify.cjs');

// Autoridad vacía a propósito: la operación no puede gastar sin que una persona abra la puerta.
async function runPollarPayment({ destination, amountStroops, ask, waitForPayment, fetchImpl }) {
  const op = createOperation({
    goal: `pay ${amountStroops} stroops of XLM to ${destination} with Pollar (mainnet)`,
    authority: { spend: [] },
    agent: 'vespi-pollar-demo',
    action: 'pay-with-pollar',
  });
  const capability = pollarCapability({ destination, amountStroops, waitForPayment });
  // El kernel da 15 s por defecto a la puerta humana, al pago y a la verificacion; una persona y un
  // navegador necesitan mas. Cada tope se fija con su peor caso, no con el valor de fabrica.
  return runOperation(op, capability, {
    askTimeoutMs: 10 * 60 * 1000,
    performTimeoutMs: 16 * 60 * 1000,
    verifyTimeoutMs: 60 * 1000,
    ask,
    verify: (evidence) => verifyPollarPayment(evidence, { destination, amountStroops, fetchImpl }),
  });
}

module.exports = { runPollarPayment };
