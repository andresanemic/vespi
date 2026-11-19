export type TeamSurveyAction = 'json' | 'csv';
export type SurveyCohort = 'rehearsal' | 'event';

export function teamSurveyRequestMessage(account: string, action: TeamSurveyAction, cohort: SurveyCohort,
  expiresAt: number, nonce: string) {
  return new TextEncoder().encode(JSON.stringify([
    'vespi:contributions-team-survey:v1:stellar:testnet', account, action, cohort, expiresAt, nonce,
  ]));
}
