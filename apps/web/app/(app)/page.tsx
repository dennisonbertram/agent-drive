import Link from 'next/link';
import { headers } from 'next/headers';
import { CopyButton } from './copy-button';
import '../styles/landing.css';

export const dynamic = 'force-dynamic';

// Deterministic activity bars so the server and client render the same markup.
const spark = (k: number) => Array.from({ length: 16 }, (_, i) => 18 + ((i * 37 + k * 53) % 64));

const sleds = [
  { name: 'trace-bot', on: [0, 1], size: '54.3', unit: 'KB', paths: '/memory /outputs', files: 2 },
  { name: 'nightly-evals', on: [2, 3], size: '2.4', unit: 'MB', paths: '/work /handoff', files: 2 },
  { name: 'research-agent', on: [0, 2], size: '118', unit: 'KB', paths: '/memory /work', files: 5 },
];
const markers: Record<number, React.ReactNode> = {
  0: (
    <>
      <span className="rk-mk" style={{ left: -9, top: '46%' }}>
        1
      </span>
      <span className="rk-mk below" style={{ left: 6 }}>
        2
      </span>
    </>
  ),
  2: (
    <span className="rk-mk below" style={{ right: 22 }}>
      4
    </span>
  ),
};

export default async function Home() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'agentdrive.xyz';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const instruction = `Set up Agent Drive: ${proto}://${host}/llms.txt`;
  const install = `npm install -g ${proto}://${host}/cli/agent-drive.tgz`;
  return (
    <main className="landing">
      <header className="landing-nav">
        <Link href="/" className="landing-brand">
          <span className="landing-logo" aria-hidden /> Agent Drive
        </Link>
        <nav className="landing-links" aria-label="Main">
          <Link href="/pricing">Pricing</Link>
          <a href="/llms.txt">llms.txt</a>
          <Link href="/sign-in">Sign in</Link>
          <Link className="landing-btn" href="/console">
            Open console
          </Link>
        </nav>
      </header>
      <section className="hero">
        <div className="landing-grid">
          <div className="hero-copy">
            <p className="hero-eyebrow">
              <i /> Portable storage for AI agents
            </p>
            <h1>Every agent gets a drive.</h1>
            <p className="hero-sub">
              The same files follow it to any machine, sandbox or new session.
            </p>
            <div className="setup-rows">
              <div className="setup-row">
                <div className="setup-head">
                  <span className="landing-tag">
                    <b>01</b> &nbsp;Paste into your agent
                  </span>
                  <CopyButton
                    text={instruction}
                    label="Copy agent instruction"
                    caption="Copy for your agent"
                    className="landing-btn sig sm"
                  />
                </div>
                <code>{instruction}</code>
              </div>
              <div className="setup-row">
                <div className="setup-head">
                  <span className="landing-tag">
                    <b>02</b> &nbsp;Or install the CLI
                  </span>
                  <CopyButton text={install} className="landing-btn out sm" />
                </div>
                <code>
                  <span className="setup-prompt">$ </span>
                  {install}
                </code>
              </div>
            </div>
            <p className="hero-works">
              <span className="landing-tag">Works with</span>
              <b>Claude Code</b>
              <b>Codex</b>
              <b>Cursor</b>
              <b>any MCP client</b>
            </p>
            <p className="hero-fine">Encrypted on the agent&apos;s machine.</p>
            <div className="landing-actions">
              <Link className="landing-btn out" href="/sign-up">
                Create your workspace <span aria-hidden>↗</span>
              </Link>
              <Link className="landing-btn out" href="/pricing">
                Pricing
              </Link>
            </div>
          </div>
          <div className="hero-rack">
            <div
              className="rack"
              role="img"
              aria-label="A rack unit with four drive bays: trace-bot, nightly-evals and research-agent drives, and one empty bay for your next agent"
            >
              <div className="rk-ear">
                <i className="rk-slot" />
                <i className="rk-slot" />
              </div>
              <div className="rk-face">
                <div className="rk-fh">
                  <span className="landing-tag ink">Agent Drive · AD-4</span>
                  <i className="rk-vent" />
                  <span className="landing-tag ink">4 bays</span>
                  <span className="rk-led dim" />
                </div>
                <div className="rk-bays">
                  {sleds.map((s, k) => (
                    <div className="rk-bay" key={s.name}>
                      {markers[k]}
                      <div className={`rk-sled s${k}`}>
                        <div className="rk-lab">{s.name}</div>
                        <div className="rk-win">
                          <div>
                            <div className="rk-seg">
                              {[0, 1, 2, 3].map((i) => (
                                <i key={i} className={s.on.includes(i) ? 'on' : ''} />
                              ))}
                            </div>
                            <div className="rk-segl">
                              <span>MEM</span>
                              <span>OUT</span>
                              <span>WRK</span>
                              <span>HND</span>
                            </div>
                          </div>
                          <div className="rk-spark">
                            {spark(k).map((v, i) => (
                              <i key={i} style={{ height: `${v}%` }} />
                            ))}
                          </div>
                          <div>
                            <div className="rk-rd">
                              {s.size}
                              <small>{s.unit}</small>
                            </div>
                            <div className="rk-parts">
                              <span>{s.paths}</span>
                              <span>{s.files} files</span>
                            </div>
                          </div>
                        </div>
                        <div className="rk-sf">
                          <span className="rk-led dim" />
                          <i className="rk-pull" />
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="rk-bay">
                    <span className="rk-mk" style={{ right: -9, top: -9 }}>
                      3
                    </span>
                    <div className="rk-sled empty">
                      <div className="rk-ghost">
                        <span className="plus">+</span>
                        <span className="landing-tag">
                          your next
                          <br />
                          agent
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rk-ear">
                <i className="rk-slot" />
                <i className="rk-slot" />
              </div>
            </div>
            <ol className="rk-notes">
              <li>
                <b>1 / DRIVE</b>One per agent.
              </li>
              <li>
                <b>2 / LED</b>Blinks on every write.
              </li>
              <li>
                <b>3 / BAY</b>New agent, new drive.
              </li>
              <li>
                <b>4 / PORTABLE</b>Slot it into a laptop, CI or sandbox.
              </li>
            </ol>
          </div>
        </div>
      </section>
      <div className="landing-wrap">
        <section className="feature-grid" aria-label="Features">
          <article>
            <span className="feature-number">01 / PRIVATE BY DESIGN</span>
            <h2>You hold the keys.</h2>
            <p>
              File contents encrypt on your device. The storage service receives ciphertext, never
              your drive key. File names, sizes, tags, and activity stay visible to the service so
              it can list and bill them.
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
      </div>
    </main>
  );
}
