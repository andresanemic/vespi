import { StrKey } from '@stellar/stellar-sdk/base';
import { createProfileRegistry } from '@/lib/contributions/profile-registry';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  if (!StrKey.isValidEd25519PublicKey(account)) return Response.json({ ok: false, reason: 'invalid-account' }, { status: 400 });
  try {
    const profile = await createProfileRegistry(process.env).get(account);
    return profile ? Response.json(profile, { headers: { 'Cache-Control': 'public, max-age=30' } }) : Response.json({ ok: false, reason: 'not-found' }, { status: 404 });
  } catch { return Response.json({ ok: false, reason: 'profile-unavailable' }, { status: 503 }); }
}
