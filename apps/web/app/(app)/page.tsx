import type { Metadata } from 'next';
import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { SiteHeader } from '../site-header';
import { SiteFooter } from '../site-footer';
import { billingRates, PLANS } from '@/src/billing/policy';
import { allowance } from '@/src/content/plans';
import { COMPARISONS } from '@/src/content/compare';
import {
  CANONICAL_ORIGIN,
  FAQ,
  FEATURES,
  GAMES,
  HERO,
  PROBLEM,
  PROTEIN,
  RELAY,
  faqJsonLd,
} from '@/src/content/home';
import { JsonLd } from '@/src/content/json-ld';
import { checkoutConfigured } from '@/src/billing/providers';
import { CopyButton } from './copy-button';
import { HeroFigure } from './hero-figure';
import { GamesFigure } from './games-figure';
import { ProteinFigure } from './protein-figure';
import '../styles/landing.css';
import '../styles/te-figures.css';

export const dynamic = 'force-dynamic';

const title = 'Agent Drive: encrypted storage your agents keep across sandboxes';
const description =
  "Encrypted storage your agents keep across sandboxes. Files are encrypted on the agent's machine and survive sandboxes, machines and platform switches.";
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/', types: { 'text/markdown': '/index.md' } },
  openGraph: {
    title,
    description,
    url: '/',
    type: 'website',
    images: ['/opengraph-image'],
  },
  twitter: { card: 'summary_large_image', title, description, images: ['/opengraph-image'] },
};

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
        <CopyButton text={instruction} label={label} caption="Copy prompt" className="l-btn" />
      </div>
    </div>
  );
}

/** Activity log as a real table: the path is a row header above who saved it, from where, and when. */
function Log({ heading, caption, rows }: { heading: string; caption: string; rows: string[][] }) {
  return (
    <div className="l-log">
      <table className="lt">
        <caption className="l-tag">{heading}</caption>
        <thead>
          <tr>
            <th scope="col">Saved by</th>
            <th scope="col">From</th>
            <th scope="col">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([path, ...cells]) => (
            <Fragment key={path}>
              <tr className="lp">
                <th scope="row" colSpan={3}>
                  {path}
                </th>
              </tr>
              <tr>
                {cells.map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="l-cap">{caption}</p>
    </div>
  );
}

export default function Home() {
  const instruction = `Set up Agent Drive: ${CANONICAL_ORIGIN}/llms.txt`;
  const install = `npm install -g @dennisonbertram/agent-drive`;
  const paid = paidAvailable();
  const plans = [
    ['Free', PLANS.free],
    ['Developer', PLANS.developer],
    ['Team', PLANS.team],
  ] as const;
  const ops = new Intl.NumberFormat('en-US', { notation: 'compact' });
  const rows: [string, (p: (typeof plans)[number][1]) => ReactNode][] = [
    ['Price / month', (p) => `$${p.baseCents / 100}`],
    ['Drives', (p) => String(p.drives)],
    ['Stored', (p) => allowance(p.storageBytes)],
    ['Downloads / month', (p) => allowance(p.egressBytes)],
    ['API operations / month', (p) => ops.format(Number(p.operations))],
  ];
  return (
    <main className="landing" id="top">
      <JsonLd data={faqJsonLd()} />
      <SiteHeader />

      <section className="l-hero">
        <div className="l-wrap l-g">
          <div>
            <div className="l-tag">Portable storage for agents</div>
            <h1>{HERO.title}</h1>
            <p className="l-lede">{HERO.lede}</p>
            <SetupPanel instruction={instruction} label="Copy agent instruction" />
            <p className="l-next">{HERO.next}</p>
            <p className="l-cli">
              <span>or in a terminal:</span>{' '}
              <span className="l-cmd">
                <b>{install}</b>{' '}
                <CopyButton text={install} caption="Copy command" className="l-copy" />
              </span>
            </p>
          </div>
          <HeroFigure />
        </div>
      </section>

      <section id="problem">
        <div className="l-wrap">
          <div className="l-tag">The problem</div>
          <h2>{PROBLEM.title}</h2>
          <p className="l-lede">{PROBLEM.lede}</p>
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
          <div className="l-tag">Long-running work</div>
          <h2>{RELAY.title}</h2>
          <p className="l-lede">{RELAY.lede}</p>
          <ul className="l-also">
            <li>
              <b>Research:</b> build on the previous round&apos;s data sets each round.
            </li>
            <li>
              <b>Game development:</b> keep generated assets between sessions.{' '}
              <a href="#games">See how</a>.
            </li>
            <li>
              <b>Protein research:</b> gigabytes of structure data in one place.{' '}
              <a href="#protein">See how</a>.
            </li>
          </ul>
          <div className="l-line3 relay">
            <div>
              <div className="l-tag">1 / Sales agent &middot; cloud worker</div>
              <p>Exports this week&apos;s customer list.</p>
              <code>
                <span>$</span> agent-drive put customers.csv /data/customers/2026-11-09.csv --drive
                &quot;$DRIVE_ID&quot;
              </code>
            </div>
            <div>
              <div className="l-tag">2 / Coding agent &middot; sandbox</div>
              <p>Works through the list and saves its full trace.</p>
              <code>
                <span>$</span> agent-drive get /data/customers/2026-11-09.csv --output customers.csv
                --drive &quot;$DRIVE_ID&quot;
                <br />
                <span>$</span> agent-drive capture --drive &quot;$DRIVE_ID&quot; --agent
                coding-agent -- claude
              </code>
              <p className="l-small">
                Traces land in <code className="l-inl">/traces/coding-agent/2026-11-09/…</code>
              </p>
            </div>
            <div>
              <div className="l-tag">3 / Review agent &middot; GPU box</div>
              <p>Reads the week&apos;s traces and improves the next run.</p>
              <div className="l-say">
                Read 42 traces from this week. Updated /prompts/outreach.md with the three changes
                that worked.
              </div>
            </div>
          </div>
          <Log
            heading="Drive activity: who saved what, from where"
            caption="Every file records which agent saved it and from which machine."
            rows={[
              ['/data/customers/2026-11-09.csv', 'sales-agent', 'cloud-worker', 'Mon 09:12'],
              [
                '/traces/coding-agent/2026-11-09/101500.123Z_….json',
                'coding-agent',
                'sandbox-7',
                'Mon 10:15',
              ],
              ['/prompts/outreach.md', 'review-agent', 'gpu-box', 'Fri 17:40'],
            ]}
          />
          <ul className="l-solve">
            <li>Many agents, one drive</li>
            <li>No silent overwrites</li>
          </ul>
        </div>
      </section>

      <section id="games">
        <div className="l-wrap l-g top">
          <div>
            <div className="l-tag">{GAMES.tag}</div>
            <h2>{GAMES.title}</h2>
            <p className="l-lede">{GAMES.lede}</p>
          </div>
          <GamesFigure />
        </div>
      </section>

      <section id="protein">
        <div className="l-wrap l-g top">
          <div>
            <div className="l-tag">{PROTEIN.tag}</div>
            <h2>{PROTEIN.title}</h2>
            <p className="l-lede">{PROTEIN.lede}</p>
          </div>
          <ProteinFigure />
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
            <picture>
              <source media="(max-width: 1000px)" srcSet="/console-files-phone.png" />
              <img
                src="/console-files.png"
                width={2320}
                height={798}
                alt="The Agent Drive console showing the inbox folder of a drive: files with their size, the agent that wrote them, and when."
              />
            </picture>
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
              <p>{FEATURES[0]!.text}</p>
            </div>
            <div>
              <div className="l-tag">Sharable</div>
              <p>{FEATURES[1]!.text}</p>
              <code>
                <span>$</span> agent-drive share --drive &quot;$DRIVE_ID&quot; /outputs/report.pdf
                --expires-in 7d
              </code>
            </div>
            <div>
              <div className="l-tag">Works anywhere</div>
              <p>{FEATURES[2]!.text}</p>
              <code>
                <span>$</span> export AGENT_DRIVE_CREDENTIALS=adcred1.…
              </code>
            </div>
          </div>
        </div>
      </section>

      <section id="compare">
        <div className="l-wrap">
          <div className="l-tag">Compared to</div>
          <h2>Why not S3, git or Dropbox?</h2>
          <div className="cmp">
            {COMPARISONS.map((c) => (
              <Link className="cmp-row" href={`/compare/${c.slug}`} key={c.slug}>
                <span className="l-tag">{c.other}</span>
                <span className="cmp-sum">{c.summary}</span>
                <span className="cmp-go">{c.title} &rarr;</span>
              </Link>
            ))}
            <Link className="cmp-row" href="/compare">
              <span className="cmp-go">All comparisons &rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      <section id="faq">
        <div className="l-wrap">
          <div className="l-tag">FAQ</div>
          <h2>Questions, answered.</h2>
          <div className="l-faq">
            {FAQ.map(({ q, a }) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a.split('`').map((part, n) => (n % 2 ? <code key={n}>{part}</code> : part))}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing">
        <div className="l-wrap">
          <div className="l-tag">Pricing</div>
          <h2>Start free.</h2>
          <p className="l-lede">Encryption on the agent&apos;s machine is on every plan.</p>
          <table className="pt">
            <thead>
              <tr>
                <td />
                {plans.map(([name, p]) => (
                  <th scope="col" key={name}>
                    {name}
                    {p.baseCents > 0 &&
                      (paid ? (
                        <Link href="/pricing">Choose plan</Link>
                      ) : (
                        <span className="soon">Coming soon</span>
                      ))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {plans.map(([name, p]) => (
                    <td key={name}>{value(p)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <Link className="l-btn pt-cta" href="/sign-up">
            Sign up free
          </Link>
          <p className="l-pnote">
            What counts as an API operation? <a href="#faq">See the FAQ above.</a>
          </p>
          <p className="l-pnote">
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
              Sign up free
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
