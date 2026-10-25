'use strict';

// Verificación separada: lee la transacción en Horizon y compara con lo autorizado.
// No usa nada de lo que informó el navegador salvo el hash.

const HORIZON = 'https://horizon.stellar.org';

function stroops(amountText) {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(String(amountText));
  if (!m) return null;
  return (BigInt(m[1]) * 10_000_000n + BigInt(((m[2] || '') + '0000000').slice(0, 7))).toString();
}

async function verifyPollarPayment(evidence, { destination, amountStroops, fetchImpl = fetch, horizon = HORIZON }) {
  const hash = evidence && evidence.hash;
  const checks = { txFound: false, txSuccessful: false, paymentOpFound: false, toMatches: false, amountMatches: false, assetNative: false };
  try {
    const tx = await fetchImpl(`${horizon}/transactions/${hash}`);
    if (!tx.ok) return { verified: false, checks, reason: `Horizon answered ${tx.status} for the transaction` };
    const txBody = await tx.json();
    checks.txFound = txBody.hash === hash;
    checks.txSuccessful = txBody.successful === true;
    const opsRes = await fetchImpl(`${horizon}/transactions/${hash}/operations`);
    if (!opsRes.ok) return { verified: false, checks, reason: `Horizon answered ${opsRes.status} for the operations` };
    const ops = (await opsRes.json())._embedded.records.filter((o) => o.type === 'payment');
    checks.paymentOpFound = ops.length > 0;
    const op = ops.find((o) => o.to === destination && o.asset_type === 'native' && stroops(o.amount) === String(amountStroops));
    const first = ops[0];
    checks.toMatches = ops.some((o) => o.to === destination);
    checks.assetNative = ops.some((o) => o.asset_type === 'native');
    checks.amountMatches = !!op;
    const ok = Object.values(checks).every(Boolean);
    return {
      verified: ok,
      checks,
      reason: ok ? 'ledger shows a successful native payment of the authorized amount to the authorized destination'
        : `ledger does not match the authorization${first ? ` (first payment: ${first.amount} to ${first.to})` : ''}`,
    };
  } catch (err) {
    return { verified: false, checks, reason: 'could not read the ledger' };
  }
}

module.exports = { verifyPollarPayment, stroops, HORIZON };
