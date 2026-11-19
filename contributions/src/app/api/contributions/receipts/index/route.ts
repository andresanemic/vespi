import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cursor = new URL(request.url).searchParams.get('cursor') ?? '0';
  if (!/^\d{1,20}$/.test(cursor)) return Response.json({ ok: false, reason: 'invalid-cursor' }, { status: 400 });
  try {
    return Response.json(await createReceiptRegistry(process.env).list(cursor));
  } catch {
    return Response.json({ ok: false, reason: 'receipt-unavailable' }, { status: 503 });
  }
}
