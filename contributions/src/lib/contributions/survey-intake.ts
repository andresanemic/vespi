import { randomBytes } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk/base';
import { surveyCommitment } from './kernel/contributions.js';
import { contributionsRedisCredentials } from './redis-credentials.mjs';

const FIELDS = ['usefulness', 'building', 'project', 'ambassadorInterest', 'nextTopic', 'email'];

export function readSurveyAnswer(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).length !== FIELDS.length || !FIELDS.every(key => Object.hasOwn(input, key))) return null;
  const { usefulness, building, project, ambassadorInterest, nextTopic, email } = input as Record<string, unknown>;
  if (typeof usefulness !== 'number' || !Number.isInteger(usefulness) || usefulness < 1 || usefulness > 5 ||
    typeof building !== 'boolean' || typeof ambassadorInterest !== 'boolean' ||
    typeof project !== 'string' || project.length > 500 || typeof nextTopic !== 'string' || nextTopic.length > 500 ||
    (email !== null && (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
    return null;
  }
  return { usefulness, building, project, ambassadorInterest, nextTopic, email };
}

export type SurveyRecord = { actor: string | null; answer: NonNullable<ReturnType<typeof readSurveyAnswer>>;
  salt: string; commitment: string; createdAt: string; rehearsal: boolean };
type IntakeStore = {
  save(id: string, record: SurveyRecord): Promise<SurveyRecord>;
  get(id: string): Promise<SurveyRecord | null>;
};

export function isSurveyId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}

export function surveySigningDeadline(closesAt?: string) {
  return closesAt === 'manual' ? Infinity : Date.parse(closesAt ?? '') + 300_000;
}

export function createSurveyIntake(store: IntakeStore, now = () => new Date(), cutoff?: string, closesAt?: string) {
  return async (body: Record<string, unknown>) => {
    const { id, actor, cohort } = body;
    const answer = readSurveyAnswer(body.answer);
    if (!isSurveyId(id) || (cohort !== undefined && cohort !== 'rehearsal' && cohort !== 'event') ||
      (actor !== null && (typeof actor !== 'string' || !StrKey.isValidEd25519PublicKey(actor))) || !answer) {
      return { ok: false, reason: 'invalid-survey' } as const;
    }

    const created = now();
    const eventStart = Date.parse(cutoff ?? '');
    const rehearsal = !Number.isFinite(eventStart) || created.getTime() < eventStart;
    const close = closesAt === 'manual' ? Infinity : Date.parse(closesAt ?? '');
    if (!rehearsal && (Number.isNaN(close) || close <= eventStart)) {
      return { ok: false, reason: 'survey-unavailable' } as const;
    }
    const closed = !rehearsal && created.getTime() >= close;
    const cohortChanged = cohort !== undefined && (cohort === 'rehearsal') !== rehearsal;
    try {
      let stored;
      if (closed || cohortChanged) {
        stored = await store.get(id);
        if (!stored) return { ok: false, reason: cohortChanged ? 'survey-cohort-changed' : 'survey-closed' } as const;
      } else {
        const salt = randomBytes(16).toString('hex');
        stored = await store.save(id, {
          actor, answer, salt, commitment: surveyCommitment(salt, answer), createdAt: created.toISOString(),
          rehearsal,
        });
      }
      if (cohort !== undefined && (cohort === 'rehearsal') !== stored.rehearsal) {
        return { ok: false, reason: 'survey-cohort-changed' } as const;
      }
      if (stored.actor !== actor || JSON.stringify(stored.answer) !== JSON.stringify(answer)) {
        return { ok: false, reason: 'survey-id-in-use' } as const;
      }
      if (!/^[a-f0-9]{32}$/.test(stored.salt) || surveyCommitment(stored.salt, answer) !== stored.commitment) {
        return { ok: false, reason: 'survey-unavailable' } as const;
      }
      return { ok: true, answer, salt: stored.salt, commitment: stored.commitment } as const;
    } catch {
      return { ok: false, reason: 'survey-unavailable' } as const;
    }
  };
}

export function createPrivateSurveyStore(env: Record<string, string | undefined>, request = fetch) {
  const key = 'contributions:testnet:private-survey:v1';

  async function run(command: unknown[]) {
    const { url: raw, token } = contributionsRedisCredentials(env);
    if (!raw || !token || new URL(raw).protocol !== 'https:') throw new Error('Survey store unavailable');
    const response = await request(raw.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Survey store rejected the command');
    const { result, error } = await response.json() as { result?: unknown; error?: unknown };
    if (error || result === undefined) throw new Error('Invalid survey store response');
    return result;
  }

  async function get(id: string): Promise<SurveyRecord | null> {
    const existing = await run(['HGET', key, id]);
    if (existing === null) return null;
    if (typeof existing !== 'string') throw new Error('Invalid existing survey');
    return JSON.parse(existing) as SurveyRecord;
  }

  return {
    get,
    async consumeTeamAuthorization(account: string, nonce: string) {
      const result = await run(['SET', `contributions:testnet:team-auth:v1:${nonce}`, account, 'NX', 'EX', 120]);
      if (result === 'OK') return true;
      if (result === null) return false;
      throw new Error('Invalid team authorization response');
    },
    async list(): Promise<SurveyRecord[]> {
      const records = new Map<string, SurveyRecord>();
      let cursor = '0';
      do {
        const page = await run(['HSCAN', key, cursor, 'COUNT', 100]);
        if (!Array.isArray(page) || !/^\d+$/.test(String(page[0])) ||
          !Array.isArray(page[1]) || page[1].length % 2 !== 0) throw new Error('Invalid survey page');
        cursor = String(page[0]);
        for (let i = 0; i < page[1].length; i += 2) {
          records.set(page[1][i], JSON.parse(page[1][i + 1]) as SurveyRecord);
        }
      } while (cursor !== '0');
      return [...records.values()];
    },
    async saveReport(digest: string, value: { bytes: string; rehearsal: boolean }) {
      const written = await run(['HSETNX', 'contributions:testnet:survey-reports:v1', digest, JSON.stringify(value)]);
      if (written !== 0 && written !== 1) throw new Error('Invalid report registration response');
    },
    async getReport(digest: string): Promise<{ bytes: string; rehearsal: boolean } | null> {
      const value = await run(['HGET', 'contributions:testnet:survey-reports:v1', digest]);
      if (value === null) return null;
      if (typeof value !== 'string') throw new Error('Invalid stored report');
      return JSON.parse(value) as { bytes: string; rehearsal: boolean };
    },
    async save(id: string, record: SurveyRecord) {
      const written = await run(['HSETNX', key, id, JSON.stringify(record)]);
      if (written === 1) return record;
      if (written !== 0) throw new Error('Invalid survey registration response');
      const existing = await get(id);
      if (!existing) throw new Error('Missing existing survey');
      return existing;
    },
  };
}
