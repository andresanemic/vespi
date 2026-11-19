import { StrKey } from '@stellar/stellar-sdk/base';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ account: string }> }) {
  const { account } = await context.params;
  const cursor = new URL(request.url).searchParams.get('cursor') ?? '0';
  if (!StrKey.isValidEd25519PublicKey(account) || !/^\d{1,20}$/.test(cursor)) return new Response(null, { status: 400 });
  try {
    const page = await createReceiptRegistry(process.env).activity(account, cursor);
    return Response.json(page, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new Response(null, { status: 503 });
  }
}
