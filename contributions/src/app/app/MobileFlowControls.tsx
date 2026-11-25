import { useId, useRef, type ComponentProps } from 'react';
import type { Lang } from '@/lib/i18n';
import type { ContributionNetwork } from '@/lib/contributions/network';

export function MobileNetworkControl({ lang, network, choose, busy, showTestnet }: {
  lang: Lang;
  network: ContributionNetwork;
  choose?: (next: ContributionNetwork) => void;
  busy?: boolean;
  showTestnet: boolean;
}) {
  const sheet = useRef<HTMLDialogElement>(null);
  const title = useId();
  const mainnet = network === 'mainnet';
  if (!mainnet && !showTestnet && !choose) return null;
  const label = mainnet ? 'Mainnet' : 'Testnet';
  const indicator = <>{mainnet && <span className="mobile-network-dot" aria-hidden="true" />}{label}</>;
  return <div className="mobile-network" data-mainnet={mainnet || undefined}>
    {choose ? <>
      <button className="mobile-network-label" type="button" aria-haspopup="dialog" disabled={busy}
        aria-label={label + (lang === 'es' ? ', cambiar red' : ', change network')} onClick={() => {
          const dialog = sheet.current;
          dialog?.querySelector('form')?.reset();
          dialog?.showModal();
          dialog?.querySelector<HTMLInputElement>(':checked')?.focus();
        }}>
        {indicator}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      <dialog className="mobile-bottom-sheet" ref={sheet} aria-labelledby={title}>
        <h2 id={title}>{lang === 'es' ? 'Red de Stellar' : 'Stellar network'}</h2>
        <form onSubmit={event => {
          event.preventDefault();
          const next = new FormData(event.currentTarget).get('network');
          sheet.current?.close();
          if (next === 'mainnet' || next === 'testnet') choose(next);
        }}>
          <fieldset className="mobile-network-options" aria-labelledby={title}>
          {(['testnet', 'mainnet'] as const).map(next => <label key={next}>
            <input type="radio" name="network" value={next} defaultChecked={next === network} />
            {next === 'mainnet' ? 'Mainnet' : 'Testnet'}
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </label>)}
          </fieldset>
          <button className="mobile-action">{lang === 'es' ? 'Continuar' : 'Continue'}</button>
          <button type="button" className="mobile-text-action" onClick={() => sheet.current?.close()}>
            {lang === 'es' ? 'Cancelar' : 'Cancel'}
          </button>
        </form>
      </dialog>
    </> : <span className="mobile-network-label">{indicator}</span>}
  </div>;
}

export function SigningButton({ lang, label, prompt = true, ...props }: ComponentProps<'button'> & {
  lang: Lang;
  label: string;
  prompt?: boolean;
}) {
  const hint = useId();
  return <button className="mobile-action" {...props} aria-label={label} aria-describedby={prompt ? hint : undefined}>
    {label}{prompt && <span id={hint} className="mobile-passkey-hint">{lang === 'es' ? 'Puede pedir tu passkey' : 'May ask for your passkey'}</span>}
  </button>;
}
