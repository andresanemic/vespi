import { StrKey } from '@stellar/stellar-sdk/base';
import { createPhotoStore, createPhotoUpload } from '@/lib/contributions/contribution-photos';
import { readContributionBody } from '@/lib/contributions/handlers';
import { contributionLimiter } from '@/lib/contributions/rate-limit';
import { testnetAccountExists } from '@/lib/contributions/fee-bump-runtime';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await readContributionBody(request, 3 * 1024 * 1024);
  if (!parsed.ok) return Response.json(parsed, { status: parsed.reason === 'too_large' ? 413 : 400 });
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const actor = parsed.body.actor;
  const hit = contributionLimiter.take(ip, typeof actor === 'string' && StrKey.isValidEd25519PublicKey(actor) ? actor : null);
  if (!hit.ok) return Response.json({ ok: false, reason: 'rate_limited' }, {
    status: 429, headers: { 'Retry-After': String(hit.retryAfter) },
  });
  const result = await createPhotoUpload({
    save: createPhotoStore().save, accountExists: testnetAccountExists,
    reserve: createReceiptRegistry(process.env).reservePhoto,
  })(parsed.body);
  const status = result.ok ? 200 : ['photo-account-required', 'photo-signature-required'].includes(result.reason) ? 403
    : result.reason === 'photo-unavailable' ? 503 : result.reason === 'photo-quota' ? 429 : 400;
  return Response.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
}
