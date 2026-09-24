import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, Address, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { USDC_CONTRACT } from './capability.js';
import { authEntriesDigest, verifyPreparedTransaction, verifySettlement } from './settlement.js';

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const PAYER = 'PAYER';
const ASSET_CONTRACT = 'CONTRACT';
const PAY_TO = 'RECIPIENT';

function fakeHorizon(changes, page = {}, transactionPatch = {}) {
  let transactionCalls = 0;
  return {
    transactionCalls: () => transactionCalls,
    transactions: () => ({
      transaction: (hash) => ({
        call: async () => {
          transactionCalls++;
          return { hash, successful: true, ledger: 1000, envelope_xdr: 'encoded', ...transactionPatch };
        },
      }),
    }),
    operations: () => ({
      forTransaction: () => ({ call: async () => ({ records: [{ id: 'op-1' }], ...page }) }),
      operation: () => ({ call: async () => ({ asset_balance_changes: changes }) }),
    }),
  };
}

const change = (overrides = {}) => ({
  asset_code: 'USDC',
  asset_issuer: ISSUER,
  from: ASSET_CONTRACT,
  to: PAY_TO,
  amount: '0.0100000',
  ...overrides,
});

function authorizedFunction() {
  return {
    switch: () => ({ name: 'sorobanAuthorizedFunctionTypeContractFn' }),
    contractFn: () => ({
      contractAddress: () => ASSET_CONTRACT,
      functionName: () => ({ toString: () => 'transfer' }),
      args: () => [PAYER, PAY_TO, '100000'],
    }),
  };
}

function authEntry(overrides = {}) {
  return {
    credentials: () => ({
      switch: () => ({ name: 'sorobanCredentialsAddress' }),
      address: () => ({ address: () => PAYER, signature: () => ({ switch: () => ({ name: 'scvVec' }), vec: () => [{}] }), signatureExpirationLedger: () => 1010 }),
    }),
    rootInvocation: () => ({ function: authorizedFunction, subInvocations: () => [] }),
    ...overrides,
  };
}

function decodedTransfer(overrides = {}) {
  return {
    operations: [{
      type: 'invokeHostFunction',
      func: { switch: () => ({ name: 'hostFunctionTypeInvokeContract' }), invokeContract: () => ({
        contractAddress: () => ASSET_CONTRACT,
        functionName: () => ({ toString: () => 'transfer' }),
        args: () => [PAYER, PAY_TO, '100000'],
      }) },
      auth: [authEntry()],
      invokeContract: () => ({
        contractAddress: () => ASSET_CONTRACT,
        functionName: () => ({ toString: () => 'transfer' }),
        args: () => [PAYER, PAY_TO, '100000'],
      }),
      ...overrides,
    }],
  };
}

function realSdkTransferWithoutAuth() {
  const payer = Keypair.random().publicKey();
  const payTo = Keypair.random().publicKey();
  const args = [
    nativeToScVal(payer, { type: 'address' }),
    nativeToScVal(payTo, { type: 'address' }),
    nativeToScVal('100000', { type: 'i128' }),
  ];
  const invoke = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(USDC_CONTRACT).toScAddress(),
    functionName: 'transfer',
    args,
  });
  const operation = Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(invoke) });
  const encoded = new TransactionBuilder(new Account(payer, '0'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(operation)
    .setTimeout(100)
    .build()
    .toXDR();
  return { decoded: TransactionBuilder.fromXDR(encoded, Networks.TESTNET), payer, payTo };
}

const EXPECTED_AUTH_DIGEST = authEntriesDigest(decodedTransfer());

function evidence(txHash, payer = PAYER, extra = {}) {
  return { txHash, payer, network: 'stellar:testnet', authDigest: EXPECTED_AUTH_DIGEST, ...extra };
}

function options(horizon, extra = {}) {
  return {
    horizon,
    payer: PAYER,
    payTo: PAY_TO,
    amount: '100000',
    issuer: ISSUER,
    assetContract: ASSET_CONTRACT,
    decodeTransaction: () => decodedTransfer(),
    ...extra,
  };
}

test('rejects missing authorization digest by default', async () => {
  const result = await verifySettlement({ txHash: 'tx-no-digest', payer: PAYER, network: 'stellar:testnet' }, options(fakeHorizon([change()])));
  assert.equal(result.verified, false);
  assert.match(result.reason, /authorization digest/);
});

test('accepts one exact SAC transfer tied to the expected payer', async () => {
  const horizon = fakeHorizon([change()]);
  const result = await verifySettlement(evidence('tx-exact'), options(horizon));
  assert.equal(result.verified, true);
  assert.equal(result.checks.exactAmount, true);
  assert.equal(result.checks.payer, true);
  assert.equal(result.checks.invocation, true);
});

test('accepts the exact prepared transfer before settlement', () => {
  const result = verifyPreparedTransaction(decodedTransfer(), {
    payer: PAYER,
    payTo: PAY_TO,
    amount: '100000',
    assetContract: ASSET_CONTRACT,
    authDigest: EXPECTED_AUTH_DIGEST,
  });
  assert.equal(result.verified, true);
  assert.equal(result.checks.prepared, true);
});

test('rejects a prepared transfer with a different auth digest', () => {
  const result = verifyPreparedTransaction(decodedTransfer(), {
    payer: PAYER,
    payTo: PAY_TO,
    amount: '100000',
    assetContract: ASSET_CONTRACT,
    authDigest: 'wrong-digest',
  });
  assert.equal(result.verified, false);
  assert.match(result.reason, /authorization digest/);
});

test('rejects a classic operation with the same balance change', async () => {
  const result = await verifySettlement(
    evidence('tx-classic'),
    options(fakeHorizon([change()]), { decodeTransaction: () => ({ operations: [{ type: 'payment' }] }) }),
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /invocation/);
});

test('reads the real SDK 16 operation shape before checking auth', async () => {
  const real = realSdkTransferWithoutAuth();
  const result = await verifySettlement(
    evidence('tx-real-sdk', real.payer),
    options(fakeHorizon([change()]), {
      payer: real.payer,
      payTo: real.payTo,
      assetContract: USDC_CONTRACT,
      decodeTransaction: () => real.decoded,
    }),
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /authorization/);
});

test('rejects a finalized invocation without a payer authorization entry', async () => {
  const result = await verifySettlement(
    evidence('tx-no-auth'),
    options(fakeHorizon([change()]), { decodeTransaction: () => decodedTransfer({ auth: [] }) }),
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /authorization/);
});

test('rejects authorization with sub-invocations', async () => {
  const decoded = decodedTransfer({
    auth: [authEntry({ rootInvocation: () => ({ function: authorizedFunction, subInvocations: () => [{}] }) })],
  });
  const result = await verifySettlement(evidence('tx-subinvocation'), options(fakeHorizon([change()]), { decodeTransaction: () => decoded }));
  assert.equal(result.verified, false);
  assert.match(result.reason, /authorization/);
});

test('rejects unsupported authorization signature types', async () => {
  const decoded = decodedTransfer({
    auth: [authEntry({ credentials: () => ({
      switch: () => ({ name: 'sorobanCredentialsAddress' }),
      address: () => ({ address: () => PAYER, signature: () => ({ switch: () => ({ name: 'scvBool' }) }), signatureExpirationLedger: () => 1010 }),
    }) })],
  });
  const result = await verifySettlement(evidence('tx-signature-type'), options(fakeHorizon([change()]), { decodeTransaction: () => decoded }));
  assert.equal(result.verified, false);
  assert.match(result.reason, /signature/);
});

test('rejects pending signatures on additional authorization entries', async () => {
  const other = authEntry({ credentials: () => ({
    switch: () => ({ name: 'sorobanCredentialsAddress' }),
    address: () => ({ address: () => 'OTHER', signature: () => ({ switch: () => ({ name: 'scvVoid' }) }), signatureExpirationLedger: () => 1010 }),
  }) });
  const decoded = decodedTransfer({ auth: [authEntry(), other] });
  const result = await verifySettlement(evidence('tx-pending'), options(fakeHorizon([change()]), { decodeTransaction: () => decoded }));
  assert.equal(result.verified, false);
  assert.match(result.reason, /signature/);
});

test('rejects authorization expiring beyond the permitted window', async () => {
  const decoded = decodedTransfer({
    auth: [authEntry({ credentials: () => ({
      switch: () => ({ name: 'sorobanCredentialsAddress' }),
      address: () => ({ address: () => PAYER, signature: () => ({ switch: () => ({ name: 'scvVec' }), vec: () => [{}] }), signatureExpirationLedger: () => 99999 }),
    }) })],
  });
  const result = await verifySettlement(evidence('tx-expiration'), options(fakeHorizon([change()]), { decodeTransaction: () => decoded }));
  assert.equal(result.verified, false);
  assert.match(result.reason, /expiration/);
});

test('rejects authorization for a different root invocation', async () => {
  const decoded = decodedTransfer({
    auth: [authEntry({ rootInvocation: () => ({
      function: () => ({
        switch: () => ({ name: 'sorobanAuthorizedFunctionTypeContractFn' }),
        contractFn: () => ({ contractAddress: () => 'OTHER', functionName: () => 'transfer', args: () => [PAYER, PAY_TO, '100000'] }),
      }),
      subInvocations: () => [],
    }) })],
  });
  const result = await verifySettlement(evidence('tx-root'), options(fakeHorizon([change()]), { decodeTransaction: () => decoded }));
  assert.equal(result.verified, false);
  assert.match(result.reason, /authorization/);
});

test('rejects an overpayment instead of accepting an amount greater than declared', async () => {
  const result = await verifySettlement(
    evidence('tx-overpay'),
    options(fakeHorizon([change({ amount: '0.0100001' })])),
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /exact amount/);
});

test('rejects a settlement response from a different payer', async () => {
  const result = await verifySettlement(
    evidence('tx-wrong-payer', 'OTHER'),
    options(fakeHorizon([change()])),
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /payer/);
});

test('rejects a transfer source that is neither the SAC contract nor the payer', async () => {
  const result = await verifySettlement(
    evidence('tx-wrong-source'),
    options(fakeHorizon([change({ from: 'OTHER' })])),
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /source/);
});

test('rejects extra USDC balance changes in the same transaction', async () => {
  const result = await verifySettlement(
    evidence('tx-extra-change'),
    options(fakeHorizon([change(), change({ to: 'OTHER' })])),
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /exactly one/);
});

test('rejects an incomplete Horizon operation page', async () => {
  const result = await verifySettlement(
    evidence('tx-page'),
    options(fakeHorizon([change()], { _links: { next: { href: 'next-page' } } })),
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /complete/);
});

test('rejects a finalized auth digest that differs from the current payload', async () => {
  const result = await verifySettlement(
    evidence('tx-wrong-auth', PAYER, { authDigest: 'wrong-digest' }),
    options(fakeHorizon([change()]), { requireAuthDigest: true }),
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /authorization digest/);
});

test('rejects a Horizon response for a different transaction hash', async () => {
  const result = await verifySettlement(
    evidence('tx-requested'),
    options(fakeHorizon([change()], {}, { hash: 'DIFFERENT-HASH' })),
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /hash/);
});

test('rejects settlement evidence for a different network', async () => {
  const result = await verifySettlement(
    evidence('tx-network', PAYER, { network: 'stellar:pubnet' }),
    options(fakeHorizon([change()])),
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /network/);
});

test('rejects a missing transaction hash without querying Horizon', async () => {
  const horizon = fakeHorizon([change()]);
  const result = await verifySettlement({}, options(horizon));
  assert.equal(result.verified, false);
  assert.match(result.reason, /transaction hash/);
  assert.equal(horizon.transactionCalls(), 0);
});
