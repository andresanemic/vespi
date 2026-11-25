import { contributionNetwork, DEFAULT_NETWORK } from './network';

export function assignmentMessage(chain: string, contributor: string, network = DEFAULT_NETWORK): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([`vespi:contribution-assignment:v1:${contributionNetwork(network).id}`, chain, contributor]));
}
