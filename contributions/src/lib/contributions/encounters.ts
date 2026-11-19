import { StrKey } from '@stellar/stellar-sdk/base';

export type Person = { account: string; displayName: string };
export type EncounterDraft = {
  type: 'reunion' | 'ayuda' | 'charla' | 'otro';
  title: string;
  date: string;
  where: string;
  summary: string;
  a: Person;
  b: Person | null;
  contributions: { from: 'a' | 'b'; text: string; url: string }[];
  revisionOf?: string;
  inviteMode?: 'link';
  role?: 'asistente' | 'ponente' | 'organizador';
};
export type Decision = 'confirm' | 'correction' | 'declined';

export function encounterAccess(draft: EncounterDraft, reviewed: boolean, account: string | null,
  invitation?: { valid: boolean; respondent?: string }) {
  if (draft.inviteMode === 'link') {
    if (account && (account === draft.a.account || account === invitation?.respondent)) return 'allowed';
    if (reviewed || !invitation?.valid) return 'wrong-account';
    return account ? 'allowed' : 'claim-sign-in';
  }
  if (!draft.b || (!draft.b.account && reviewed)) return 'allowed';
  if (!account) return 'sign-in';
  return account === draft.a.account || account === draft.b.account ? 'allowed' : 'wrong-account';
}
export type Encounter = EncounterDraft & {
  id: string;
  revision?: number;
  inviteUrl?: string;
  createdAt: string;
  status: 'pending' | 'confirmed' | 'personal' | 'correction' | 'declined';
  confirmed: boolean;
  respondedBy?: Person;
  note?: string;
  anchor?: string;
  receiptToken?: string;
  anchorCommitment?: string;
};

export function isEncounterId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

function field(input: unknown, max: number) {
  if (typeof input !== 'string' || input.length > max || /[\p{Cf}\u0000-\u0008\u000b-\u001f\u007f]/u.test(input)) {
    throw new Error('invalid-field');
  }
  return input.trim().normalize('NFC');
}

function person(input: unknown, allowUnassigned = false): Person {
  const value = input as Partial<Person> | null;
  if (!value || typeof value.account !== 'string' || (!StrKey.isValidEd25519PublicKey(value.account) && !(allowUnassigned && value.account === ''))) throw new Error('invalid-person');
  const displayName = field(value.displayName, 80);
  if (!displayName || /\p{Cc}/u.test(displayName)) throw new Error('invalid-name');
  return { account: value.account, displayName };
}

export function parseEncounterDraft(input: unknown): EncounterDraft {
  const value = input as EncounterDraft | null;
  if (!value || !['reunion', 'ayuda', 'charla', 'otro'].includes(value.type)) throw new Error('invalid-type');
  const { type } = value;
  const a = person(value.a);
  const b = value.b === null ? null : person(value.b, true);
  if ((!b && type !== 'charla') || b?.account === a.account) throw new Error('invalid-counterparty');
  const title = field(value.title, 140);
  const date = field(value.date, 10);
  const where = field(value.where, 200);
  const summary = field(value.summary, 1000);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date || !Array.isArray(value.contributions) ||
    !value.contributions.length || value.contributions.length > 12) throw new Error('invalid-encounter');
  const contributions: EncounterDraft['contributions'] = value.contributions.map(entry => {
    if (!entry || (entry.from !== 'a' && (entry.from !== 'b' || !b))) throw new Error('invalid-author');
    const text = field(entry.text, 1000);
    const url = field(entry.url, 1000);
    if (!text || (url && !['https:', 'http:'].includes(new URL(url).protocol))) throw new Error('invalid-contribution');
    return { from: entry.from, text, url };
  });
  const role = value.role;
  if (role !== undefined && (type !== 'charla' || !['asistente', 'ponente', 'organizador'].includes(role))) throw new Error('invalid-role');
  const revisionOf = value.revisionOf;
  if (revisionOf !== undefined && !isEncounterId(revisionOf)) throw new Error('invalid-revision');
  const inviteMode = value.inviteMode;
  if (inviteMode !== undefined && (inviteMode !== 'link' || !b || b.account || revisionOf)) throw new Error('invalid-invitation');
  return { type, title, date, where, summary, a, b, contributions, ...(role && { role }), ...(revisionOf && { revisionOf }),
    ...(inviteMode && { inviteMode }) };
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const domain = 'vespi:encuentro:v1:stellar:testnet';
export function proposalMessage(id: string, draft: EncounterDraft) {
  return bytes([domain, 'proposal', id, parseEncounterDraft(draft)]);
}
export function decisionMessage(id: string, proposalSignature: string, choice: Decision, note: string) {
  return bytes([domain, 'decision', id, proposalSignature, choice, note]);
}
export function sessionMessage(account: string, expires: number) {
  return bytes([domain, 'list', account, expires]);
}
export function parseDecisionNote(value: unknown) { return field(value, 500); }
