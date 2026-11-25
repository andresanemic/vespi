import { createHash } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk/base';
import { readContributionBody } from '@/lib/contributions/handlers';
import { accountNotAllowed, mainnetNotSupported, mainnetReceiptSupported, readContributionNetwork } from '@/lib/contributions/network-request';
import { canonicalBytes } from '@/lib/contributions/kernel/contributions.js';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await readContributionBody(request);
  if (!parsed.ok) return Response.json(parsed, { status: parsed.reason === 'too_large' ? 413 : 400 });

  const selected = readContributionNetwork(request, parsed.body);
  if (!selected.ok) return selected.response;
  const { actor } = parsed.body;
  const receipt = { ...parsed.body };
  delete receipt.network;
  if (selected.network === 'mainnet' && !mainnetReceiptSupported(receipt)) return mainnetNotSupported();
  if (typeof actor !== 'string' || !StrKey.isValidEd25519PublicKey(actor)) {
    return Response.json({ ok: false, reason: 'invalid-public-key' }, { status: 400 });
  }

  if (selected.allowlist && !selected.allowlist.has(actor)) return accountNotAllowed();

  try {
    const bytes = canonicalBytes(receipt);
    const digest = createHash('sha256').update(bytes, 'utf8').digest('hex');
    return Response.json({ ok: true, bytes, digest });
  } catch {
    return Response.json({ ok: false, reason: 'invalid-receipt' }, { status: 400 });
  }
}
