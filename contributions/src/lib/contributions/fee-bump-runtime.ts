import { Horizon } from '@stellar/stellar-sdk';
import type { FeeBumpDeps } from './handlers';
import { createSponsorBudget } from './sponsor-budget';

const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');

export async function lookupAnchor(hash: string) {
  try {
    const record = await horizon.transactions().transaction(hash).call();
    return { successful: record.successful, ledger: record.ledger_attr,
      envelopeXdr: record.envelope_xdr, closedAt: record.created_at };
  } catch (error) {
    if ((error as { response?: { status?: number } } | null)?.response?.status === 404) return null;
    throw error;
  }
}

export async function testnetAccountExists(actor: string) {
  try { await horizon.loadAccount(actor); return true; }
  catch (error) {
    if ((error as { response?: { status?: number } } | null)?.response?.status === 404) return false;
    throw error;
  }
}

export async function latestLedgerTime() {
  const { records } = await horizon.ledgers().order('desc').limit(1).call();
  return Date.parse(records[0]?.closed_at ?? '') / 1000;
}

export function makeFeeBumpDeps(): FeeBumpDeps {
  return {
    env: process.env, now: () => new Date(),
    reserveSponsorBudget: createSponsorBudget(process.env),
    getTransaction: lookupAnchor,
    submit: tx => horizon.submitTransaction(tx),
  };
}
