import { contributionRoute, type Deps, parseLeasesPerIp } from '@/lib/contributions/handlers';
import { makeFeeBumpDeps } from '@/lib/contributions/fee-bump-runtime';
import { contributionLimiter } from '@/lib/contributions/rate-limit';
import { createSharedChannelLeases } from '@/lib/contributions/channel-leases';
import { type ContributionNetwork } from '@/lib/contributions/network';
import { sponsorSetting } from '@/lib/contributions/sponsor-policy';

export const dynamic = 'force-dynamic';

const deps = (network: ContributionNetwork, env: Deps['env']): Deps => ({
  ...makeFeeBumpDeps(network, env),
  leasesPerIp: parseLeasesPerIp(sponsorSetting(env, 'CONTRIB_LEASES_PER_IP', network)),
  sharedLeases: network === 'mainnet' ? createSharedChannelLeases(env, network) : undefined,
});

const handle = contributionRoute('account', deps, contributionLimiter);

export async function POST(request: Request) {
  return handle(request);
}
