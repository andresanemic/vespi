import { contributionNetwork, DEFAULT_NETWORK } from './network';

export function photoUploadMessage(actor: string, sha256: string, expiresAt: number, network = DEFAULT_NETWORK): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(
    [`vespi:contribution-photo:v1:${contributionNetwork(network).id}`, actor, sha256, expiresAt],
  ));
}
