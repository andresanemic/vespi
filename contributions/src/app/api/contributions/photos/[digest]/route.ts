import { createPhotoStore } from '@/lib/contributions/contribution-photos';
import { parseContribution } from '@/lib/contributions/kernel/contributions.js';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ digest: string }> }) {
  const { digest } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(digest)) return new Response(null, { status: 404 });
  try {
    const publication = await createReceiptRegistry(process.env).photoReceipt(digest);
    if (!publication) return new Response(null, { status: 404 });
    const actor = parseContribution(publication.intent.bytes).actor;
    const photo = await createPhotoStore().read(actor, digest);
    if (!photo) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(photo.bytes), {
      headers: { 'Content-Type': photo.contentType, 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=300, s-maxage=3600, immutable' },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
