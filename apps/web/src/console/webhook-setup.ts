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
  if (verdict === 'unverifiable' && source === 'pasted') throw new Error(EMPTY_DRIVE);

  async function ensureInbox() {
    const { inbox } = await request<{ inbox: TraceInboxRecord | null }>(
      `drives/${driveId}/trace-inbox`,
    );
    if (inbox) return;
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
