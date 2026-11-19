import { readContributionBody } from '@/lib/contributions/handlers';
import { makeReceiptAnchor } from '@/lib/contributions/receipt-runtime';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';
import { createPrivateSurveyStore } from '@/lib/contributions/survey-intake';
import { createSurveyReport } from '@/lib/contributions/survey-report';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await readContributionBody(request, 256 * 1024);
  if (!parsed.ok) return Response.json(parsed, { status: parsed.reason === 'too_large' ? 413 : 400 });
  const store = createPrivateSurveyStore(process.env);
  const report = createSurveyReport({
    organizer: process.env.CONTRIB_ORGANIZER_ACCOUNT, cutoff: process.env.CONTRIB_EVENT_CUTOFF,
    closesAt: process.env.CONTRIB_SURVEY_CLOSES_AT, settle: makeReceiptAnchor().settle,
    now: () => new Date(), list: store.list, head: createReceiptRegistry(process.env).head, save: store.saveReport,
  });
  const result = await report(parsed.body);
  const status = result.ok ? 200 : result.reason === 'organizer-required' ? 403
    : result.reason === 'report-unavailable' ? 503 : result.reason === 'survey-anchors-pending' ? 409 : 400;
  return Response.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
}
