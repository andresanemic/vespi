import { StrKey } from '@stellar/stellar-sdk/base';

export const yerkoSlides = '/contributions/las-tres-fronteras-yerko-pincheira-58271dc7.pdf';
export const yerkoSlidesSha256 = '58271dc7e01a3f74b1a7f0f1722e12368df047bca2719add161d9d17ab061688';
export const yerkoSlidesReference = 'https://vespi.xyz' + yerkoSlides + ' · SHA-256 ' + yerkoSlidesSha256;

export function readYerkoSettings(env: Record<string, string | undefined>) {
  const { CONTRIB_YERKO_ROOT: root, CONTRIB_YERKO_ACCOUNT: account } = env;
  if (!root || !/^[a-f0-9]{64}$/.test(root)) return;
  return { root, account: account && StrKey.isValidEd25519PublicKey(account) ? account : '',
    closed: env.CONTRIB_YERKO_CLOSED === '1' };
}
