import { StrKey } from '@stellar/stellar-sdk/base';
import { readContributionBody } from '@/lib/contributions/handlers';
import { makeReceiptAnchor } from '@/lib/contributions/receipt-runtime';
import { contributionLimiter } from '@/lib/contributions/rate-limit';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  'anchor-pending': 409, 'chain-conflict': 409, 'retry-with-fresh-transaction': 409,
  'budget-exhausted': 409, 'budget-unavailable': 503, 'anchor-unavailable': 503,
  'config-error': 503, 'anchor-mismatch': 502, 'inner-failed': 422, 'evidence-unavailable': 422,
  'organizer-required': 403, 'survey-closed': 410,
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
  const hit = contributionLimiter.take(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    parsed.ok ? requestedActor(parsed.body) : null);
  if (!hit.ok) return Response.json({ ok: false, reason: 'rate_limited' }, {
    status: 429, headers: { 'Retry-After': String(hit.retryAfter) },
  });
  if (!parsed.ok) return Response.json(parsed, { status: parsed.reason === 'too_large' ? 413 : 400 });

  const result = await makeReceiptAnchor()(parsed.body);
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.reason] ?? 400 });
}
