import { Buffer } from 'buffer';
import type { Keypair } from '@stellar/stellar-sdk/base';
import type { Signer } from './keys';

// Keeps the signed-in account usable across reloads without asking for the passkey again. Only a non-extractable
// WebCrypto key is stored, never the seed: script on this origin could use it until it expires, but not read or
// copy it. The same key is the account on both networks: asking for the passkey to sign on mainnet is a rule of
// this interface (requireMobileSigner, fresh; not repeated for two minutes, and not for device keys), not a limit
// of the key. Voice notes are authorized with the session on both networks.
export const SESSION_MS = 12 * 60 * 60 * 1000;
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

type Stored = { key: CryptoKey; publicKey: string; expires: number };
export type SessionSigner = { signer: Signer; expires: number };

export async function sessionFromKeypair(pair: Keypair, now = Date.now()): Promise<Stored> {
  const der = new Uint8Array([...PKCS8_ED25519, ...pair.rawSecretKey()]);
  try {
    const key = await crypto.subtle.importKey('pkcs8', der, 'Ed25519', false, ['sign']);
    return { key, publicKey: pair.publicKey(), expires: now + SESSION_MS };
  } finally {
    der.fill(0);
  }
}

// Null for another account, an expired or future-dated record, or a key that could be exported.
export function signerFromSession(stored: unknown, account: string, now = Date.now()): SessionSigner | null {
  const record = stored as Stored | undefined;
  if (!record || record.publicKey !== account || !Number.isSafeInteger(record.expires) || record.expires <= now ||
    record.expires > now + SESSION_MS || record.key?.type !== 'private' || record.key.extractable) return null;
  return { expires: record.expires, signer: { publicKey: account, sign: async bytes =>
    new Uint8Array(await crypto.subtle.sign('Ed25519', record.key, new Uint8Array(bytes))) } };
}

function run<T>(act: (store: IDBObjectStore) => IDBRequest<T>, create = false): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    // Sign-in and sign-out wait for this: a stuck database must not block them.
    let abandoned = false;
    let transaction: IDBTransaction | undefined;
    const timer = setTimeout(() => {
      abandoned = true;
      try { transaction?.abort(); } catch {}
      reject(new Error('session store timed out'));
    }, 3000);
    const open = indexedDB.open('vespi-session', 1);
    let missing = false;
    open.onupgradeneeded = () => {
      if (create && !abandoned) open.result.createObjectStore('keys');
      else {
        missing = true;
        open.transaction?.abort();
      }
    };
    open.onblocked = () => {
      abandoned = true;
      clearTimeout(timer);
      reject(new Error('session store unavailable'));
    };
    open.onerror = () => {
      clearTimeout(timer);
      if (missing) resolve(undefined);
      else reject(open.error ?? new Error('session store unavailable'));
    };
    open.onsuccess = () => {
      const db = open.result;
      if (abandoned) { db.close(); return; }
      db.onversionchange = () => db.close();
      try {
        const tx = transaction = db.transaction('keys', 'readwrite');
        const request = act(tx.objectStore('keys'));
        tx.oncomplete = () => { clearTimeout(timer); db.close(); resolve(request.result); };
        tx.onabort = () => { clearTimeout(timer); db.close(); reject(tx.error ?? new Error('session store aborted')); };
      } catch (error) {
        clearTimeout(timer);
        db.close();
        reject(error);
      }
    };
  });
}

export async function saveSession(pair: Keypair, at = Date.now()) {
  const stored = await sessionFromKeypair(pair, at);
  await run(store => store.put(stored, 'session'), true);
}

export async function loadSession(account: string): Promise<SessionSigner | null> {
  let found: SessionSigner | null = null;
  await run(store => {
    const read = store.get('session');
    read.onsuccess = () => {
      const stored = read.result as Stored | undefined;
      found = signerFromSession(stored, account);
      if (!found && stored?.publicKey === account) store.delete('session');
    };
    return read;
  });
  return found;
}

// With an account, only that account's session, checked and deleted in one transaction.
export async function clearSession(account?: string) {
  await run<unknown>(store => {
    if (!account) return store.delete('session') as IDBRequest<unknown>;
    const read: IDBRequest<unknown> = store.get('session');
    read.onsuccess = () => { if ((read.result as Stored | undefined)?.publicKey === account) store.delete('session'); };
    return read;
  });
}
