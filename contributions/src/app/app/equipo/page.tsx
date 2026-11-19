import type { Metadata } from 'next';
import TeamSurvey from './TeamSurvey';
import '../mobile.css';
import './team.css';

export const metadata: Metadata = {
  title: 'Encuesta del equipo · Vespi Contributions',
  robots: { index: false, follow: false },
  alternates: { canonical: '/app/equipo' },
};

export default function TeamSurveyPage() {
  return <TeamSurvey />;
}
