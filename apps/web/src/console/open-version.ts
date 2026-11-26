import {
  decryptWithFileKeyStream,
  envelopeVersion,
  unwrapFileKey,
} from '../../../../packages/agent-drive/src/crypto.ts';
import type { TraceInboxRecord } from '../../../../packages/agent-drive/src/trace-inbox.ts';
import { validateDownloadUrl } from '../share/url';
import { MISSING_INBOX, inboxFor } from './share-link';

type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>;

/** Per-drive memo of the trace inbox request, so many opens fetch it once. */
export type InboxCache = Map<string, Promise<TraceInboxRecord | null>>;

export function loadInbox(api: Api, cache: InboxCache, driveId: string) {
  let pending = cache.get(driveId);
  if (!pending) {
    pending = api<{ inbox: TraceInboxRecord | null }>(`drives/${driveId}/trace-inbox`).then(
      (result) => result.inbox,
    );
    // A failed request is not remembered.
    pending.catch(() => {
      if (cache.get(driveId) === pending) cache.delete(driveId);
    });
    cache.set(driveId, pending);
  }
  return pending;
}

/** Collect a verified stream only when the caller has a strict plaintext budget, such as Preview. */
export async function openVersion(
  api: Api,
  driveId: string,
  metadata: { wrappedKey: string; downloadUrl: string; ciphertextSize: number },
  key: string,
  inboxCache: InboxCache,
  maxPlaintextBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxPlaintextBytes) || maxPlaintextBytes < 0)
    throw new Error('The preview size limit is invalid.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const bytes of openVersionStream(api, driveId, metadata, key, inboxCache)) {
      if (total + bytes.byteLength > maxPlaintextBytes) {
        bytes.fill(0);
        throw new Error('This file is too large to preview. Download it to view the full file.');
      }
      chunks.push(bytes);
      total += bytes.byteLength;
    }
    const plaintext = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      plaintext.set(chunk, offset);
      offset += chunk.byteLength;
      chunk.fill(0);
    }
    return plaintext;
  } catch (error) {
    for (const chunk of chunks) chunk.fill(0);
    throw error;
  }
}

async function* responseChunks(
  response: Response,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  const body = response.body;
  if (!body) throw new Error('This browser could not stream the encrypted file.');
  const reader = body.getReader();
  let complete = false;
  const cancel = () => void reader.cancel(signal?.reason).catch(() => undefined);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('The download was canceled.', 'AbortError');
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException('The download was canceled.', 'AbortError');
      if (done) {
        complete = true;
        return;
      }
      if (value?.byteLength) yield value;
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!complete) await reader.cancel(signal?.reason).catch(() => undefined);
    reader.releaseLock();
  }
}

/** Streams an authenticated version to its caller without buffering the full ciphertext. */
export async function* openVersionStream(
  api: Api,
  driveId: string,
  metadata: { wrappedKey: string; downloadUrl: string; ciphertextSize: number },
  key: string,
  inboxCache: InboxCache,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  const url = validateDownloadUrl(metadata.downloadUrl);
  const expectedCiphertextBytes = Number(metadata.ciphertextSize);
  if (!Number.isSafeInteger(expectedCiphertextBytes) || expectedCiphertextBytes < 1)
    throw new Error('The encrypted file size is invalid. Reload the file list and try again.');

  // Start the v2 inbox request while ciphertext is arriving, as in openVersion.
  const pendingInbox =
    envelopeVersion(metadata.wrappedKey) === 2 ? loadInbox(api, inboxCache, driveId) : undefined;
  let response: Response | null;
  try {
    response = await fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
  } catch {
    if (signal?.aborted) throw new DOMException('The download was canceled.', 'AbortError');
    response = null;
  }
  if (!response?.ok) throw new Error('The encrypted file could not be downloaded.');

  let inbox;
  if (pendingInbox) {
    const record = await pendingInbox;
    if (!record) throw new Error(MISSING_INBOX);
    inbox = inboxFor(driveId, record);
  }
  const fileKey = await unwrapFileKey(metadata.wrappedKey, key, inbox);
  yield* decryptWithFileKeyStream(
    responseChunks(response, signal),
    fileKey,
    expectedCiphertextBytes,
  );
}
