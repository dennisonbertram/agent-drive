'use client';

import { useRef, useState } from 'react';
import {
  DEFAULT_EXPIRY,
  createShareLink,
  type Request,
  type ShareExpiry,
  type ShareRow,
} from '@/src/console/share-link';
import { versionWhen } from '@/src/console/when';

export type SharesState = {
  driveId: string;
  items: ShareRow[];
  capped: boolean;
  status: 'loading' | 'ready' | 'error';
  message?: string;
};

const CHOICES: [ShareExpiry, string][] = [
  ['1h', '1 hour'],
  ['24h', '24 hours'],
  ['7d', '7 days'],
  ['30d', '30 days'],
];

export const STATUS_LABEL: Record<ShareRow['status'], string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  unavailable: 'File in Trash',
};

/** `Revoke`, then `Stop this link? [Revoke link] [Cancel]`. The API call and the list update belong to the caller. */
export function RevokeControl({
  question,
  onRevoke,
}: {
  question: string;
  onRevoke: () => Promise<void>;
}) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [error, setError] = useState('');
  if (step === 'idle')
    return (
      <button type="button" className="share-revoke" onClick={() => setStep('confirm')}>
        Revoke
      </button>
    );
  return (
    <span className="share-confirm" role="group" aria-label={question}>
      <span>{error || question}</span>
      <button
        type="button"
        className="button danger"
        disabled={step === 'busy'}
        onClick={async () => {
          setStep('busy');
          setError('');
          try {
            await onRevoke();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not revoke the link.');
            setStep('confirm');
          }
        }}
      >
        Revoke link
      </button>
      <button
        type="button"
        className="button secondary"
        disabled={step === 'busy'}
        onClick={() => {
          setError('');
          setStep('idle');
        }}
      >
        Cancel
      </button>
    </span>
  );
}

type Link = { id: string; url: string; expiresAt: string; createdAt: string };

/**
 * Body of the Share dialog. The file key exists only inside `link.url` (in its #k= fragment), in this
 * component's state: never in storage, the page URL, a toast, a console message or an error.
 */
export function ShareDialog({
  driveId,
  path,
  driveKey,
  origin,
  request,
  shares,
  onReload,
  onCreated,
  onRevoke,
}: {
  driveId: string;
  path: string;
  driveKey: string;
  origin: string;
  request: Request;
  shares: SharesState | null;
  onReload: () => void;
  onCreated: (row: ShareRow) => void;
  onRevoke: (id: string) => Promise<void>;
}) {
  const [expiry, setExpiry] = useState<ShareExpiry>(DEFAULT_EXPIRY);
  const [link, setLink] = useState<Link | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  // The one creation for this opening. A second click, or a retry after a clipboard failure, reuses it.
  const creation = useRef<Promise<Link> | null>(null);

  function start() {
    if (!creation.current) {
      const made = createShareLink(request, { origin, driveId, path, driveKey, expiry });
      creation.current = made;
      made.then(
        (created) => {
          setLink(created);
          onCreated({
            id: created.id,
            path,
            versionId: '',
            expiresAt: created.expiresAt,
            revokedAt: null,
            createdAt: created.createdAt,
            status: 'active',
          });
        },
        () => {
          if (creation.current === made) creation.current = null;
        },
      );
    }
    return creation.current;
  }

  async function copy() {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    // Created inside the click, so Safari keeps the user gesture while the link is still being made.
    const made = start();
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': made.then((l) => new Blob([l.url], { type: 'text/plain' })),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText((await made).url);
      }
      const done = await made;
      setStatus(`Link copied. It expires ${versionWhen(done.expiresAt)}.`);
    } catch (reason) {
      const done = await made.catch(() => null);
      if (!done) {
        setError(reason instanceof Error ? reason.message : 'Could not create the link.');
      } else {
        // Some browsers refuse the promise form; plain text is the second try.
        try {
          await navigator.clipboard.writeText(done.url);
          setStatus(`Link copied. It expires ${versionWhen(done.expiresAt)}.`);
        } catch {
          setStatus('Copy failed. Select the link and copy it.');
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const mine =
    shares?.driveId === driveId
      ? shares.items
          .filter((row) => row.path === path)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [];
  const failedCopy = link && status.startsWith('Copy failed');
  return (
    <div className="share-dialog">
      <fieldset className="share-expiry" disabled={Boolean(link) || busy}>
        <legend>Link expires after</legend>
        {CHOICES.map(([value, label]) => (
          <label key={value} className="check-label">
            <input
              type="radio"
              name="share-expiry"
              checked={expiry === value}
              onChange={() => setExpiry(value)}
            />{' '}
            {label}
          </label>
        ))}
      </fieldset>
      <button type="button" className="button primary" disabled={busy} onClick={() => void copy()}>
        Copy link
      </button>
      <p className="share-status" role="status">
        {status}
      </p>
      <p className="share-error" role="alert">
        {error}
      </p>
      {failedCopy && link && (
        <input
          readOnly
          aria-label="Share link"
          value={link.url}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <p className="share-help">
        Anyone with the link can download this version of the file. Later changes are not included.
        A link can only be copied when it is created.
      </p>
      <h3 className="share-heading">Links for this file</h3>
      {shares?.driveId !== driveId || shares.status === 'loading' ? (
        <p className="muted">Loading links…</p>
      ) : shares.status === 'error' && !mine.length ? (
        <p role="alert">
          Could not load links.{' '}
          <button type="button" className="share-revoke" onClick={onReload}>
            Retry
          </button>
        </p>
      ) : mine.length === 0 ? (
        <p className="muted">No links yet.</p>
      ) : (
        <ul className="share-links">
          {mine.map((row) => (
            <li key={row.id} data-testid="share-link-row">
              <span className="share-when">
                Created {versionWhen(row.createdAt)}
                {' · '}
                {row.status === 'expired' ? 'Expired' : `Expires ${versionWhen(row.expiresAt)}`}
              </span>
              <span className="share-state" data-status={row.status}>
                {STATUS_LABEL[row.status]}
              </span>
              {row.status === 'active' && (
                <RevokeControl question="Stop this link?" onRevoke={() => onRevoke(row.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
