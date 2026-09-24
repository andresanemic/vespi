import { Address, TransactionBuilder, scValToNative } from '@stellar/stellar-sdk';
import { getNetworkPassphrase } from '@x402/stellar';
import { createHash } from 'node:crypto';

const TOKEN_DECIMALS = 7;
const TOKEN_SCALE = 10n ** BigInt(TOKEN_DECIMALS);
const AUTH_EXPIRATION_LEDGER_TOLERANCE = 2;
const ESTIMATED_LEDGER_SECONDS = 5;
const MAX_SIGNATURE_SECONDS = 300;

function toAtomic(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,7})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * TOKEN_SCALE + BigInt((fraction + '0000000').slice(0, TOKEN_DECIMALS));
}

function toDeclaredAtomic(value) {
  const text = String(value);
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

function decodeEnvelope(envelope, network) {
  if (typeof envelope !== 'string' || !envelope) return null;
  try {
    return TransactionBuilder.fromXDR(envelope, getNetworkPassphrase(network));
  } catch {
    return null;
  }
}

function native(value) {
  return typeof value === 'string' ? value : scValToNative(value);
}

function contractAddress(value) {
  return typeof value === 'string' ? value : Address.fromScAddress(value).toString();
}

function authEntriesDigest(transaction) {
  const entries = transaction?.operations?.[0]?.auth;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const encoded = entries.map((entry) => {
    try {
      return typeof entry.toXDR === 'function' ? entry.toXDR('base64') : JSON.stringify(entry);
    } catch {
      return '';
    }
  }).join('|');
  return createHash('sha256').update(encoded).digest('hex');
}

function authDigestFromEnvelope(envelope, network) {
  return authEntriesDigest(decodeEnvelope(envelope, network));
}

function authorizationError(operation, expected, currentLedger) {
  const entries = Array.isArray(operation.auth) ? operation.auth : [];
  if (entries.length === 0) return 'payer authorization entry is missing';
  const hasLedger = Number.isSafeInteger(currentLedger);
  const maxLedger = hasLedger
    ? currentLedger + Math.ceil(MAX_SIGNATURE_SECONDS / ESTIMATED_LEDGER_SECONDS) + AUTH_EXPIRATION_LEDGER_TOLERANCE
    : Infinity;
  let payerMatched = false;
  for (const entry of entries) {
    let credentials;
    let addressCredentials;
    let rootInvocation;
    try {
      credentials = entry.credentials();
      const credentialType = credentials.switch().name;
      addressCredentials = credentialType === 'sorobanCredentialsAddress'
        ? credentials.address()
        : credentialType === 'sorobanCredentialsAddressV2'
          ? credentials.addressV2()
          : null;
      rootInvocation = entry.rootInvocation();
    } catch {
      return 'payer authorization entry is invalid';
    }
    if (!addressCredentials || !rootInvocation) return 'payer authorization entry is invalid';
    let address;
    let expiration;
    try {
      address = contractAddress(addressCredentials.address());
      expiration = addressCredentials.signatureExpirationLedger();
    } catch {
      return 'payer authorization entry is invalid';
    }
    if (!Number.isSafeInteger(expiration) || expiration <= 0 || (hasLedger && expiration <= currentLedger) || expiration > maxLedger) {
      return 'payer authorization expiration is outside the permitted window';
    }
    let subInvocations;
    try {
      subInvocations = rootInvocation.subInvocations();
    } catch {
      return 'payer authorization entry is invalid';
    }
    if (!Array.isArray(subInvocations) || subInvocations.length !== 0) {
      return 'payer authorization contains sub-invocations';
    }
    let authorizedFunction;
    let contractFunction;
    let args;
    try {
      authorizedFunction = rootInvocation.function();
      if (!authorizedFunction || authorizedFunction.switch().name !== 'sorobanAuthorizedFunctionTypeContractFn') {
        return 'payer authorization is not a contract function';
      }
      contractFunction = authorizedFunction.contractFn();
      args = contractFunction.args();
      if (contractAddress(contractFunction.contractAddress()) !== expected.assetContract || contractFunction.functionName().toString() !== 'transfer' || args.length !== 3) {
        return 'payer authorization does not match the transfer';
      }
      if (native(args[0]) !== expected.payer || native(args[1]) !== expected.payTo || BigInt(native(args[2])) !== expected.amount) {
        return 'payer authorization does not match the transfer';
      }
    } catch {
      return 'payer authorization is invalid';
    }
    let signature;
    try {
      signature = addressCredentials.signature();
      const signatureType = signature.switch().name;
      if (signatureType !== 'scvVec' || typeof signature.vec !== 'function' || signature.vec().length === 0) {
        return 'authorization signature is missing or unsupported';
      }
    } catch {
      return 'authorization signature is invalid';
    }
    if (address !== expected.payer) continue;
    payerMatched = true;
  }
  return payerMatched ? null : 'payer authorization entry is missing';
}

function verifyInvocation(transaction, expected) {
  if (!transaction || !Array.isArray(transaction.operations) || transaction.operations.length !== 1) {
    return { verified: false, reason: 'expected one Soroban invocation operation' };
  }
  const operation = transaction.operations[0];
  if (operation.type !== 'invokeHostFunction' || !operation.func || typeof operation.func.invokeContract !== 'function' || operation.func.switch().name !== 'hostFunctionTypeInvokeContract') {
    return { verified: false, reason: 'expected Soroban transfer invocation' };
  }
  const invocation = operation.func.invokeContract();
  if (!invocation || contractAddress(invocation.contractAddress()) !== expected.assetContract) {
    return { verified: false, reason: 'invocation contract does not match the asset contract' };
  }
  if (invocation.functionName().toString() !== 'transfer') {
    return { verified: false, reason: 'invocation function is not transfer' };
  }
  const args = invocation.args();
  if (args.length !== 3) return { verified: false, reason: 'invocation arguments are incomplete' };
  const from = native(args[0]);
  const to = native(args[1]);
  let amount;
  try {
    amount = BigInt(native(args[2]));
  } catch {
    return { verified: false, reason: 'invocation amount is invalid' };
  }
  if (from !== expected.payer || to !== expected.payTo || amount !== expected.amount) {
    return { verified: false, reason: 'invocation payer, recipient, or amount does not match' };
  }
  const authError = authorizationError(operation, expected, expected.currentLedger);
  if (authError) {
    return { verified: false, reason: authError };
  }
  const actualAuthDigest = authEntriesDigest(transaction);
  if (expected.requireAuthDigest && !actualAuthDigest) {
    return { verified: false, reason: 'authorization digest is missing' };
  }
  if (expected.authDigest && actualAuthDigest !== expected.authDigest) {
    return { verified: false, reason: 'authorization digest does not match the current payload' };
  }
  return { verified: true, checks: { invocation: true, authorization: true, contract: expected.assetContract, function: 'transfer' } };
}

function verifyPreparedTransaction(transaction, expected) {
  if (!expected || typeof expected !== 'object') {
    return failure('prepared verification is missing expected values');
  }
  const amount = toDeclaredAtomic(expected.amount);
  if (amount === null) return failure('invalid expected amount');
  const result = verifyInvocation(transaction, { ...expected, amount, currentLedger: null });
  if (!result.verified) return result;
  return {
    verified: true,
    checks: { ...result.checks, prepared: true },
    reason: 'prepared transaction matches declared effect',
  };
}

function failure(reason, checks = {}) {
  return { verified: false, checks, reason };
}

async function verifySettlement(evidence, options) {
  const {
    horizon,
    payer,
    payTo,
    amount = '100000',
    issuer,
    assetContract,
    network = 'stellar:testnet',
    decodeTransaction = decodeEnvelope,
  } = options || {};
  if (!evidence || typeof evidence.txHash !== 'string' || !evidence.txHash.trim()) {
    return failure('missing transaction hash');
  }
  if (!horizon || !payer || !payTo || !issuer || !assetContract) {
    return failure('verification is missing horizon, payer, recipient, issuer, or asset contract');
  }
  if (evidence.payer !== payer) {
    return failure('settlement payer does not match expected payer', { payer: false });
  }
  if (evidence.network !== network) {
    return failure('settlement network does not match expected network', { network: false });
  }
  if (typeof evidence.authDigest !== 'string' || !evidence.authDigest.trim()) {
    return failure('authorization digest is missing');
  }
  const expected = toDeclaredAtomic(amount);
  if (expected === null) return failure('invalid expected amount');

  const txHash = evidence.txHash.trim().toLowerCase();
  const txn = await horizon.transactions().transaction(txHash).call();
  if (typeof txn.hash !== 'string' || txn.hash.trim().toLowerCase() !== txHash) {
    return failure('Horizon transaction hash does not match requested hash', { transaction: txHash });
  }
  if (txn.successful !== true) return failure('transaction not successful', { transaction: txHash });
  const currentLedger = Number(txn.ledger);
  if (!Number.isSafeInteger(currentLedger) || currentLedger < 0) {
    return failure('transaction ledger is missing or invalid');
  }
  const invocation = verifyInvocation(decodeTransaction(txn.envelope_xdr, network), {
    payer,
    payTo,
    amount: expected,
    assetContract,
    authDigest: evidence.authDigest,
    requireAuthDigest: true,
    currentLedger,
  });
  if (!invocation.verified) return failure(invocation.reason, { transaction: txHash, invocation: false });

  const operations = await horizon.operations().forTransaction(txHash).call();
  if (operations._links && operations._links.next) return failure('Horizon operation page is not complete', { transaction: txHash });
  const changes = [];
  for (const operation of operations.records || []) {
    const full = await horizon.operations().operation(operation.id).call();
    if (Array.isArray(full.asset_balance_changes)) changes.push(...full.asset_balance_changes);
  }

  const assetChanges = changes.filter((change) => change.asset_code === 'USDC' && change.asset_issuer === issuer);
  const recipientChanges = assetChanges.filter((change) => change.to === payTo);
  const checks = {
    transaction: txHash,
    ...invocation.checks,
    changesSeen: changes.length,
    assetChanges: assetChanges.length,
    recipientChanges: recipientChanges.length,
  };
  if (assetChanges.length !== 1 || recipientChanges.length !== 1) {
    return failure('expected exactly one USDC transfer to recipient', checks);
  }

  const transfer = recipientChanges[0];
  if (transfer.from !== assetContract && transfer.from !== payer) {
    return failure('transfer source is neither the asset contract nor the payer', { ...checks, source: false });
  }
  const actual = toAtomic(transfer.amount);
  if (actual === null || actual !== expected) {
    return failure('transfer amount does not match exact amount', { ...checks, amountAtomic: actual?.toString() });
  }

  return {
    verified: true,
    checks: { ...checks, transfer: true, payer: true, source: true, exactAmount: true, amountAtomic: actual.toString() },
    reason: 'settlement matches exact declared effect',
  };
}

export { authDigestFromEnvelope, authEntriesDigest, toAtomic, verifyPreparedTransaction, verifySettlement };
