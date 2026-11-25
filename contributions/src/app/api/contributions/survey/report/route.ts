import { readContributionBody } from '@/lib/contributions/handlers';
import { makeReceiptAnchor } from '@/lib/contributions/receipt-runtime';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';
import { createPrivateSurveyStore } from '@/lib/contributions/survey-intake';
import { createSurveyReport } from '@/lib/contributions/survey-report';

import { mainnetNotSupported, readContributionNetwork } from '@/lib/contributions/network-request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await readContributionBody(request, 256 * 1024);
  if (!parsed.ok) return Response.json(parsed, { status: parsed.reason === 'too_large' ? 413 : 400 });
  const selected = readContributionNetwork(request, parsed.body);
  if (!selected.ok) return selected.response;
  if (selected.network === 'mainnet') return mainnetNotSupported();
  const { env, network } = selected;
  const store = createPrivateSurveyStore(env, fetch, network);
  const report = createSurveyReport({
    organizer: env.CONTRIB_ORGANIZER_ACCOUNT, cutoff: env.CONTRIB_EVENT_CUTOFF,
    closesAt: env.CONTRIB_SURVEY_CLOSES_AT, settle: makeReceiptAnchor(network, env).settle,
    now: () => new Date(), list: store.list, head: createReceiptRegistry(env, fetch, network).head, save: store.saveReport,
  }, network);
  const result = await report(parsed.body);
  const status = result.ok ? 200 : result.reason === 'organizer-required' ? 403
    : result.reason === 'report-unavailable' ? 503 : result.reason === 'survey-anchors-pending' ? 409 : 400;
  return Response.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
}
