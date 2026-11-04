'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  decryptWithFileKey,
  DriveCryptoError,
} from '../../../../../packages/agent-drive/src/crypto.ts';
import { validateDownloadUrl } from '@/src/share/url';
import { parseShareFragment } from '@/src/share/fragment';

type ShareMetadata = {
  name: string;
  ciphertextSize: number;
  expiresAt: string;
  downloadUrl?: string;
};

const errorHeadings: Record<string, string> = {
  'missing-key': 'This link is missing a valid decryption key',
  not_found: 'Share link not found',
  share_revoked: 'Share link revoked',
  share_expired: 'Share link expired',
  share_unavailable: 'Shared file unavailable',
  'decryption-failed': "This link's key can't decrypt this file",
  unavailable: 'Share unavailable',
};

class ShareError extends Error {
  constructor(readonly code: string) {
    super(errorHeadings[code] ?? errorHeadings.unavailable);
  }
}

async function fetchShare(id: string, download = false): Promise<ShareMetadata> {
  const response = await fetch(
    `/api/shares/${encodeURIComponent(id)}${download ? '' : '?metadataOnly=1'}`,
    {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    },
  );
  if (!response.ok) {
    const body = (await response.json()) as { error?: { code?: string } };
    throw new ShareError(body.error?.code ?? 'unavailable');
  }
  return response.json() as Promise<ShareMetadata>;
}

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function currentHash() {
  return window.location.hash;
}

export default function ShareClient({ id }: { id: string }) {
  const fragment = useSyncExternalStore(subscribeToHash, currentHash, () => '');
  const fileKey = parseShareFragment(fragment);
  const [share, setShare] = useState<ShareMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!fileKey) return;
    let active = true;
    void fetchShare(id)
      .then((metadata) => {
        if (active) {
          setShare(metadata);
          setError(null);
          setErrorCode('');
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : 'This share link could not be opened.',
          );
          setErrorCode(reason instanceof ShareError ? reason.code : 'unavailable');
        }
      });
    return () => {
      active = false;
    };
  }, [fileKey, id]);

  async function download() {
    if (!share || !fileKey) return;
    setBusy(true);
    try {
      const metadata = await fetchShare(id, true);
      if (!metadata.downloadUrl) throw new Error('The download could not be authorized.');
      const response = await fetch(validateDownloadUrl(metadata.downloadUrl), {
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('The encrypted file could not be downloaded.');
      const bytes = await decryptWithFileKey(new Uint8Array(await response.arrayBuffer()), fileKey);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = metadata.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) {
      if (reason instanceof DriveCryptoError && reason.code === 'decryption_failed') {
        setErrorCode('decryption-failed');
        setError("This link's key can't decrypt this file");
      } else {
        setErrorCode(reason instanceof ShareError ? reason.code : 'unavailable');
        setError(reason instanceof Error ? reason.message : 'The file could not be decrypted.');
      }
    } finally {
      setBusy(false);
    }
  }

  const displayError = error ?? (fileKey ? null : 'This link is missing a valid decryption key.');
  const displayErrorCode = errorCode || (fileKey ? '' : 'missing-key');

  return (
    <main className="share-shell" data-testid="share-page">
      <Link className="brand" href="/" aria-label="Agent Drive home">
        <span className="brand-mark" aria-hidden="true">
          a/
        </span>
        agent drive
      </Link>
      <section className="share-card" aria-live="polite">
        <div className="share-symbol" aria-hidden="true">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
          </svg>
        </div>
        <p className="eyebrow">ENCRYPTED FILE TRANSFER</p>
        <h1 data-testid={displayError ? `share-error-${displayErrorCode}` : undefined}>
          {displayError
            ? (errorHeadings[displayErrorCode] ?? errorHeadings.unavailable)
            : (share?.name ?? 'Opening secure link')}
        </h1>
        {displayError ? (
          <p data-testid="share-error">
            {displayErrorCode === 'missing-key' || displayErrorCode === 'decryption-failed'
              ? 'Ask the sender for the complete link, including everything after the # symbol.'
              : 'Ask the sender for a new share link. Your files have not been changed.'}
          </p>
        ) : share ? (
          <>
            <div className="share-details">
              <div>
                <span>TRANSFER SIZE</span>
                <strong>{share.ciphertextSize.toLocaleString()} encrypted bytes</strong>
              </div>
              <div>
                <span>LINK EXPIRES</span>
                <strong>{new Date(share.expiresAt).toLocaleString()}</strong>
              </div>
            </div>
            <button
              className="button primary share-download"
              disabled={busy}
              onClick={() => void download()}
            >
              {busy ? 'Decrypting…' : 'Download'}
            </button>
            <p>Your browser decrypts this file. No sign-in required.</p>
          </>
        ) : (
          <p>Checking this share link…</p>
        )}
      </section>
      <p className="share-footer">Client-side encryption. The key stays in your browser.</p>
    </main>
  );
}
