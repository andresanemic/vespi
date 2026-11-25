import type { ContributionNetwork } from '@/lib/contributions/network';

const draftPrefix = 'vespi-contributions:draft:';
const draftLifetime = 7 * 24 * 60 * 60 * 1000;
export const guestDraft = 'guest';

export function readDraft<T>(key: string): T | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!saved) return;
    const now = Date.now();
    if (saved.expires === undefined) {
      saveDraft(key, saved);
      return saved as T;
    }
    if (Number.isFinite(saved.expires) && saved.expires > now && saved.expires <= now + draftLifetime) return saved.value as T;
    localStorage.removeItem(key);
  } catch {}
}

export function saveDraft(key: string, value?: object) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify({ expires: Date.now() + draftLifetime, value }));
    else localStorage.removeItem(key);
  } catch {}
}

export function draftKey(account: string, network: ContributionNetwork, flow: string) {
  return `${draftPrefix}${account}:${network}:${flow}`;
}

export function purgeDrafts(account?: string) {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(account ? draftPrefix + account + ':' : draftPrefix) ||
        (!account && key.startsWith('vespi-encuentros-borrador-integracion-v1'))) localStorage.removeItem(key);
    }
  } catch {}
}

export type ComposerDraft = {
  statement: string;
  comment?: string;
  received?: boolean;
  counterparty?: string;
  voiceSuggested?: boolean;
  review?: boolean;
};

export function readComposerDraft(account: string, network: ContributionNetwork, flow: string): ComposerDraft | undefined {
    const draft = readDraft<ComposerDraft>(draftKey(account, network, flow));
    if (draft && typeof draft.statement === 'string' && draft.statement.length <= 1000 &&
      (draft.comment === undefined || typeof draft.comment === 'string' && draft.comment.length <= 280) &&
      (draft.counterparty === undefined || typeof draft.counterparty === 'string' && draft.counterparty.length <= 56)) {
      return { statement: draft.statement, comment: draft.comment, counterparty: draft.counterparty,
        received: draft.received === true, voiceSuggested: draft.voiceSuggested === true, review: draft.review === true };
    }
}

export function saveComposerDraft(account: string, network: ContributionNetwork, flow: string, draft?: ComposerDraft) {
  saveDraft(draftKey(account, network, flow), draft);
}

export function legacyReceivedDraft(account: string, network: ContributionNetwork) {
  const saved = readComposerDraft(account, network, 'received');
  const previous = readComposerDraft(account, network, 'request');
  if (!previous?.received) return saved;
  if (saved) return saved;
  try {
    const oldKey = draftKey(account, network, 'request');
    const value = localStorage.getItem(oldKey);
    if (value) {
      localStorage.setItem(draftKey(account, network, 'received'), value);
      localStorage.removeItem(oldKey);
    }
  } catch {}
  return previous;
}
