'use client';

import { useEffect, useState } from 'react';

export type ToastState = {
  id: number;
  message: string;
  tone?: 'info' | 'error';
  action?: { label: string; run: () => void | Promise<void> };
} | null;

const SHOW_MS = 8000;

/** One short message with an optional action (Undo, Show file). Pauses while hovered, focused or running. */
export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  return toast ? <ToastBody key={toast.id} toast={toast} onDismiss={onDismiss} /> : null;
}

function ToastBody({
  toast,
  onDismiss,
}: {
  toast: NonNullable<ToastState>;
  onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [running, setRunning] = useState(false);
  const paused = hovered || focused || running;
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, SHOW_MS);
    return () => clearTimeout(timer);
  }, [paused, onDismiss]);
  const error = toast.tone === 'error';
  const { action } = toast;
  return (
    <div
      className={`toast ${error ? 'error' : ''}`}
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <span className="toast-message">{toast.message}</span>
      {action && (
        <button
          type="button"
          className="toast-action"
          disabled={running}
          aria-busy={running || undefined}
          onClick={async () => {
            setRunning(true);
            try {
              await action.run();
            } finally {
              setRunning(false);
            }
          }}
        >
          {action.label}
        </button>
      )}
      <button type="button" className="toast-dismiss" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
