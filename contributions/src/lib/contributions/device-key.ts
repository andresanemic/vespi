import { Buffer } from 'buffer';
import { StrKey } from '@stellar/stellar-sdk/base';
import type { Signer } from './keys';

function openKeyDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is unavailable; the device key cannot be stored or loaded.');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto (crypto.subtle) is unavailable.');
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('vespi-contributions', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('keys');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      request.onsuccess = () => request.result.close();
      reject(new Error('Opening the device key database is blocked by another tab.'));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

async function signerFromDeviceKey(pair: CryptoKeyPair): Promise<Signer> {
  const publicKey = StrKey.encodeEd25519PublicKey(Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)));
  return {
    publicKey,
    sign: async (hash) => new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, new Uint8Array(hash))),
  };
}

function readDeviceKey(db: IDBDatabase): Promise<CryptoKeyPair | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readonly');
    const request = tx.objectStore('keys').get('device');
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? new Error('Loading the device key was aborted.'));
  });
}

export async function createDeviceKey(): Promise<Signer> {
  const db = await openKeyDatabase();
  try {
    if (await readDeviceKey(db)) {
      throw new Error('contributions: a device key already exists');
    }
    const pair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotSupportedError') {
        throw new Error('contributions: this browser does not support Ed25519 device keys');
      }
      throw error;
    });
    const signer = await signerFromDeviceKey(pair);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Saving the device key was aborted.'));
      // add preserves an existing participant identity instead of silently replacing it.
      tx.objectStore('keys').add(pair, 'device');
    });
    return signer;
  } finally {
    db.close();
  }
}

export async function loadDeviceKey(): Promise<Signer | null> {
  const db = await openKeyDatabase();
  try {
    const pair = await readDeviceKey(db);
    return pair ? await signerFromDeviceKey(pair) : null;
  } finally {
    db.close();
  }
}
