import { Head, Html, Main, NextScript } from 'next/document';

// Mirror the theme, fonts, icons and language behavior of src/app/layout.tsx.
// The public record and chain result use Pages Router to return a 503 on storage failure.
export default function Document() {
  return <Html lang="es" data-theme="light">
    <Head>
      <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('vespi-theme');document.documentElement.dataset.theme=t==='dark'||t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var q=new URLSearchParams(location.search).get('lang');if(q==='es'||q==='en')localStorage.setItem('vespi-lang',q);document.documentElement.lang=q==='en'?'en':'es';}catch(e){}" }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,SOFT,WONK,wght@9..144,100,1,900&family=IBM+Plex+Sans:wght@400;450;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      <link rel="icon" href="/favicon-dark.png" type="image/png" media="(prefers-color-scheme: light)" />
      <link rel="icon" href="/favicon-white.png" type="image/png" media="(prefers-color-scheme: dark)" />
      <link rel="apple-touch-icon" href="/apple-icon.png" />
      <meta name="theme-color" content="#0D0C0A" />
    </Head>
    <body><Main /><NextScript /></body>
  </Html>;
}
