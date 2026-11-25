import { StrKey } from '@stellar/stellar-sdk/base';
import { createPhotoStore, createPhotoUpload } from '@/lib/contributions/contribution-photos';
import { readContributionBody } from '@/lib/contributions/handlers';
import { contributionLimiter } from '@/lib/contributions/rate-limit';
import { mainnetNotSupported, readContributionNetwork } from '@/lib/contributions/network-request';
import { enabledAccountExists } from '@/lib/contributions/fee-bump-runtime';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await readContributionBody(request, 3 * 1024 * 1024);
  if (!parsed.ok) return Response.json(parsed, { status: parsed.reason === 'too_large' ? 413 : 400 });
  const selected = readContributionNetwork(request, parsed.body);
  if (!selected.ok) return selected.response;
  if (selected.network === 'mainnet') return mainnetNotSupported();
  const { env, network } = selected;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const actor = parsed.body.actor;
  const hit = contributionLimiter.take(ip, typeof actor === 'string' && StrKey.isValidEd25519PublicKey(actor) ? actor : null);
  if (!hit.ok) return Response.json({ ok: false, reason: 'rate_limited' }, {
    status: 429, headers: { 'Retry-After': String(hit.retryAfter) },
  });
  const result = await createPhotoUpload({
    save: createPhotoStore({}, network).save,
    accountExists: key => enabledAccountExists(key, network, env),
    reserve: createReceiptRegistry(env, fetch, network).reservePhoto,
  }, undefined, network)(parsed.body);
  const status = result.ok ? 200 : ['photo-account-required', 'photo-signature-required'].includes(result.reason) ? 403
    : result.reason === 'photo-unavailable' ? 503 : result.reason === 'photo-quota' ? 429 : 400;
  return Response.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
}
