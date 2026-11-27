import {
  createTraceInbox,
  type TraceInboxRecord,
} from '../../../../packages/agent-drive/src/trace-inbox.ts';
import type { Request } from './share-link';

/** Where the key came from. Only `pasted` cannot prove it belongs to this drive. */
export type Source = 'trusted' | 'recovery-file' | 'bundle' | 'pasted' | 'vault';
export type Verdict = 'file' | 'inbox' | 'mismatch' | 'unverifiable';
export type WebhookToken = { id: string; token: string; url: string; createdAt: string };

/** A local generated key or selected-drive recovery material can identify a truly empty drive. */
export const isDriveBoundSource = (source: Source) =>
  source === 'trusted' || source === 'recovery-file' || source === 'bundle';

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
  strictRequest: Request;
  driveId: string;
  key: string;
  source: Source;
  verify: (driveId: string, key: string) => Promise<Verdict>;
  verifyInbox: (driveId: string, key: string, record: TraceInboxRecord) => Promise<boolean>;
}): Promise<WebhookToken> {
  const { request, strictRequest, driveId, key, source, verify, verifyInbox } = args;

  const readInbox = async () => {
    const { inbox } = await request<{ inbox: TraceInboxRecord | null }>(
      `drives/${driveId}/trace-inbox`,
    );
    return inbox;
  };

  async function proveInbox(record: TraceInboxRecord) {
    if (!(await verifyInbox(driveId, key, record))) throw new Error(MISMATCH);
  }

  // Returns the exact record the drive has on the server after this call.
  async function ensureInbox(): Promise<TraceInboxRecord> {
    const inbox = await readInbox();
    if (inbox) {
      // Prove this exact record even when a file also proves the drive key. Otherwise a changed
      // inbox could receive traces the drive key cannot open.
      await proveInbox(inbox);
      return inbox;
    }

    // With no inbox to prove against, use a drive file or trusted recovery material. A vault slot
    // alone cannot identify an empty drive.
    const verdict = await verify(driveId, key);
    if (verdict === 'mismatch') throw new Error(MISMATCH);
    if (verdict === 'unverifiable' && !isDriveBoundSource(source)) throw new Error(EMPTY_DRIVE);

    const created = await createTraceInbox(driveId, key);
    await proveInbox(created);
    try {
      await strictRequest(`drives/${driveId}/trace-inbox`, 'POST', created);
      return created;
    } catch (reason) {
      if (!conflict(reason)) throw reason;
      // Another tab created it first: the key must open that inbox.
      const winner = await readInbox();
      if (!winner) throw reason;
      await proveInbox(winner);
      return winner;
    }
  }

  let record = await ensureInbox();
  try {
    return await strictRequest<WebhookToken>(`drives/${driveId}/webhook-token`, 'POST', {
      keyId: record.keyId,
      publicKey: record.publicKey,
      wrappedPrivateKey: record.wrappedPrivateKey,
    });
  } catch (reason) {
    if (!conflict(reason)) throw reason;
    record = await ensureInbox();
    return strictRequest<WebhookToken>(`drives/${driveId}/webhook-token`, 'POST', {
      keyId: record.keyId,
      publicKey: record.publicKey,
      wrappedPrivateKey: record.wrappedPrivateKey,
    });
  }
}
