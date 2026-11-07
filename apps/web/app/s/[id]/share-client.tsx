'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { BrandMark } from '../../brand-mark';
import { FileIcon } from '../../(app)/console/file-icon';
import {
  decryptWithFileKey,
  DriveCryptoError,
  plaintextSize,
} from '../../../../../packages/agent-drive/src/crypto.ts';
import { fileKind } from '@/src/console/file-tree';
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
  'decryption-failed': "This link's key doesn't match this file",
  unavailable: 'Share unavailable',
};

const errorBodies: Record<string, string> = {
  'missing-key': 'Ask the sender for the complete link, including everything after the # symbol.',
  'decryption-failed':
    'The link is complete, but its key does not open this file. Ask the sender to copy the link again, or paste it below.',
  unavailable: 'The file could not be downloaded. Check your connection and try again.',
  not_found:
    'This link does not match any shared file. Check the address, or ask the sender for a new link.',
  share_revoked:
    'The sender turned this link off. Ask them for a new link if you still need the file.',
  share_expired: 'This link passed its expiry date. Ask the sender for a new link.',
};
const defaultErrorBody = 'This file cannot be opened right now. Ask the sender for a new link.';

// TODO(P3): replace this local helper with the shared decimal `formatBytes` from
// `@/src/format/bytes` (owned by agent-drive-r5-p3-billing). Same rule: 1 KB = 1000 B.
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

function plainSizeLabel(ciphertextSize: number) {
  try {
    return formatBytes(plaintextSize(ciphertextSize));
  } catch {
    return 'Unknown';
  }
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

/** Reads the encrypted body, reporting whole percent of `total` as bytes arrive (never sent anywhere). */
async function readBody(response: Response, total: number, onPercent: (percent: number) => void) {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onPercent(total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
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
  let linkedId = '';
  try {
    linkedId = decodeURIComponent(linkId ?? '');
  } catch {
    // A malformed percent-escape cannot match this share.
  }
  if (route !== 's' || linkedId !== id) {
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
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'decrypting'>('idle');
  const [percent, setPercent] = useState<number | null>(null);
  const [saved, setSaved] = useState('');
  const busy = phase !== 'idle';
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
    setPhase('downloading');
    setPercent(null);
    setSaved('');
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
      const encrypted = await readBody(response, metadata.ciphertextSize, setPercent);
      setPhase('decrypting');
      const bytes = await decryptWithFileKey(encrypted, key);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = metadata.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setSaved(metadata.name);
    } catch (reason) {
      if (reason instanceof DriveCryptoError && reason.code === 'decryption_failed') {
        setErrorCode('decryption-failed');
        setError("This link's key doesn't match this file");
      } else {
        setErrorCode(reason instanceof ShareError ? reason.code : 'unavailable');
        setError(reason instanceof Error ? reason.message : 'The file could not be decrypted.');
      }
    } finally {
      setPhase('idle');
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
            <h1 className="share-label">
              {share ? (
                <>
                  <span className="share-icon">
                    <FileIcon kind={fileKind(share.name)} />
                  </span>
                  {share.name}
                </>
              ) : (
                'Opening link…'
              )}
            </h1>
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
                        placeholder="https://…/s/…#k=…"
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
                <Link className="share-home" href="/">
                  Go to Agent Drive
                </Link>
              </div>
            ) : share ? (
              <div className="share-details">
                <div>
                  <span>SIZE</span>
                  <strong>{plainSizeLabel(share.ciphertextSize)}</strong>
                </div>
                <div>
                  <span>LINK EXPIRES</span>
                  <strong>{formatExpiry(share.expiresAt)}</strong>
                </div>
              </div>
            ) : (
              <div className="share-details" aria-hidden="true">
                <div>
                  <span>SIZE</span>
                  <strong>&nbsp;</strong>
                </div>
                <div>
                  <span>LINK EXPIRES</span>
                  <strong>&nbsp;</strong>
                </div>
              </div>
            )}
          </div>
          {displayError ? null : (
            <>
              <button
                className="button primary share-download"
                disabled={!share || busy}
                onClick={() => void download()}
              >
                {phase === 'downloading'
                  ? percent === null
                    ? 'Downloading…'
                    : `Downloading ${percent}%`
                  : phase === 'decrypting'
                    ? 'Decrypting…'
                    : 'Download'}
              </button>
              <p className="share-status" role="status">
                {saved ? `Saved ${saved}.` : ''}
              </p>
            </>
          )}
        </div>
      </section>
      {displayError ? null : (
        <p className="share-footer">
          Your browser decrypts this file and the key never leaves it. No sign-in required.
        </p>
      )}
    </main>
  );
}
