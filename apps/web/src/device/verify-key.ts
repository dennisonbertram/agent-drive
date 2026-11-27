// Checks a pasted or recovered drive key against the drive it claims, in the browser, before
// the key is sealed to an agent (docs/agent-login.md section 12). Same check the console vault
// makes: the key must unwrap a live file's newest wrapped key, or its trace inbox private key.
// Every call is a metadata GET: no file bodies, and the
// key itself is never sent anywhere.
import { envelopeVersion, unwrapFileKey } from '../../../../packages/agent-drive/src/crypto.ts';
import {
  verifyInboxKeypair,
  type TraceInbox,
  type TraceInboxRecord,
} from '../../../../packages/agent-drive/src/trace-inbox.ts';
import { inboxFor } from '../console/share-link';

/**
 * 'file' — the key opened a live file's envelope; 'inbox' — it opened an empty drive's trace
 * inbox; 'mismatch' — it is well-formed but belongs to a different drive; 'unverifiable' —
 * the drive has no live file and no trace inbox, so nothing can check the key.
 */
export type DriveKeyCheck = 'file' | 'inbox' | 'mismatch' | 'unverifiable';

/** A console GET. Failures throw; the caller decides whether a failed check is fatal. */
export type KeyCheckRequest = (path: string) => Promise<unknown>;

async function inboxOf(request: KeyCheckRequest, driveId: string) {
  const result = (await request(`drives/${driveId}/trace-inbox`)) as {
    inbox: TraceInboxRecord | null;
  };
  return result.inbox;
}

export async function verifyDriveKey(
  request: KeyCheckRequest,
  driveId: string,
  key: string,
): Promise<DriveKeyCheck> {
  // Search returns live files only (unlike list, which can lead with folders). Sample at most
  // ten wrapped keys, since one damaged record must not reject a key that opens another file.
  const sampleLimit = 5;
  const maxSamples = 10;
  const maxPages = Math.ceil(maxSamples / sampleLimit);
  let cursor: string | undefined;
  let sampled = 0;
  let pagesRead = 0;
  let hadEvidence = false;
  let inboxPromise: Promise<TraceInboxRecord | null> | undefined;
  const loadInbox = () => (inboxPromise ??= inboxOf(request, driveId));

  while (sampled < maxSamples && pagesRead < maxPages) {
    const path =
      `drives/${driveId}/search?limit=${sampleLimit}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const page = (await request(path)) as {
      items: { wrappedKey?: string }[];
      nextCursor: string | null;
    };
    pagesRead += 1;
    for (const item of page.items) {
      if (sampled >= maxSamples) break;
      sampled += 1;
      const wrapped = item.wrappedKey;
      if (!wrapped) continue;
      hadEvidence = true;
      let inbox: TraceInbox | undefined;
      let isV2 = false;
      try {
        isV2 = envelopeVersion(wrapped) === 2;
      } catch {
        // The unwrap attempt below records this as corrupt evidence and continues sampling.
      }
      if (isV2) {
        // Keep the request outside the decrypt catch so network/authorization failures propagate.
        const record = await loadInbox();
        if (record) {
          try {
            inbox = inboxFor(driveId, record);
          } catch {
            // A malformed inbox cannot open this envelope; other samples may still verify.
          }
        }
      }
      try {
        await unwrapFileKey(wrapped, key, inbox);
        return 'file';
      } catch {
        // Bad envelopes and failed decryptions are isolated to this sample; keep checking.
      }
      if (sampled >= maxSamples) break;
    }
    if (!page.nextCursor || sampled >= maxSamples) break;
    cursor = page.nextCursor;
  }

  const record = await loadInbox();
  if (record) {
    hadEvidence = true;
    try {
      await verifyInboxKeypair(inboxFor(driveId, record), key);
      return 'inbox';
    } catch {
      // A corrupt inbox is still evidence, but cannot establish this key as correct.
    }
  }
  return hadEvidence ? 'mismatch' : 'unverifiable';
}
