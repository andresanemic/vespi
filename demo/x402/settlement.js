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
  return {
    verified: true,
    checks: { invocation: true, authorization: true },
    facts: { contract: expected.assetContract, function: 'transfer' },
  };
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
    facts: result.facts,
    reason: 'prepared transaction matches declared effect',
  };
}

// `checks` holds only booleans: the kernel counts a check as covered when it is `true` and lists
// anything else in `notCovered`. Values a reader may want (a hash, a counter, an amount) go in
// `facts`, which is not coverage.
function failure(reason, checks = {}, facts = {}) {
  return { verified: false, checks, facts, reason };
}

async function verifySettlementUnchecked(evidence, options) {
  const {
    horizon,
    payer,
    payTo,
    amount = '100000',
    issuer,
    assetContract,
    network = 'stellar:testnet',
    decodeTransaction = decodeEnvelope,
    // The signal the run handed down. A settlement read is three Horizon round trips, so the abort
    // is checked before each one and once more after the last: a read nobody is waiting for is not
    // a readback. Without it a cancelled run keeps the ledger busy and then answers with a verdict
    // it produced after the payment was called off.
    signal,
  } = options || {};
  const aborted = () => {
    try {
      return signal?.aborted === true;
    } catch {
      return true;
    }
  };
  // No check name is claimed here. The closed catalog does not carry a name for a cancelled read,
  // and inventing one would be refused by the kernel anyway; what this says is only that there is
  // nothing verified, and the reason says which phase stopped.
  const stopped = (phase) => failure(`the settlement read was cancelled before ${phase}`);

  // One Horizon read, with the run's signal carried into it and with nothing left to throw.
  //
  // Two things were missing here and both were visible from outside. The signal was checked at the
  // doors but never handed to the call, so an abort that arrived while a read was in flight could not
  // stop it: the read ran to its answer against the ledger and the abort was noticed afterwards, one
  // wasted round trip later. And the read was unguarded, so whatever the SDK raised — a network
  // error, a 404, an aborted request — left this function as a raw exception and crossed to the host
  // with the ledger host's own text on it.
  //
  // So the signal goes in with the read, and a read that ends badly ends in the closed vocabulary.
  // Which of the two it was comes from the signal, not from the shape of the error: this SDK reports
  // an aborted request as a plain Error carrying a message, with no abort name and no code, so
  // matching on the error would mistake a cancelled run for a broken ledger.
  //
  // The two outcomes are told apart by which key is present, never by looking inside the answer: a
  // Horizon record is not this function's to interpret, and a refusal could collide with a field of
  // its own.
  const readSettlementPage = async (read, phase) => {
    if (aborted()) return { refused: stopped(phase) };
    let answer;
    try {
      answer = await read(signal);
    } catch {
      // An abort is the caller answering and a failure is the ledger host answering. Neither is text
      // this function may repeat, so both come back as a closed refusal with no check claimed.
      return { refused: aborted() ? stopped(phase) : failure('the settlement read could not be completed', {}) };
    }
    // The abort can also land between the answer arriving and this line, and an answer nobody is
    // waiting for is not a readback.
    if (aborted()) return { refused: stopped(phase) };
    return { answer };
  };

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

  if (aborted()) return stopped('the transaction was read');

  const txHash = evidence.txHash.trim().toLowerCase();
  // `read` hands the signal to the SDK, which takes no arguments on `call()` in this version: the
  // port installs it on the client's own fetch options, where it reaches `fetch`. The argument is
  // still passed, because a Horizon that is not this SDK — a double in a test, another adapter — is
  // the one place where the signal can be honoured directly.
  const firstRead = await readSettlementPage(
    (readSignal) => horizon.transactions().transaction(txHash).call(readSignal),
    'the transaction was read',
  );
  if (firstRead.refused) return firstRead.refused;
  const txn = firstRead.answer;
  if (aborted()) return stopped('the transaction was read');
  if (typeof txn.hash !== 'string' || txn.hash.trim().toLowerCase() !== txHash) {
    return failure('Horizon transaction hash does not match requested hash', {}, { transaction: txHash });
  }
  if (txn.successful !== true) return failure('transaction not successful', {}, { transaction: txHash });
  // In the Horizon SDK `ledger` is the HAL link (a function); the sequence number is `ledger_attr`.
  const currentLedger = Number(txn.ledger_attr ?? txn.ledger);
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
  if (!invocation.verified) return failure(invocation.reason, { invocation: false }, { transaction: txHash });

  if (aborted()) return stopped('the operation page was read');

  const pageRead = await readSettlementPage(
    (readSignal) => horizon.operations().forTransaction(txHash).call(readSignal),
    'the operation page was read',
  );
  if (pageRead.refused) return pageRead.refused;
  const operations = pageRead.answer;
  if (operations._links && operations._links.next) return failure('Horizon operation page is not complete', {}, { transaction: txHash });
  const changes = [];
  for (const operation of operations.records || []) {
    // Checked per operation and not once for the page: one page can hold many operations, and a run
    // that gave up after the third should not have produced the fourth read.
    if (aborted()) return stopped('every operation was read');
    const operationRead = await readSettlementPage(
      (readSignal) => horizon.operations().operation(operation.id).call(readSignal),
      'every operation was read',
    );
    if (operationRead.refused) return operationRead.refused;
    const full = operationRead.answer;
    if (Array.isArray(full.asset_balance_changes)) changes.push(...full.asset_balance_changes);
  }

  const assetChanges = changes.filter((change) => change.asset_code === 'USDC' && change.asset_issuer === issuer);
  const recipientChanges = assetChanges.filter((change) => change.to === payTo);
  const checks = { ...invocation.checks };
  const facts = {
    ...invocation.facts,
    transaction: txHash,
    changesSeen: changes.length,
    assetChanges: assetChanges.length,
    recipientChanges: recipientChanges.length,
  };
  if (assetChanges.length !== 1 || recipientChanges.length !== 1) {
    return failure('expected exactly one USDC transfer to recipient', { ...checks, transfer: false }, facts);
  }

  const transfer = recipientChanges[0];
  if (transfer.from !== assetContract && transfer.from !== payer) {
    return failure('transfer source is neither the asset contract nor the payer', { ...checks, source: false }, facts);
  }
  const actual = toAtomic(transfer.amount);
  if (actual === null || actual !== expected) {
    return failure('transfer amount does not match exact amount', { ...checks, exactAmount: false }, { ...facts, amountAtomic: actual?.toString() });
  }

  if (aborted()) return stopped('the verdict was formed');

  return {
    verified: true,
    checks: { ...checks, transfer: true, payer: true, source: true, exactAmount: true },
    facts: { ...facts, amountAtomic: actual.toString() },
    reason: 'settlement matches exact declared effect',
  };
}

// Horizon is external data, and a successful HTTP call can still resolve to a malformed SDK object.
// Keep that shape boundary inside the same closed vocabulary as a rejected read; do not let a
// TypeError containing response-controlled details escape into the paid operation's host.
async function verifySettlement(evidence, options) {
  try {
    return await verifySettlementUnchecked(evidence, options);
  } catch {
    return failure('the settlement response could not be checked');
  }
}

export { authDigestFromEnvelope, authEntriesDigest, toAtomic, verifyPreparedTransaction, verifySettlement };
