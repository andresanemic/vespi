import { contributionNetwork, DEFAULT_NETWORK } from './network';

export function profileMessage(account: string, displayName: string, expiresAt: number, network = DEFAULT_NETWORK) {
  return new TextEncoder().encode(JSON.stringify([`vespi:contribution-profile:v1:${contributionNetwork(network).id}`, account, displayName, expiresAt]));
}
