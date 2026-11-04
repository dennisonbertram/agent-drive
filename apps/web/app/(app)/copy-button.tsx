'use client';

import { useState } from 'react';

export function CopyButton({ text, label = 'Copy command' }: { text: string; label?: string }) {
  const [status, setStatus] = useState('');
  const copy = () => {
    // navigator.clipboard is undefined on insecure (plain HTTP) origins.
    if (!navigator.clipboard?.writeText) {
      setStatus('Copy failed');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        setStatus('Copied');
        setTimeout(() => setStatus(''), 2000);
      },
      () => setStatus('Copy failed'),
    );
  };
  return (
    <>
      <button type="button" className="copy-button" onClick={copy} aria-label={label}>
        {status === 'Copied' ? 'Copied' : 'Copy'}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
    </>
  );
}
