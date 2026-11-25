import type { AppProps } from 'next/app';
import '@/app/globals.css';
import '@/app/app/app-viewport.css';
import '@/app/app/app-brand.css';
import '@/app/app/mobile.css';
import './app/cadena/chain-result.css';

export default function PagesApp({ Component, pageProps }: AppProps) {
  return <div id="contributions-app"><Component {...pageProps} /></div>;
}
