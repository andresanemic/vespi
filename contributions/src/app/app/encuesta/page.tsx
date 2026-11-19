import type { Metadata } from 'next';
import { surveySigningDeadline } from '@/lib/contributions/survey-intake';
import MobileContributions from '../MobileContributions';
import '../mobile.css';
import './survey.css';

export const metadata: Metadata = {
  title: 'Encuesta del evento · Vespi Contributions',
  robots: { index: false, follow: true },
  alternates: { canonical: '/app/encuesta' },
};

export const dynamic = 'force-dynamic';

export default async function SurveyPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  const cutoff = Date.parse(process.env.CONTRIB_EVENT_CUTOFF ?? '');
  // This dynamic server route uses request time, matching the survey intake.
  // eslint-disable-next-line react-hooks/purity
  const rehearsal = !Number.isFinite(cutoff) || Date.now() < cutoff;
  const deadline = surveySigningDeadline(process.env.CONTRIB_SURVEY_CLOSES_AT);
  return <MobileContributions survey={rehearsal ? 'rehearsal' : 'event'}
    initialLang={lang === 'en' ? 'en' : undefined}
    surveyDeadline={rehearsal || deadline === Infinity ? undefined : Number.isFinite(deadline) ? deadline : null} />;
}
