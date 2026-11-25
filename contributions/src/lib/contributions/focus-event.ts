export const focusRoot: string | null = '4fdda44d19479e678d9525ec56e10e718bcd620f2f403883debdc2fa93003e77';

export const focusEvent = {
  startsAt: '2026-11-25T19:00:00Z',
  endsAt: '2026-11-25T20:00:00Z',
  attendanceClosesAt: '2026-11-26T23:00:00Z',
  path: '/app/evento/focus-group',
  url: 'https://luma.com/mt0nzpct',
  copy: {
    es: {
      title: 'Aportar en Stellar: ¿se ve, se valora, se recompensa?',
      date: 'Conversación en línea · miércoles 25 de noviembre, 16:00 (hora de Chile)',
      schedule: 'En línea, en español · miércoles 25 de noviembre de 2026, 16:00–17:00 (hora de Chile)',
      action: 'Reservar mi lugar',
      attend: 'Firmar que asistí',
      details: 'Ver el evento',
    },
    en: {
      title: 'Contributing to Stellar: is it seen, valued, rewarded?',
      date: 'Online conversation in Spanish · Wednesday, November 25, 16:00 Chile time (19:00 UTC)',
      schedule: 'Online, in Spanish · Wednesday, November 25, 2026, 16:00–17:00 Chile time (19:00–20:00 UTC)',
      action: 'Save my spot',
      attend: 'Sign that I attended',
      details: 'View the event',
    },
  },
} as const;

export const focusRegistration = `Organizo el focus group en línea «${focusEvent.copy.es.title}», 25 de noviembre de 2026. Quienes asistan pueden firmar que estuvieron.`;
export const focusAttendance = {
  es: `Asistí al focus group «${focusEvent.copy.es.title}».`,
  en: `I attended the focus group “${focusEvent.copy.en.title}”.`,
};

export function isFocusRegistration(statement: string, digest: string) {
  return focusRoot ? digest === focusRoot : statement === focusRegistration;
}

export function focusAttendanceSlot(root: string, account: string) {
  return `focus-attendance:${root}:${account}`;
}

export function focusSignPath(root: string, lang: string) {
  return `/app?observe=${root}&evento=focus-group&lang=${lang}`;
}

export const focusStart = Date.parse(focusEvent.startsAt);
export const focusClose = Date.parse(focusEvent.attendanceClosesAt);

export function focusPhase(now: number) {
  return now < focusStart ? 'before' : now < focusClose ? 'open' : 'closed';
}
