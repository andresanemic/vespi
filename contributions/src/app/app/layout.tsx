import type { ReactNode } from 'react';
import './app-viewport.css';

export default function ContributionsLayout({ children }: { children: ReactNode }) {
  return <div id="contributions-app">{children}</div>;
}
