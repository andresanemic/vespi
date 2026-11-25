import { Keypair } from '@stellar/stellar-sdk/base';
import { DEFAULT_NETWORK, parseContributionNetwork } from './network';
import { contributionsRedisCredentials, contributionsTokenKey } from './redis-credentials.mjs';
import { readSponsorBudgetCap } from './sponsor-budget';
import { readSponsorConfig, sponsorSetting } from './sponsor-policy';

export function contributionFailure(reason: string, status: number) {
  return Response.json({ ok: false, reason }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function contributionNetworkFromQuery(route: string[]) {
  if (route.length > 1) throw new Error('duplicate network');
  return route.length ? parseContributionNetwork(route[0]) : DEFAULT_NETWORK;
}

export function requestContributionNetwork(request: Request, body?: Record<string, unknown>) {
  const route = new URL(request.url).searchParams.getAll('network');
  const network = contributionNetworkFromQuery(route);
  if (!body || !Object.hasOwn(body, 'network')) return network;
  const fromBody = parseContributionNetwork(body.network);
  if (route.length && fromBody !== network) throw new Error('conflicting network');
  return fromBody;
}

export function readContributionNetwork(request: Request, body?: Record<string, unknown>, env = process.env) {
  let network;
  try { network = requestContributionNetwork(request, body); }
  catch {
    return { ok: false, response: contributionFailure('invalid-network', 400) } as const;
  }

  if (network === 'testnet') return { ok: true, network, env, allowlist: null } as const;

  try {
    const { allowedAccounts } = readSponsorConfig(env, network);
    if (!allowedAccounts?.size) throw new Error('missing allowlist');
    Keypair.fromSecret(sponsorSetting(env, 'CONTRIB_SPONSOR_SECRET', network) ?? '');
    const channels = sponsorSetting(env, 'CONTRIB_CHANNEL_SECRETS', network) ?? '';
    for (const channel of channels.split(',')) Keypair.fromSecret(channel.trim());
    readSponsorBudgetCap(env, network);
    const { url, token } = contributionsRedisCredentials(env, network);
    if (!url || new URL(url).protocol !== 'https:' || !token?.trim()) throw new Error('invalid Redis credentials');
    contributionsTokenKey(env, network);
    return { ok: true, network, env, allowlist: allowedAccounts } as const;
  } catch {
    return { ok: false, response: contributionFailure('mainnet-unavailable', 503) } as const;
  }
}

export function mainnetReceiptSupported(receipt: { kind?: unknown; evidence?: unknown }) {
  return ['REQUEST', 'CONTRIBUTE', 'ACCEPT'].some(kind => kind === receipt.kind) &&
    (receipt.evidence === null || receipt.evidence === undefined);
}

export function mainnetNotSupported() {
  return contributionFailure('mainnet-not-supported', 400);
}

export function accountNotAllowed() {
  return contributionFailure('account-not-allowed', 403);
}
