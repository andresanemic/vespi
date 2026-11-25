import { readContributionBody } from '@/lib/contributions/handlers';
import { contributionLimiter } from '@/lib/contributions/rate-limit';
import { createPrivateSurveyStore, createSurveyIntake } from '@/lib/contributions/survey-intake';

import { mainnetNotSupported, readContributionNetwork } from '@/lib/contributions/network-request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await readContributionBody(request);
  const selected = readContributionNetwork(request, parsed.ok ? parsed.body : undefined);
  if (!selected.ok) return selected.response;
  if (selected.network === 'mainnet') return mainnetNotSupported();
  const { env, network } = selected;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const hit = contributionLimiter.take(ip, null);
  if (!hit.ok) return Response.json({ ok: false, reason: 'rate_limited' }, {
    status: 429, headers: { 'Retry-After': String(hit.retryAfter) },
  });
  if (!parsed.ok) return Response.json(parsed, { status: parsed.reason === 'too_large' ? 413 : 400 });

  const intake = createSurveyIntake(createPrivateSurveyStore(env, fetch, network), undefined,
    env.CONTRIB_EVENT_CUTOFF, env.CONTRIB_SURVEY_CLOSES_AT);
  const result = await intake(parsed.body);
  const status = result.ok ? 200 : ['survey-id-in-use', 'survey-cohort-changed'].includes(result.reason) ? 409
    : result.reason === 'survey-unavailable' ? 503 : result.reason === 'survey-closed' ? 410 : 400;
  return Response.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
}
