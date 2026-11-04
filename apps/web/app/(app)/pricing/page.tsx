import Link from 'next/link';
import { billingRates, GIB, PLANS } from '@/src/billing/policy';
import { checkoutConfigured } from '@/src/billing/providers';
import '../console/billing/billing.css';
import './pricing.css';

export const dynamic = 'force-dynamic';

const allowance = (bytes: bigint) =>
  bytes >= 1024n * GIB ? `${String(bytes / (1024n * GIB))} TiB` : `${String(bytes / GIB)} GiB`;

const money = (cents: number | bigint) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(cents) / 100,
  );

function publishedRates() {
  try {
    return billingRates();
  } catch {
    return null;
  }
}

export default function PricingPage() {
  const rates = publishedRates();
  const paidAvailable = rates !== null && checkoutConfigured();
  const egressNotMetered = process.env.S3_EGRESS_METERING === 'none';
  return (
    <div className="billing-page pricing-page">
      <header className="billing-header">
        <Link href="/" className="brand">
          <span className="brand-mark">a/</span> agent drive
        </Link>
        <nav className="actions" aria-label="Main">
          <a
            className="button secondary"
            href="https://github.com/dennisonbertram/agent-drive/blob/main/docs/quickstart.md"
          >
            Quickstart
          </a>
          <Link className="button secondary" href="/sign-in">
            Sign in
          </Link>
        </nav>
      </header>
      <main>
        <section className="billing-heading">
          <div>
            <p className="eyebrow">START SMALL. KEEP YOUR KEYS.</p>
            <h1>A home for every agent.</h1>
            <p>Client-side encryption on every plan. Choose the room your agents need.</p>
          </div>
        </section>
        {!paidAvailable && (
          <p className="pricing-availability" role="status">
            Paid checkout is not enabled on this deployment. The Free plan is available when sign-in
            and storage are configured; the paid prices below describe the supported plans.
          </p>
        )}
        <section className="billing-plans" aria-label="Plans">
          {Object.entries(PLANS).map(([name, plan]) => (
            <article
              key={name}
              className={`billing-card billing-plan ${name === 'developer' ? 'selected' : ''}`}
            >
              <h2>{name}</h2>
              <p>
                <span className="billing-price">{money(plan.baseCents)}</span> / month
              </p>
              <ul>
                <li>{String(plan.drives)} drives</li>
                <li>{allowance(plan.storageBytes)} stored ciphertext</li>
                <li>{allowance(plan.egressBytes)} monthly downloads included</li>
                <li>{Number(plan.operations).toLocaleString('en-US')} API operations / month</li>
                <li>CLI, MCP, web console, and encrypted sharing</li>
              </ul>
              <Link
                className={`button ${name === 'free' ? 'primary' : 'secondary'}`}
                href={name === 'free' ? '/sign-up' : '/console/billing'}
                prefetch={name === 'free' ? null : false}
              >
                {name === 'free'
                  ? 'Start with Free'
                  : `Choose ${name === 'developer' ? 'Developer' : 'Team'}`}
              </Link>
            </article>
          ))}
        </section>
        <section className="billing-card pricing-details" aria-labelledby="usage-pricing">
          <div>
            <p className="eyebrow">NO SURPRISES IN THE FINE PRINT</p>
            <h2 id="usage-pricing">How usage works</h2>
            <p>
              Limits apply across your account. All retained file versions count toward storage,
              including overwritten files and trash. Each encrypted upload can be at most 5 GiB; the
              original file must leave room for encryption overhead.
            </p>
            <p>
              Free accounts stop at their included allowances. Paid overages require a configured
              billing provider and active subscription. Drive and storage overages use the monthly
              high-water allocation, not hourly averages. Base prices are in USD, before applicable
              taxes.
            </p>
          </div>
          <div>
            <h3>Additional usage on paid plans</h3>
            {rates ? (
              <dl className="pricing-rate-list">
                <div>
                  <dt>Extra drive / month</dt>
                  <dd>{money(rates.drive)}</dd>
                </div>
                <div>
                  <dt>Extra GiB stored / month</dt>
                  <dd>{money(rates.storage)}</dd>
                </div>
                <div>
                  <dt>Extra GiB downloaded</dt>
                  <dd>{egressNotMetered ? 'Not charged' : money(rates.egress)}</dd>
                </div>
                <div>
                  <dt>Extra 1,000 API operations</dt>
                  <dd>{money(rates.operations)}</dd>
                </div>
              </dl>
            ) : (
              <p>
                Overage rates have not been published for this deployment. Paid checkout stays
                disabled until billing is fully configured.
              </p>
            )}
            <p className="billing-caption">
              Downloads are measured from observed storage logs, not just issued links. Logs can
              arrive late, and an issued link can be reused until it expires. Spending caps block
              new writes; they are not guaranteed invoice or network-traffic ceilings.
            </p>
          </div>
        </section>
        <section className="feature-grid" aria-label="Your data and access">
          <article>
            <span className="feature-number">01 / YOUR ENCRYPTION KEYS</span>
            <h2>Private contents.</h2>
            <p>
              File contents are encrypted on your device. File paths, sizes, tags, and activity
              metadata remain visible to the service. Save your recovery keys: we cannot recover
              lost keys.
            </p>
          </article>
          <article>
            <span className="feature-number">02 / PURPOSE-BUILT ACCESS</span>
            <h2>Built around agents.</h2>
            <p>
              Create scoped, revocable credentials for separate agents. Attribute activity to agents
              and machines without sharing your human sign-in.
            </p>
          </article>
          <article>
            <span className="feature-number">03 / YOU CONTROL RETENTION</span>
            <h2>Leave on your terms.</h2>
            <p>
              Restore files from trash or request permanent drive/account deletion in the console.
              Deletion disables access and uses a retryable background purge, not an instant erasure
              claim.
            </p>
          </article>
        </section>
      </main>
      <footer className="landing-footer">
        <Link href="/">AGENT DRIVE</Link>
        <span>Persistent storage. Independent agents.</span>
      </footer>
    </div>
  );
}
