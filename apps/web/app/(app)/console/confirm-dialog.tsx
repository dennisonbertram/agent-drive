'use client';

/** Body of the in-app confirm dialog. Cancel has focus, so Enter never destroys anything. */
export function ConfirmBody({
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="confirm">
      <p>{message}</p>
      <div className="confirm-actions">
        <button type="button" className="button secondary" data-autofocus onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button danger" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
