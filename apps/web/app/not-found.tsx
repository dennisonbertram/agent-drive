import Link from 'next/link';
import { SiteHeader } from './site-header';
import './styles/docs.css';

export const metadata = { title: 'Page not found | Agent Drive' };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <div className="doc-page">
        <main>
          <header className="doc-heading">
            <p className="doc-eyebrow">404</p>
            <h1>Page not found</h1>
          </header>
          <article className="doc-prose">
            <p>That page does not exist or has moved.</p>
            <p>
              <Link href="/">Home</Link> · <Link href="/docs">Docs</Link>
            </p>
          </article>
        </main>
        <footer className="doc-footer">
          <Link href="/">AGENT DRIVE</Link>
          <nav aria-label="Footer">
            <Link href="/docs">Docs</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href="mailto:support@agentdrive.xyz">Contact</a>
          </nav>
        </footer>
      </div>
    </>
  );
}
