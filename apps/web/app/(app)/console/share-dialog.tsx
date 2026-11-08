'use client';

import { useEffect, useRef, useState } from 'react';
import type { TraceInboxRecord } from '../../../../../packages/agent-drive/src/trace-inbox.ts';
import {
  DEFAULT_EXPIRY,
  createShareLink,
  recoverShareLink,
  type Request,
  type ShareLink,
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
  unavailable: 'Unavailable (file in Trash)',
};

/** `Revoke`, then `Stop this link? [Revoke link] [Cancel]`. The API call and the list update belong to the caller. */
export function RevokeControl({
  question,
  confirmLabel = 'Revoke link',
  onRevoke,
}: {
  question: string;
  confirmLabel?: string;
  onRevoke: () => Promise<void>;
}) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [error, setError] = useState('');
  const revoke = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  // Keyboard focus follows the control: Revoke -> Revoke link, Cancel -> Revoke. Not on first render.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    (step === 'confirm' ? confirm : revoke).current?.focus();
  }, [step]);
  if (step === 'idle')
    return (
      <button
        ref={revoke}
        type="button"
        className="share-revoke"
        onClick={() => {
          moved.current = true;
          setStep('confirm');
        }}
      >
        Revoke
      </button>
    );
  return (
    <span ref={root} className="share-confirm" role="group" aria-label={question}>
      <span>{error || question}</span>
      <button
        ref={confirm}
        type="button"
        className="button danger"
        disabled={step === 'busy'}
        onClick={async () => {
          setStep('busy');
          setError('');
          // This control goes away once the row is revoked: focus the row's new status text instead.
          const row = root.current?.closest('li, tr');
          try {
            await onRevoke();
            setTimeout(() => row?.querySelector<HTMLElement>('.share-state')?.focus(), 0);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not revoke the link.');
            setStep('confirm');
          }
        }}
      >
        {confirmLabel}
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
  inbox,
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
  inbox: (driveId: string) => Promise<TraceInboxRecord | null>;
  shares: SharesState | null;
  onReload: () => void;
  onCreated: (driveId: string, row: ShareRow) => void;
  onRevoke: (id: string) => Promise<void>;
}) {
  const [expiry, setExpiry] = useState<ShareExpiry>(DEFAULT_EXPIRY);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  // The one creation for this opening. A second click, or a retry after a clipboard failure, reuses it.
  const creation = useRef<Promise<ShareLink> | null>(null);
  // False once the dialog is gone (closed, idle lock, drive change). Every later step is cancelled: the
  // clipboard promise rejects instead of resolving with the URL, and nothing is stored or reported.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function start() {
    if (creation.current) return creation.current;
    const forDrive = driveId;
    const began = Date.now();
    const known = new Set((shares?.driveId === driveId ? shares.items : []).map((row) => row.id));
    let prepared: { fileKey: string; versionId: string } | undefined;
    const made = (async () => {
      let created: ShareLink | null = null;
      try {
        created = await createShareLink(request, {
          origin,
          driveId,
          path,
          driveKey,
          expiry,
          inbox,
          onPrepared: (p) => {
            prepared = p;
          },
        });
      } catch (failure) {
        // After the POST was sent, a lost response or a 5xx may still have created the link. Look for
        // it before allowing another attempt, so a retry cannot make a second link.
        if (prepared && alive.current) {
          created = await recoverShareLink(request, {
            origin,
            driveId,
            path,
            ...prepared,
            knownIds: known,
            since: began - 60_000,
          }).catch(() => null);
          if (!created) {
            throw new Error(
              `${failure instanceof Error ? failure.message : 'Could not create the link.'} If you try again, check “Links for this file” first: the link may have been created.`,
            );
          }
        } else throw failure;
      }
      if (!alive.current) throw new Error('The dialog was closed.');
      setLink(created);
      onCreated(forDrive, {
        id: created.id,
        path,
        versionId: prepared?.versionId ?? '',
        expiresAt: created.expiresAt,
        revokedAt: null,
        createdAt: created.createdAt,
        status: 'active',
      });
      return created;
    })();
    creation.current = made;
    made.catch(() => {
      if (creation.current === made) creation.current = null;
    });
    return made;
  }

  async function copy() {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    // Created inside the click, so Safari keeps the user gesture while the link is still being made.
    const made = start();
    const copied = (done: ShareLink) =>
      alive.current && setStatus(`Link copied. It expires ${versionWhen(done.expiresAt)}.`);
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
      copied(await made);
    } catch (reason) {
      const done = await made.catch(() => null);
      if (!alive.current) return;
      if (!done) {
        setError(reason instanceof Error ? reason.message : 'Could not create the link.');
      } else {
        // Some browsers refuse the promise form; plain text is the second try.
        try {
          await navigator.clipboard.writeText(done.url);
          copied(done);
        } catch {
          setStatus(
            'Copy failed. The browser blocked automatic copying. Select the link below and copy it yourself.',
          );
        }
      }
    } finally {
      if (alive.current) setBusy(false);
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
              <span className="share-state" data-status={row.status} tabIndex={-1}>
                {STATUS_LABEL[row.status]}
              </span>
              {(row.status === 'active' || row.status === 'unavailable') && (
                <RevokeControl question="Stop this link?" onRevoke={() => onRevoke(row.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
