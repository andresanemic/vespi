import { Buffer } from 'buffer';
import { digestBytes, FlowError, post, type Attempt, type makeSurveyReceipt } from '../client';

export type Answer = {
  usefulness: number;
  building: boolean;
  project: string;
  ambassadorInterest: boolean;
  nextTopic: string;
  email: string | null;
};

const saltPattern = /^[a-f0-9]{32}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[0-9a-f-]{36}$/;

export async function submitSurvey(id: string, actor: string | null, cohort: Cohort, answer: Answer) {
  const { result } = await post<{ answer: Answer; salt: string; commitment: string }>('/survey', { id, actor, cohort, answer });
  if (!result.ok) throw new FlowError(result.reason);
  const keys = Object.keys(answer).sort() as (keyof Answer)[];
  if (!result.answer || Object.keys(result.answer).length !== keys.length ||
    keys.some(key => result.answer[key] !== answer[key]) || !saltPattern.test(result.salt)) {
    throw new FlowError('survey-mismatch');
  }
  // The six answer values are scalar. The kernel uses alphabetical keys, UTF-8 and the raw salt.
  const canonical = JSON.stringify(answer, keys);
  const bytes = new TextEncoder().encode(canonical);
  const salted = new Uint8Array(16 + bytes.length);
  salted.set(Buffer.from(result.salt, 'hex'));
  salted.set(bytes, 16);
  const commitment = await digestBytes(salted.buffer);
  if (commitment !== result.commitment) throw new FlowError('survey-mismatch');
  return { salt: result.salt, commitment, canonical };
}

export type SurveyState = {
  id: string;
  saved?: true;
  commitment?: string;
  salt?: string;
  draft?: ReturnType<typeof makeSurveyReceipt>;
  attempt?: Attempt;
  receipt?: string;
};

export type Cohort = 'rehearsal' | 'event';
const storageKey = (cohort: Cohort, actor?: string) => 'vespi:survey:2026-11-19:' + cohort + ':' + (actor ?? 'anonymous');

export function readSurveyState(cohort: Cohort, actor?: string): SurveyState | null {
  try {
    const key = storageKey(cohort, actor);
    const storage = actor ? localStorage : sessionStorage;
    const saved: SurveyState | null = JSON.parse(storage.getItem(key) ?? 'null');
    if (!saved || !idPattern.test(saved.id)) return null;
    if (saved.draft && (saved.draft.kind !== 'SURVEY' || saved.draft.actor !== actor ||
      !digestPattern.test(saved.commitment ?? '') || saved.draft.evidence?.commitment !== saved.commitment)) return null;
    const salt = actor && sessionStorage.getItem(key + ':salt:' + saved.id);
    return { ...saved, salt: salt && saltPattern.test(salt) ? salt : undefined };
  } catch { return null; }
}

export function saveSurveyState(cohort: Cohort, actor: string | undefined, state: SurveyState) {
  const key = storageKey(cohort, actor);
  const { salt, ...shareable } = state;
  try {
    (actor ? localStorage : sessionStorage).setItem(key, JSON.stringify(shareable));
  } catch {}
  if (actor && salt) {
    try { sessionStorage.setItem(key + ':salt:' + state.id, salt); } catch {}
  }
}
