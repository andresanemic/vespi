export const SITE_NAME = 'Vespi';
export const DEFAULT_TITLE = 'Vespi Contributions | Good work deserves a record';
export const DEFAULT_DESCRIPTION = 'Two people record help that already happened, each signs their own step and the receipt’s fingerprint goes on Stellar. Live on Stellar testnet during Stellar Chile Instawards.';
import { REPO, PROOF } from './corte';
export { REPO };
export const RELEASE = `${REPO}/tree/v0.1.8-kernel`;
export const JUDGES = PROOF.judges;

// La URL absoluta del sitio. El dominio es vespi.xyz, y se puede sobreescribir con
// `NEXT_PUBLIC_SITE_URL` al desplegar: una canonica apuntando a un dominio que no es el
// real es peor que no tener canonica, porque le dice al buscador que indexe otro sitio.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vespi.xyz';

export const seo = (lang: 'en' | 'es') => ({
  SITE_NAME: 'Vespi',
  DEFAULT_TITLE: lang === 'en' ? 'Vespi Contributions | Good work deserves a record' : 'Vespi Contributions | Un buen aporte merece un registro',
  DEFAULT_DESCRIPTION: lang === 'en'
    ? 'Two people record help that already happened, each signs their own step and the receipt’s fingerprint goes on Stellar. Live on Stellar testnet during Stellar Chile Instawards.'
    : 'Dos personas registran una ayuda que ya ocurrió, cada una firma su paso y la huella del recibo queda en Stellar. Funcionando en Stellar testnet durante Stellar Chile Instawards.',
  REPO,
  RELEASE,
  JUDGES
});