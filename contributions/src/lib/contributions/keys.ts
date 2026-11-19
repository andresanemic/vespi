import { Buffer } from 'buffer';
import { Keypair, type Transaction } from '@stellar/stellar-sdk/base';

// SHA-256 of "vespi-contributions/prf/v1".
export const PRF_SALT: Uint8Array = new Uint8Array([
  0x5c, 0xb3, 0x56, 0x0b, 0x49, 0x6a, 0xc2, 0x53,
  0x87, 0x78, 0xae, 0xef, 0x74, 0x2c, 0x51, 0x7a,
  0xa4, 0x77, 0x9a, 0xe8, 0xf8, 0xe5, 0xb0, 0xff,
  0x54, 0x9e, 0x68, 0x0d, 0x54, 0x4e, 0xb4, 0xe9,
]);

export async function deriveSeed(prfOutput: Uint8Array, rpId: string): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto (crypto.subtle) is unavailable.');
  }
  const key = await crypto.subtle.importKey('raw', new Uint8Array(prfOutput), 'HKDF', false, ['deriveBits']);
  const seed = await crypto.subtle.deriveBits({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode('vespi-contributions/v1'),
    info: new TextEncoder().encode(rpId),
  }, key, 256);
  return new Uint8Array(seed);
}

export async function keypairFromPrf(prfOutput: Uint8Array, rpId: string): Promise<Keypair> {
  return Keypair.fromRawEd25519Seed(Buffer.from(await deriveSeed(prfOutput, rpId)));
}

function passkeyPrf(extensions: AuthenticationExtensionsClientOutputs): Uint8Array | null {
  const first = extensions.prf?.results?.first;
  if (!first) return null;
  return ArrayBuffer.isView(first)
    ? new Uint8Array(first.buffer, first.byteOffset, first.byteLength).slice()
    : new Uint8Array(first);
}

function randomBytes() {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Web Crypto (crypto.getRandomValues) is unavailable.');
  }
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function createPasskey({ rpId, userName }: {
  rpId: string;
  userName: string;
}): Promise<{ credentialId: string; prf: Uint8Array | null; prfEnabled: boolean }> {
  if (typeof navigator === 'undefined' || typeof navigator.credentials?.create !== 'function') {
    throw new Error('WebAuthn (navigator.credentials.create) is unavailable.');
  }
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(),
      rp: { id: rpId, name: 'Vespi Contributions' },
      user: { id: randomBytes(), name: userName, displayName: userName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      attestation: 'none',
      extensions: { prf: { eval: { first: new Uint8Array(PRF_SALT) } } },
    },
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('WebAuthn did not create a passkey.');
  const extensions = credential.getClientExtensionResults();
  return {
    credentialId: credential.id,
    prf: passkeyPrf(extensions),
    prfEnabled: extensions.prf?.results !== undefined || extensions.prf?.enabled === true,
  };
}

export async function resolvePasskeyPrf({ rpId, created }: {
  rpId: string;
  created: Awaited<ReturnType<typeof createPasskey>>;
}): Promise<Uint8Array | null> {
  if (created.prf) return created.prf;
  return created.prfEnabled ? unlockPasskey({ rpId, credentialId: created.credentialId }) : null;
}

export async function unlockPasskey({ rpId, credentialId }: {
  rpId: string;
  credentialId?: string;
}): Promise<Uint8Array | null> {
  if (typeof navigator === 'undefined' || typeof navigator.credentials?.get !== 'function') {
    throw new Error('WebAuthn (navigator.credentials.get) is unavailable.');
  }
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(),
      rpId,
      userVerification: 'required',
      ...(credentialId === undefined ? {} : {
        allowCredentials: [{
          type: 'public-key',
          id: Uint8Array.from(atob(credentialId.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
        }],
      }),
      extensions: { prf: { eval: { first: new Uint8Array(PRF_SALT) } } },
    },
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('WebAuthn did not unlock a passkey.');
  return passkeyPrf(credential.getClientExtensionResults());
}

export type Signer = {
  publicKey: string;
  sign(hash: Uint8Array): Promise<Uint8Array>;
};

export function signerFromKeypair(kp: Keypair): Signer {
  return { publicKey: kp.publicKey(), sign: async (hash) => kp.sign(Buffer.from(hash)) };
}

export async function signTransaction(tx: Transaction, signer: Signer): Promise<void> {
  const signature = await signer.sign(tx.hash());
  tx.addSignature(signer.publicKey, Buffer.from(signature).toString('base64'));
}

export function isEmbeddedBrowser(userAgent: string): boolean {
  return /WhatsApp|Instagram|FBAN|FBAV/i.test(userAgent);
}
