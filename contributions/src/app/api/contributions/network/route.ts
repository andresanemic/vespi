import { StrKey } from '@stellar/stellar-sdk/base';
import { readContributionNetwork } from '@/lib/contributions/network-request';
import { createRateLimiter } from '@/lib/contributions/rate-limit';

export const dynamic = 'force-dynamic';
const limiter = createRateLimiter();

export function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const hit = limiter.take(ip, null);
  if (!hit.ok) return Response.json({ ok: false, reason: 'rate_limited' }, {
    status: 429, headers: { 'Retry-After': String(hit.retryAfter), 'Cache-Control': 'no-store' },
  });
  const url = new URL(request.url);
  const [account, ...extra] = url.searchParams.getAll('account');
  url.searchParams.set('network', 'mainnet');
  let mainnet = false;
  if (account && !extra.length && StrKey.isValidEd25519PublicKey(account)) {
    const selected = readContributionNetwork(new Request(url));
    mainnet = selected.ok && selected.allowlist?.has(account) === true;
  }
  return Response.json({ mainnet }, { headers: { 'Cache-Control': 'no-store' } });
}
