'use client';

import { useSyncExternalStore } from 'react';
import type { Keypair } from '@stellar/stellar-sdk/base';
import { isEmbeddedBrowser, keypairFromPrf, signerFromKeypair, unlockPasskey, type Signer } from '@/lib/contributions/keys';
import { loadDeviceKey } from '@/lib/contributions/device-key';
import { clearSession, loadSession, saveSession, SESSION_MS } from '@/lib/contributions/session-key';
import { closeEncounterSession, FlowError } from './client';
import { purgeDrafts } from './composer-draft';
import { clearVoiceConsent } from './voice-recorder';

export type MobileIdentity = { account: string; displayName: string; local?: boolean };
export const mobileIdentityKey = 'vespi-contributions:identity:v1';
const eventName = 'vespi-contributions:identity';
let memory: string | null = null;
let volatile = false;

function snapshot() {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(mobileIdentityKey) ?? (volatile ? memory : null); }
  catch { return memory; }
}

function parse(raw: string | null): MobileIdentity | null {
  try {
    const identity = JSON.parse(raw ?? 'null');
    if (identity && typeof identity.account === 'string' && /^G[A-Z2-7]{55}$/.test(identity.account) &&
      typeof identity.displayName === 'string' && identity.displayName.length > 0 && identity.displayName.length <= 80) {
      return { account: identity.account, displayName: identity.displayName, local: identity.local === true };
    }
  } catch {}
  return null;
}

function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback);
  window.addEventListener('storage', callback);
  window.addEventListener('pageshow', callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener('storage', callback);
    window.removeEventListener('pageshow', callback);
  };
}

export function readMobileIdentity() { return parse(snapshot()); }

export function useMobileIdentity() {
  return parse(useSyncExternalStore(subscribe, snapshot, () => null));
}

export function rememberMobileIdentity(account: string, displayName: string, local?: boolean) {
  const previous = readMobileIdentity();
  if (previous && previous.account !== account) {
    clearVoiceConsent(previous.account);
    purgeDrafts(previous.account);
    if (!getMobileSigner(account)) {
      lock();
      queueSession(() => clearSession(previous.account));
    }
  }
  memory = JSON.stringify({ account, displayName, ...(local && { local }) });
  try { window.localStorage.setItem(mobileIdentityKey, memory); volatile = false; } catch { volatile = true; }
  window.dispatchEvent(new Event(eventName));
}
type Unlocked = { signer: Signer; local: boolean; expires: number };
const FRESH_MS = 120_000;
// Both clocks: the wall clock can be set back, the monotonic one may stop while the phone sleeps.
let passkeyAt: { wall: number; mono: number } | undefined;

export const unlockedNow = () => Date.now();
export const unlockIsRecent = (at: number) => Date.now() - at >= 0 && Date.now() - at < FRESH_MS;

function passkeyIsRecent() {
  const wall = passkeyAt ? Date.now() - passkeyAt.wall : -1;
  return wall >= 0 && wall < FRESH_MS && performance.now() - passkeyAt!.mono < FRESH_MS;
}
let unlocked: Unlocked | undefined;
let pending: { account: string; promise: Promise<Signer> } | undefined;
let generation = 0;
let sessionWrites = Promise.resolve();

function queueSession(write: () => Promise<void>) {
  sessionWrites = sessionWrites.then(write).catch(() => {});
}

// pair comes only from a passkey, used at the given time: it opens the session that survives reloads.
export function keepMobileSigner(signer: Signer, local: boolean, pair?: Keypair, at = Date.now(), expires = at + SESSION_MS) {
  if (unlocked && unlocked.signer.publicKey !== signer.publicKey) {
    const other = unlocked.signer.publicKey;
    lock();
    queueSession(() => clearSession(other));
  }
  const version = generation;
  const remembered = readMobileIdentity()?.account === signer.publicKey;
  if (pair && !local) {
    passkeyAt = { wall: at, mono: performance.now() - (Date.now() - at) };
    // Without Ed25519 or storage support the session simply ends at the next reload.
    queueSession(async () => {
      if (generation !== version) return;
      await saveSession(pair, at);
      // Signed out here or in another tab while it was being saved.
      const current = readMobileIdentity()?.account;
      if (generation !== version || (remembered && current !== signer.publicKey)) await clearSession(signer.publicKey);
    });
  }
  unlocked = { local, expires, signer: { publicKey: signer.publicKey, sign: async bytes => {
    const identity = readMobileIdentity();
    if (Date.now() >= expires || generation !== version || ((remembered || identity) && identity?.account !== signer.publicKey)) throw new FlowError('different-account');
    return signer.sign(bytes);
  } } };
  return unlocked.signer;
}

export function getMobileSigner(account: string) {
  return unlocked?.signer.publicKey === account && Date.now() < unlocked.expires ? unlocked : undefined;
}

let restoring: { account: string; promise: Promise<void> } | undefined;

// Reopens the stored session for the remembered account, if it is still valid.
export function restoreMobileSession(): Promise<void> {
  const identity = readMobileIdentity();
  if (!identity || identity.local || getMobileSigner(identity.account)) return Promise.resolve();
  if (restoring?.account === identity.account) return restoring.promise;
  const version = generation;
  const promise = sessionWrites.then(() => {
    if (generation === version && readMobileIdentity()?.account === identity.account) return loadSession(identity.account);
  }).then(session => {
    if (!session || generation !== version || readMobileIdentity()?.account !== identity.account || getMobileSigner(identity.account)) return;
    keepMobileSigner(session.signer, false, undefined, undefined, session.expires);
    window.dispatchEvent(new Event(eventName));
  }).catch(() => {});
  restoring = { account: identity.account, promise };
  void promise.finally(() => { if (restoring?.promise === promise) restoring = undefined; });
  return promise;
}

// fresh: signing on mainnet, which asks for the passkey unless it was used in the last two minutes.
export async function requireMobileSigner(account: string, useDevice = false, fresh = false): Promise<Signer> {
  const remembered = readMobileIdentity();
  if (remembered && remembered.account !== account) throw new FlowError('different-account');
  if (isEmbeddedBrowser(navigator.userAgent)) throw new FlowError('embedded');
  const deviceKey = useDevice || remembered?.local === true;
  const recent = () => !fresh || deviceKey || passkeyIsRecent();
  if (!fresh && !getMobileSigner(account)) await restoreMobileSession();
  const cached = getMobileSigner(account);
  if (cached && recent()) return cached.signer;
  if (pending?.account === account) return pending.promise;
  const version = generation;
  const local = deviceKey;
  const promise = (async () => {
    const rpId = location.hostname;
    const legacy = remembered?.account === account && !remembered.local;
    let canceled = false;
    const prf = local ? null : await unlockPasskey({ rpId }).catch(() => { canceled = true; return null; });
    const pair = prf ? await keypairFromPrf(prf, rpId) : undefined;
    const signer = pair ? signerFromKeypair(pair) : local || legacy || !canceled ? await loadDeviceKey().catch(() => null) : null;
    if (!signer || (!pair && !local && signer.publicKey !== account)) throw new FlowError(canceled ? 'auth' : 'device-required');
    if (signer.publicKey !== account || version !== generation || (remembered && readMobileIdentity()?.account !== account)) {
      throw new FlowError('different-account');
    }
    if (remembered && !prf && !remembered.local) rememberMobileIdentity(account, remembered.displayName, true);
    return keepMobileSigner(signer, !prf, pair);
  })();
  pending = { account, promise };
  try { return await promise; }
  finally { if (pending?.promise === promise) pending = undefined; }
}

function lock() {
  generation++;
  unlocked = undefined;
  passkeyAt = undefined;
  restoring = undefined;
  pending = undefined;
}

export function mobileIdentityChanged(event: StorageEvent) {
  return event.key === null || (event.key === mobileIdentityKey &&
    parse(event.oldValue)?.account !== parse(event.newValue)?.account);
}

if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') void restoreMobileSession();
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (!mobileIdentityChanged(event)) return;
  const previous = parse(event.oldValue);
  lock();
  if (!previous) return;
  clearVoiceConsent(previous.account);
  purgeDrafts(previous.account);
  queueSession(() => clearSession(previous.account));
});

export function mobilePageRestored(event: PageTransitionEvent) {
  if (!event.persisted) return;
  document.documentElement.style.visibility = 'hidden';
  location.reload();
}

export function hasPendingSubmission(account?: string) {
  try {
    return Object.keys(localStorage).some(key =>
      /^vespi-contributions:(pending|chain-attempt|observation):/.test(key) &&
        key.split(':').includes(account ?? '') ||
      key.startsWith('vespi-encounter:anchor:') || key.startsWith('vespi-encounter:publishing:'));
  } catch { return false; }
}

export async function clearMobileIdentity() {
  const account = readMobileIdentity()?.account;
  const closed = Promise.allSettled([closeEncounterSession('testnet', account), closeEncounterSession('mainnet', account)]);
  if (account) clearVoiceConsent(account);
  memory = null;
  volatile = false;
  lock();
  queueSession(() => clearSession(account));
  purgeDrafts();
  try {
    window.localStorage.removeItem(mobileIdentityKey);
    for (const key of Object.keys(window.localStorage)) {
      // Invitations and mutual links stay for the next sign-in: they belong to the account and cannot be rebuilt.
      if (key.startsWith('vespi-contributions:') && !/^vespi-contributions:(invitations|mutual):/.test(key) &&
        key.split(':').includes(account ?? '')) window.localStorage.removeItem(key);
      if (key.startsWith('vespi-encounter:anchor:') || key.startsWith('vespi-encounter:publishing:')) window.localStorage.removeItem(key);
    }
  } catch {}
  window.dispatchEvent(new Event(eventName));
  await sessionWrites;
  // The requests survive the page; a slow network must not keep the account on screen.
  await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 2000))]);
}
