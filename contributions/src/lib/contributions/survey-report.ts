import { createHash } from 'node:crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk/base';
import { canonicalBytes, parseContribution, surveyCommitment } from './kernel/contributions.js';
import type { RegisteredReceipt } from './receipt-registry';
import { readSurveyAnswer, surveySigningDeadline, type SurveyRecord } from './survey-intake';

export const SURVEY_EVENT = '2026-11-19';
export const REPORT_STATEMENT = 'Resultados de la encuesta';
type Answer = SurveyRecord['answer'];
type Fallback = { answer: Answer; salt: string };
type ReportSnapshot = { bytes: string; rehearsal: boolean };

export function surveySlot(actor: string, rehearsal: boolean) {
  return `survey:${SURVEY_EVENT}:${rehearsal ? 'rehearsal' : 'event'}:${actor}`;
}

export function reportRequestMessage(createdAt: string, rehearsal: boolean, fallback: unknown) {
  return new TextEncoder().encode(JSON.stringify(
    ['vespi:survey-report:v1:stellar:testnet', SURVEY_EVENT, createdAt, rehearsal, fallback],
  ));
}

function readFallback(value: unknown): Fallback | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { answer, salt } = value as Record<string, unknown>;
  const parsed = readSurveyAnswer(answer);
  return parsed && typeof salt === 'string' && /^[a-f0-9]{32}$/.test(salt) ? { answer: parsed, salt } : null;
}

type ReportPorts = {
  organizer?: string;
  cutoff?: string;
  closesAt?: string;
  now(): Date;
  list(): Promise<SurveyRecord[]>;
  head(slot: string): Promise<RegisteredReceipt | null>;
  settle(slot: string): Promise<boolean>;
  save(digest: string, snapshot: ReportSnapshot): Promise<void>;
};

export function createSurveyReport(ports: ReportPorts) {
  return async (body: Record<string, unknown>) => {
    const { rehearsal, createdAt, signature } = body;
    const fallback = body.fallback;
    const organizer = ports.organizer;
    const cutoff = Date.parse(ports.cutoff ?? '');
    const deadline = surveySigningDeadline(ports.closesAt);
    if (!organizer || !StrKey.isValidEd25519PublicKey(organizer)) {
      return { ok: false, reason: 'report-unavailable' } as const;
    }
    if (typeof rehearsal !== 'boolean' || typeof createdAt !== 'string' || typeof signature !== 'string' ||
      !/^[a-f0-9]{128}$/.test(signature) || !Array.isArray(fallback)) {
      return { ok: false, reason: 'invalid-report-request' } as const;
    }
    const time = Date.parse(createdAt);
    const now = ports.now().getTime();
    if (!Number.isFinite(time) || new Date(time).toISOString() !== createdAt || Math.abs(now - time) > 300_000 ||
      (!rehearsal && (!Number.isFinite(cutoff) || !Number.isFinite(deadline) ||
        deadline <= cutoff + 300_000 || time < deadline || now < deadline))) {
      return { ok: false, reason: 'invalid-report-time' } as const;
    }
    if (!Keypair.fromPublicKey(organizer).verify(Buffer.from(reportRequestMessage(createdAt, rehearsal, fallback)),
      Buffer.from(signature, 'hex'))) {
      return { ok: false, reason: 'organizer-required' } as const;
    }
    const external = fallback.map(readFallback);
    if (external.some(row => !row)) return { ok: false, reason: 'invalid-fallback' } as const;

    try {
      const cohort = (await ports.list()).filter(row => row.rehearsal === rehearsal);
      const byCommitment = new Map(cohort.map(row => [row.commitment, row]));
      const actors = [...new Set(cohort.flatMap(row => row.actor ? [row.actor] : []))];
      const slots = actors.map(actor => surveySlot(actor, rehearsal));
      if (!rehearsal && (await Promise.all(slots.map(slot => ports.settle(slot)))).includes(false)) {
        return { ok: false, reason: 'survey-anchors-pending' } as const;
      }
      const heads = await Promise.all(slots.map(slot => ports.head(slot)));
      const answers: Answer[] = [];
      const surveys: string[] = [];
      const commitments: string[] = [];
      for (const [index, head] of heads.entries()) {
        if (!head?.index) continue;
        const receipt = parseContribution(head.intent.bytes);
        const row = byCommitment.get(receipt.evidence?.commitment);
        if (receipt.kind !== 'SURVEY' || receipt.actor !== actors[index] || row?.actor !== receipt.actor ||
          head.index.rehearsal !== rehearsal || !row) throw new Error('Unmatched confirmed survey');
        surveys.push(head.index.digest);
        commitments.push(row.commitment);
        answers.push(row.answer);
      }
      const withoutAccount = cohort.filter(row => row.actor === null);
      for (const row of withoutAccount) {
        commitments.push(row.commitment);
        answers.push(row.answer);
      }
      for (const row of external) {
        if (!row) continue;
        commitments.push(surveyCommitment(row.salt, row.answer));
        answers.push(row.answer);
      }
      if (new Set(commitments).size !== commitments.length) {
        return { ok: false, reason: 'duplicate-survey' } as const;
      }

      const bytes = canonicalBytes({
        kind: 'REPORT', role: 'organizer', actor: organizer, statement: REPORT_STATEMENT, comment: null,
        chain: null, prev: null, subject: null, createdAt,
        evidence: {
          surveys: surveys.sort(), commitments: commitments.sort(),
          counts: { withAccount: surveys.length, withoutAccount: withoutAccount.length, fallbackForm: external.length },
          aggregate: answers.length < 3 ? { rehearsal, metricsWithheld: true } : {
            rehearsal,
            averageUsefulness: answers.reduce((sum, answer) => sum + answer.usefulness, 0) / answers.length,
            building: answers.filter(answer => answer.building).length,
            ambassadorInterest: answers.filter(answer => answer.ambassadorInterest).length,
          },
        },
      });
      if (Buffer.byteLength(bytes) > 12 * 1024) return { ok: false, reason: 'report-too-large' } as const;
      const digest = createHash('sha256').update(bytes).digest('hex');
      await ports.save(digest, { bytes, rehearsal });
      return { ok: true, bytes, digest } as const;
    } catch {
      return { ok: false, reason: 'report-unavailable' } as const;
    }
  };
}
