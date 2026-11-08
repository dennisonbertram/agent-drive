import {
  createTraceInbox,
  type TraceInboxRecord,
} from '../../../../packages/agent-drive/src/trace-inbox.ts';
import type { Request } from './share-link';

/** Where the key came from. Only `pasted` cannot prove it belongs to this drive. */
export type Source = 'trusted' | 'recovery-file' | 'bundle' | 'pasted' | 'vault';
export type Verdict = 'file' | 'inbox' | 'mismatch' | 'unverifiable';
export type WebhookToken = { id: string; token: string; url: string; createdAt: string };

export const MISMATCH = 'This key does not open this drive’s files.';
export const EMPTY_DRIVE =
  'This drive has no files yet. Load its recovery file or credentials bundle so the key can be matched to the drive.';

/** The tab's own generated key is trusted only while it is still the key in use. */
export const keySourceFor = (
  generatedKey: string | undefined,
  recorded: Source | undefined,
  key: string,
): Source => (generatedKey === key ? 'trusted' : (recorded ?? 'pasted'));

const conflict = (reason: unknown) => (reason as { status?: number } | null)?.status === 409;

/**
 * Creates the trace inbox (if the drive has none) and a new webhook token, after proving the key
 * belongs to this drive. A wrong key sealed into the inbox would make every later trace unreadable.
 */
export async function setUpWebhook(args: {
  request: Request;
  driveId: string;
  key: string;
  source: Source;
  verify: (driveId: string, key: string) => Promise<Verdict>;
}): Promise<WebhookToken> {
  const { request, driveId, key, source, verify } = args;
  const verdict = await verify(driveId, key);
  if (verdict === 'mismatch') throw new Error(MISMATCH);
  // Only a key bound to this drive may create the inbox when there is nothing to check it against.
  // A vault slot is only unsealed, never matched to the drive.
  if (verdict === 'unverifiable' && (source === 'pasted' || source === 'vault'))
    throw new Error(EMPTY_DRIVE);

  async function ensureInbox() {
    const { inbox } = await request<{ inbox: TraceInboxRecord | null }>(
      `drives/${driveId}/trace-inbox`,
    );
    if (inbox) {
      // An inbox that appeared after the first check (another tab) must open with this key.
      if (verdict === 'unverifiable') {
        const again = await verify(driveId, key);
        if (again !== 'file' && again !== 'inbox') throw new Error(MISMATCH);
      }
      return;
    }
    try {
      await request(`drives/${driveId}/trace-inbox`, 'POST', await createTraceInbox(driveId, key));
    } catch (reason) {
      if (!conflict(reason)) throw reason;
      // Another tab created it first: the key must open that inbox.
      const again = await verify(driveId, key);
      if (again !== 'file' && again !== 'inbox') throw new Error(MISMATCH);
    }
  }

  await ensureInbox();
  try {
    return await request<WebhookToken>(`drives/${driveId}/webhook-token`, 'POST');
  } catch (reason) {
    if (!conflict(reason)) throw reason;
    await ensureInbox();
    return request<WebhookToken>(`drives/${driveId}/webhook-token`, 'POST');
  }
}
