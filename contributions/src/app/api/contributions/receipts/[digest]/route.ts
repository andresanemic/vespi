import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ digest: string }> }) {
  const { digest } = await context.params;
  if (!/^[0-9a-f]{64}$/.test(digest)) return Response.json({ ok: false }, { status: 404 });
  try {
    const record = await createReceiptRegistry(process.env).get(digest);
    if (!record?.index) return Response.json({ ok: false }, { status: 404 });
    if (new URL(request.url).searchParams.get('format') === 'index') return Response.json(record.index);
    return new Response(record.intent.bytes, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch {
    return Response.json({ ok: false, reason: 'receipt-unavailable' }, { status: 503 });
  }
}
