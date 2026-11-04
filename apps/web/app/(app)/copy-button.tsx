'use client';

import { useState } from 'react';

export function CopyButton({
  text,
  label = 'Copy command',
  caption = 'Copy',
  className = 'copy-button',
}: {
  text: string;
  label?: string;
  caption?: string;
  className?: string;
}) {
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
      <button type="button" className={className} onClick={copy} aria-label={label}>
        {status === 'Copied' ? 'Copied' : caption}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
    </>
  );
}
