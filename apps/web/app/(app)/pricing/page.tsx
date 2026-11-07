import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { publicOrigin } from '@/src/content/origin';
import { SiteHeader } from '../../site-header';
import { PLANS, type PlanName } from '@/src/billing/policy';
import { checkoutConfigured } from '@/src/billing/providers';
import { JsonLd } from '@/src/content/json-ld';
import { perGbDollars } from '@/src/format/bytes';
import { money, PLAN_INCLUDES, planFacts } from '@/src/content/plans';
import {
  DISCLOSURE,
  egressNotMetered as egressNotMeteredEnv,
  pricingJsonLd,
  publishedRates,
} from '@/src/content/pricing';
import '../../styles/account.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pricing | Agent Drive',
  alternates: { types: { 'text/markdown': '/pricing.md' } },
  openGraph: {
    title: 'Pricing | Agent Drive',
    url: '/pricing',
    images: ['/opengraph-image'],
  },
};

export default async function PricingPage() {
  const origin = publicOrigin(await headers());
  const rates = publishedRates();
  const paidAvailable = rates !== null && checkoutConfigured();
  const egressNotMetered = egressNotMeteredEnv();
  return (
    <>
      <JsonLd data={pricingJsonLd(origin)} />
      <SiteHeader current="pricing" />
      <div className="billing-page pricing-page">
        <main>
          <section className="billing-heading">
            <div>
              <p className="eyebrow">START SMALL. KEEP YOUR KEYS.</p>
              <h1>A home for every agent.</h1>
              <p>Client-side encryption on every plan. Choose the room your agents need.</p>
            </div>
          </section>
          {!paidAvailable && (
            <p className="pricing-availability" id="pricing-availability" role="status">
              {DISCLOSURE.checkoutDisabled}
            </p>
          )}
          <section className="billing-plans" aria-label="Plans">
            {(Object.keys(PLANS) as PlanName[]).map((name) => {
              const plan = planFacts(name, egressNotMetered);
              return (
                <article key={name} className="billing-card billing-plan">
                  <h2>{name}</h2>
                  <p>
                    <span className="billing-price">{plan.price}</span> / month
                  </p>
                  <ul>
                    <li>{plan.drives}</li>
                    <li>{plan.storage}</li>
                    <li>{plan.downloads}</li>
                    <li>{plan.operations}</li>
                    <li>{PLAN_INCLUDES}</li>
                  </ul>
                  {name === 'free' ? (
                    <Link className="button primary" href="/sign-up">
                      Start with Free
                    </Link>
                  ) : paidAvailable ? (
                    <Link className="button secondary" href="/console/billing" prefetch={false}>
                      Choose {name === 'developer' ? 'Developer' : 'Team'}
                    </Link>
                  ) : (
                    <button
                      className="button secondary"
                      disabled
                      aria-describedby="pricing-availability"
                    >
                      Coming soon
                    </button>
                  )}
                </article>
              );
            })}
          </section>
          <section className="billing-card pricing-details" aria-labelledby="usage-pricing">
            <div>
              <p className="eyebrow">NO SURPRISES IN THE FINE PRINT</p>
              <h2 id="usage-pricing">How usage works</h2>
              {DISCLOSURE.usage.map((t) => (
                <p key={t}>{t}</p>
              ))}
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
                    <dt>Extra GB stored / month</dt>
                    <dd>{perGbDollars(rates.storage)}</dd>
                  </div>
                  <div>
                    <dt>Extra GB downloaded</dt>
                    <dd>{egressNotMetered ? 'Not charged' : perGbDollars(rates.egress)}</dd>
                  </div>
                  <div>
                    <dt>Extra 1,000 API operations</dt>
                    <dd>{money(rates.operations)}</dd>
                  </div>
                </dl>
              ) : (
                <p>{DISCLOSURE.noRates}</p>
              )}
              <p className="billing-caption">{DISCLOSURE.downloads}</p>
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
                Create scoped, revocable credentials for separate agents. Attribute activity to
                agents and machines without sharing your human sign-in.
              </p>
            </article>
            <article>
              <span className="feature-number">03 / YOU CONTROL RETENTION</span>
              <h2>Leave on your terms.</h2>
              <p>
                Restore files from trash or request permanent drive/account deletion in the console.
                Deletion disables access and uses a retryable background purge, not an instant
                erasure claim.
              </p>
            </article>
          </section>
        </main>
        <footer className="landing-footer">
          <Link href="/">AGENT DRIVE</Link>
          <span>Persistent storage. Independent agents.</span>
        </footer>
      </div>
    </>
  );
}
