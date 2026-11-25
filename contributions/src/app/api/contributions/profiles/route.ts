import { StrKey } from '@stellar/stellar-sdk/base';
import { readContributionBody } from '@/lib/contributions/handlers';
import { createRateLimiter } from '@/lib/contributions/rate-limit';
import { createProfileRegistry } from '@/lib/contributions/profile-registry';
import { createProfile } from '@/lib/contributions/profile';
import { accountNotAllowed, readContributionNetwork } from '@/lib/contributions/network-request';
import { enabledAccountExists } from '@/lib/contributions/fee-bump-runtime';

export const dynamic = 'force-dynamic';
const profileLimiter = createRateLimiter();
const mainnetProfileLimiter = createRateLimiter();

export async function GET(request: Request) {
  const selected = readContributionNetwork(request);
  if (!selected.ok) return selected.response;
  const cursor = new URL(request.url).searchParams.get('cursor') ?? '0';
  if (!/^\d{1,20}$/.test(cursor)) return Response.json({ ok: false, reason: 'invalid-cursor' }, { status: 400 });
  try { return Response.json(await createProfileRegistry(selected.env, fetch, selected.network).list(cursor), { headers: { 'Cache-Control': selected.allowlist ? 'no-store' : 'public, max-age=30' } }); }
  catch { return Response.json({ ok: false, reason: 'profile-unavailable' }, { status: 503 }); }
}

export async function POST(request: Request) {
  const parsed = await readContributionBody(request, 4096);
  const selected = readContributionNetwork(request, parsed.ok ? parsed.body : undefined);
  if (!selected.ok) return selected.response;
  const { network, env, allowlist } = selected;
  const account = parsed.ok && typeof parsed.body.account === 'string' && StrKey.isValidEd25519PublicKey(parsed.body.account) ? parsed.body.account : null;
  const limiter = network === 'mainnet' ? mainnetProfileLimiter : profileLimiter;
  const hit = limiter.take(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown', account);
  if (!hit.ok) return Response.json({ ok: false, reason: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(hit.retryAfter) } });
  if (!parsed.ok) return Response.json(parsed, { status: parsed.reason === 'too_large' ? 413 : 400 });
  if (account && allowlist && !allowlist.has(account)) return accountNotAllowed();
  const registry = createProfileRegistry(env, fetch, network);
  const result = await createProfile({
    exists: key => enabledAccountExists(key, network, env),
    create: registry.create,
  }, undefined, network)(parsed.body);
  const status = result.ok ? 200 : result.reason === 'profile-exists' ? 409 : result.reason === 'profile-account-required' || result.reason === 'profile-signature-required' ? 403 : result.reason === 'profile-unavailable' ? 503 : 400;
  return Response.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
}
