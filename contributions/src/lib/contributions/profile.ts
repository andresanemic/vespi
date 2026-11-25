import { Keypair, StrKey } from '@stellar/stellar-sdk/base';
import { DEFAULT_NETWORK } from './network';
import { profileMessage } from './profile-authorization';

export function createProfile(deps: { exists(account: string): Promise<boolean>; create(account: string, name: string): Promise<'created' | 'same' | 'exists'> }, now = () => Date.now(), network = DEFAULT_NETWORK) {
  return async (body: Record<string, unknown>) => {
    const { account, displayName, expiresAt, signature } = body;
    const seconds = Math.floor(now() / 1000);
    if (typeof account !== 'string' || !StrKey.isValidEd25519PublicKey(account) ||
      typeof displayName !== 'string' || displayName !== displayName.trim() ||
      [...displayName].length < 1 || [...displayName].length > 40 || /[\p{Cc}\p{Cf}]/u.test(displayName) ||
      typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= seconds || expiresAt > seconds + 300 ||
      typeof signature !== 'string' || !/^[a-f0-9]{128}$/.test(signature)) return { ok: false, reason: 'invalid-profile' } as const;
    if (!Keypair.fromPublicKey(account).verify(Buffer.from(profileMessage(account, displayName, expiresAt, network)), Buffer.from(signature, 'hex')))
      return { ok: false, reason: 'profile-signature-required' } as const;
    try {
      if (!await deps.exists(account)) return { ok: false, reason: 'profile-account-required' } as const;
      if (expiresAt <= Math.floor(now() / 1000)) return { ok: false, reason: 'invalid-profile' } as const;
      const result = await deps.create(account, displayName);
      if (result === 'exists') return { ok: false, reason: 'profile-exists' } as const;
      return { ok: true, created: result === 'created' } as const;
    } catch { return { ok: false, reason: 'profile-unavailable' } as const; }
  };
}
