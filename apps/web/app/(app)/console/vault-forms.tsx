'use client';

import { useState, type FormEvent } from 'react';
import { checkPassphrase, generatePassphrase } from '@/src/console/account-key';
import { CopyButton } from '../copy-button';

/** Each form returns '' on success or the message to show. Passphrases never leave these forms. */
type Submit<A extends unknown[]> = (...args: A) => Promise<string>;

const grouped = (passphrase: string) => passphrase.match(/.{1,4}/gu)?.join(' ') ?? passphrase;

export function PassphraseForm({
  email,
  onUnlock,
  onRecovery,
  note,
}: {
  email: string;
  onUnlock: Submit<[string]>;
  onRecovery: () => void;
  note?: string | undefined;
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
    setError(await onUnlock(typed));
    setBusy(false);
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <p>
        Type your passphrase to open the drives you added to your account. The keys stay in this tab
        only. Your drives stay unlocked until you reload, lock, or leave it for 30 minutes.
      </p>
      {note && <p>{note}</p>}
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
        Passphrase
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
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={onRecovery}>
          Use a recovery file instead
        </button>
      </div>
    </form>
  );
}

/** Setup and Change: a generated passphrase by default, or one the user makes up. */
export function NewPassphraseForm({
  email,
  current,
  submitLabel,
  busyLabel,
  onSubmit,
}: {
  email: string;
  /** Change mode asks for the current passphrase first. */
  current?: boolean;
  submitLabel: string;
  busyLabel: string;
  onSubmit: Submit<[string, string]>;
}) {
  const [generated] = useState(generatePassphrase);
  const [own, setOwn] = useState(false);
  const [saved, setSaved] = useState(false);
  const [old, setOld] = useState('');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (own) {
      const check = checkPassphrase(first, email);
      if (!check.ok) {
        setError(
          check.reason.endsWith('.')
            ? check.reason
            : `That passphrase is too easy to guess: ${check.reason}.`,
        );
        return;
      }
      if (first !== second) {
        setError('The passphrases don’t match.');
        return;
      }
    }
    const next = own ? first : generated;
    const previous = old;
    // Typed values leave state before the slow work starts; a failure means typing them again.
    setOld('');
    setFirst('');
    setSecond('');
    setBusy(true);
    const message = await onSubmit(previous, next);
    setBusy(false);
    if (message) setError(message);
  }

  const ready = own ? first !== '' && second !== '' : saved;
  return (
    <form onSubmit={(event) => void submit(event)}>
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
      {current && (
        <label>
          Current passphrase
          <input
            type="password"
            name="current-passphrase"
            autoComplete="current-password"
            data-autofocus
            required
            disabled={busy}
            value={old}
            onChange={(event) => setOld(event.target.value)}
          />
        </label>
      )}
      {!own ? (
        <>
          <p>
            {current ? 'Your new passphrase:' : 'Your passphrase:'} we generated it in your browser.
            Save it in your password manager. If you lose it you can reset it, but every drive must
            be added again.
          </p>
          <div className="passphrase-box">
            <code data-testid="generated-passphrase">{grouped(generated)}</code>
            <CopyButton text={grouped(generated)} label="Copy passphrase" />
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={saved}
              disabled={busy}
              onChange={(event) => setSaved(event.target.checked)}
            />
            I saved it
          </label>
        </>
      ) : (
        <>
          <label>
            {current ? 'New passphrase' : 'Passphrase'} (at least 14 characters)
            <input
              type="password"
              name="new-passphrase"
              autoComplete="new-password"
              required
              disabled={busy}
              value={first}
              onChange={(event) => setFirst(event.target.value)}
            />
          </label>
          <label>
            Type it again
            <input
              type="password"
              name="confirm-passphrase"
              autoComplete="new-password"
              required
              disabled={busy}
              value={second}
              onChange={(event) => setSecond(event.target.value)}
            />
          </label>
          <p className="unlock-help">
            This check only catches obvious patterns. A passphrase you made up can still be guessed
            by someone who copies our database. The generated one can’t.
          </p>
        </>
      )}
      <p className="field-error" role="alert">
        {error}
      </p>
      {current && (
        <p className="unlock-help">
          Changing the passphrase does not lock out someone who already knows the old one. If it may
          be known, reset instead.
        </p>
      )}
      <div className="dialog-actions">
        <button className="button primary" disabled={busy || !ready}>
          {busy ? busyLabel : submitLabel}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setOwn((value) => !value);
            setFirst('');
            setSecond('');
            setError('');
          }}
        >
          {own ? 'Use a generated passphrase' : 'Use my own passphrase'}
        </button>
      </div>
      {busy && <p>Working… this takes a few seconds.</p>}
    </form>
  );
}

export function ResetForm({ onReset }: { onReset: Submit<[]> }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setError(await onReset());
    setBusy(false);
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <p>
        Resetting deletes your account key and removes every drive from it. Files are not deleted.
        You will add each drive again by loading its recovery file. Anyone who already opened a
        drive keeps its key.
      </p>
      <label>
        Type RESET to continue
        <input
          type="text"
          autoComplete="off"
          data-autofocus
          disabled={busy}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>
      <p className="field-error" role="alert">
        {error}
      </p>
      <div className="dialog-actions">
        <button className="button danger" disabled={busy || typed !== 'RESET'}>
          {busy ? 'Resetting…' : 'Reset and remove all drives'}
        </button>
      </div>
    </form>
  );
}
