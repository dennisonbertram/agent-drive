'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { looksBinary, previewMime } from '@/src/console/preview';

export type PreviewView =
  | { status: 'loading' }
  | { status: 'ready'; kind: 'text' | 'image' | 'pdf'; bytes: Uint8Array }
  | { status: 'too-large'; sizeLabel: string }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

/**
 * Body of the preview dialog. The file is untrusted: text is rendered as a React text child
 * (escaped), HTML and SVG are text, and the only blob URLs are images and PDFs whose MIME type
 * comes from the console's fixed allowlist by file name, never from the bytes.
 */
export function PreviewBody({ name, view }: { name: string; view: PreviewView }) {
  // The one place blob URLs are created. The cleanup revokes the URL on close, on switching
  // files, and when the panel unmounts (drive change, idle lock).
  const bytes = view.status === 'ready' && view.kind !== 'text' ? view.bytes : null;
  const mime = previewMime(name);
  const [url, setUrl] = useState('');
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // When the PDF was opened in its own tab; that tab needs the URL for about a minute.
  const openedAt = useRef(0);
  useEffect(() => {
    if (!bytes || !mime) return;
    const made = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
    openedAt.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL must be created and revoked by this effect
    setUrl(made);
    return () => {
      const wait = openedAt.current ? openedAt.current + 60_000 - Date.now() : 0;
      if (wait > 0) setTimeout(() => URL.revokeObjectURL(made), wait);
      else URL.revokeObjectURL(made);
    };
  }, [bytes, mime]);

  const text = useMemo(
    () =>
      view.status === 'ready' && view.kind === 'text' && !looksBinary(view.bytes)
        ? new TextDecoder('utf-8').decode(view.bytes)
        : null,
    [view],
  );

  let body;
  if (view.status === 'loading') {
    body = <p className="preview-note">Decrypting {name} in your browser…</p>;
  } else if (view.status === 'too-large') {
    body = (
      <p className="preview-note">
        Too large to preview ({view.sizeLabel}). Download it to open it on your computer.
      </p>
    );
  } else if (view.status === 'unsupported') {
    body = <p className="preview-note">No preview for this file type.</p>;
  } else if (view.status === 'error') {
    body = (
      <p className="preview-note" role="alert">
        {view.message}
        {view.message.startsWith('Unable to decrypt') &&
          ' Forget the key from the key chip and load the right recovery file.'}
      </p>
    );
  } else if (view.kind === 'text') {
    body =
      text === null ? (
        <p className="preview-note">This file has binary content, so it can’t be shown as text.</p>
      ) : (
        <pre className="preview-text">{text}</pre>
      );
  } else if (view.kind === 'image') {
    body =
      failedUrl === url ? (
        <p className="preview-note">This image could not be shown.</p>
      ) : (
        url && (
          <img className="preview-image" src={url} alt={name} onError={() => setFailedUrl(url)} />
        )
      );
  } else {
    // PDFs are never embedded: a link inside a PDF could navigate this key-holding tab.
    body = (
      <div className="preview-note">
        <p>PDF files open in a separate tab.</p>
        <button
          type="button"
          className="button"
          disabled={!url}
          onClick={() => {
            openedAt.current = Date.now();
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
        >
          Open PDF in new tab
        </button>
      </div>
    );
  }

  return (
    <div
      className="preview-body"
      tabIndex={0}
      aria-label={`Preview of ${name}`}
      aria-busy={view.status === 'loading' || undefined}
      data-autofocus
    >
      {body}
    </div>
  );
}
