'use client';

import { formatBytes } from '@/src/format/bytes';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BrandMark } from '../../brand-mark';
import { FileIcon } from '../../(app)/console/file-icon';
import {
  decryptWithFileKeyStream,
  DriveCryptoError,
  plaintextSize,
} from '../../../../../packages/agent-drive/src/crypto.ts';
import { fileKind } from '@/src/console/file-tree';
import { validateDownloadUrl } from '@/src/share/url';
import { parseShareFragment } from '@/src/share/fragment';
import {
  cleanupDownloadScratch,
  createDownloadSink,
  DownloadSaveError,
} from '@/src/share/download';

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
  'download-canceled': 'Download canceled',
};

const errorBodies: Record<string, string> = {
  'missing-key': 'Ask the sender for the complete link, including everything after the # symbol.',
  'decryption-failed':
    'The link is complete, but its key does not open this file. Ask the sender to copy the link again, or paste it below.',
  unavailable: 'The file could not be downloaded. Check your connection and try again.',
  'download-canceled': 'No file was saved. You can try again when ready.',
  not_found:
    'This link does not match any shared file. Check the address, or ask the sender for a new link.',
  share_revoked:
    'The sender turned this link off. Ask them for a new link if you still need the file.',
  share_expired: 'This link passed its expiry date. Ask the sender for a new link.',
};
const defaultErrorBody = 'This file cannot be opened right now. Ask the sender for a new link.';

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

async function* responseChunks(
  response: Response,
  total: number,
  onPercent: (percent: number) => void,
  signal: AbortSignal,
) {
  if (!response.body) throw new Error('This browser could not stream the encrypted file.');
  const reader = response.body.getReader();
  let complete = false;
  let received = 0;
  const cancel = () => void reader.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('The download was canceled.', 'AbortError');
      const { done, value } = await reader.read();
      if (signal.aborted) throw new DOMException('The download was canceled.', 'AbortError');
      if (done) {
        complete = true;
        return;
      }
      received += value.byteLength;
      onPercent(total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0);
      yield value;
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete) await reader.cancel(signal.reason).catch(() => undefined);
    reader.releaseLock();
  }
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
  const activeDownload = useRef<AbortController | null>(null);
  const cancelRequested = useRef(false);

  useEffect(() => {
    void cleanupDownloadScratch();
  }, []);
  useEffect(() => () => activeDownload.current?.abort(), []);

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

  async function download(key = fileKey, allowMemory = false) {
    if (!share || !key) return;
    const controller = new AbortController();
    activeDownload.current = controller;
    let sink: Awaited<ReturnType<typeof createDownloadSink>> | undefined;
    setPhase('downloading');
    setPercent(null);
    setSaved('');
    setError(null);
    setErrorCode('');
    try {
      sink = await createDownloadSink(share.name, plaintextSize(share.ciphertextSize), {
        allowLargeBlob: allowMemory,
      });
      const metadata = await fetchShare(id, true);
      if (!metadata.downloadUrl) throw new Error('The download could not be authorized.');
      if (metadata.ciphertextSize !== share.ciphertextSize)
        throw new Error('This shared file changed. Reload the page and try again.');
      const response = await fetch(validateDownloadUrl(metadata.downloadUrl), {
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('The encrypted file could not be downloaded.');
      let bytesWritten = 0;
      for await (const bytes of decryptWithFileKeyStream(
        responseChunks(response, metadata.ciphertextSize, setPercent, controller.signal),
        key,
        metadata.ciphertextSize,
      )) {
        if (controller.signal.aborted) {
          bytes.fill(0);
          throw new DOMException('The download was canceled.', 'AbortError');
        }
        bytesWritten += bytes.byteLength;
        setPhase('decrypting');
        await sink.write(bytes);
      }
      if (bytesWritten !== plaintextSize(metadata.ciphertextSize))
        throw new Error('The decrypted file did not match its expected size.');
      await sink.finish();
      sink = undefined;
      setSaved(metadata.name);
    } catch (reason) {
      await sink?.abort(reason).catch(() => {
        reason = new Error(
          'The download failed, and the temporary plaintext file could not be removed.',
        );
      });
      if (
        cancelRequested.current ||
        controller.signal.aborted ||
        (reason instanceof DOMException && reason.name === 'AbortError') ||
        (reason instanceof DownloadSaveError && reason.code === 'aborted')
      ) {
        setErrorCode('unavailable');
        setError('The download was canceled.');
      } else if (
        (reason instanceof DownloadSaveError && reason.code === 'unsupported-large-download') ||
        (reason instanceof DOMException && reason.name === 'QuotaExceededError')
      ) {
        setErrorCode('large-download-memory');
        setError(
          'The browser could not stage this large download to disk. You can continue with a browser download that may use memory equal to this file size.',
        );
      } else if (reason instanceof DownloadSaveError && reason.code === 'save-gesture-required') {
        setErrorCode('save-picker-gesture');
        setError('Choose Save file again to open the browser file picker.');
      } else if (reason instanceof DriveCryptoError && reason.code === 'decryption_failed') {
        setErrorCode('decryption-failed');
        setError("This link's key doesn't match this file");
      } else {
        setErrorCode(reason instanceof ShareError ? reason.code : 'unavailable');
        setError(reason instanceof Error ? reason.message : 'The file could not be decrypted.');
      }
    } finally {
      cancelRequested.current = false;
      if (activeDownload.current === controller) activeDownload.current = null;
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
                {displayErrorCode === 'unavailable' || displayErrorCode === 'download-canceled' ? (
                  <button className="button share-retry" disabled={busy} onClick={retry}>
                    {displayErrorCode === 'download-canceled' ? 'Download again' : 'Try again'}
                  </button>
                ) : null}
                {displayErrorCode === 'large-download-memory' ? (
                  <button
                    className="button share-retry"
                    disabled={busy}
                    onClick={() => void download(fileKey, true)}
                  >
                    Download using browser memory
                  </button>
                ) : null}
                {displayErrorCode === 'save-picker-gesture' ? (
                  <button
                    className="button share-retry"
                    disabled={busy}
                    onClick={() => void download(fileKey)}
                  >
                    Save file again
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
              {busy ? (
                <button
                  className="button share-retry"
                  onClick={() => {
                    cancelRequested.current = true;
                    activeDownload.current?.abort();
                    setError('No file was saved. You can try again when ready.');
                    setErrorCode('download-canceled');
                  }}
                >
                  Cancel download
                </button>
              ) : null}
              <p className="share-status" role="status">
                {saved ? `Download started: ${saved}. Check your downloads.` : ''}
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
