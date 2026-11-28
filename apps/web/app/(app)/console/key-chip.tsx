'use client';

import { useEffect, useRef } from 'react';
import { MenuButton } from './menu-button';
import type { VaultStatus } from '@/src/console/vault';
import { CopyButton } from '../copy-button';
import { FingerprintBox, sealCommand } from './vault-forms';

/** The one place that shows whether this tab has the drive key and whether the key is backed up. */
export function KeyChip({
  hasKey,
  backedUp,
  backupText,
  confirming,
  onLoad,
  onDownload,
  onSaved,
  onForget,
  busy,
  vault,
  fingerprint,
  agentOnly,
  inAccount,
  passkey,
  vaultActions,
}: {
  hasKey: boolean;
  backedUp: boolean;
  backupText: string;
  confirming: boolean;
  onLoad: () => void;
  onDownload: () => void;
  /** Records the backup after the owner confirms that the download succeeded. */
  onSaved: () => void;
  onForget: () => void;
  busy: boolean;
  vault: VaultStatus;
  fingerprint: string;
  agentOnly?: boolean;
  /** The selected drive's key is saved under the account key, so the passphrase opens it. */
  inAccount?: boolean;
  /** 'use' = a passkey exists and this browser can run it; 'add' = it could enroll one. */
  passkey?: 'use' | 'add' | undefined;
  vaultActions: {
    onSetup: () => void;
    onUnlock: () => void;
    onPasskeyUnlock?: () => void;
    onAddPasskey?: () => void;
    onLock: () => void;
    onLockBrowser: () => void;
    onChange: () => void;
    onReset: () => void;
    onRetry: () => void;
  };
}) {
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirming) confirmation.current?.closest<HTMLElement>('[popover]')?.showPopover();
  }, [confirming]);
  const hasVault = vault === 'locked' || vault === 'unlocked';
  // A fresh recovery file can be written without a file whenever the account holds a copy
  // (agent-only drives never get one). A locked vault asks for the passphrase first.
  const canReproduce = !agentOnly && hasVault;
  const dot = !backedUp ? 'danger' : hasKey || vault === 'unlocked' ? 'ok' : 'idle';
  const closeMenu = (event: { currentTarget: HTMLElement }) =>
    event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
  return (
    <MenuButton
      className="key-chip"
      testId="key-chip"
      menuTestId="key-menu"
      label={
        <>
          <span className={`key-dot ${dot}`} aria-hidden />
          {vault === 'locked' && !hasKey
            ? 'Locked'
            : vault === 'unlocked'
              ? 'Unlocked'
              : hasKey
                ? 'Key loaded'
                : 'Key needed'}
          {!backedUp && ' · Not backed up'}
        </>
      }
    >
      {(vault === 'loading' || vault === 'error') && (
        <>
          <p role="status">
            {vault === 'loading'
              ? 'Checking passphrase status…'
              : 'Couldn’t check passphrase status. Retry or use a recovery file.'}
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={vault === 'loading'}
            onClick={vaultActions.onRetry}
          >
            {vault === 'loading' ? 'Checking…' : 'Retry'}
          </button>
        </>
      )}
      {hasVault && (
        <p>
          {vault === 'locked'
            ? hasKey
              ? 'Locked, but this drive’s key is loaded in this tab.'
              : agentOnly
                ? 'Locked. This drive is agent-only — only its recovery file opens it.'
                : 'Locked. Your passphrase opens the drives you added to your account.'
            : hasKey
              ? 'Unlocked. This drive’s key is loaded in this tab.'
              : agentOnly
                ? 'Unlocked. This drive is agent-only — only its recovery file opens it.'
                : inAccount
                  ? 'Unlocked. Drives you added to your account open when you use them.'
                  : 'Unlocked, but this drive is not in your account yet. Load its recovery file once; after that your passphrase opens it.'}{' '}
        </p>
      )}
      {hasVault && fingerprint && (
        <div className="key-fingerprint">
          <small>Account key fingerprint</small>
          <FingerprintBox fingerprint={fingerprint} />
          <span className="key-fingerprint-copy">
            <CopyButton
              text={sealCommand(fingerprint)}
              caption="Copy seal command"
              label="Copy account seal command"
            />
            <CopyButton
              text={sealCommand(fingerprint, undefined, true)}
              caption="Copy re-pin command"
              label="Copy account re-pin command"
            />
          </span>
        </div>
      )}
      {!hasVault && (
        <p>
          {hasKey
            ? 'Key loaded in this tab.'
            : agentOnly
              ? 'Agent-only: open with a recovery file. A fresh file needs the key loaded here first.'
              : 'Key not loaded. Downloads ask for your recovery file.'}
        </p>
      )}
      <p>
        {backedUp
          ? backupText
          : 'Not backed up. If the agent’s machine is lost, these files can’t be opened.'}
      </p>
      {vault === 'locked' && passkey === 'use' && vaultActions.onPasskeyUnlock && (
        <button
          type="button"
          className="button primary"
          onClick={(event) => {
            closeMenu(event);
            vaultActions.onPasskeyUnlock?.();
          }}
        >
          Unlock with passkey
        </button>
      )}
      {vault === 'locked' && (
        <button
          type="button"
          className={passkey === 'use' ? 'button secondary' : 'button primary'}
          onClick={(event) => {
            closeMenu(event);
            vaultActions.onUnlock();
          }}
        >
          Unlock with passphrase
        </button>
      )}
      {!hasKey && (
        <button
          type="button"
          className="button secondary"
          onClick={(event) => {
            closeMenu(event);
            onLoad();
          }}
        >
          Load key
        </button>
      )}
      {(hasKey || canReproduce) && !confirming && (
        <button type="button" className="button secondary" disabled={busy} onClick={onDownload}>
          {backedUp ? 'Download recovery file again' : 'Download recovery file'}
        </button>
      )}
      {hasKey && confirming && (
        <div ref={confirmation} className="key-confirm" role="group" aria-label="Confirm save">
          Did the file save?
          <button type="button" className="button primary" disabled={busy} onClick={onSaved}>
            I saved it
          </button>
          <button type="button" className="button secondary" onClick={onDownload}>
            Download again
          </button>
        </div>
      )}
      {hasKey && vault !== 'unlocked' && (
        <button
          type="button"
          className="button secondary"
          onClick={(event) => {
            closeMenu(event);
            onForget();
          }}
        >
          Forget key
        </button>
      )}
      {vault === 'none' && (
        <button
          type="button"
          className="button secondary"
          onClick={(event) => {
            closeMenu(event);
            vaultActions.onSetup();
          }}
        >
          Set up passphrase unlock
        </button>
      )}
      {(vault === 'unlocked' || (hasVault && hasKey)) && (
        <button
          type="button"
          className="button secondary"
          onClick={(event) => {
            closeMenu(event);
            vaultActions.onLock();
          }}
        >
          Lock this tab
        </button>
      )}
      {vault === 'unlocked' && (
        <>
          <button
            type="button"
            className="button secondary"
            data-testid="lock-browser"
            onClick={(event) => {
              closeMenu(event);
              vaultActions.onLockBrowser();
            }}
          >
            Lock this browser
          </button>
          <small className="key-menu-help">
            Lock this tab clears the key here; a reload can unlock again if this browser remembers
            it. Lock this browser forgets it.
          </small>
        </>
      )}
      {hasVault && (
        <>
          <hr className="key-menu-rule" />
          {vault === 'unlocked' && passkey === 'add' && vaultActions.onAddPasskey && (
            <button
              type="button"
              className="button secondary"
              onClick={(event) => {
                closeMenu(event);
                vaultActions.onAddPasskey?.();
              }}
            >
              Add a passkey
            </button>
          )}
          {vault === 'unlocked' && (
            <button
              type="button"
              className="button secondary"
              onClick={(event) => {
                closeMenu(event);
                vaultActions.onChange();
              }}
            >
              Change passphrase
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            onClick={(event) => {
              closeMenu(event);
              vaultActions.onReset();
            }}
          >
            Forgot or exposed passphrase?
          </button>
        </>
      )}
    </MenuButton>
  );
}
