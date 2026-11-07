export type ListStatus = 'loading' | 'slow' | 'error';

// The three non-ready states of a loaded list. Empty and zero-match copy stays with each list.
export function ListState({
  status,
  message,
  noun = 'files',
  onRetry,
}: {
  status: ListStatus;
  message?: string | undefined;
  noun?: string;
  onRetry: () => void;
}) {
  if (status === 'loading')
    return (
      <div className="list-state" data-state="loading" aria-busy="true">
        <span role="status" className="sr-only">
          Loading {noun}…
        </span>
        <span className="skeleton-bar" />
        <span className="skeleton-bar" />
        <span className="skeleton-bar" />
      </div>
    );
  return (
    <div
      className={`list-state ${status === 'error' ? 'is-error' : ''}`}
      data-state={status}
      role={status === 'error' ? 'alert' : undefined}
    >
      <h3>{status === 'error' ? `Could not load ${noun}.` : `Still loading ${noun}…`}</h3>
      <p>{status === 'error' ? message : 'This is taking longer than usual.'}</p>
      <button className="button secondary" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
