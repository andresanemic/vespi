import { StrKey } from '@stellar/stellar-sdk/base';
import { isEncounterId } from '@/lib/contributions/encounters';
import { contributionFailure, contributionNetworkFromQuery } from '@/lib/contributions/network-request';
import { createPublicEncounters, publicEncounterLimiter } from '@/lib/contributions/public-encounters';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ account: string }> }) {
  const hit = publicEncounterLimiter.take(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown', null);
  if (!hit.ok) {
    const response = contributionFailure('rate_limited', 429);
    response.headers.set('Retry-After', String(hit.retryAfter));
    return response;
  }
  const { account } = await params;
  if (!StrKey.isValidEd25519PublicKey(account)) return contributionFailure('invalid-account', 400);
  const query = new URL(request.url).searchParams;
  const cursors = query.getAll('cursor');
  const cursor = cursors[0] ?? '0';
  if (cursors.length > 1 || (cursor !== '0' && !isEncounterId(cursor))) return contributionFailure('invalid-cursor', 400);
  let network;
  try { network = contributionNetworkFromQuery(query.getAll('network')); }
  catch { return contributionFailure('invalid-network', 400); }
  try {
    const page = await createPublicEncounters(network).list(account, cursor);
    return Response.json({ ok: true, ...page }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return contributionFailure('unavailable', 503);
  }
}
