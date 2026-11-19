'use client';

import { useSyncExternalStore } from 'react';
import type { Signer } from '@/lib/contributions/keys';

export type MobileIdentity = { account: string; displayName: string };
export const mobileIdentityKey = 'vespi-contributions:identity:v1';
const eventName = 'vespi-contributions:identity';
let memory: string | null = null;

function snapshot() {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(mobileIdentityKey) ?? memory; }
  catch { return memory; }
}

function parse(raw: string | null): MobileIdentity | null {
  try {
    const identity = JSON.parse(raw ?? 'null');
    if (identity && typeof identity.account === 'string' && /^G[A-Z2-7]{55}$/.test(identity.account) &&
      typeof identity.displayName === 'string' && identity.displayName.length > 0 && identity.displayName.length <= 80) {
      return { account: identity.account, displayName: identity.displayName };
    }
  } catch {}
  return null;
}

function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener('storage', callback);
  };
}

export function readMobileIdentity() { return parse(snapshot()); }

export function useMobileIdentity() {
  return parse(useSyncExternalStore(subscribe, snapshot, () => null));
}

export function rememberMobileIdentity(account: string, displayName: string) {
  memory = JSON.stringify({ account, displayName });
  try { window.localStorage.setItem(mobileIdentityKey, memory); } catch {}
  window.dispatchEvent(new Event(eventName));
}
type Unlocked = { signer: Signer; local: boolean; expiresAt: number };
let unlocked: Unlocked | undefined;

export function keepMobileSigner(signer: Signer, local: boolean) {
  const current = { signer, local, expiresAt: Date.now() + 120_000 };
  unlocked = current;
  window.setTimeout(() => { if (unlocked === current) unlocked = undefined; }, 120_000);
}

export function getMobileSigner(account: string) {
  return unlocked?.signer.publicKey === account && Date.now() < unlocked.expiresAt ? unlocked : undefined;
}

export function clearMobileIdentity() {
  memory = null;
  unlocked = undefined;
  try { window.localStorage.removeItem(mobileIdentityKey); } catch {}
  window.dispatchEvent(new Event(eventName));
}