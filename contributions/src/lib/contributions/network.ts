import { Networks } from '@stellar/stellar-sdk/base';

export type ContributionNetwork = 'testnet' | 'mainnet';
export const DEFAULT_NETWORK: ContributionNetwork = 'testnet';

const networks = {
  testnet: {
    passphrase: Networks.TESTNET,
    horizon: 'https://horizon-testnet.stellar.org',
    id: 'stellar:testnet',
    segment: 'testnet',
    explorer: 'https://stellar.expert/explorer/testnet',
  },
  mainnet: {
    passphrase: Networks.PUBLIC,
    horizon: 'https://horizon.stellar.org',
    id: 'stellar:pubnet',
    segment: 'mainnet',
    explorer: 'https://stellar.expert/explorer/public',
  },
} as const;

export function parseContributionNetwork(value: unknown): ContributionNetwork {
  if (value === 'testnet' || value === 'mainnet') return value;
  throw new Error('invalid-network');
}

export function contributionNetwork(network: ContributionNetwork = DEFAULT_NETWORK) {
  return networks[parseContributionNetwork(network)];
}

export function contributionRedisPrefix(network: ContributionNetwork) {
  return `contributions:${contributionNetwork(network).segment}`;
}
