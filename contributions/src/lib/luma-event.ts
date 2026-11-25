import { focusClose, focusEvent, focusRoot, focusStart } from './contributions/focus-event';

const end = Date.parse(focusEvent.endsAt);
const changeEvent = 'vespi-luma-changed';

export function watchLumaChange(onChange: () => void) {
  window.addEventListener(changeEvent, onChange);
  return () => window.removeEventListener(changeEvent, onChange);
}

// Cached HTML follows both transitions before hydration.
export const lumaExpiryScript = `(()=>{
  const root = document.documentElement;
  let timer;
  function sync() {
    clearTimeout(timer);
    const now = Date.now();
    const phase = now < ${focusStart} ? 'before' : now < ${focusClose} ? 'open' : 'closed';
    const announcement = ${Boolean(focusRoot)} ? phase : now < ${end} ? 'before' : 'closed';
    if (root.dataset.focusPhase !== phase || root.dataset.lumaPhase !== announcement) {
      root.dataset.focusPhase = phase;
      root.dataset.lumaPhase = announcement;
      window.dispatchEvent(new Event('${changeEvent}'));
    }
    if (phase !== 'closed') {
      const next = phase === 'before' ? ${focusStart} : !${Boolean(focusRoot)} && now < ${end} ? ${end} : ${focusClose};
      timer = setTimeout(sync, Math.min(next - now, 2147483647));
    }
  }
  window.addEventListener('pageshow', sync);
  document.addEventListener('visibilitychange', sync);
  sync();
})();`;
