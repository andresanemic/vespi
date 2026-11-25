import type { Metadata } from 'next';
import './globals.css';
import { lumaExpiryScript } from '@/lib/luma-event';

export const metadata: Metadata = {
  title: 'Vespi Contributions',
  description: 'Record a collaboration and share it for confirmation on Stellar.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-theme="light" suppressHydrationWarning><head>
    <script dangerouslySetInnerHTML={{__html:"try{var t=localStorage.getItem('vespi-theme');document.documentElement.dataset.theme=t==='dark'||t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var q=new URLSearchParams(location.search).get('lang');if(q==='es'||q==='en')localStorage.setItem('vespi-lang',q);var g=localStorage.getItem('vespi-lang');document.documentElement.lang=g==='es'||g!=='en'&&/^es\\b/i.test(navigator.languages?.[0]||navigator.language)?'es':'en';}catch(e){}"}} />
    <script dangerouslySetInnerHTML={{__html:lumaExpiryScript}} />
    <script dangerouslySetInnerHTML={{__html:"history.scrollRestoration='manual';if(performance.getEntriesByType('navigation')[0]?.type==='reload'){var h=new URLSearchParams(location.hash.slice(1));if(!h.has('invitation')&&!h.has('assignment'))history.replaceState(null,'',location.pathname+location.search);window.scrollTo(0,0);}"}} />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,SOFT,WONK,wght@9..144,100,1,900&family=IBM+Plex+Sans:wght@400;450;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  </head><body>{children}</body></html>;
}
