import Link from 'next/link';
import { headers } from 'next/headers';
import { BrandMark } from '../brand-mark';
import { billingRates, GIB, PLANS } from '@/src/billing/policy';
import { checkoutConfigured } from '@/src/billing/providers';
import { CopyButton } from './copy-button';
import { LandingFigure } from './landing-figure';
import '../styles/landing.css';

export const dynamic = 'force-dynamic';

const allowance = (bytes: bigint) =>
  bytes >= 1024n * GIB ? `${String(bytes / (1024n * GIB))} TiB` : `${String(bytes / GIB)} GiB`;
const count = (n: bigint) => new Intl.NumberFormat('en-US').format(n);

function paidAvailable() {
  try {
    return billingRates() !== null && checkoutConfigured();
  } catch {
    return false;
  }
}

const problems = [
  [
    'The sandbox ends',
    'Codex cloud task',
    'saves /memory/project-notes.md',
    'Sandbox',
    'deleted',
    'Next task',
    'reads the notes back',
  ],
  [
    'The machine changes',
    'Laptop',
    'saves /outputs/report.pdf',
    'Laptop',
    'closed',
    'CI runner',
    'gets the report',
  ],
  [
    'The platform switches',
    'Claude Code',
    'writes /handoff/next.md',
    'Session',
    'ended',
    'Codex',
    'reads the handoff',
  ],
];
const folders = [
  ['/memory', 'What the agent should remember.'],
  ['/outputs', 'Finished files.'],
  ['/work', 'Files still in progress.'],
  ['/handoff', 'Notes for the next session.'],
];

function SetupPanel({ instruction, label }: { instruction: string; label: string }) {
  return (
    <div className="l-panel">
      <div className="l-tag">Give this to your agent</div>
      <div className="l-row">
        <code>
          <span className="l-p">&gt;</span> {instruction}
        </code>
        <CopyButton text={instruction} label={label} caption="Copy" className="l-btn signal" />
      </div>
    </div>
  );
}

export default async function Home() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'agentdrive.xyz';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const instruction = `Set up Agent Drive: ${proto}://${host}/llms.txt`;
  const install = `npm install -g ${proto}://${host}/cli/agent-drive.tgz`;
  const paid = paidAvailable();
  const plans = [
    ['Free', PLANS.free],
    ['Developer', PLANS.developer],
    ['Team', PLANS.team],
  ] as const;
  return (
    <main className="landing" id="top">
      <header className="l-nav">
        <div className="l-wrap">
          <BrandMark />
          <nav className="l-links" aria-label="Main">
            <a href="/llms.txt">Docs</a>
            <Link href="/pricing">Pricing</Link>
            <a href="/llms.txt">llms.txt</a>
            <Link href="/sign-in">Sign in</Link>
            <Link href="/console">Console</Link>
          </nav>
        </div>
      </header>

      <section className="l-hero">
        <div className="l-wrap l-g">
          <div>
            <div className="l-tag">Portable storage for agents</div>
            <h1>Agent files that outlive the sandbox.</h1>
            <p className="l-lede">
              Agents save to their drive as they work. When the sandbox ends, the machine changes,
              or the work moves from Claude Code to Codex, the files are still there.
            </p>
            <SetupPanel instruction={instruction} label="Copy agent instruction" />
            <p className="l-cli">
              or in a terminal: <b>{install}</b> <CopyButton text={install} className="l-copy" />
            </p>
          </div>
          <LandingFigure />
        </div>
      </section>

      <section id="problem">
        <div className="l-wrap">
          <div className="l-tag">The problem</div>
          <h2>Sandboxes end. Machines change. Platforms switch.</h2>
          <p className="l-lede">
            Each one wipes whatever the agent saved locally, and the next run starts from zero. With
            a drive, the agent picks up where it stopped.
          </p>
          <div className="l-three">
            {problems.map(([title, a, as, b, bs, c, cs]) => (
              <div key={title}>
                <h3>{title}</h3>
                <div className="l-strip">
                  <div className="l-cell">
                    <b>{a}</b>
                    <small>{as}</small>
                  </div>
                  <span className="l-arr" aria-hidden />
                  <div className="l-cell gone">
                    <b>{b}</b>
                    <small>{bs}</small>
                  </div>
                  <span className="l-arr" aria-hidden />
                  <div className="l-cell">
                    <b>{c}</b>
                    <small>{cs}</small>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="folders">
        <div className="l-wrap">
          <div className="l-tag">Every drive has</div>
          <h2>Four folders, ready for the agent to use.</h2>
          <div className="l-spec">
            {folders.map(([name, text]) => (
              <div key={name}>
                <code>{name}</code>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="connect">
        <div className="l-wrap l-two">
          <div>
            <div className="l-tag">Connecting</div>
            <h2>One line to the agent. One click from you.</h2>
            <ol className="l-steps">
              <li>
                <i>1</i>
                <b>Paste one line into your agent.</b>
                <div className="t">{instruction}</div>
              </li>
              <li>
                <i>2</i>
                <b>The agent shows a pairing code.</b>
                <div className="t">CXRH-TZJT</div>
              </li>
              <li>
                <i>3</i>
                <b>You approve it once.</b>
              </li>
            </ol>
            <p className="l-nokey">No API key to copy.</p>
          </div>
          <div className="l-pair" role="img" aria-label="Example approval page">
            <div className="top">
              <span className="l-tag">Approve agent</span>
              <span className="l-led" />
            </div>
            <div className="c">CXRH-TZJT</div>
            <h3>Connect trace-bot?</h3>
            <div className="rows">
              <div>
                <span>Agent</span>
                <b>trace-bot</b>
              </div>
              <div>
                <span>Machine</span>
                <b>MacBook</b>
              </div>
              <div>
                <span>Account</span>
                <b>sam@northwind.dev</b>
              </div>
            </div>
            <p className="can">Read, write, delete and share files in this drive</p>
            <span className="l-btn signal">Approve</span>
          </div>
        </div>
      </section>

      <section id="machines">
        <div className="l-wrap">
          <div className="l-tag">How it moves</div>
          <h2>Take the key along, and the files follow.</h2>
          <p className="l-lede">
            The drive holds the files. The agent&apos;s credentials bundle holds the key. Wherever
            the bundle goes, the agent can read its drive.
          </p>
          <div className="l-line3">
            <div>
              <div className="l-tag">1 / Save as you work</div>
              <code>
                <span>$</span> agent-drive put notes.md /memory/project-notes.md
                <br />
                <span>$</span> agent-drive backup ./work
              </code>
              <p>Ordinary commands, or the same actions as MCP tools.</p>
            </div>
            <div>
              <div className="l-tag">2 / Keep the key safe</div>
              <code>
                <span>$</span> agent-drive credentials export --stdout
              </code>
              <p>Put the bundle in your secret store once.</p>
            </div>
            <div>
              <div className="l-tag">3 / Anywhere next</div>
              <code>
                <span>$</span> export AGENT_DRIVE_CREDENTIALS=adcred1.…
                <br />
                <span>$</span> agent-drive get /memory/project-notes.md
              </code>
              <p>Set it as a sandbox secret. The key is never written to disk.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="keys">
        <div className="l-wrap">
          <div className="l-tag">Privacy</div>
          <h2>Your keys stay with the agent.</h2>
          <p className="l-lede">
            Files are encrypted on the agent&apos;s machine with AES-256-GCM. The service stores
            only ciphertext.
          </p>
          <div className="l-see">
            <div>
              <div className="l-tag">We see</div>
              <ul>
                <li>File paths</li>
                <li>File sizes</li>
                <li>
                  Versions <small>so we can list files and bill usage</small>
                </li>
              </ul>
            </div>
            <div className="no">
              <div className="l-tag">We do not see</div>
              <ul>
                <li>File contents</li>
                <li>Your drive keys</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="works">
        <div className="l-wrap">
          <div className="l-tag">Works with</div>
          <h2>The agents you already use.</h2>
          <div className="l-works">
            <span>Claude Code</span>
            <span>Codex</span>
            <span>Cursor</span>
            <span>Gemini CLI</span>
            <span className="q">Any MCP client</span>
          </div>
          <p className="l-llms">
            Agents can read the setup themselves. Point one at{' '}
            <a href="/llms.txt">{host}/llms.txt</a> and it installs the CLI and connects.
          </p>
        </div>
      </section>

      <section id="pricing">
        <div className="l-wrap">
          <div className="l-tag">Pricing</div>
          <h2>Start free.</h2>
          <p className="l-lede">Encryption on the agent&apos;s machine is on every plan.</p>
          <div className="l-plans">
            {plans.map(([name, p]) => (
              <div className="l-plan" key={name}>
                <h3>{name}</h3>
                <div className="pr">
                  ${p.baseCents / 100}
                  <small> / month</small>
                </div>
                <ul>
                  <li>{String(p.drives)} drives</li>
                  <li>{allowance(p.storageBytes)} stored</li>
                  <li>{allowance(p.egressBytes)} downloads a month</li>
                  <li>{count(p.operations)} API operations a month</li>
                </ul>
                {p.baseCents > 0 &&
                  (paid ? (
                    <Link className="l-btn" href="/pricing">
                      Choose plan
                    </Link>
                  ) : (
                    <span className="soon">Coming soon</span>
                  ))}
              </div>
            ))}
          </div>
          <p className="l-pnote">
            {paid ? '' : 'Paid checkout is not enabled yet. '}
            <Link href="/pricing">See full pricing</Link>
          </p>
        </div>
      </section>

      <section className="l-final">
        <div className="l-wrap">
          <h2>Give your agent a drive.</h2>
          <SetupPanel instruction={instruction} label="Copy agent instruction again" />
        </div>
      </section>

      <footer className="l-footer">
        <div className="l-wrap">
          <nav aria-label="Footer">
            <Link href="/pricing">Pricing</Link>
            <a href="/llms.txt">llms.txt</a>
            <a href="/llms.txt">Docs</a>
            <Link href="/sign-in">Sign in</Link>
            <Link href="/console">Console</Link>
          </nav>
          <span>{host}</span>
        </div>
      </footer>
    </main>
  );
}
