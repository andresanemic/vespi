import './app-brand.css';

export default function AppBrand() {
  // A full navigation lets the app initialize its shadow stylesheet before revealing its controls.
  // eslint-disable-next-line @next/next/no-html-link-for-pages
  return <a href="/app" className="mobile-brand" aria-label="Vespi Contributions">
    <span className="contributions-wordmark" aria-hidden="true"><span>Contributions</span></span>
  </a>;
}
