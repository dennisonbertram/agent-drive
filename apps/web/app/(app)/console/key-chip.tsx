'use client';

import { MenuButton } from './menu-button';

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
}) {
  const dot = !backedUp ? 'danger' : hasKey ? 'ok' : 'idle';
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
          {hasKey ? 'Key loaded' : 'Key needed'}
          {!backedUp && ' · Not backed up'}
        </>
      }
    >
      <p>
        {hasKey
          ? 'Key loaded in this tab.'
          : 'Key not loaded. Downloads ask for your recovery file.'}
      </p>
      <p>
        {backedUp
          ? backupText
          : 'Not backed up. If the agent’s machine is lost, these files can’t be opened.'}
      </p>
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
      {hasKey && (
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
    </MenuButton>
  );
}
