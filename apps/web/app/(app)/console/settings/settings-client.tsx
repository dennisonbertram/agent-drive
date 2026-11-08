'use client';

import Link from 'next/link';
import { useReverification } from '@clerk/nextjs';
import { auditLabel, errorLabel } from '@/src/console/audit-labels';
import { keyDetail } from '@/src/console/audit-who';
import { AccountHeader } from '../account-header';
import { useCallback, useEffect, useRef, useState } from 'react';

type Page<T> = { items: T[]; nextCursor: string | null };
type Drive = { id: string; name: string };
type Deletion = {
  id: string;
  kind: 'drive' | 'account';
  targetId: string;
  status: 'pending' | 'blocked' | 'complete';
  requestedAt: string;
  notBefore: string;
  completedAt: string | null;
  lastError: string | null;
};
type Audit = {
  id: string;
  action: string;
  outcome: 'pending' | 'success' | 'failure';
  httpStatus: number;
  errorCode: string | null;
  createdAt: string;
  agentName: string | null;
  keyLabel: string | null;
  userId: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/console/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'The request failed. Please retry.');
  return body as T;
}

// Account delete is a Clerk strict-reverification route. Return Clerk's reverification body
// unchanged so useReverification can show its verify prompt and call this again.
async function apiReverifiable<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/console/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await response.json();
  if (response.status === 403 && body?.clerk_error) return body as T;
  if (!response.ok) throw new Error(body.error?.message ?? 'The request failed. Please retry.');
  return body as T;
}

// Test auth runs without a Clerk provider, where useReverification cannot be used.
const passThrough = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => fn;

async function all<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  let cursor: string | null = null;
  const visited = new Set<string>();
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await api<Page<T>>(`${path}?${query}`);
    result.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && visited.has(cursor)) throw new Error('Pagination failed. Please refresh.');
    if (cursor) visited.add(cursor);
  } while (cursor);
  return result;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The request failed. Please retry.';
}

function date(value: string) {
  return new Date(value).toLocaleString();
}

function shortDate(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function actor(event: Audit) {
  if (event.userId) return 'You';
  if (event.action === 'share.access') return 'Someone with a share link';
  return event.agentName ?? 'Not signed in';
}

export default function SettingsClient({ clerkEnabled }: { clerkEnabled: boolean }) {
  // clerkEnabled is constant for the life of the deployment, so the hook order never changes.
  const useWrap = (clerkEnabled ? useReverification : passThrough) as typeof passThrough;
  const reverifiable = useWrap(apiReverifiable);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [jobs, setJobs] = useState<Deletion[]>([]);
  const [jobsCursor, setJobsCursor] = useState<string | null>(null);
  const auditTable = useRef<HTMLDivElement>(null);
  const receipt = useRef<HTMLParagraphElement>(null);
  const [audit, setAudit] = useState<Page<Audit>>({ items: [], nextCursor: null });
  const [selectedId, setSelectedId] = useState('');
  const [driveConfirmation, setDriveConfirmation] = useState('');
  const [accountConfirmation, setAccountConfirmation] = useState('');
  const [busy, setBusy] = useState<string | null>('load');
  const [showViews, setShowViews] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [driveError, setDriveError] = useState('');
  const [accountError, setAccountError] = useState('');
  const [notice, setNotice] = useState('');
  const accountDeleting = jobs.some((job) => job.kind === 'account');
  const selected = drives.find((drive) => drive.id === selectedId);

  const reload = useCallback(async () => {
    const deletions = await api<Page<Deletion>>('deletions?limit=25');
    setJobs(deletions.items);
    setJobsCursor(deletions.nextCursor);
    const nextDrives = deletions.items.some((job) => job.kind === 'account')
      ? []
      : await all<Drive>('drives');
    setDrives(nextDrives);
    setSelectedId((current) =>
      nextDrives.some((drive) => drive.id === current) ? current : (nextDrives[0]?.id ?? ''),
    );
    setAudit(await api<Page<Audit>>(`audit?limit=25${showViews ? '' : '&consoleReads=0'}`));
    auditTable.current?.scrollTo({ top: 0 });
  }, [showViews]);

  useEffect(() => {
    let mounted = true;
    void Promise.resolve()
      .then(reload)
      .catch((error: unknown) => {
        if (mounted) setLoadError(message(error));
      })
      .finally(() => {
        if (mounted) setBusy(null);
      });
    return () => {
      mounted = false;
    };
  }, [reload]);

  async function refresh() {
    setBusy('load');
    setLoadError('');
    try {
      await reload();
    } catch (error) {
      setLoadError(message(error));
    } finally {
      setBusy(null);
    }
  }

  async function moreAudit() {
    if (!audit.nextCursor) return;
    setBusy('audit');
    setLoadError('');
    try {
      const next = await api<Page<Audit>>(
        `audit?${new URLSearchParams({ limit: '25', cursor: audit.nextCursor })}${showViews ? '' : '&consoleReads=0'}`,
      );
      setAudit((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
      }));
    } catch (error) {
      setLoadError(message(error));
    } finally {
      setBusy(null);
    }
  }

  async function moreJobs() {
    if (!jobsCursor) return;
    setBusy('jobs');
    setLoadError('');
    try {
      const next = await api<Page<Deletion>>(
        `deletions?${new URLSearchParams({ limit: '25', cursor: jobsCursor })}`,
      );
      setJobs((current) => [...current, ...next.items]);
      setJobsCursor(next.nextCursor);
    } catch (error) {
      setLoadError(message(error));
    } finally {
      setBusy(null);
    }
  }

  async function remove(kind: 'drive' | 'account') {
    if (kind === 'drive' && !selected) return;
    setBusy(kind);
    setDriveError('');
    setAccountError('');
    setNotice('');
    try {
      const init = {
        method: 'DELETE',
        body: JSON.stringify({
          confirmation: kind === 'drive' ? driveConfirmation : accountConfirmation,
        }),
      };
      const { deletion } = (
        kind === 'drive'
          ? await api<{ deletion: Deletion }>(`drives/${selected!.id}`, init)
          : await reverifiable<{ deletion: Deletion }>('account', init)
      ) as { deletion: Deletion };
      setJobs((current) => [deletion, ...current.filter((job) => job.id !== deletion.id)]);
      setDriveConfirmation('');
      setAccountConfirmation('');
      setNotice(
        `${kind === 'drive' ? 'Drive' : 'Account'} deletion accepted. Access is disabled. See request history below for the current cleanup status. Request ${deletion.id}.`,
      );
      try {
        await reload();
      } catch {
        setLoadError(
          'Deletion was accepted, but status could not be refreshed. The background job continues independently.',
        );
      }
    } catch (error) {
      if (kind === 'drive') setDriveError(message(error));
      else setAccountError(message(error));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (notice) receipt.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [notice]);

  return (
    <div className="billing-page settings-page">
      <AccountHeader current="settings" clerkEnabled={clerkEnabled} />
      <main>
        <div className="billing-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE, YOUR CONTROL</p>
            <h1>Activity &amp; deletion</h1>
            <p>Review access and permanently remove data you no longer need.</p>
            <nav className="settings-jumps" aria-label="On this page">
              <a href="#audit-heading">Activity</a>
              <a href="#delete-heading">Delete data</a>
            </nav>
          </div>
        </div>
        {loadError && (
          <p className="banner error" role="alert">
            {loadError}
          </p>
        )}
        {notice && (
          <p className="banner settings-notice" role="status" ref={receipt}>
            {notice}
          </p>
        )}
        <section className="billing-card" aria-labelledby="audit-heading">
          <div className="settings-section-heading">
            <div>
              <h2 id="audit-heading">Activity</h2>
              <p>Most recent first. Metadata only—never file contents or credentials.</p>
            </div>
            <div className="settings-audit-tools">
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={showViews}
                  onChange={(event) => {
                    setBusy('load');
                    setShowViews(event.target.checked);
                  }}
                />
                Show my page views
              </label>
              <button className="button secondary" disabled={!!busy} onClick={() => void refresh()}>
                {busy === 'load' ? 'Loading…' : 'Refresh'}
              </button>
            </div>
          </div>
          <div
            className="table-scroll table-stack"
            ref={auditTable}
            tabIndex={0}
            role="region"
            aria-label="Audit events"
          >
            <table className="settings-audit" role="table">
              <thead>
                <tr role="row">
                  <th role="columnheader">When</th>
                  <th role="columnheader">What</th>
                  <th role="columnheader">Who</th>
                  <th role="columnheader">Result</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {audit.items.map((event) => (
                  <tr key={event.id} role="row">
                    <td role="cell" className="primary">
                      <time dateTime={event.createdAt}>{shortDate(event.createdAt)}</time>
                    </td>
                    <td role="cell" data-label="What">
                      <span title={event.action}>{auditLabel(event.action)}</span>
                    </td>
                    <td role="cell" data-label="Who">
                      {actor(event)}
                      {keyDetail(actor(event), event.keyLabel) && (
                        <small>{keyDetail(actor(event), event.keyLabel)}</small>
                      )}
                    </td>
                    <td role="cell" data-label="Result">
                      {event.outcome === 'pending' ? (
                        <span className="settings-result">In progress</span>
                      ) : event.outcome === 'failure' ? (
                        <span className="settings-result fail">
                          Failed · {errorLabel(event.errorCode)}
                        </span>
                      ) : (
                        <span className="settings-result">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!audit.items.length && (
            <p className="settings-empty">
              {busy === 'load' ? 'Loading activity…' : 'No activity yet.'}
            </p>
          )}
          {audit.nextCursor && (
            <button className="button secondary" disabled={!!busy} onClick={() => void moreAudit()}>
              {busy === 'audit' ? 'Loading…' : 'Load older events'}
            </button>
          )}
        </section>
        <section className="billing-card settings-danger" aria-labelledby="delete-heading">
          <p className="eyebrow">PERMANENT ACTIONS</p>
          <h2 id="delete-heading">Delete your data</h2>
          <p>
            Deletion cannot be undone. Download any files you need before continuing. This removes
            retained versions, trash, sharing links, and upload metadata—not just visible files.
          </p>
          <details className="settings-explainer">
            <summary>When is data actually removed?</summary>
            <p>
              New access is disabled when the request is accepted. Purging starts after the upload
              grace period (at least ten minutes), using the configured maintenance worker. Storage
              or billing failures delay completion and are retried. Already-issued links may work
              until they expire; late uploads are removed by repeated sweeps and storage lifecycle
              rules.
            </p>
            <p>
              Account deletion also closes billing and removes your sign-in identity. Known usage is
              settled first; existing invoices and provider records follow their own retention
              policies. Aggregate billing receipts, minimal deletion IDs, and a hashed identity
              tombstone remain. These receipts contain no file names, keys, contents, email
              addresses, or external identity IDs. A pending request does not mean erasure has
              completed.
            </p>
          </details>
          <div className="settings-delete-grid">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void remove('drive');
              }}
            >
              <h3>Delete one drive</h3>
              <label htmlFor="delete-drive">Drive</label>
              <select
                id="delete-drive"
                value={selectedId}
                disabled={!!busy || accountDeleting || !drives.length}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setDriveConfirmation('');
                  setDriveError('');
                }}
              >
                {!drives.length && <option value="">No active drives</option>}
                {drives.map((drive) => (
                  <option key={drive.id} value={drive.id}>
                    {drive.name}
                  </option>
                ))}
              </select>
              <label htmlFor="drive-confirm">Type the exact drive name to confirm</label>
              <input
                id="drive-confirm"
                autoComplete="off"
                value={driveConfirmation}
                disabled={!!busy || !selected || accountDeleting}
                onChange={(event) => setDriveConfirmation(event.target.value)}
              />
              {driveError && (
                <p className="banner error" role="alert">
                  {driveError}
                </p>
              )}
              <button
                className="button settings-delete-button"
                disabled={
                  !!busy || accountDeleting || !selected || driveConfirmation !== selected.name
                }
              >
                {busy === 'drive' ? 'Requesting deletion…' : 'Permanently delete drive'}
              </button>
              {!!selected && driveConfirmation !== selected.name && (
                <small className="settings-hint">
                  Type the exact drive name above to enable this.
                </small>
              )}
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void remove('account');
              }}
            >
              <h3>Delete your account</h3>
              <p>
                Remove every drive and agent, revoke all API keys, and end this workspace. This is
                not a plan downgrade.
              </p>
              <label htmlFor="account-confirm">
                Type <strong>DELETE MY ACCOUNT</strong> to confirm
              </label>
              <input
                id="account-confirm"
                autoComplete="off"
                value={accountConfirmation}
                disabled={!!busy || accountDeleting}
                onChange={(event) => setAccountConfirmation(event.target.value)}
              />
              {accountError && (
                <p className="banner error" role="alert">
                  {accountError}
                </p>
              )}
              <button
                className="button settings-delete-button"
                disabled={!!busy || accountDeleting || accountConfirmation !== 'DELETE MY ACCOUNT'}
              >
                {accountDeleting
                  ? 'Account deletion requested'
                  : busy === 'account'
                    ? 'Requesting deletion…'
                    : 'Permanently delete account'}
              </button>
              {!accountDeleting && accountConfirmation !== 'DELETE MY ACCOUNT' && (
                <small className="settings-hint">
                  Type DELETE MY ACCOUNT above to enable this.
                </small>
              )}
            </form>
          </div>
        </section>
        <section className="billing-card" aria-labelledby="jobs-heading">
          <div className="settings-section-heading">
            <div>
              <h2 id="jobs-heading">Deletion requests</h2>
              <p>Refresh to check background progress. Save the request ID if you need help.</p>
            </div>
          </div>
          {!jobs.length && <p className="settings-empty">No deletion requests.</p>}
          <ul className="settings-jobs">
            {jobs.map((job) => (
              <li key={job.id}>
                <div className="settings-job-title">
                  <strong>{job.kind === 'account' ? 'Account' : 'Drive'} deletion</strong>
                  <span className={`settings-outcome ${job.status}`}>
                    {job.status === 'blocked' ? 'Needs retry' : job.status}
                  </span>
                </div>
                <p>
                  Requested {date(job.requestedAt)} ·{' '}
                  {job.completedAt
                    ? `Completed ${date(job.completedAt)}`
                    : `Purge not before ${date(job.notBefore)}`}
                </p>
                <p className="settings-id">
                  Request <code>{job.id}</code>
                  <br />
                  Target <code>{job.targetId}</code>
                </p>
                {job.lastError && job.status !== 'complete' && (
                  <p className="settings-job-error">
                    {job.lastError} The worker will retry; unresolved billing or provider issues may
                    need operator help.
                  </p>
                )}
              </li>
            ))}
          </ul>
          {jobsCursor && (
            <button className="button secondary" disabled={!!busy} onClick={() => void moreJobs()}>
              {busy === 'jobs' ? 'Loading…' : 'Load older requests'}
            </button>
          )}
        </section>
      </main>
      <footer className="landing-footer">
        <Link href="/">AGENT DRIVE</Link>
        <span>Persistent storage. Independent agents.</span>
      </footer>
    </div>
  );
}
