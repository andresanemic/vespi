import { Keypair } from '@stellar/stellar-sdk/base';

export function verifiesEncounterSignature(account: string, payload: Uint8Array, signature: unknown): signature is string {
  return typeof signature === 'string' && /^[a-f0-9]{128}$/.test(signature) &&
    Keypair.fromPublicKey(account).verify(Buffer.from(payload), Buffer.from(signature, 'hex'));
}
