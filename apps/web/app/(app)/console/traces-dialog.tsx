'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Request } from '@/src/console/share-link';
import { versionWhen } from '@/src/console/when';
import {
  changedInAnotherTab,
  setUpWebhook,
  TAB_CHANGED,
  type Source,
  type Verdict,
  type WebhookToken,
} from '@/src/console/webhook-setup';
import { CopyButton } from '../copy-button';
import { RevokeControl } from './share-dialog';

type Active = { id: string; createdAt: string; status: 'active' | 'stale' };
/** `driveId` is the drive the key was verified for; `seen` the token id the dialog saw before unlocking. */
export type TracesKey = {
  key: string;
  source: Source;
  driveId?: string;
  seen?: string | null | undefined;
};

/**
 * Body of the "Set up trace capture" dialog. The drive key is passed in only for the moment a token is
 * created; the token itself exists only in this component's state, shown once.
 */
export function TracesDialog({
  driveId,
  request,
  strictRequest,
  verify,
  getKey,
  resumeWith,
  onReady,
  onBusy,
}: {
  driveId: string;
  origin: string;
  request: Request;
  /** Enrollment and token issuance are strict routes: this wraps the Clerk reverification. */
  strictRequest: Request;
  verify: (driveId: string, key: string) => Promise<Verdict>;
  /**
   * The key this tab already has, or undefined after opening the unlock dialog for it. `seen` is
   * the token id this dialog has observed, carried through the unlock dialog.
   */
  getKey: (seen: string | null | undefined) => Promise<TracesKey | undefined>;
  /** A key the unlock dialog just loaded for this action. */
  resumeWith?: TracesKey | undefined;
  /** The inbox now exists and `key` is verified: seal it into the account. */
  onReady: (key: string, source: Source) => void;
  /** True while a create, replace or revoke is in flight: the dialog must not close then. */
  onBusy: (busy: boolean) => void;
}) {
  const [active, setActive] = useState<Active | null | 'loading' | 'error'>('loading');
  const [created, setCreated] = useState<WebhookToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [notice, setNotice] = useState('');
  // The token id this tab last saw (null: none). undefined until the first load finishes.
  const seen = useRef<string | null | undefined>(undefined);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusAdd = useRef(false);
  const working = busy || revoking;
  useEffect(() => {
    onBusy(working);
  }, [working, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);
  // After a revoke the confirm buttons are gone; keyboard focus goes to Add webhook.
  useEffect(() => {
    if (active === null && focusAdd.current) {
      focusAdd.current = false;
      addButton.current?.focus();
    }
  }, [active]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchToken = useCallback(() => {
    request<{ token: Active | null }>(`drives/${driveId}/webhook-token`).then(
      (result) => {
        if (!alive.current) return;
        seen.current = result.token?.id ?? null;
        // A one-time token display must not outlive the state it described.
        setCreated((shown) => (shown && shown.id === seen.current ? shown : null));
        setActive(result.token);
      },
      () => alive.current && setActive('error'),
    );
  }, [request, driveId]);
  useEffect(fetchToken, [fetchToken]);
  const retryLoad = () => {
    setActive('loading');
    fetchToken();
  };

  async function add(have?: TracesKey) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const found = have ?? (await getKey(seen.current));
      if (!found) return; // The unlock dialog took over; it comes back with resumeWith.
      const token = await setUpWebhook({
        request,
        strictRequest,
        driveId,
        key: found.key,
        source: found.source,
        verify,
        ...(seen.current === undefined ? {} : { expectedTokenId: seen.current }),
      });
      if (!alive.current) return;
      seen.current = token.id;
      setCreated(token);
      setConfirmReplace(false);
      setActive({ id: token.id, createdAt: token.createdAt, status: 'active' });
      onReady(found.key, found.source);
    } catch (reason) {
      if (alive.current && changedInAnotherTab(reason)) {
        // Show what the other tab left, and let the user decide again.
        setConfirmReplace(false);
        setNotice(`${TAB_CHANGED} Showing the current setup.`);
        fetchToken();
      } else if (alive.current)
        setError(reason instanceof Error ? reason.message : 'Could not set up the webhook.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  // Once, with the key the unlock dialog loaded.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumeWith && !resumed.current && (resumeWith.driveId ?? driveId) === driveId) {
      resumed.current = true;
      // Carry the token id observed before the unlock dialog opened.
      seen.current = resumeWith.seen;
      void add(resumeWith);
    }
    // add reads only state that is current on this first run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function revoke() {
    setRevoking(true);
    try {
      await request(`drives/${driveId}/webhook-token`, 'DELETE');
    } finally {
      if (alive.current) setRevoking(false);
    }
    if (!alive.current) return;
    focusAdd.current = true;
    seen.current = null;
    setCreated(null);
    setConfirmReplace(false);
    setActive(null);
  }

  const headers = created ? JSON.stringify({ Authorization: `Bearer ${created.token}` }) : '';
  const capture = `agent-drive capture --drive ${driveId} -- claude`;
  const install = `npm install -g @dennisonbertram/agent-drive`;
  return (
    <div className="traces-dialog">
      {created && (
        <div className="trace-created" data-testid="webhook-created">
          <p className="share-help">
            Copy these now. The token cannot be shown again. In OpenRouter, add a Webhook
            destination.
          </p>
          <div className="trace-field">
            <span>Webhook URL</span>
            <span className="trace-command">
              <code data-testid="webhook-url">{created.url}</code>
              <CopyButton text={created.url} label="Copy webhook URL" />
            </span>
          </div>
          <div className="trace-field">
            <span>Headers</span>
            <span className="trace-command">
              <code data-testid="webhook-headers">{headers}</code>
              <CopyButton text={headers} label="Copy headers JSON" />
            </span>
          </div>
          <p className="share-help">
            In OpenRouter, leave Privacy Mode off for this destination, or traces will contain no
            prompts or replies.
          </p>
        </div>
      )}
      <h3 className="share-heading">Local agents</h3>
      <p className="share-help">
        Connect to Agent Drive and load this drive’s key on your agent’s machine first. Run Claude
        Code or Codex through <code>capture</code> to save encrypted traces under{' '}
        <code>/traces</code>. Check terminal output: capture may be disabled, uploads may be queued,
        or calls may not be captured.
      </p>
      <div className="trace-command">
        <code>{install}</code>
        <CopyButton text={install} label="Copy install command" />
      </div>
      <div className="trace-command">
        <code>{capture}</code>
        <CopyButton text={capture} label="Copy capture command" />
      </div>

      <h3 className="share-heading">OpenRouter webhook</h3>
      {active === 'loading' && <p className="muted">Loading…</p>}
      {active === 'error' && (
        <p role="alert">
          Could not load the webhook.{' '}
          <button type="button" className="share-revoke" onClick={retryLoad}>
            Retry
          </button>
        </p>
      )}
      {active !== 'loading' && active !== 'error' && (
        <>
          {active ? (
            <div className="trace-token" data-testid="webhook-token-row">
              <span className="share-when">Created {versionWhen(active.createdAt)}</span>
              <span className="share-state" data-status={active.status}>
                {active.status === 'stale' ? 'Needs replacement' : 'Active'}
              </span>
              {confirmReplace ? (
                <span role="group" aria-label="Confirm replace">
                  <span className="share-help">
                    The old token stops working immediately. Update OpenRouter with the new one.
                  </span>{' '}
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setConfirmReplace(false);
                      void add();
                    }}
                  >
                    Replace token
                  </button>{' '}
                  <button
                    type="button"
                    className="share-revoke"
                    onClick={() => setConfirmReplace(false)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setConfirmReplace(true)}
                >
                  Replace
                </button>
              )}
              <RevokeControl
                question="Stop this webhook?"
                confirmLabel="Revoke webhook"
                onRevoke={revoke}
              />
              {active.status === 'stale' && (
                <p className="share-help" role="status">
                  The inbox changed after this token was created. Replace the token to resume trace
                  delivery.
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="share-help">
                This creates an agent named openrouter that can only write traces to{' '}
                <code>/traces/openrouter</code>.
              </p>
              <button
                ref={addButton}
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => void add()}
              >
                Add webhook
              </button>
            </div>
          )}
          {notice && (
            <p className="share-help" role="status">
              {notice}
            </p>
          )}
          {busy && <p className="muted">Setting up…</p>}
          {error && (
            <p className="share-error" role="alert">
              {error}{' '}
              <button type="button" className="share-revoke" onClick={() => void add()}>
                Retry
              </button>
            </p>
          )}
        </>
      )}
      <p className="share-help">
        OpenRouter sends this trace to our server over TLS. The server reads it once to encrypt it
        to this drive’s inbox key; it never holds your drive key.
      </p>
    </div>
  );
}
