// Checks a pasted or recovered drive key against the drive it claims, in the browser, before
// the key is sealed to an agent (docs/agent-login.md section 12). Same check the console vault
// makes: the key must unwrap one live file's newest wrapped key, or — for a drive with no
// files — its trace inbox private key. Every call is a metadata GET: no file bodies, and the
// key itself is never sent anywhere.
import { envelopeVersion, unwrapFileKey } from '../../../../packages/agent-drive/src/crypto.ts';
import {
  unwrapInboxPrivateKey,
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
  // `search` rather than `list`: it only ever returns live files, never the folder rows a
  // `list` page can lead with, and each row already carries the newest version's wrapped key.
  const probe = (await request(`drives/${driveId}/search?limit=1`)) as {
    items: { wrappedKey?: string }[];
  };
  const wrapped = probe.items[0]?.wrappedKey;
  if (wrapped) {
    // A v2 envelope is sealed to the drive's trace inbox; the inbox record is needed to open it.
    let inbox: TraceInbox | undefined;
    if (envelopeVersion(wrapped) === 2) {
      const record = await inboxOf(request, driveId);
      inbox = record ? inboxFor(driveId, record) : undefined;
    }
    try {
      await unwrapFileKey(wrapped, key, inbox);
      return 'file';
    } catch {
      return 'mismatch';
    }
  }
  const record = await inboxOf(request, driveId);
  if (!record) return 'unverifiable';
  try {
    await unwrapInboxPrivateKey(inboxFor(driveId, record), key);
    return 'inbox';
  } catch {
    return 'mismatch';
  }
}
