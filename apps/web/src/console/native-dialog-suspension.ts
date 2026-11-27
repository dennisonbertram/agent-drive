/** Temporarily leave the browser's top layer so an external authentication prompt can be used. */
export function suspendNativeDialog(dialog: HTMLDialogElement | null): () => void {
  if (!dialog?.isConnected || !dialog.open) return () => {};

  const focused = document.activeElement;
  dialog.close();
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    if (!dialog.isConnected || dialog.open) return;

    dialog.showModal();
    const focusTarget =
      focused instanceof HTMLElement && focused.isConnected && dialog.contains(focused)
        ? focused
        : dialog;
    focusTarget.focus();
  };
}
