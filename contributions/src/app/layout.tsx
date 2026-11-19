import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vespi Contributions',
  description: 'Record a collaboration and share it for confirmation on Stellar testnet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-theme="light" suppressHydrationWarning><head>
    <script dangerouslySetInnerHTML={{__html:"try{var t=localStorage.getItem('vespi-theme');document.documentElement.dataset.theme=t==='dark'||t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var g=localStorage.getItem('vespi-lang');document.documentElement.lang=g==='es'||g!=='en'&&/^es\\b/i.test(navigator.languages?.[0]||navigator.language)?'es':'en';}catch(e){}"}} />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,SOFT,WONK,wght@9..144,100,1,900&family=IBM+Plex+Sans:wght@400;450;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  </head><body>{children}</body></html>;
}
