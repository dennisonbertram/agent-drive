'use client';

import { CopyButton } from '../copy-button';
import { MenuButton } from './menu-button';

type DriveItem = { id: string; name: string };
type DriveUsage = { drives: { id: string; storageBytes: number; liveFiles: number }[] } | null;

/** Picks the drive. The name is the button label; the menu lists every drive with its size and file count. */
export function DriveMenu({
  drives,
  usage,
  selected,
  onSelect,
  onNewDrive,
  onTraces,
  onCapture,
  disabled,
  formatSize,
}: {
  drives: DriveItem[];
  usage: DriveUsage;
  selected: string;
  onSelect: (id: string) => void;
  onNewDrive: () => void;
  /** Phone only: the header buttons are hidden there, so the menu offers the same two actions. */
  onTraces?: () => void;
  onCapture?: () => void;
  disabled?: boolean;
  formatSize: (bytes: number) => string;
}) {
  const current = drives.find((item) => item.id === selected);
  const closeMenu = (event: { currentTarget: HTMLElement }) =>
    event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
  return (
    <span className={`drive-menu ${disabled ? 'disabled' : ''}`}>
      <MenuButton
        align="start"
        className="drive-menu-button"
        testId="drive-menu-button"
        ariaLabel={`Drive: ${current?.name ?? 'none'}`}
        label={<>{current?.name ?? 'Choose a drive'} ▾</>}
      >
        {onTraces && (
          <button
            type="button"
            className="drive-option drive-trace-item"
            onClick={(event) => {
              closeMenu(event);
              onTraces();
            }}
          >
            Traces
          </button>
        )}
        {onCapture && (
          <button
            type="button"
            className="drive-option drive-trace-item"
            onClick={(event) => {
              closeMenu(event);
              onCapture();
            }}
          >
            Capture traces…
          </button>
        )}
        {drives.map((item) => {
          const stats = usage?.drives.find((entry) => entry.id === item.id);
          return (
            <button
              key={item.id}
              type="button"
              className="drive-option"
              aria-current={item.id === selected ? 'true' : undefined}
              disabled={disabled}
              onClick={(event) => {
                closeMenu(event);
                onSelect(item.id);
              }}
            >
              <span className="drive-option-name">{item.name}</span>
              {stats && (
                <span className="drive-option-meta">
                  {formatSize(stats.storageBytes)} · {stats.liveFiles}{' '}
                  {stats.liveFiles === 1 ? 'file' : 'files'}
                </span>
              )}
            </button>
          );
        })}
        {selected && (
          <div className="drive-id-row">
            <span className="drive-id-label">Drive ID</span>
            <code className="drive-id" data-testid="drive-id" title={selected}>
              {selected.slice(0, 8)}…
            </code>
            <CopyButton text={selected} label="Copy drive ID" />
          </div>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={(event) => {
            closeMenu(event);
            onNewDrive();
          }}
        >
          New drive
        </button>
      </MenuButton>
    </span>
  );
}
