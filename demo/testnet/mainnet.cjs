'use strict';

// Re-verificación de solo lectura de las dos transacciones reales en Stellar mainnet del
// 25 de octubre de 2026: el pago con Pollar bajo la puerta humana del kernel y el ancla de un
// recibo. No firma, no paga y no repite la aprobación: lee Horizon y compara.

const { verifyPollarPayment, HORIZON } = require('../pollar/verify.cjs');

const POLLAR_PAYMENT = {
  hash: '52759df5db949d6bd9b506de0081f7bddb5254bb374de8f682b5a1e507e37bb2',
  destination: 'GDS6AO6UEHXO6SFG7R4HQS5KN7RMFUPMAQLHJA7CD7ZFNELWACINCO36',
  amountStroops: '1000',
};
const RECEIPT_ANCHOR = {
  hash: '2ff744c69fc01c0de2016e45c5f157b0434382572f2dfc997e8e1d4e34af09d7',
  digest: '71f58fc2379c72d177f9ab4b655106d0474a67924c59c966153a7995776b7d9f',
};

async function verifyPollarMainnet({ fetchImpl = fetch, horizon = HORIZON } = {}) {
  return verifyPollarPayment({ hash: POLLAR_PAYMENT.hash }, { ...POLLAR_PAYMENT, fetchImpl, horizon });
}

async function verifyReceiptAnchor({ fetchImpl = fetch, horizon = HORIZON } = {}) {
  const { hash, digest } = RECEIPT_ANCHOR;
  const checks = { txFound: false, txSuccessful: false, memoHashIsDigest: false, manageDataIsDigest: false };
  try {
    const tx = await fetchImpl(`${horizon}/transactions/${hash}`);
    if (!tx.ok) return { verified: false, checks, reason: `Horizon answered ${tx.status} for the transaction` };
    const body = await tx.json();
    checks.txFound = body.hash === hash;
    checks.txSuccessful = body.successful === true;
    checks.memoHashIsDigest = body.memo_type === 'hash' && Buffer.from(String(body.memo || ''), 'base64').toString('hex') === digest;
    const opsRes = await fetchImpl(`${horizon}/transactions/${hash}/operations`);
    if (!opsRes.ok) return { verified: false, checks, reason: `Horizon answered ${opsRes.status} for the operations` };
    const ops = (await opsRes.json())._embedded.records;
    checks.manageDataIsDigest = ops.some((o) => o.type === 'manage_data'
      && Buffer.from(String(o.value || ''), 'base64').toString('hex') === digest);
    const verified = Object.values(checks).every(Boolean);
    return { verified, checks, reason: verified ? 'the ledger holds the receipt digest as a hash memo and a manage_data entry' : 'the ledger does not hold the receipt digest as expected' };
  } catch {
    return { verified: false, checks, reason: 'could not read the ledger' };
  }
}

module.exports = { verifyPollarMainnet, verifyReceiptAnchor, POLLAR_PAYMENT, RECEIPT_ANCHOR };
