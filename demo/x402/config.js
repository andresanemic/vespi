import { StrKey } from '@stellar/stellar-sdk';

function isValidPublicKey(value) {
  return typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
}

function requirePublicKey(value, label = 'payTo') {
  if (!isValidPublicKey(value)) throw new Error(`${label} must be a valid Stellar G... public key`);
  return value;
}

export { isValidPublicKey, requirePublicKey };
