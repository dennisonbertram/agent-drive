'use client';

import { useEffect, useRef, useState } from 'react';
import { driveKeyFromPastedText, driveKeyFromRecoveryText } from '@/src/console/recovery-file';
import { CopyButton } from '../copy-button';

/** Body of the "Load the key" dialog. Errors stay here so the dialog never changes size. */
export function UnlockDialog({
  driveId,
  pendingMessage,
  onKey,
}: {
  driveId: string;
  pendingMessage?: string | undefined;
  onKey: (key: string) => void;
}) {
  const [error, setError] = useState('');
  const [pasted, setPasted] = useState('');

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
      onKey(driveKeyFromRecoveryText(text, driveId));
    } catch (reason) {
      if (mine !== attempt.current) return;
      setError(reason instanceof Error ? reason.message : 'That file could not be read.');
    }
  }

  return (
    <div className="unlock">
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
              onKey(driveKeyFromPastedText(pasted, driveId));
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
    </div>
  );
}
