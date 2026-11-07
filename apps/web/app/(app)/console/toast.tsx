'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type ToastItem = {
  id: number;
  // Changes when the toast is updated in place, which restarts its 8 s timer.
  rev: number;
  message: string;
  tone?: 'info' | 'error';
  action?: { label: string; run: (id: number) => void | Promise<void> };
  // Where focus goes if the toast is dismissed while it holds focus.
  returnTo?: HTMLElement | null;
};
export type Announcement = { text: string; tone: 'info' | 'error'; n: number };

const SHOW_MS = 8000;

/**
 * A short stack of toasts (newest at the bottom), each with its own timer. Screen readers hear them
 * through two always-mounted live regions, because a live region that mounts already filled can be missed.
 */
export function Toast({
  toasts,
  announcement,
  onDismiss,
}: {
  toasts: ToastItem[];
  announcement: Announcement | null;
  onDismiss: (id: number) => void;
}) {
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement?.tone === 'info' ? announcement.text : ''}
      </div>
      <div className="sr-only" role="alert">
        {announcement?.tone === 'error' ? announcement.text : ''}
      </div>
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <ToastBody key={toast.id} toast={toast} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </>
  );
}

function ToastBody({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [running, setRunning] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dismiss = useRef<HTMLButtonElement>(null);
  const paused = hovered || focused || running;
  const { id, rev, action } = toast;
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDismiss(id), SHOW_MS);
    return () => clearTimeout(timer);
  }, [paused, onDismiss, id, rev]);
  // The action went away (Undo failed) while it had focus: keep focus inside the toast.
  const hadAction = useRef(Boolean(action));
  useLayoutEffect(() => {
    if (hadAction.current && !action && focused) dismiss.current?.focus();
    hadAction.current = Boolean(action);
  }, [action, focused]);
  function close() {
    // A focused toast is going away: hand focus back to what caused it, else the list.
    if (root.current?.contains(document.activeElement)) {
      const back =
        toast.returnTo?.isConnected && toast.returnTo
          ? toast.returnTo
          : document.querySelector<HTMLElement>('.file-panel .file-row-name');
      back?.focus();
    }
    onDismiss(id);
  }
  const error = toast.tone === 'error';
  return (
    <div
      ref={root}
      className={`toast ${error ? 'error' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <span className="toast-message" aria-hidden>
        {toast.message}
      </span>
      {action && (
        <button
          type="button"
          className="toast-action"
          // aria-disabled, not disabled: a disabled button drops focus.
          aria-disabled={running || undefined}
          aria-busy={running || undefined}
          onClick={async () => {
            if (running) return;
            setRunning(true);
            try {
              await action.run(id);
            } finally {
              setRunning(false);
            }
          }}
        >
          {action.label}
        </button>
      )}
      <button
        ref={dismiss}
        type="button"
        className="toast-dismiss"
        aria-label="Dismiss"
        onClick={close}
      >
        ×
      </button>
    </div>
  );
}
