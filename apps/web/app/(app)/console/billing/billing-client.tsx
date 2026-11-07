'use client';

import Link from 'next/link';
import { BrandMark } from '../../../brand-mark';
import { formatBytes, MAX_UPLOAD } from '@/src/format/bytes';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Plan = {
  id: string;
  baseCents: string;
  drives: string;
  storageBytes: string;
  egressBytes: string;
  operations: string;
};
type Rates = { drive: string; storage: string; egress: string; operations: string };
type AgentUsage = {
  id: string;
  name: string;
  storage_bytes: string;
  egress_bytes: string;
  operations: string;
};
type Billing = {
  plan: string;
  subscriptionStatus: string | null;
  periodStart: string;
  periodEnd: string;
  storageBytes: string;
  peakStorageBytes: string;
  drives: string;
  egressBytes: string;
  authorizedEgressBytes: string;
  operations: string;
  totalCents: string;
  overageCents: string;
  spendCapCents: string | null;
  alertThresholdCents: string | null;
  alertEmail: string | null;
  overageConfigured: boolean;
  hasCustomer: boolean;
  checkoutConfigured: boolean;
  egressMeteringConfigured: boolean;
  egressNotMetered: boolean;
  emailConfigured: boolean;
  agents: AgentUsage[];
  rates: Rates | null;
  checkoutRates: Rates | null;
  limits: Record<string, string>;
};
type Statement = { periodStart: string; statement: Billing };

function dollars(cents: string) {
  const value = BigInt(cents);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

function money(cents: string) {
  const [whole, fraction] = dollars(cents).split('.');
  return `$${BigInt(whole!).toLocaleString()}.${fraction}`;
}

function centsInput(value: string) {
  if (!value.trim()) return null;
  if (!/^\d{1,8}(?:\.\d{1,2})?$/u.test(value))
    throw new Error('Enter a dollar amount with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > 1_000_000_000n) throw new Error('The maximum limit is $10,000,000.');
  return Number(cents);
}

function month(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function api<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/console/billing${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 401) {
    window.location.assign('/sign-in');
    throw new Error('Sign in to manage billing.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? 'Billing could not be loaded.');
  return data as T;
}

function csv(value: string) {
  const safe = /^\s*[=+@-]|^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function downloadBreakdown(statement: Billing) {
  const rows = [
    [
      'period_start',
      'period_end',
      'agent_id',
      'agent_name',
      'retained_storage_bytes',
      'observed_egress_bytes',
      'successful_api_operations',
      'egress_log_source',
    ],
    ...statement.agents.map((agent) => [
      statement.periodStart,
      statement.periodEnd,
      agent.id,
      agent.name,
      agent.storage_bytes,
      agent.egress_bytes,
      agent.operations,
      statement.egressNotMetered
        ? 'provider does not charge egress'
        : statement.egressMeteringConfigured
          ? 'configured; delivery may be incomplete'
          : 'not configured',
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob([rows.map((row) => row.map(csv).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `agent-drive-usage-${statement.periodStart.slice(0, 7)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function BillingClient({ plans }: { plans: Plan[] }) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [cap, setCap] = useState('');
  const [threshold, setThreshold] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState('');
  const load = useCallback(async () => {
    const data = await api<Billing>();
    setBilling(data);
    setCap(data.spendCapCents === null ? '' : dollars(data.spendCapCents));
    setThreshold(data.alertThresholdCents === null ? '' : dollars(data.alertThresholdCents));
    setEmail(data.alertEmail ?? '');
    const history = await api<{ items: Statement[] }>('/statements');
    setStatements(history.items);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Billing could not be loaded.'),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFormError('');
    setNotice('');
    try {
      await api('/settings', 'PATCH', {
        spendCapCents: centsInput(cap),
        alertThresholdCents: centsInput(threshold),
        alertEmail: email.trim() || null,
      });
      await load();
      setNotice('Spending controls saved.');
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function openStripe(path: '/checkout' | '/portal', plan?: string) {
    if (
      path === '/checkout' &&
      billing?.plan !== 'free' &&
      !window.confirm(
        `Change to ${plan}? Stripe will prorate the base-plan change on your next invoice. Your existing spending cap stays in place.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ url?: string; updated?: boolean }>(
        path,
        'POST',
        plan ? { plan } : {},
      );
      if (result.updated) {
        await load();
        setNotice('Plan updated. Stripe will apply prorations on your next invoice.');
        setBusy(false);
        return;
      }
      if (!result.url) throw new Error('The payment provider did not return a URL.');
      const target = new URL(result.url);
      if (
        target.protocol !== 'https:' ||
        !['checkout.stripe.com', 'billing.stripe.com'].includes(target.hostname) ||
        target.username ||
        target.password
      )
        throw new Error('The payment provider returned an unexpected URL.');
      window.location.assign(target.href);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'The billing portal could not be opened.',
      );
      setBusy(false);
    }
  }

  const rateCard = billing?.plan === 'free' ? billing.checkoutRates : billing?.rates;
  const chosen = statements.find((item) => item.periodStart === period)?.statement ?? billing;
  return (
    <div className="billing-page">
      <header className="billing-header">
        <BrandMark href="/console" />
        <nav className="billing-links" aria-label="Account">
          <Link href="/console/settings">Settings</Link>
          <Link className="billing-links-cta" href="/console">
            Back to files
          </Link>
        </nav>
      </header>
      <main>
        <div className="billing-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h1>Billing &amp; limits</h1>
            <p>Know your usage. Set your boundaries.</p>
          </div>
          {billing?.hasCustomer && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void openStripe('/portal')}
            >
              Invoices &amp; payment details
            </button>
          )}
        </div>
        {error && (
          <div className="billing-banner error" role="alert">
            {error}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setError('');
                void load().catch((reason: unknown) =>
                  setError(
                    reason instanceof Error ? reason.message : 'Billing could not be loaded.',
                  ),
                );
              }}
            >
              Refresh
            </button>
          </div>
        )}
        {notice && (
          <div className="billing-banner" role="status">
            {notice}
          </div>
        )}
        {!billing ? (
          !error && (
            <p className="billing-loading" role="status">
              Loading your billing details…
            </p>
          )
        ) : (
          <>
            <section className="billing-metrics" aria-label="Current period usage">
              <article className="billing-card">
                <p className="eyebrow">{month(billing.periodStart)} · ESTIMATE</p>
                <strong className="billing-number">{money(billing.totalCents)}</strong>
                <p>{money(billing.overageCents)} in metered overage</p>
                <small>Excludes tax. Base fees may be prorated on your Stripe invoice.</small>
              </article>
              <article className="billing-card">
                <p className="eyebrow">RETAINED STORAGE</p>
                <strong className="billing-number">{formatBytes(billing.storageBytes)}</strong>
                <p>
                  {formatBytes(billing.limits.storageBytes!)} included · {billing.drives} drives
                </p>
                <small>
                  All versions count, including trash. Monthly peak:{' '}
                  {formatBytes(billing.peakStorageBytes)}.
                </small>
              </article>
              <article className="billing-card">
                <p className="eyebrow">OBSERVED DOWNLOADS</p>
                <strong className="billing-number">
                  {billing.egressNotMetered
                    ? 'Not metered — provider does not charge egress'
                    : billing.egressMeteringConfigured
                      ? formatBytes(billing.egressBytes)
                      : 'Not connected'}
                </strong>
                <p>{formatBytes(billing.authorizedEgressBytes)} authorized this month</p>
                <small>
                  Actual transfer reports can be delayed or incomplete. Authorizations are not
                  charges.
                </small>
              </article>
            </section>
            <section aria-labelledby="plans-title">
              <div className="billing-section-heading">
                <h2 id="plans-title">A plan for your agents</h2>
                <span className="billing-tag">
                  {billing.plan} · {billing.subscriptionStatus ?? 'no card required'}
                </span>
              </div>
              {!billing.checkoutConfigured && (
                <p className="billing-banner">
                  Paid checkout is not enabled. Stripe prices, metering and overage rates must be
                  configured first.{' '}
                  {billing.plan === 'free'
                    ? 'You can keep using the Free plan.'
                    : 'Contact your workspace operator to restore payment setup.'}
                </p>
              )}
              <div className="billing-plans">
                {plans.map((plan) => (
                  <article
                    key={plan.id}
                    className={`billing-card billing-plan ${billing.plan === plan.id ? 'selected' : ''}`}
                  >
                    <h3>{plan.id}</h3>
                    <p>
                      <strong className="billing-price">{money(plan.baseCents)}</strong> / month
                    </p>
                    <ul>
                      <li>{plan.drives} drives</li>
                      <li>{formatBytes(plan.storageBytes)} encrypted storage</li>
                      <li>{formatBytes(plan.egressBytes)} monthly download allowance</li>
                      <li>{BigInt(plan.operations).toLocaleString()} monthly operations</li>
                    </ul>
                    <button
                      className={`button ${plan.id === 'developer' ? 'primary' : 'secondary'}`}
                      disabled={
                        busy ||
                        plan.id === 'free' ||
                        plan.id === billing.plan ||
                        !billing.checkoutConfigured
                      }
                      onClick={() => void openStripe('/checkout', plan.id)}
                    >
                      {plan.id === billing.plan
                        ? 'Current plan'
                        : plan.id === 'free'
                          ? 'Included by default'
                          : billing.plan !== 'free'
                            ? `Change to ${plan.id}`
                            : `Choose ${plan.id}`}
                    </button>
                  </article>
                ))}
              </div>
              {!billing.checkoutConfigured && (
                <p className="billing-caption">
                  Paid plan buttons are disabled because checkout is not enabled on this deployment.
                </p>
              )}
              <p className="billing-caption">
                All plans include client-side encryption. {MAX_UPLOAD} maximum encrypted file size.
                Need a custom enterprise plan? Contact your workspace operator.
              </p>
              {rateCard && (
                <div className="billing-card billing-rates">
                  <h3>Configured overage rates</h3>
                  <p>
                    {money(rateCard.drive)} per extra drive/month · {money(rateCard.storage)} per
                    extra GB stored/month ·{' '}
                    {billing.egressNotMetered
                      ? 'downloads not charged'
                      : `${money(rateCard.egress)} per extra GB downloaded`}{' '}
                    · {money(rateCard.operations)} per 1,000 extra operations.
                  </p>
                  <small>
                    Paid plans only. Storage and drives use the month’s peak allocation, not
                    time-weighted usage. Each category rounds up to the nearest cent. Rates are
                    fixed for the current plan period.
                  </small>
                </div>
              )}
            </section>
            <section className="billing-controls" aria-labelledby="controls-title">
              <div>
                <p className="eyebrow">STAY IN CONTROL</p>
                <h2 id="controls-title">Boundaries, not surprises.</h2>
                <p>
                  A write cap stops new uploads and other file writes once your estimated monthly
                  spend reaches it. Existing files remain readable within your download allowance.
                </p>
                <p className="billing-caption">
                  This is not a guaranteed invoice ceiling: reads continue, transfer logs can arrive
                  later, and tax is excluded. The estimate includes your plan’s listed base fee.
                </p>
              </div>
              <form className="billing-card billing-form" onSubmit={(event) => void save(event)}>
                <label htmlFor="spend-cap">
                  Monthly write cap (USD)
                  <input
                    id="spend-cap"
                    inputMode="decimal"
                    placeholder="No cap"
                    value={cap}
                    onChange={(event) => setCap(event.target.value)}
                    disabled={busy}
                  />
                </label>
                <small>Leave blank for no cap. A zero cap blocks new writes immediately.</small>
                <label htmlFor="alert-threshold">
                  Alert when spend reaches (USD)
                  <input
                    id="alert-threshold"
                    inputMode="decimal"
                    placeholder="No alert"
                    value={threshold}
                    onChange={(event) => setThreshold(event.target.value)}
                    disabled={busy}
                  />
                </label>
                <label htmlFor="alert-email">
                  Alert email
                  <input
                    id="alert-email"
                    type="email"
                    maxLength={254}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={busy}
                  />
                </label>
                {!billing.emailConfigured && (
                  <p className="billing-caption">
                    Email delivery is not configured. You can save a threshold, but alerts will
                    remain queued until delivery is enabled.
                  </p>
                )}
                {formError && (
                  <div className="billing-banner error" role="alert">
                    {formError}
                  </div>
                )}
                <button className="button primary" disabled={busy} type="submit">
                  {busy ? 'Working…' : 'Save spending controls'}
                </button>
              </form>
            </section>
            <section className="billing-card" aria-labelledby="breakdown-title">
              <div className="billing-section-heading">
                <div>
                  <h2 id="breakdown-title">Usage by agent</h2>
                  <p>{month(billing.periodStart)} · UTC calendar month</p>
                </div>
                <div className="actions">
                  <label className="billing-period-label" htmlFor="statement-period">
                    Export period
                    <select
                      id="statement-period"
                      value={period}
                      onChange={(event) => setPeriod(event.target.value)}
                    >
                      <option value="">Current month</option>
                      {statements
                        .filter((item) => item.periodStart !== billing.periodStart)
                        .map((item) => (
                          <option key={item.periodStart} value={item.periodStart}>
                            {month(item.periodStart)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    className="button secondary"
                    onClick={() => chosen && downloadBreakdown(chosen)}
                  >
                    Download CSV
                  </button>
                </div>
              </div>
              <div className="table-scroll table-stack">
                <table role="table">
                  <thead>
                    <tr role="row">
                      <th role="columnheader">AGENT</th>
                      <th role="columnheader">RETAINED STORAGE</th>
                      <th role="columnheader">OBSERVED DOWNLOADS</th>
                      <th role="columnheader">OPERATIONS</th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {billing.agents.map((agent) => (
                      <tr key={agent.id} role="row">
                        <td role="cell" className="primary">
                          {agent.name === '__console__' ? 'Console' : agent.name}
                        </td>
                        <td role="cell" data-label="Retained storage">
                          {formatBytes(agent.storage_bytes)}
                        </td>
                        <td role="cell" data-label="Observed downloads">
                          {billing.egressNotMetered
                            ? 'Not metered — provider does not charge egress'
                            : billing.egressMeteringConfigured
                              ? formatBytes(agent.egress_bytes)
                              : 'Not connected'}
                        </td>
                        <td role="cell" data-label="Operations">
                          {BigInt(agent.operations).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!billing.agents.length && (
                <p className="billing-caption">
                  Agent usage will appear after your first operation.
                </p>
              )}
              <p className="billing-caption">
                Storage and observed transfers are attributed to the version’s author; operations to
                the requesting agent. Public activity without an agent appears only in account
                totals. This breakdown supplements your Stripe invoice—it is not a per-agent
                allocation of charges.
              </p>
            </section>
          </>
        )}
      </main>
      <footer className="landing-footer">
        <Link href="/">AGENT DRIVE</Link>
        <span>Persistent storage. Independent agents.</span>
      </footer>
    </div>
  );
}
