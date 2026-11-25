import { readContributionBody } from '@/lib/contributions/handlers';
import { createRateLimiter } from '@/lib/contributions/rate-limit';
import { createPrivateSurveyStore } from '@/lib/contributions/survey-intake';
import { createTeamSurveyQuery, surveyCsv } from '@/lib/contributions/team-survey';

import { mainnetNotSupported, readContributionNetwork } from '@/lib/contributions/network-request';

export const dynamic = 'force-dynamic';
// shortcut: rate limits live per function instance, switch to shared Redis if team traffic spans concurrent instances.
const teamSurveyLimiter = createRateLimiter({ perIp: 20, perKey: 20 });
const noStore = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const parsed = await readContributionBody(request, 4096);
  const selected = readContributionNetwork(request, parsed.ok ? parsed.body : undefined);
  if (!selected.ok) return selected.response;
  if (selected.network === 'mainnet') return mainnetNotSupported();
  const { env, network } = selected;
  const hit = teamSurveyLimiter.take(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown', null);
  if (!hit.ok) return Response.json({ ok: false, reason: 'rate_limited' }, { status: 429,
    headers: { ...noStore, 'Retry-After': String(hit.retryAfter) } });
  if (!parsed.ok) return Response.json(parsed, { status: parsed.reason === 'too_large' ? 413 : 400, headers: noStore });
  try {
    const store = createPrivateSurveyStore(env, fetch, network);
    const query = createTeamSurveyQuery({
      teamAccounts: (env.CONTRIB_TEAM_ACCOUNTS ?? '').split(',').map(account => account.trim()),
      consumeNonce: store.consumeTeamAuthorization,
      list: store.list,
    }, undefined, network);
    const result = await query(parsed.body);
    if (!result.ok) return Response.json(result, { status: result.reason === 'team-auth-replayed' ? 409 : 403, headers: noStore });
    if (result.action === 'csv') return new Response(surveyCsv(result.records), {
      headers: { ...noStore, 'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="survey-${result.cohort}.csv"` },
    });
    return Response.json({ cohort: result.cohort, records: result.records }, { headers: noStore });
  } catch {
    return Response.json({ ok: false, reason: 'team-survey-unavailable' }, { status: 503, headers: noStore });
  }
}
