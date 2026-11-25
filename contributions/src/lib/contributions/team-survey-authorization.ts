import { contributionNetwork, DEFAULT_NETWORK } from './network';

export type TeamSurveyAction = 'json' | 'csv';
export type SurveyCohort = 'rehearsal' | 'event';

export function teamSurveyRequestMessage(account: string, action: TeamSurveyAction, cohort: SurveyCohort,
  expiresAt: number, nonce: string, network = DEFAULT_NETWORK) {
  return new TextEncoder().encode(JSON.stringify([
    `vespi:contributions-team-survey:v1:${contributionNetwork(network).id}`, account, action, cohort, expiresAt, nonce,
  ]));
}
