'use strict';

// Testnet adapter. Testnet only: the Horizon URL and the passphrase are fixed here. Secret keys live in
// memory for the run and are never printed or written.

const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';

function loadSdk() {
  try {
    return require('@stellar/stellar-sdk');
  } catch {
    throw new Error('The Stellar SDK is missing. Run `npm --prefix demo/sandbox ci` first.');
  }
}

async function fund(publicKey, fetchImpl = fetch) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await fetchImpl(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
    if (res.ok) return;
    lastStatus = res.status;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error(`Friendbot answered ${lastStatus} for ${publicKey}`);
}

function createStellarAdapter({ payer, fetchImpl = fetch, horizon = HORIZON_TESTNET }) {
  const sdk = loadSdk();
  const { Horizon, TransactionBuilder, Networks, Operation, Asset, Memo, BASE_FEE } = sdk;
  const server = new Horizon.Server(horizon);
  const { fromStroops } = require('./sandbox.cjs');
  return {
    horizon,
    async pay({ to, amountStroops, memoHex }) {
      if (!/^[0-9a-f]{64}$/.test(memoHex)) throw new TypeError('memo must be a 32-byte hex digest');
      const account = await server.loadAccount(payer.publicKey());
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({ destination: to, asset: Asset.native(), amount: fromStroops(amountStroops) }))
        .addMemo(Memo.hash(memoHex))
        .setTimeout(120)
        .build();
      tx.sign(payer);
      const res = await server.submitTransaction(tx);
      return res.hash;
    },
    async confirm({ txHash, memoHex, to, amountStroops }) {
      const base = `${horizon}/transactions/${txHash}`;
      const tx = await (await fetchImpl(base)).json();
      if (tx.hash !== txHash || tx.successful !== true) return false;
      if (tx.memo_type !== 'hash' || Buffer.from(String(tx.memo || ''), 'base64').toString('hex') !== memoHex) return false;
      const ops = (await (await fetchImpl(`${base}/operations`)).json())._embedded.records;
      return ops.some((o) => o.type === 'payment' && o.to === to && o.asset_type === 'native' && o.amount === fromStroops(amountStroops));
    },
  };
}

module.exports = { createStellarAdapter, fund, loadSdk, HORIZON_TESTNET };
