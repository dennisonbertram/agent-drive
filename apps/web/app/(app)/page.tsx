import Link from 'next/link';
import { headers } from 'next/headers';
import { CopyButton } from './copy-button';

const command = 'agent-drive put ./handoff.md /memory/handoff.md';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'agent-drive.vercel.app';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const instruction = `Set up Agent Drive: ${proto}://${host}/llms.txt`;
  return (
    <main className="landing">
      <header className="landing-nav">
        <Link href="/" className="brand">
          <span className="brand-mark">a/</span> agent drive
        </Link>
        <nav className="actions" aria-label="Main">
          <Link className="button secondary" href="/pricing">
            Pricing
          </Link>
          <Link className="button secondary" href="/sign-in">
            Sign in
          </Link>
        </nav>
      </header>
      <section className="hero">
        <p className="eyebrow">A WORKSPACE THAT OUTLIVES THE SESSION</p>
        <h1>
          Your agents.
          <br />
          Their own drive.
        </h1>
        <p className="hero-copy">
          Give your agents a place to keep their memory, share their work, and pick up where they
          left off. Encrypted before it leaves their machine.
        </p>
        <div className="agent-give">
          <p className="agent-give-label">Give this to your agent</p>
          <div className="terminal-command">
            <code>{instruction}</code>
            <CopyButton text={instruction} label="Copy agent instruction" />
          </div>
        </div>
        <p className="agent-works">Works with Claude Code, Codex, Cursor, and any MCP client.</p>
        <h2 className="agent-steps-title">How connecting works</h2>
        <ol className="agent-steps">
          <li>
            <span>1</span> Your agent installs the CLI and asks to connect.
          </li>
          <li>
            <span>2</span> You approve it in your browser.
          </li>
          <li>
            <span>3</span> It gets its own scoped key and can save, share, and back up files.
          </li>
        </ol>
        <div className="actions">
          <Link className="button secondary" href="/sign-up">
            Create your workspace <span aria-hidden>↗</span>
          </Link>
          <Link className="button secondary" href="/console">
            Open console
          </Link>
        </div>
        <div className="terminal-preview">
          <div className="terminal-label">
            <span className="status-dot" /> FROM A SESSION TO SOMETHING LASTING
          </div>
          <div className="terminal-command">
            <code>
              <span>$</span> {command}
            </code>
            <CopyButton text={command} />
          </div>
          <p>A fresh session. The same context.</p>
        </div>
      </section>
      <section className="feature-grid" aria-label="Features">
        <article>
          <span className="feature-number">01 / PRIVATE BY DESIGN</span>
          <h2>You hold the keys.</h2>
          <p>
            File contents encrypt on your device. The storage service receives ciphertext, never
            your drive key. File names, sizes, tags, and activity stay visible to the service so it
            can list and bill them.
          </p>
        </article>
        <article>
          <span className="feature-number">02 / BUILT FOR AGENTS</span>
          <h2>Less setup. More doing.</h2>
          <p>A CLI, typed client, and MCP tools fit the way your agents already work.</p>
        </article>
        <article>
          <span className="feature-number">03 / HUMAN OVERSIGHT</span>
          <h2>A clear view of the work.</h2>
          <p>Browse files, recover versions, and decide which agents can access each drive.</p>
        </article>
      </section>
      <footer className="landing-footer">
        AGENT DRIVE <span>Persistent storage. Independent agents.</span>
      </footer>
    </main>
  );
}
