'use client';

import { useEffect, useRef } from 'react';
import { createMeridianBackend, readMeridianEntry, type MeridianEntry } from './meridian-backend';
import { mountMeridian } from './meridian-templates';
import { setVespiTheme } from '@/components/ThemeSwitch';
import '../app-brand.css';
import './meridian-entry.css';

export default function MeridianFront({ entry }: { entry: MeridianEntry }) {
  const host = useRef<HTMLDivElement>(null);
  const playedEntrance = useRef(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
    const theme = new URL(location.href).searchParams.get('theme');
    if (theme === 'dark' || theme === 'light') setVespiTheme(theme);
    const syncTheme = () => { element.dataset.theme = document.documentElement.dataset.theme ?? 'light'; };
    syncTheme();
    window.addEventListener('vespi-theme-change', syncTheme);
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = '/meridian-front.css';
    const root = document.createElement('div');
    root.className = 'meridian-body';
    root.hidden = true;
    const surface = document.createElement('div');
    surface.id = 'app';
    root.append(surface);
    const backend = createMeridianBackend();
    const update = mountMeridian(root, backend, entry, setVespiTheme);
    style.onload = () => {
      root.hidden = false;
      element.dataset.ready = 'true';
      const garden = root.querySelector('.home-garden');
      if (garden && !playedEntrance.current && matchMedia('(min-width: 901px) and (prefers-reduced-motion: no-preference)').matches) {
        playedEntrance.current = true;
        garden.animate([{ clipPath: 'inset(0 0 0 45%)' }, { clipPath: 'inset(0)' }],
          { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' });
      }
    };
    style.onerror = () => { element.dataset.ready = 'error'; };
    shadow.replaceChildren(style, root);
    const back = () => update(readMeridianEntry());
    addEventListener('popstate', back);
    return () => {
      removeEventListener('popstate', back);
      window.removeEventListener('vespi-theme-change', syncTheme);
      delete element.dataset.ready;
      style.onload = null;
      style.onerror = null;
      shadow.replaceChildren();
    };
  }, [entry]);

  return <>
    <link rel="preload" as="style" href="/meridian-front.css" />
    <div id="meridian-reference" ref={host} />
    <div className="meridian-entry" aria-hidden="true">
      <span className="contributions-wordmark"><span>Contributions</span></span>
    </div>
    <button className="meridian-entry-retry" onClick={() => location.reload()}>Volver a cargar / Reload</button>
  </>;
}
