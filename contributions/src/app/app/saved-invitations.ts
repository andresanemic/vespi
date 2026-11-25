import { contributionLink } from './client';
import { DEFAULT_NETWORK } from '@/lib/contributions/network';

export type SavedInvitation = { root: string; recipient: string; name: string; proof: string; mutual?: string; incoming?: boolean };

const digestPattern = /^[a-f0-9]{64}$/;

export function readInvitations(account: string, network = DEFAULT_NETWORK): SavedInvitation[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(invitationKey(account, network)) ?? '[]');
    return Array.isArray(entries) ? entries.filter((entry): entry is SavedInvitation => entry && digestPattern.test(entry.root) &&
      /^[a-f0-9]{128}$/.test(entry.proof) && /^G[A-Z2-7]{55}$/.test(entry.recipient) &&
      typeof entry.name === 'string' && (!entry.mutual || digestPattern.test(entry.mutual))) : [];
  } catch { return []; }
}

const invitationKey = (account: string, network = DEFAULT_NETWORK) =>
  'vespi-contributions:invitations:' + account + (network === 'mainnet' ? ':mainnet' : '');

export function rememberInvitation(account: string, invitation: SavedInvitation, network = DEFAULT_NETWORK) {
  try {
    localStorage.setItem(invitationKey(account, network), JSON.stringify([invitation, ...readInvitations(account, network)
      .filter(previous => previous.root !== invitation.root)]));
  } catch {}
}

export function invitationPath(invitation: SavedInvitation, network = DEFAULT_NETWORK) {
  return contributionLink('continue', invitation.root, invitation.mutual, network) + '&permiso=entrega#assignment=' + invitation.proof;
}

const mutualKey = (account: string, root: string, network = DEFAULT_NETWORK) =>
  'vespi-contributions:mutual:' + account + ':' + root + (network === 'mainnet' ? ':mainnet' : '');

export function rememberMutual(account: string, root: string, first: string, network = DEFAULT_NETWORK) {
  try { localStorage.setItem(mutualKey(account, root, network), first); } catch {}
}

export function readMutual(account: string, root: string, network = DEFAULT_NETWORK) {
  try {
    const first = localStorage.getItem(mutualKey(account, root, network));
    if (first && digestPattern.test(first)) return first;
  } catch {}
}
