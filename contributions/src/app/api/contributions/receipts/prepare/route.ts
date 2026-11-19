import { createHash } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk/base';
import { readContributionBody } from '@/lib/contributions/handlers';
import { canonicalBytes } from '@/lib/contributions/kernel/contributions.js';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await readContributionBody(request);
  if (!parsed.ok) return Response.json(parsed, { status: parsed.reason === 'too_large' ? 413 : 400 });

  const { actor } = parsed.body;
  if (typeof actor !== 'string' || !StrKey.isValidEd25519PublicKey(actor)) {
    return Response.json({ ok: false, reason: 'invalid-public-key' }, { status: 400 });
  }

  try {
    const bytes = canonicalBytes(parsed.body);
    const digest = createHash('sha256').update(bytes, 'utf8').digest('hex');
    return Response.json({ ok: true, bytes, digest });
  } catch {
    return Response.json({ ok: false, reason: 'invalid-receipt' }, { status: 400 });
  }
}
