import { Account, Horizon } from '@stellar/stellar-sdk';
import { contributionRoute, type Deps, parseLeasesPerIp } from '@/lib/contributions/handlers';
import { contributionLimiter } from '@/lib/contributions/rate-limit';
import { createSponsorBudget } from '@/lib/contributions/sponsor-budget';

export const dynamic = 'force-dynamic';

const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');

function isNotFound(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null)?.response?.status === 404;
}

const deps = (): Deps => ({
  env: process.env, now: () => new Date(),
  reserveSponsorBudget: createSponsorBudget(process.env),
  leasesPerIp: parseLeasesPerIp(process.env.CONTRIB_LEASES_PER_IP),
  loadAccount: async id => {
    const account = await horizon.loadAccount(id);
    return new Account(account.accountId(), account.sequenceNumber());
  },
  findAccount: async id => {
    try { return { sponsor: (await horizon.loadAccount(id)).sponsor ?? null }; }
    catch (error) { if (isNotFound(error)) return null; throw error; }
  },
  getTransaction: async hash => {
    try {
      const record = await horizon.transactions().transaction(hash).call();
      return { successful: record.successful, ledger: record.ledger_attr };
    } catch (error) { if (isNotFound(error)) return null; throw error; }
  },
  submit: tx => horizon.submitTransaction(tx),
});

const handle = contributionRoute('account', deps, contributionLimiter);

export async function POST(request: Request) {
  return handle(request);
}
