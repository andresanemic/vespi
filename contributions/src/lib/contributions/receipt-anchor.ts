import { createHash } from 'node:crypto';
import { FeeBumpTransaction, Keypair, Networks, Transaction } from '@stellar/stellar-sdk/base';
import { hasParticipantSignature } from './handlers';
import { assignmentMessage } from './contribution-assignment';
import { photoUri } from './contribution-photos';
import { buildIndexEntry, parseContribution } from './kernel/contributions.js';
import { buildFeeBump } from './stellar-server';
import { isSurveyId, surveySigningDeadline, type SurveyRecord } from './survey-intake';
import type { ReceiptIndex, ReceiptIntent, Registry } from './receipt-registry';
import { SURVEY_EVENT, surveySlot } from './survey-report';
import { yerkoSlidesReference } from './yerko-event';

type Parsed = ReturnType<typeof parseContribution>;
type LedgerReceipt = { successful: boolean; ledger: number; envelopeXdr: string; closedAt: string };
type AnchorPorts = {
  registry: Registry;
  now(): Date;
  sponsor(): Keypair;
  send(xdr: string, actor: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  lookup(hash: string): Promise<LedgerReceipt | null>;
  latestLedgerTime(): Promise<number>;
  getSurvey(id: string): Promise<SurveyRecord | null>;
  getReport(digest: string): Promise<{ bytes: string; rehearsal: boolean } | null>;
  photoExists?(actor: string, digest: string): Promise<boolean>;
  organizer?: string;
  cutoff?: string;
  surveyClosesAt?: string;
  yerko?: { root: string; account: string; closed: boolean };
};
type AnchorResult = { ok: true; index: ReceiptIndex } | { ok: false; reason: string };

function fail(reason: string): AnchorResult { return { ok: false, reason }; }

function matchesCommitment(tx: Transaction, receipt: Parsed, digest: string) {
  const memo = tx.memo;
  return tx.source === receipt.actor && memo.type === 'hash' &&
    Buffer.isBuffer(memo.value) && memo.value.toString('hex') === digest &&
    hasParticipantSignature(tx, receipt.actor);
}

async function readConfirmed(registry: Registry, digest: string) {
  const record = await registry.get(digest);
  return record?.index ? parseContribution(record.intent.bytes) : null;
}

async function isLinkedReceipt(receipt: Parsed, registry: Registry, assignment: unknown) {
  const root = await readConfirmed(registry, receipt.chain);
  if (!root || root.kind !== 'REQUEST') return false;

  if (receipt.kind === 'ATTEST') {
    const subject = await readConfirmed(registry, receipt.subject);
    return subject?.kind === 'CONTRIBUTE' && subject.chain === receipt.chain &&
      receipt.actor !== root.actor && receipt.actor !== subject.actor;
  }

  const prior = receipt.prev === receipt.chain ? root : await readConfirmed(registry, receipt.prev);
  if (!prior || (prior.kind !== 'REQUEST' && prior.chain !== receipt.chain)) return false;
  if (receipt.kind === 'CONTRIBUTE') {
    if (prior.kind === 'CONTRIBUTE') return prior.actor === receipt.actor;
    return prior.kind === 'REQUEST' && receipt.prev === receipt.chain &&
      typeof assignment === 'string' && /^[a-f0-9]{128}$/.test(assignment) &&
      Keypair.fromPublicKey(root.actor).verify(Buffer.from(assignmentMessage(receipt.chain, receipt.actor)),
        Buffer.from(assignment, 'hex'));
  }
  if (receipt.actor !== root.actor || prior.kind !== 'CONTRIBUTE') return false;
  const subject = await readConfirmed(registry, receipt.subject);
  return subject?.kind === 'CONTRIBUTE' && subject.chain === receipt.chain;
}

export function createReceiptAnchor(ports: AnchorPorts) {
  async function reconcile(intent: ReceiptIntent, receipt: Parsed, allowRelease: boolean): Promise<AnchorResult> {
    let observed = await ports.lookup(intent.hash);
    if (!observed && allowRelease && ports.now().getTime() / 1000 > intent.deadline &&
      await ports.latestLedgerTime() > intent.deadline) {
      // Read again after the indexing watermark. A 404 from before the time bound proves nothing.
      observed = await ports.lookup(intent.hash);
      if (!observed) {
        await ports.registry.release(intent);
        return fail('retry-with-fresh-transaction');
      }
    }
    if (!observed) return fail('anchor-pending');
    const outer = new FeeBumpTransaction(observed.envelopeXdr, Networks.TESTNET);
    const closed = Date.parse(observed.closedAt);
    if (outer.hash().toString('hex') !== intent.hash || !matchesCommitment(outer.innerTransaction, receipt, intent.digest)
      || !Number.isFinite(closed)) return fail('anchor-mismatch');

    if (!observed.successful) {
      await ports.registry.release(intent);
      return fail('inner-failed');
    }

    const cutoff = Date.parse(ports.cutoff ?? '');
    const index = buildIndexEntry({
      digest: intent.digest, network: 'stellar:testnet', txHash: intent.hash, ledger: observed.ledger,
      envelopeXdr: observed.envelopeXdr, rehearsal: intent.rehearsal ?? (!Number.isFinite(cutoff) || closed < cutoff),
    });
    return await ports.registry.confirm(intent, index) ? { ok: true, index } : fail('anchor-pending');
  }

  async function anchor(body: Record<string, unknown>): Promise<AnchorResult> {
    if (typeof body.bytes !== 'string' || typeof body.xdr !== 'string') return fail('invalid-body');
    let receipt, tx;
    try {
      receipt = parseContribution(body.bytes);
      tx = new Transaction(body.xdr, Networks.TESTNET);
    } catch { return fail('invalid-receipt-or-xdr'); }
    if (!['REQUEST', 'CONTRIBUTE', 'ACCEPT', 'ATTEST', 'SURVEY', 'REPORT'].includes(receipt.kind)) return fail('unsupported-receipt-kind');
    const digest = createHash('sha256').update(body.bytes, 'utf8').digest('hex');
    try {
      if (!matchesCommitment(tx, receipt, digest)) return fail('commitment-mismatch');
    } catch { return fail('commitment-mismatch'); }

    try {
      if (receipt.kind === 'REPORT' && receipt.actor !== ports.organizer) return fail('organizer-required');
      const existing = await ports.registry.get(digest);
      if (existing?.index) return { ok: true, index: existing.index };
      if (existing) return await reconcile(existing.intent, receipt, true);
      let eventSlot: string | null = null;
      let rehearsal: boolean | undefined;
      let photo: string | undefined;
      if (receipt.kind === 'SURVEY') {
        if (!isSurveyId(body.surveyId) || receipt.statement !== 'Respondí la encuesta' || receipt.comment !== null) {
          return fail('invalid-survey-receipt');
        }
        const survey = await ports.getSurvey(body.surveyId);
        if (!survey || survey.actor !== receipt.actor || survey.commitment !== receipt.evidence.commitment ||
          typeof survey.rehearsal !== 'boolean') {
          return fail('invalid-survey-receipt');
        }
        rehearsal = survey.rehearsal;
        eventSlot = surveySlot(receipt.actor, rehearsal);
      } else if (receipt.kind === 'REPORT') {
        const snapshot = await ports.getReport(digest);
        if (snapshot?.bytes !== body.bytes || typeof snapshot.rehearsal !== 'boolean') {
          return fail('invalid-report-snapshot');
        }
        rehearsal = snapshot.rehearsal;
        eventSlot = `report:${SURVEY_EVENT}:${rehearsal ? 'rehearsal' : 'event'}`;
      } else if (receipt.evidence !== null) {
        const { sha256, uri } = receipt.evidence;
        if (uri !== photoUri(sha256) || !await ports.photoExists?.(receipt.actor, sha256)) {
          return fail('evidence-unavailable');
        }
        photo = sha256;
      }

      const now = Math.floor(ports.now().getTime() / 1000);
      const deadline = Number(tx.timeBounds?.maxTime);
      if (!Number.isSafeInteger(deadline) || deadline <= now || deadline > now + 300) {
        return fail('invalid-timebound');
      }
      if (receipt.kind === 'SURVEY' && !rehearsal) {
        const surveyDeadline = surveySigningDeadline(ports.surveyClosesAt);
        if (Number.isNaN(surveyDeadline) || deadline * 1000 > surveyDeadline) return fail('survey-closed');
      }
      if (ports.yerko && receipt.chain === ports.yerko.root) {
        if (receipt.kind === 'CONTRIBUTE') {
          if (receipt.actor !== ports.yerko.account) return fail('speaker-required');
          if (receipt.comment !== yerkoSlidesReference) return fail('slides-required');
        }
        if (receipt.kind === 'ATTEST') {
          if (ports.yerko.closed) return fail('event-closed');
          const speaker = await readConfirmed(ports.registry, receipt.subject);
          if (speaker?.kind !== 'CONTRIBUTE' || speaker.actor !== ports.yerko.account ||
            speaker.comment !== yerkoSlidesReference) return fail('speaker-required');
        }
      }
      const op = tx.operations[0];
      if (tx.operations.length !== 1 || op.type !== 'bumpSequence' || (op.source && op.source !== receipt.actor)) {
        return fail('wrong-operation');
      }
      if (['CONTRIBUTE', 'ACCEPT', 'ATTEST'].includes(receipt.kind) &&
        !await isLinkedReceipt(receipt, ports.registry, body.assignment)) return fail('invalid-chain-link');

      const outer = buildFeeBump(tx, ports.sponsor(), tx.fee);
      const intent = {
        digest, bytes: body.bytes, hash: outer.hash().toString('hex'), deadline,
        chain: receipt.kind === 'REQUEST' ? digest : receipt.kind === 'ATTEST' ? null : eventSlot ?? receipt.chain,
        prev: receipt.prev, rehearsal, photo,
      };
      let result = await ports.registry.reserve(intent);
      if (result === 'conflict' && intent.chain) {
        const blocked = await ports.registry.pending(intent.chain);
        if (blocked) {
          const recovered = await reconcile(blocked.intent, parseContribution(blocked.intent.bytes), true);
          if (!recovered.ok && ['inner-failed', 'retry-with-fresh-transaction'].includes(recovered.reason)) {
            result = await ports.registry.reserve(intent);
          }
        }
      }
      if (result === 'conflict') return fail('chain-conflict');
      if (result === 'exists') {
        const raced = await ports.registry.get(digest);
        if (!raced) return fail('anchor-pending');
        return raced.index ? { ok: true, index: raced.index } : await reconcile(raced.intent, receipt, true);
      }
      const submission = await ports.send(body.xdr, receipt.actor);
      if (!submission.ok && ['budget-exhausted', 'budget-unavailable', 'config-error', 'authority-expired',
        'fee-over-limit'].includes(submission.reason)) {
        await ports.registry.release(intent);
        return submission;
      }
      return await reconcile(intent, receipt, false);
    } catch {
      return fail('anchor-unavailable');
    }
  }

  return Object.assign(anchor, {
    async settle(slot: string) {
      const pending = await ports.registry.pending(slot);
      if (!pending) return true;
      const result = await reconcile(pending.intent, parseContribution(pending.intent.bytes), true);
      return result.ok || ['inner-failed', 'retry-with-fresh-transaction'].includes(result.reason);
    },
  });
}
