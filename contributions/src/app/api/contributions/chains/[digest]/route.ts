import { parseContribution } from '@/lib/contributions/kernel/contributions.js';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';
import { isEncounterFingerprint } from '@/lib/contributions/encounters';

import { readContributionNetwork } from '@/lib/contributions/network-request';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ digest: string }> }) {
  const selected = readContributionNetwork(request);
  if (!selected.ok) return selected.response;
  const { digest } = await context.params;
  const unavailable = () => Response.json({ ok: false, reason: 'receipt-unavailable' }, { status: 503 });
  const missing = () => Response.json({ ok: false }, { status: 404 });
  if (!/^[0-9a-f]{64}$/.test(digest)) return missing();
  try {
    const registry = createReceiptRegistry(selected.env, fetch, selected.network);
    const root = await registry.get(digest);
    if (!root?.index) return missing();
    const original = parseContribution(root.intent.bytes);
    if (original.kind !== 'REQUEST' || (selected.network === 'mainnet' && isEncounterFingerprint(original))) return missing();

    const head = await registry.head(digest);
    if (!head?.index || head.intent.chain !== digest) return unavailable();
    const receipt = parseContribution(head.intent.bytes);
    const { kind } = receipt;
    if (kind === 'REQUEST' ? head.index.digest !== digest :
      !['CONTRIBUTE', 'ACCEPT'].includes(kind) || receipt.chain !== digest) return unavailable();

    return Response.json({ request: digest, head: head.index.digest, kind }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return unavailable();
  }
}
