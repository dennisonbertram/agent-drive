import Image from 'next/image';
import Link from 'next/link';
import { headers } from 'next/headers';
import { SiteHeader } from '../site-header';
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
      <SiteHeader />

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
            <p className="l-next">
              Free to start. Your agent shows a code; you approve it once. No API keys to copy.
            </p>
            <p className="l-cli">
              <span>or in a terminal:</span>{' '}
              <span className="l-cmd">
                <b>{install}</b> <CopyButton text={install} className="l-copy" />
              </span>
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

      <section id="relay">
        <div className="l-wrap">
          <div className="l-tag">Example</div>
          <h2>A bot, a coder and an assistant on the same data.</h2>
          <p className="l-lede">
            Three agents on three platforms. None of them shares a machine. They meet in the drive.
          </p>
          <ul className="l-also">
            <li>
              <b>Research:</b> each run starts from what the last one found.
            </li>
            <li>
              <b>Long-running goals:</b> the plan and progress survive restarts and new models.
            </li>
          </ul>
          <div className="l-line3 relay">
            <div>
              <div className="l-tag">1 / Grok bot &middot; cloud worker</div>
              <p>Pulls today&apos;s posts about your app from X.</p>
              <code>
                <span>$</span> agent-drive put --drive &quot;$DRIVE_ID&quot; posts.jsonl
                /inbox/x/2026-11-05.jsonl
              </code>
            </div>
            <div>
              <div className="l-tag">2 / Devin &middot; Devin sandbox</div>
              <p>
                Reads the posts, builds the feature people asked for most, and writes up what
                changed.
              </p>
              <code>
                <span>$</span> agent-drive get --drive &quot;$DRIVE_ID&quot;
                /inbox/x/2026-11-05.jsonl
                <br />
                <span>$</span> agent-drive put --drive &quot;$DRIVE_ID&quot; notes.md
                /outputs/csv-export.md
              </code>
            </div>
            <div>
              <div className="l-tag">3 / Claude &middot; Claude desktop</div>
              <p>Checks what changed through the MCP server and tells you.</p>
              <div className="l-say">
                Devin shipped CSV export today. It was the most requested feature in this
                morning&apos;s posts from X. Notes are in /outputs/csv-export.md.
              </div>
            </div>
          </div>
          <div
            className="l-log"
            role="img"
            aria-label="Drive activity: the Grok bot wrote the posts file from a cloud worker, Devin wrote the notes file from its sandbox."
          >
            <div className="l-tag">Drive activity</div>
            <div className="lr h">
              <span>PATH</span>
              <span>AGENT</span>
              <span>MACHINE</span>
            </div>
            <div className="lr">
              <span>/inbox/x/2026-11-05.jsonl</span>
              <span>grok-bot</span>
              <span>cloud-worker</span>
            </div>
            <div className="lr">
              <span>/outputs/csv-export.md</span>
              <span>devin</span>
              <span>devin-sandbox</span>
            </div>
          </div>
          <p className="l-lede l-many">
            Agents in different sandboxes read and write the same files. Each has its own key and
            can be limited to folders, and nobody silently overwrites another agent&apos;s work.
          </p>
        </div>
      </section>

      <section id="console">
        <div className="l-wrap">
          <div className="l-tag">Console</div>
          <h2>See every file your agents saved.</h2>
          <p className="l-lede">
            Browse by folder, sort by date, preview and download, all decrypted only in your
            browser.
          </p>
          <figure className="l-shot">
            <Image
              src="/console-files.png"
              width={2320}
              height={862}
              sizes="(max-width: 1160px) 100vw, 1096px"
              alt="The Agent Drive console file browser for a drive named research-bot. A folder list sorted by modified date shows archive, assets, config, inbox, logs, memory and outputs, with a Browse and Recent switch, a search box and a Key needed button."
              unoptimized
            />
          </figure>
        </div>
      </section>

      <section id="features">
        <div className="l-wrap">
          <div className="l-tag">Features</div>
          <h2>Encrypted. Sharable. Works anywhere.</h2>
          <div className="l-line3 feat">
            <div>
              <div className="l-tag">Encrypted</div>
              <p>
                Files are encrypted on the agent&apos;s machine (AES-256-GCM). We store only
                ciphertext and never see your keys.
              </p>
            </div>
            <div>
              <div className="l-tag">Sharable</div>
              <p>
                Send an expiring link that decrypts in the recipient&apos;s browser. No account
                needed; revoke it any time.
              </p>
              <code>
                <span>$</span> agent-drive share --drive &quot;$DRIVE_ID&quot; /outputs/report.pdf
                --expires-in 7d
              </code>
            </div>
            <div>
              <div className="l-tag">Works anywhere</div>
              <p>
                A CLI and an MCP server. Set one secret in a sandbox, laptop or CI runner and the
                agent has its drive.
              </p>
              <code>
                <span>$</span> export AGENT_DRIVE_CREDENTIALS=adcred1.…
              </code>
            </div>
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
            <p className="l-more">
              Adding a second agent? Approve it in the browser, hand it a .env line, or let a
              trusted agent grant it. <a href="/llms.txt">Read the docs</a>.
            </p>
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

      <section id="faq">
        <div className="l-wrap">
          <div className="l-tag">FAQ</div>
          <h2>Questions, answered.</h2>
          <div className="l-faq">
            <details>
              <summary>What happens if I lose the drive key?</summary>
              <p>
                Nobody can open the files, including us. Save the recovery file when you create a
                drive, or ask your agent to run <code>agent-drive credentials export</code>.
              </p>
            </details>
            <details>
              <summary>How is this different from S3, git or Dropbox?</summary>
              <p>
                The agent connects in one step with no keys to paste. Files are encrypted before
                upload. Each agent has its own revocable key and folder limits. Every version
                records which agent wrote it. And it works the same in any sandbox.
              </p>
            </details>
            <details>
              <summary>Which agents work with it?</summary>
              <p>
                Any agent that can run a shell command or use an MCP server. We have tested Claude
                Code, Codex, pi and opencode.
              </p>
            </details>
            <details>
              <summary>Can a chat assistant in a vendor&apos;s cloud use it?</summary>
              <p>
                Not yet. Encryption happens on the agent&apos;s own machine, so it needs a shell or
                a local MCP server.
              </p>
            </details>
            <details>
              <summary>What counts as an API operation?</summary>
              <p>
                Each successful request an agent makes (for example a list, upload or download)
                counts as one. Failed requests do not count.
              </p>
            </details>
          </div>
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
                {p.baseCents === 0 && (
                  <Link className="l-btn" href="/sign-up">
                    Start free
                  </Link>
                )}
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
            What counts as an API operation? <a href="#faq">See the FAQ above.</a>
          </p>
          <p className="l-pnote">
            {paid ? '' : 'Paid checkout is not enabled yet. '}
            <Link href="/pricing">See full pricing</Link>
          </p>
        </div>
      </section>

      <section className="l-final">
        <div className="l-wrap">
          <h2>Give your agent a drive.</h2>
          <div className="l-final-row">
            <SetupPanel instruction={instruction} label="Copy agent instruction again" />
            <Link className="l-btn" href="/sign-up">
              Create a free account
            </Link>
          </div>
        </div>
      </section>

      <footer className="l-footer">
        <div className="l-wrap">
          <nav aria-label="Footer">
            <Link href="/pricing">Pricing</Link>
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
