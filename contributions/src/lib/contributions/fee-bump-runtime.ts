import { Account, Horizon } from '@stellar/stellar-sdk';
import { contributionNetwork, DEFAULT_NETWORK } from './network';
import { accountAllowed, readAccountAllowlist } from './sponsor-policy';
import { createSponsorBudget } from './sponsor-budget';
import type { Deps } from './handlers';

function notFound(error: unknown) {
  return (error as { response?: { status?: number } } | null)?.response?.status === 404;
}

function makeHorizonPorts(network = DEFAULT_NETWORK) {
  const horizon = new Horizon.Server(contributionNetwork(network).horizon);
  return {
    async loadAccount(id: string) {
      const account = await horizon.loadAccount(id);
      return new Account(account.accountId(), account.sequenceNumber());
    },
    async findAccount(id: string) {
      try { return { sponsor: (await horizon.loadAccount(id)).sponsor ?? null }; }
      catch (error) { if (notFound(error)) return null; throw error; }
    },
    async getTransaction(hash: string) {
      try {
        const record = await horizon.transactions().transaction(hash).call();
        return { successful: record.successful, ledger: record.ledger_attr,
          envelopeXdr: record.envelope_xdr, closedAt: record.created_at };
      } catch (error) { if (notFound(error)) return null; throw error; }
    },
    async latestLedgerTime() {
      const { records } = await horizon.ledgers().order('desc').limit(1).call();
      return Date.parse(records[0]?.closed_at ?? '') / 1000;
    },
    submit: (tx: Parameters<Deps['submit']>[0]) => horizon.submitTransaction(tx),
    // Bound the fee_charged p90 lookup to 2 s. Soroban charges can raise the reading up to the sponsor cap.
    async networkFee() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('fee-stats-timeout')), 2_000); });
      try { return Number((await Promise.race([horizon.feeStats(), timeout])).fee_charged.p90); }
      finally { clearTimeout(timer); }
    },
  };
}

export async function enabledAccountExists(actor: string, network = DEFAULT_NETWORK, env = process.env) {
  return accountAllowed(readAccountAllowlist(env, network), actor) && !!await makeHorizonPorts(network).findAccount(actor);
}

export function makeFeeBumpDeps(network = DEFAULT_NETWORK, env: Deps['env'] = process.env) {
  return {
    ...makeHorizonPorts(network),
    env, network, now: () => new Date(),
    reserveSponsorBudget: createSponsorBudget(env, fetch, network),
  };
}
