import { StrKey } from '@stellar/stellar-sdk/base';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';

import { accountNotAllowed, readContributionNetwork } from '@/lib/contributions/network-request';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ account: string }> }) {
  const selected = readContributionNetwork(request);
  if (!selected.ok) return selected.response;
  const { account } = await context.params;
  const cursor = new URL(request.url).searchParams.get('cursor') ?? '0';
  if (!StrKey.isValidEd25519PublicKey(account) || !/^\d{1,20}$/.test(cursor)) return new Response(null, { status: 400 });
  if (selected.allowlist && !selected.allowlist.has(account)) return accountNotAllowed();
  try {
    const page = await createReceiptRegistry(selected.env, fetch, selected.network).activity(account, cursor);
    return Response.json(page, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new Response(null, { status: 503 });
  }
}
