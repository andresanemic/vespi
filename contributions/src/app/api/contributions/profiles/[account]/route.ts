import { StrKey } from '@stellar/stellar-sdk/base';
import { createProfileRegistry } from '@/lib/contributions/profile-registry';

import { accountNotAllowed, readContributionNetwork } from '@/lib/contributions/network-request';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ account: string }> }) {
  const selected = readContributionNetwork(request);
  if (!selected.ok) return selected.response;
  const { account } = await params;
  if (!StrKey.isValidEd25519PublicKey(account)) return Response.json({ ok: false, reason: 'invalid-account' }, { status: 400 });
  if (selected.allowlist && !selected.allowlist.has(account)) return accountNotAllowed();
  try {
    const profile = await createProfileRegistry(selected.env, fetch, selected.network).get(account);
    return profile ? Response.json(profile, { headers: { 'Cache-Control': selected.allowlist ? 'no-store' : 'public, max-age=30' } }) : Response.json({ ok: false, reason: 'not-found' }, { status: 404 });
  } catch { return Response.json({ ok: false, reason: 'profile-unavailable' }, { status: 503 }); }
}
