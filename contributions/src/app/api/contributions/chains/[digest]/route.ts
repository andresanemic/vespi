import { parseContribution } from '@/lib/contributions/kernel/contributions.js';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ digest: string }> }) {
  const { digest } = await context.params;
  const unavailable = () => Response.json({ ok: false, reason: 'receipt-unavailable' }, { status: 503 });
  const missing = () => Response.json({ ok: false }, { status: 404 });
  if (!/^[0-9a-f]{64}$/.test(digest)) return missing();
  try {
    const registry = createReceiptRegistry(process.env);
    const root = await registry.get(digest);
    if (!root?.index || parseContribution(root.intent.bytes).kind !== 'REQUEST') return missing();

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
