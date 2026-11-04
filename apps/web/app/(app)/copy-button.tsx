'use client';

import { useState } from 'react';

export function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState('');
  const copy = () => {
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
      <button type="button" className="copy-button" onClick={copy} aria-label="Copy command">
        {status === 'Copied' ? 'Copied' : 'Copy'}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
    </>
  );
}
