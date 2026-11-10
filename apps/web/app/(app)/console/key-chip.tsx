'use client';

import { MenuButton } from './menu-button';
import type { VaultStatus } from '@/src/console/vault';

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
  vaultActions,
}: {
  hasKey: boolean;
  backedUp: boolean;
  backupText: string;
  confirming: boolean;
  onLoad: () => void;
  onDownload: () => void;
  onSaved: () => void;
  onForget: () => void;
  busy: boolean;
  vault: VaultStatus;
  fingerprint: string;
  vaultActions: {
    onSetup: () => void;
    onUnlock: () => void;
    onLock: () => void;
    onChange: () => void;
    onReset: () => void;
    onRetry: () => void;
  };
}) {
  const hasVault = vault === 'locked' || vault === 'unlocked';
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
              : 'Locked. Your passphrase opens the drives you added to your account.'
            : hasKey
              ? 'Unlocked. This drive’s key is loaded in this tab.'
              : 'Unlocked. Drives you added to your account open when you use them.'}{' '}
          <small data-testid="vault-fingerprint">Fingerprint {fingerprint}</small>
        </p>
      )}
      {!hasVault && (
        <p>
          {hasKey
            ? 'Key loaded in this tab.'
            : 'Key not loaded. Downloads ask for your recovery file.'}
        </p>
      )}
      <p>
        {backedUp
          ? backupText
          : 'Not backed up. If the agent’s machine is lost, these files can’t be opened.'}
      </p>
      {vault === 'locked' && (
        <button
          type="button"
          className="button primary"
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
      {hasKey && !confirming && (
        <button type="button" className="button secondary" onClick={onDownload}>
          {backedUp ? 'Download recovery file again' : 'Download recovery file'}
        </button>
      )}
      {hasKey && confirming && (
        <div className="key-confirm" role="group" aria-label="Confirm save">
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
          Lock
        </button>
      )}
      {vault === 'unlocked' && (
        <>
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
        </>
      )}
      {hasVault && (
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
      )}
    </MenuButton>
  );
}
