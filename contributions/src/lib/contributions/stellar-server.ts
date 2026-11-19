import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type Account, type FeeBumpTransaction, type Keypair,
  Networks, Operation, Transaction, TransactionBuilder,
} from '@stellar/stellar-sdk/base';

export function buildOnboardingTx({ channel, sponsor, newAccount, baseFee, timeoutSeconds }: {
  channel: Account;
  sponsor: string;
  newAccount: string;
  baseFee: string;
  timeoutSeconds: number;
}): Transaction {
  return new TransactionBuilder(channel, { fee: baseFee, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.beginSponsoringFutureReserves({ source: sponsor, sponsoredId: newAccount }))
    .addOperation(Operation.createAccount({ source: sponsor, destination: newAccount, startingBalance: '0' }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: newAccount }))
    .setTimeout(timeoutSeconds)
    .build();
}

export function buildFeeBump(inner: Transaction, sponsor: Keypair, baseFee: string): FeeBumpTransaction {
  return TransactionBuilder.buildFeeBumpTransaction(sponsor, baseFee, inner, Networks.TESTNET);
}

export function wrapFeeBump(inner: Transaction, sponsor: Keypair, baseFee: string): FeeBumpTransaction {
  const tx = buildFeeBump(inner, sponsor, baseFee);
  tx.sign(sponsor);
  return tx;
}

export function onboardingToken(xdr: string, key: Uint8Array): string {
  const tx = new Transaction(xdr, Networks.TESTNET);
  // The participant adds a signature between prepare and complete; authenticate the unsigned envelope.
  tx.signatures.length = 0;
  return createHmac('sha256', key).update(tx.toXDR()).digest('hex');
}

export function verifyOnboardingToken(xdr: string, token: string, key: Uint8Array): boolean {
  if (!/^[0-9a-f]{64}$/i.test(token)) return false;
  try {
    return timingSafeEqual(Buffer.from(onboardingToken(xdr, key), 'hex'), Buffer.from(token, 'hex'));
  } catch {
    return false;
  }
}

export function isBadSequence(horizonError: unknown): boolean {
  const error = horizonError as {
    response?: { data?: { extras?: { result_codes?: { transaction?: unknown } } } };
  } | null | undefined;
  return error?.response?.data?.extras?.result_codes?.transaction === 'tx_bad_seq';
}
