import { StrKey } from '@stellar/stellar-sdk/base';
import { readContributionBody } from '@/lib/contributions/handlers';
import { makeReceiptAnchor } from '@/lib/contributions/receipt-runtime';
import { readContributionNetwork } from '@/lib/contributions/network-request';
import { contributionLimiter, mainnetContributionLimiter } from '@/lib/contributions/rate-limit';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  'anchor-pending': 409, 'chain-conflict': 409, 'retry-with-fresh-transaction': 409,
  'budget-exhausted': 409, 'budget-unavailable': 503, 'anchor-unavailable': 503,
  'config-error': 503, 'anchor-mismatch': 502, 'inner-failed': 422, 'evidence-unavailable': 422,
  'mainnet-not-supported': 400, 'organizer-required': 403, 'account-not-allowed': 403, 'survey-closed': 410,
  'event-not-open': 409, 'event-closed': 410, 'attendance-already-signed': 409,
};

function requestedActor(body: Record<string, unknown>) {
  let actor = body.participant;
  if (typeof body.bytes === 'string') {
    try { actor = JSON.parse(body.bytes)?.actor; }
    catch { return null; }
  }
  return typeof actor === 'string' && StrKey.isValidEd25519PublicKey(actor) ? actor : null;
}

export async function POST(request: Request) {
  const parsed = await readContributionBody(request);
  const selected = readContributionNetwork(request, parsed.ok ? parsed.body : undefined);
  if (!selected.ok) return selected.response;
  const { network, env } = selected;
  const limiter = network === 'mainnet' ? mainnetContributionLimiter : contributionLimiter;
  const hit = limiter.take(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    parsed.ok ? requestedActor(parsed.body) : null);
  if (!hit.ok) return Response.json({ ok: false, reason: 'rate_limited' }, {
    status: 429, headers: { 'Retry-After': String(hit.retryAfter) },
  });
  if (!parsed.ok) return Response.json(parsed, { status: parsed.reason === 'too_large' ? 413 : 400 });

  const result = await makeReceiptAnchor(network, env)(parsed.body);
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.reason] ?? 400 });
}
