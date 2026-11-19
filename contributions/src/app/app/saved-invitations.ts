import { contributionLink } from './client';

export type SavedInvitation = { root: string; recipient: string; name: string; proof: string; mutual?: string; incoming?: boolean };

const key = (account: string) => 'vespi-contributions:invitations:' + account;
const digestPattern = /^[a-f0-9]{64}$/;

export function readInvitations(account: string): SavedInvitation[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(key(account)) ?? '[]');
    return Array.isArray(entries) ? entries.filter((entry): entry is SavedInvitation => entry && digestPattern.test(entry.root) &&
      /^[a-f0-9]{128}$/.test(entry.proof) && /^G[A-Z2-7]{55}$/.test(entry.recipient) &&
      typeof entry.name === 'string' && (!entry.mutual || digestPattern.test(entry.mutual))) : [];
  } catch { return []; }
}

export function rememberInvitation(account: string, invitation: SavedInvitation) {
  try {
    localStorage.setItem(key(account), JSON.stringify([invitation, ...readInvitations(account)
      .filter(previous => previous.root !== invitation.root)]));
  } catch {}
}

export function invitationPath(invitation: SavedInvitation) {
  return contributionLink('continue', invitation.root, invitation.mutual) + '#assignment=' + invitation.proof;
}

const mutualKey = (account: string, root: string) => 'vespi-contributions:mutual:' + account + ':' + root;

export function rememberMutual(account: string, root: string, first: string) {
  try { localStorage.setItem(mutualKey(account, root), first); } catch {}
}

export function readMutual(account: string, root: string) {
  try {
    const first = localStorage.getItem(mutualKey(account, root));
    if (first && digestPattern.test(first)) return first;
  } catch {}
}