import { createHash } from 'node:crypto';
import { createEncounterRegistry, type StoredEncounter } from './encounter-registry';
import { verifiesEncounterSignature } from './encounter-signatures';
import { decisionMessage, deriveRecordTitle, encounterAnchorMessage, isEncounterFingerprint, isEncounterId, parseEncounterDraft,
  proposalMessage, type EncounterDraft, type Person } from './encounters';
import { verifyEvidenceReceipt } from './chain-evidence.mjs';
import type { ContributionNetwork } from './network';
import { createRateLimiter } from './rate-limit';
import { createReceiptRegistry, ReceiptIntegrityError } from './receipt-registry';

export type PublicEncounter = {
  id: string;
  a: Person;
  b: Person;
  date: string;
  where: string;
  contributions: EncounterDraft['contributions'];
  proposalSignature: string;
  decisionSignature: string;
  commitment: string;
  anchor: { digest: string; txHash: string } | null;
};
export type PublicEncounterDetail = PublicEncounter & { messages?: { proposal: string | null; confirmation: string | null } };

export const publicEncounterLimiter = createRateLimiter();
export const publicProfileLimiter = createRateLimiter();

export function signedPublicEncounter(row: StoredEncounter | null, network: ContributionNetwork, includeMessages = false) {
  if (row?.draft?.visibility !== 'public' || row.decision?.choice !== 'confirm' || !isEncounterId(row.id)) return null;
  const { id, decision, proposalSignature } = row;
  try {
    const draft = parseEncounterDraft(row.draft);
    const recipient = decision.person.account;
    const proposal = proposalMessage(id, draft, network);
    const confirmation = decisionMessage(id, proposalSignature, 'confirm', decision.note, network);
    if (!draft.b || recipient === draft.a.account || (draft.b.account && draft.b.account !== recipient) ||
      !verifiesEncounterSignature(draft.a.account, proposal, proposalSignature) ||
      !verifiesEncounterSignature(recipient, confirmation, decision.signature)) return null;
    return {
      entry: {
        id, a: draft.a, b: draft.inviteMode === 'link' ? { account: recipient, displayName: decision.person.displayName } : draft.b,
        date: draft.date, where: draft.where, contributions: draft.contributions,
        proposalSignature, decisionSignature: decision.signature,
        commitment: createHash('sha256').update(encounterAnchorMessage(id, proposalSignature, decision.signature, network)).digest('hex'),
      },
      messages: includeMessages ? {
        proposal: !draft.inviteMode && !draft.revisionOf && draft.summary === '' &&
          draft.title === deriveRecordTitle(draft.contributions[0].text) ? new TextDecoder().decode(proposal) : null,
        confirmation: decision.note === '' ? new TextDecoder().decode(confirmation) : null,
      } : undefined,
    };
  } catch {
    return null;
  }
}

export function createPublicEncounters(network: ContributionNetwork, env: Record<string, string | undefined> = process.env, request = fetch) {
  const encounters = createEncounterRegistry(env, request, network);
  const receipts = createReceiptRegistry(env, request, network);

  async function anchorFor(digest: string | undefined, actor: string, commitment: string) {
    if (!digest || !/^[a-f0-9]{64}$/.test(digest)) return null;
    const record = await receipts.get(digest).catch(error => {
      if (error instanceof ReceiptIntegrityError) return null;
      throw error;
    });
    if (!record?.index) return null;
    try {
      const { receipt, index } = verifyEvidenceReceipt(digest, Buffer.from(record.intent.bytes), record.index, network);
      if (receipt.actor === actor && isEncounterFingerprint(receipt) && receipt.comment === 'vespi:encuentro:' + commitment) {
        return { digest, txHash: index.txHash };
      }
    } catch {
      return null;
    }
    return null;
  }

  async function project(row: StoredEncounter | null, account?: string, includeMessages = false): Promise<PublicEncounterDetail | null> {
    const signed = signedPublicEncounter(row, network, includeMessages);
    if (!signed) return null;
    const { entry, messages } = signed;
    if (account && account !== entry.a.account && account !== entry.b.account) return null;
    const anchor = await anchorFor(row?.anchor, entry.b.account, entry.commitment);
    return { ...entry, anchor, ...(messages && { messages }) };
  }

  return {
    async get(id: string, includeMessages = false) {
      return isEncounterId(id) ? project(await encounters.get(id), undefined, includeMessages) : null;
    },
    async list(account: string, cursor: string) {
      const page = await encounters.listPublicCandidates(account, cursor);
      const entries = await Promise.all(page.entries.map(row => project(row, account)));
      return { cursor: page.cursor, entries: entries.filter(entry => entry !== null) };
    },
  };
}
