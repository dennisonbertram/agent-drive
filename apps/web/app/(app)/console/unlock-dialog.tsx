'use client';

import { useEffect, useRef, useState } from 'react';
import {
  driveKeyFromPastedText,
  driveKeyFromRecoveryText,
  keySource,
} from '@/src/console/recovery-file';
import type { Source } from '@/src/console/webhook-setup';
import { CopyButton } from '../copy-button';
import { NewPassphraseForm, PassphraseForm, ResetForm } from './vault-forms';

export type UnlockMode = 'passphrase' | 'recovery' | 'setup' | 'change' | 'reset';
export type VaultActions = {
  email: string;
  /** True when a passphrase exists for this account, so recovery mode can offer it. */
  hasVault: boolean;
  onUnlock: (passphrase: string) => Promise<string>;
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
}: {
  driveId: string;
  pendingMessage?: string | undefined;
  onKey: (key: string, source: Exclude<Source, 'trusted'>) => void;
  mode: UnlockMode;
  onMode: (mode: UnlockMode) => void;
  vault: VaultActions;
  recoveryNote?: string | undefined;
}) {
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
          note={pendingMessage}
        />
      </div>
    );
  if (mode === 'setup')
    return (
      <div className="unlock" ref={root}>
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
        <ResetForm onReset={vault.onReset} />
      </div>
    );

  return (
    <div className="unlock" ref={root}>
      {recoveryNote && <p role="status">{recoveryNote}</p>}
      <p>
        Choose the recovery file for this drive. The key stays in this tab only. It is cleared when
        you reload, or after 30 minutes without use.
      </p>
      {pendingMessage && <p>{pendingMessage}</p>}
      <div className="drop-box">
        <span className="button secondary">Choose recovery file</span>
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
      <details>
        <summary>Paste a key instead</summary>
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
      </details>
      <p className="unlock-help">
        No recovery file? Ask the agent that created this drive to run{' '}
        <code>agent-drive credentials export</code>, then choose or paste what it gives you.{' '}
        <CopyButton text="agent-drive credentials export" label="Copy credentials export command" />
      </p>
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
