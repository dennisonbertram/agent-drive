'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { BrandMark } from '../../brand-mark';
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

const errorBodies: Record<string, string> = {
  'missing-key': 'Ask the sender for the complete link, including everything after the # symbol.',
  'decryption-failed':
    'Ask the sender for the complete link, including everything after the # symbol.',
  unavailable: 'The file could not be downloaded. Check your connection and try again.',
  not_found:
    'This link does not match any shared file. Check the address, or ask the sender for a new link.',
  share_revoked:
    'The sender turned this link off. Ask them for a new link if you still need the file.',
  share_expired: 'This link passed its expiry date. Ask the sender for a new link.',
};
const defaultErrorBody = 'This file cannot be opened right now. Ask the sender for a new link.';

function formatBytes(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1000;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function formatExpiry(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

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

const keyFixCodes = ['missing-key', 'decryption-failed'];

/** Returns the key from a pasted full link for this share, or an inline error message. */
function keyFromPastedLink(value: string, id: string): { key: string } | { problem: string } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { problem: 'That is not a full link. Paste the whole address, starting with https://.' };
  }
  const [, route, linkId] = url.pathname.split('/');
  if (route !== 's' || decodeURIComponent(linkId ?? '') !== id) {
    return { problem: 'That link is for a different share. Paste the link for this file.' };
  }
  const key = parseShareFragment(url.hash);
  return key ? { key } : { problem: 'That link does not include a valid key after the # symbol.' };
}

function currentHash() {
  return window.location.hash;
}

export default function ShareClient({ id }: { id: string }) {
  const fragment = useSyncExternalStore<string | null>(subscribeToHash, currentHash, () => null);
  // Before hydration the fragment is unknown (null), so show the loading state, not a missing-key error.
  const fileKey = fragment === null ? null : parseShareFragment(fragment);
  const [share, setShare] = useState<ShareMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pasted, setPasted] = useState('');
  const [pasteProblem, setPasteProblem] = useState('');

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
  }, [fileKey, id, attempt]);

  async function download(key = fileKey) {
    if (!share || !key) return;
    setBusy(true);
    setError(null);
    setErrorCode('');
    try {
      const metadata = await fetchShare(id, true);
      if (!metadata.downloadUrl) throw new Error('The download could not be authorized.');
      const response = await fetch(validateDownloadUrl(metadata.downloadUrl), {
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('The encrypted file could not be downloaded.');
      const bytes = await decryptWithFileKey(new Uint8Array(await response.arrayBuffer()), key);
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

  function retry() {
    if (share) void download();
    else {
      setError(null);
      setErrorCode('');
      setAttempt((n) => n + 1);
    }
  }

  function usePastedLink(event: React.FormEvent) {
    event.preventDefault();
    const result = keyFromPastedLink(pasted, id);
    if ('problem' in result) {
      setPasteProblem(result.problem);
      return;
    }
    // The key stays in this browser: update the fragment in place, never send it anywhere.
    window.history.replaceState(null, '', `${window.location.pathname}#k=${result.key}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    setPasted('');
    setPasteProblem('');
    setError(null);
    setErrorCode('');
    if (share) void download(result.key);
  }

  const displayError =
    error ?? (fileKey || fragment === null ? null : 'This link is missing a valid decryption key.');
  const displayErrorCode = errorCode || (fileKey || fragment === null ? '' : 'missing-key');

  const state = displayError ? 'error' : share ? 'ready' : 'loading';

  return (
    <main className="share-shell" data-testid="share-page">
      <BrandMark />
      <section className="share-card" data-state={state} aria-live="polite">
        <div className="share-head">
          <span className="share-led" aria-hidden="true" />
          <p className="share-tag">ENCRYPTED FILE TRANSFER</p>
          <span className="share-vent" aria-hidden="true" />
        </div>
        <div className="share-sled">
          {displayError ? null : (
            <h1 className="share-label">{share?.name ?? 'Opening secure link'}</h1>
          )}
          <div className="share-window">
            {displayError ? (
              <div className="share-fault">
                <h1 data-testid={`share-error-${displayErrorCode}`}>
                  {errorHeadings[displayErrorCode] ?? errorHeadings.unavailable}
                </h1>
                <p className="share-msg" data-testid="share-error">
                  {errorBodies[displayErrorCode] ?? defaultErrorBody}
                </p>
                {keyFixCodes.includes(displayErrorCode) ? (
                  <form className="share-paste" onSubmit={usePastedLink}>
                    <label htmlFor="share-paste-link">Paste the full share link</label>
                    <div className="share-paste-row">
                      <input
                        id="share-paste-link"
                        type="text"
                        value={pasted}
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={pasteProblem ? true : undefined}
                        aria-describedby={pasteProblem ? 'share-paste-problem' : undefined}
                        onChange={(event) => {
                          setPasted(event.target.value);
                          setPasteProblem('');
                        }}
                      />
                      <button className="button" type="submit" disabled={!pasted.trim()}>
                        Use link
                      </button>
                    </div>
                    {pasteProblem ? (
                      <p id="share-paste-problem" className="share-paste-problem" role="alert">
                        {pasteProblem}
                      </p>
                    ) : null}
                  </form>
                ) : null}
                {displayErrorCode === 'unavailable' ? (
                  <button className="button share-retry" disabled={busy} onClick={retry}>
                    Try again
                  </button>
                ) : null}
              </div>
            ) : share ? (
              <div className="share-details">
                <div>
                  <span>TRANSFER SIZE</span>
                  <strong>{formatBytes(share.ciphertextSize)} encrypted</strong>
                </div>
                <div>
                  <span>LINK EXPIRES</span>
                  <strong>{formatExpiry(share.expiresAt)}</strong>
                </div>
              </div>
            ) : (
              <p className="share-msg">Checking this share link…</p>
            )}
          </div>
          {share && !displayError ? (
            <button
              className="button primary share-download"
              disabled={busy}
              onClick={() => void download()}
            >
              {busy ? 'Decrypting…' : 'Download'}
            </button>
          ) : null}
        </div>
      </section>
      <p className="share-footer">
        Your browser decrypts this file and the key never leaves it. No sign-in required.
      </p>
    </main>
  );
}
