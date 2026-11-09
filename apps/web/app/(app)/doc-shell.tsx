import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteHeader } from '../site-header';
import '../styles/docs.css';

/** Frame shared by /docs and /compare pages. Public: it never reads the session. */
export function DocShell({
  eyebrow,
  title,
  mdHref,
  sidebar,
  children,
}: {
  eyebrow: string;
  title: string;
  mdHref: string;
  /** Docs navigation. Absent on compare and legal pages. */
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <div className={sidebar ? 'doc-page doc-page-side' : 'doc-page'}>
        {sidebar}
        <main>
          <header className="doc-heading">
            <p className="doc-eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p className="doc-md">
              <a href={mdHref}>View as Markdown</a>
            </p>
          </header>
          {children}
        </main>
        <footer className="doc-footer">
          <Link href="/">AGENT DRIVE</Link>
          <nav aria-label="Footer">
            <Link href="/docs">Docs</Link>
            <Link href="/compare">Compare</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
        </footer>
      </div>
    </>
  );
}
