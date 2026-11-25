import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';
import { Keypair, StrKey } from '@stellar/stellar-sdk/base';
import { contributionNetwork, DEFAULT_NETWORK } from './network';
import { photoUploadMessage } from './photo-authorization';

const MAX_BYTES = 2 * 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;
const EVENT_ORIGIN = 'https://vespi.xyz';

export function photoUri(digest: string, network = DEFAULT_NETWORK) {
  const segment = contributionNetwork(network).segment;
  return `${EVENT_ORIGIN}/api/contributions/photos/${digest}${network === DEFAULT_NETWORK ? '' : `?network=${segment}`}`;
}

export function photoPath(actor: string, digest: string, network = DEFAULT_NETWORK) {
  return `contributions/${contributionNetwork(network).segment}/photos/${actor}/${digest}`;
}

function digestOf(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function imageType(bytes: Buffer) {
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function createPhotoStore({ fetchBlob = get, putBlob = put } = {}, network = DEFAULT_NETWORK) {
  async function read(actor: string, digest: string) {
    if (!StrKey.isValidEd25519PublicKey(actor) || !DIGEST.test(digest)) return null;
    const result = await fetchBlob(photoPath(actor, digest, network), {
      access: 'private', useCache: false, abortSignal: AbortSignal.timeout(8000),
    });
    if (result?.statusCode !== 200) return null;
    if (result.blob.size > MAX_BYTES) {
      await result.stream.cancel();
      return null;
    }
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    const contentType = imageType(bytes);
    if (bytes.length > MAX_BYTES || !contentType || result.blob.contentType !== contentType || digestOf(bytes) !== digest) {
      return null;
    }
    return { bytes, contentType };
  }

  return {
    read,
    async save(actor: string, digest: string, bytes: Buffer, contentType: string) {
      try {
        await putBlob(photoPath(actor, digest, network), bytes, {
          access: 'private', contentType, allowOverwrite: false, abortSignal: AbortSignal.timeout(8000),
        });
      } catch (error) {
        if (!await read(actor, digest)) throw error;
      }
    },
  };
}

export function createPhotoUpload(ports: {
  save: ReturnType<typeof createPhotoStore>['save'];
  reserve(actor: string, digest: string, bytes: number): Promise<boolean>;
  accountExists(actor: string): Promise<boolean>;
}, now = () => Date.now(), network = DEFAULT_NETWORK) {
  return async (body: Record<string, unknown>) => {
    const { actor, sha256, expiresAt, signature, base64 } = body;
    const seconds = Math.floor(now() / 1000);
    if (typeof actor !== 'string' || !StrKey.isValidEd25519PublicKey(actor) || typeof sha256 !== 'string' ||
      !DIGEST.test(sha256) || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) ||
      expiresAt <= seconds || expiresAt > seconds + 300 || typeof signature !== 'string' ||
      !/^[a-f0-9]{128}$/.test(signature) || typeof base64 !== 'string' ||
      base64.length > Math.ceil(MAX_BYTES / 3) * 4) {
      return { ok: false, reason: 'invalid-photo' } as const;
    }
    if (!Keypair.fromPublicKey(actor).verify(Buffer.from(photoUploadMessage(actor, sha256, expiresAt, network)),
      Buffer.from(signature, 'hex'))) return { ok: false, reason: 'photo-signature-required' } as const;
    const bytes = Buffer.from(base64, 'base64');
    const contentType = imageType(bytes);
    if (bytes.length > MAX_BYTES || bytes.toString('base64') !== base64 || !contentType || digestOf(bytes) !== sha256) {
      return { ok: false, reason: 'invalid-photo' } as const;
    }

    try {
      if (!await ports.accountExists(actor)) return { ok: false, reason: 'photo-account-required' } as const;
      if (!await ports.reserve(actor, sha256, bytes.length)) return { ok: false, reason: 'photo-quota' } as const;
      await ports.save(actor, sha256, bytes, contentType);
      return { ok: true, evidence: { uri: photoUri(sha256, network), sha256 } } as const;
    } catch {
      return { ok: false, reason: 'photo-unavailable' } as const;
    }
  };
}
