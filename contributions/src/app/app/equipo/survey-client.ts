import { Buffer } from 'buffer';
import type { Signer } from '@/lib/contributions/keys';
import { teamSurveyRequestMessage, type SurveyCohort, type TeamSurveyAction } from '@/lib/contributions/team-survey-authorization';

export class TeamAccessDenied extends Error {}

export async function querySurvey(signer: Signer, action: TeamSurveyAction, cohort: SurveyCohort, signal: AbortSignal) {
  const account = signer.publicKey;
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 45;
  const signature = Buffer.from(await signer.sign(teamSurveyRequestMessage(account, action, cohort, expiresAt, nonce))).toString('hex');
  if (signal.aborted) throw new DOMException('Operation aborted', 'AbortError');
  const response = await fetch('/api/contributions/team/survey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, action, cohort, expiresAt, nonce, signature }),
    cache: 'no-store',
    signal,
  });
  if (response.status === 403) throw new TeamAccessDenied();
  if (!response.ok) throw new Error('team-survey-unavailable');
  return response;
}

export async function downloadSurvey(response: Response, cohort: SurveyCohort, signal: AbortSignal) {
  if (!response.headers.get('Content-Type')?.startsWith('text/csv')) throw new Error('unexpected-survey-response');
  const blob = await response.blob();
  if (signal.aborted) throw new DOMException('Operation aborted', 'AbortError');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'survey-' + cohort + '.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
