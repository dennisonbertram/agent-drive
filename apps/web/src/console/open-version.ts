import { decryptFile, envelopeVersion } from '../../../../packages/agent-drive/src/crypto.ts';
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

/** Downloads one version's ciphertext and decrypts it in memory (v1 and v2 envelopes). */
export async function openVersion(
  api: Api,
  driveId: string,
  metadata: { wrappedKey: string; downloadUrl: string },
  key: string,
  inboxCache: InboxCache,
): Promise<Uint8Array> {
  const url = validateDownloadUrl(metadata.downloadUrl);
  // A v2 envelope needs the trace inbox; its request overlaps the ciphertext download.
  const pendingInbox =
    envelopeVersion(metadata.wrappedKey) === 2 ? loadInbox(api, inboxCache, driveId) : undefined;
  const response = await fetch(url, {
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  }).catch(() => null);
  if (!response?.ok) throw new Error('The encrypted file could not be downloaded.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let inbox;
  if (pendingInbox) {
    const record = await pendingInbox;
    if (!record) throw new Error(MISSING_INBOX);
    inbox = inboxFor(driveId, record);
  }
  return decryptFile(bytes, metadata.wrappedKey, key, inbox);
}
