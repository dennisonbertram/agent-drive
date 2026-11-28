'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  driveKeyFromPastedText,
  driveKeyFromRecoveryText,
  keySource,
} from '@/src/console/recovery-file';
import type { Source } from '@/src/console/webhook-setup';
import type { VaultStatus } from '@/src/console/vault';
import { CopyButton } from '../copy-button';
import { NewPassphraseForm, PassphraseForm, ResetForm, sealCommand } from './vault-forms';

export type UnlockMode =
  | 'passphrase'
  | 'recovery'
  | 'setup'
  | 'change'
  | 'reset'
  | 'passkey'
  | 'passkeyAdd';
export type VaultActions = {
  email: string;
  status: VaultStatus;
  onRetry: () => void;
  /** Account-key fingerprint ('' until known); copied seal commands carry it. */
  fingerprint?: string;
  /** True when a passphrase exists for this account, so recovery mode can offer it. */
  hasVault: boolean;
  /** True when the account record carries a passkey wrap this browser may open. */
  hasPasskey?: boolean;
  onUnlock: (passphrase: string, keepUnlocked: boolean) => Promise<string>;
  /** 'passkey' mode: the checkbox tells it whether to keep this browser unlocked. */
  onPasskeyUnlock?: (keepUnlocked: boolean) => Promise<string>;
  /** 'passkeyAdd' mode: the typed passphrase verifies the account once. */
  onAddPasskey?: (passphrase: string) => Promise<string>;
  onSetup: (_old: string, passphrase: string) => Promise<string>;
  onChange: (oldPassphrase: string, newPassphrase: string) => Promise<string>;
  onReset: () => Promise<string>;
};

/** Body of the "Load the key" dialog. Errors stay here so the dialog never changes size. */
export function UnlockDialog({
  driveId,
  pendingMessage,
  onKey,
  mode,
  onMode,
  vault,
  recoveryNote,
  agentOnly,
  onClose,
}: {
  driveId: string;
  pendingMessage?: string | undefined;
  onKey: (key: string, source: Exclude<Source, 'trusted'>) => void;
  mode: UnlockMode;
  onMode: (mode: UnlockMode) => void;
  vault: VaultActions;
  recoveryNote?: string | undefined;
  /** Agent-only drives have no account copy: the file-or-key path is the only honest one. */
  agentOnly?: boolean | undefined;
  /** Closes the whole dialog (the passkey step's Cancel button). */
  onClose?: (() => void) | undefined;
}) {
  const [afterReset, setAfterReset] = useState(false);
  const [error, setError] = useState('');
  const [pasted, setPasted] = useState('');
  const root = useRef<HTMLDivElement>(null);
  // The dialog only focuses its first field when it opens; a mode change needs the same.
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    root.current
      ?.querySelector<HTMLElement>('[data-autofocus], input:not([type=checkbox]):not([readonly])')
      ?.focus();
  }, [mode]);

  // Only the latest attempt for this open dialog may load a key. Closing the dialog, changing
  // drive, choosing again or pasting invalidates reads still in flight.
  const attempt = useRef(0);
  useEffect(() => {
    const current = attempt;
    return () => {
      current.current += 1;
    };
  }, [driveId]);

  async function choose(file?: File) {
    if (!file) return;
    setError('');
    const mine = ++attempt.current;
    try {
      // An oversize file is rejected without reading it; '' fails the same way as non-JSON.
      const text = file.size > 16_384 ? '' : await file.text();
      if (mine !== attempt.current) return;
      onKey(driveKeyFromRecoveryText(text, driveId), 'recovery-file');
    } catch (reason) {
      if (mine !== attempt.current) return;
      setError(reason instanceof Error ? reason.message : 'That file could not be read.');
    }
  }

  if (mode === 'passphrase')
    return (
      <div className="unlock" ref={root}>
        <PassphraseForm
          email={vault.email}
          onUnlock={vault.onUnlock}
          onRecovery={() => onMode('recovery')}
          onForgot={() => onMode('reset')}
          note={pendingMessage}
        />
        {vault.hasPasskey && vault.onPasskeyUnlock && (
          <p className="unlock-help">
            This account has a passkey too.{' '}
            <button type="button" onClick={() => onMode('passkey')}>
              Use the passkey instead
            </button>
          </p>
        )}
      </div>
    );
  if (mode === 'passkey')
    return (
      <div className="unlock" ref={root}>
        <PasskeyUnlockForm
          note={pendingMessage}
          onUnlock={vault.onPasskeyUnlock ?? (async () => 'Passkey unlock is unavailable.')}
          onPassphrase={() => onMode('passphrase')}
          onCancel={onClose}
        />
      </div>
    );
  if (mode === 'passkeyAdd')
    return (
      <div className="unlock" ref={root}>
        <PasskeyEnrollForm
          email={vault.email}
          onAdd={vault.onAddPasskey ?? (async () => 'Passkey setup is unavailable.')}
          onCancel={onClose}
        />
      </div>
    );
  if (mode === 'setup')
    return (
      <div className="unlock" ref={root}>
        {afterReset && (
          <p className="unlock-help" role="status">
            Your old account key is gone. After you set a new passphrase, each agent must pin the
            new key. The key menu on Files then shows the exact <code>account seal --repin</code>{' '}
            command to copy and run on each agent&rsquo;s machine.
          </p>
        )}
        <NewPassphraseForm
          email={vault.email}
          submitLabel="Create"
          busyLabel="Creating… this takes a few seconds."
          onSubmit={vault.onSetup}
        />
      </div>
    );
  if (mode === 'change')
    return (
      <div className="unlock" ref={root}>
        <NewPassphraseForm
          current
          email={vault.email}
          submitLabel="Change passphrase"
          busyLabel="Changing… this takes a few seconds."
          onSubmit={vault.onChange}
        />
      </div>
    );
  if (mode === 'reset')
    return (
      <div className="unlock" ref={root}>
        <ResetForm
          onReset={async () => {
            const message = await vault.onReset();
            if (!message) setAfterReset(true);
            return message;
          }}
        />
      </div>
    );

  return (
    <div className="unlock" ref={root}>
      {(vault.status === 'loading' || vault.status === 'error') && (
        <>
          <p role="status">
            {vault.status === 'loading'
              ? 'Checking passphrase status…'
              : 'Couldn’t check passphrase status. Retry or use a recovery file.'}
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={vault.status === 'loading'}
            onClick={vault.onRetry}
          >
            {vault.status === 'loading' ? 'Checking…' : 'Retry'}
          </button>
        </>
      )}
      {recoveryNote && <p role="status">{recoveryNote}</p>}
      <p>
        Choose the recovery file for this drive. The key stays in this tab only. It is cleared when
        you reload, or after 30 minutes without use.
      </p>
      {pendingMessage && <p>{pendingMessage}</p>}
      <div className="drop-box">
        <span className="button primary">Choose recovery file</span>
        <small>or drop it here</small>
        <input
          type="file"
          aria-label="Choose recovery file"
          data-autofocus
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <p className="field-error" role="alert">
        {error}
      </p>
      <p className="unlock-help">
        {agentOnly
          ? 'No recovery file? Ask the agent that created this drive to run '
          : 'No recovery file? Ask an agent that has this drive to run '}
        <code>agent-drive credentials export --to agent-drive-credentials.txt</code> and send you
        that file, then choose it above.{' '}
        <CopyButton
          text="agent-drive credentials export --to agent-drive-credentials.txt"
          label="Copy credentials export command"
        />
      </p>
      <details>
        <summary>Other ways</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError('');
            attempt.current += 1;
            try {
              onKey(driveKeyFromPastedText(pasted, driveId), keySource(pasted));
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'That key is not valid.');
            }
          }}
        >
          <label>
            Drive key or credentials bundle (adcred1.…)
            <input
              type="password"
              autoComplete="off"
              required
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
            />
          </label>
          <button className="button primary">Load key</button>
        </form>
        {!agentOnly && (
          <p className="unlock-help">
            Or have an agent add this drive to your account: run{' '}
            <code>{sealCommand(vault.fingerprint ?? '', driveId)}</code> on its machine.{' '}
            <CopyButton
              text={sealCommand(vault.fingerprint ?? '', driveId)}
              label="Copy account seal command"
            />{' '}
            {vault.fingerprint
              ? ''
              : 'Add --fingerprint with the value from the key menu on Files, or it stays unverified. '}
            {vault.status === 'none'
              ? 'Set up a passphrase first — sealing needs your account key.'
              : vault.status === 'unlocked'
                ? 'After it runs, close this dialog and try again.'
                : 'Your passphrase then opens this drive — no file needed.'}
          </p>
        )}
        {vault.status === 'none' && !agentOnly && (
          <p>
            <button type="button" className="button secondary" onClick={() => onMode('setup')}>
              Set up passphrase unlock
            </button>
          </p>
        )}
      </details>
      {vault.hasVault && (
        <p>
          <button type="button" className="button secondary" onClick={() => onMode('passphrase')}>
            Use my passphrase instead
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * 'passkey': a browser passkey prompt opens the account; the checkbox is the same "Keep this
 * browser unlocked" the passphrase form carries. The passphrase route stays one click away.
 */
function PasskeyUnlockForm({
  note,
  onUnlock,
  onPassphrase,
  onCancel,
}: {
  note?: string | undefined;
  onUnlock: (keepUnlocked: boolean) => Promise<string>;
  onPassphrase: () => void;
  onCancel?: (() => void) | undefined;
}) {
  const [keepUnlocked, setKeepUnlocked] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError('');
    setError(await onUnlock(keepUnlocked));
    setBusy(false);
  }
  return (
    <div>
      <p>Use your fingerprint, face, security key or device PIN when your browser asks.</p>
      {note && <p>{note}</p>}
      <label className="check-label">
        <input
          type="checkbox"
          checked={keepUnlocked}
          disabled={busy}
          onChange={(event) => setKeepUnlocked(event.target.checked)}
        />
        Keep this browser unlocked
      </label>
      <p className="field-error" role="alert">
        {error}
      </p>
      <div className="dialog-actions">
        <button
          type="button"
          className="button primary"
          data-autofocus
          disabled={busy}
          onClick={() => void go()}
        >
          {busy ? 'Waiting for your passkey…' : 'Unlock with passkey'}
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={onPassphrase}>
          Use your passphrase instead
        </button>
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 'passkeyAdd': enrollment for an account that is already unlocked. The passphrase is typed
 * once to prove the account key is the caller's; it never reaches the credential.
 */
function PasskeyEnrollForm({
  email,
  onAdd,
  onCancel,
}: {
  email: string;
  onAdd: (passphrase: string) => Promise<string>;
  onCancel?: (() => void) | undefined;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const typed = value;
    setValue('');
    setBusy(true);
    setError('');
    setError(await onAdd(typed));
    setBusy(false);
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <p>
        Confirm your account passphrase, then follow the device prompt. You can use the same passkey
        wherever your password manager syncs it.
      </p>
      {/* Lets a password manager pair the passphrase with this account. */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      />
      <label>
        Confirm with your passphrase
        <input
          type="password"
          name="passphrase"
          autoComplete="current-password"
          data-autofocus
          required
          disabled={busy}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <p className="field-error" role="alert">
        {error}
      </p>
      <div className="dialog-actions">
        <button className="button primary" disabled={busy || !value}>
          {busy ? 'Adding passkey…' : 'Add a passkey'}
        </button>
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
