import {
  answerTraceInboxChallenge,
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

/** Shown when a key is loaded for trace capture and does not belong to the selected drive. */
export const WRONG_KEY = 'That key is not for this drive.';
export const MISMATCH = 'This key does not open this drive’s files.';
export const EMPTY_DRIVE =
  'This drive has no files yet. Load its recovery file or credentials bundle so the key can be matched to the drive.';

/** Throws WRONG_KEY when the drive's files or trace inbox show this key does not belong to it. */
export async function assertKeyForDrive(
  verify: (driveId: string, key: string) => Promise<Verdict>,
  driveId: string,
  key: string,
) {
  if ((await verify(driveId, key)) === 'mismatch') throw new Error(WRONG_KEY);
}

/** The tab's own generated key is trusted only while it is still the key in use. */
export const keySourceFor = (
  generatedKey: string | undefined,
  recorded: Source | undefined,
  key: string,
): Source => (generatedKey === key ? 'trusted' : (recorded ?? 'pasted'));

const conflict = (reason: unknown) => (reason as { status?: number } | null)?.status === 409;

/** The server's answer when the active token is not the one the page last saw. */
export const TAB_CHANGED = 'This changed in another tab.';
export const changedInAnotherTab = (reason: unknown) =>
  conflict(reason) && (reason as Error).message === TAB_CHANGED;

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
  /** The active token id the page last saw (null: none). Omitted when unknown. */
  expectedTokenId?: string | null;
  /** Test seam; production opens the challenge using the exact locally unwrapped inbox key. */
  answerChallenge?: typeof answerTraceInboxChallenge;
}): Promise<WebhookToken> {
  const { request, strictRequest, driveId, key, source, verify } = args;
  const answerChallenge = args.answerChallenge ?? answerTraceInboxChallenge;

  const readInbox = async () => {
    const { inbox } = await request<{ inbox: TraceInboxRecord | null }>(
      `drives/${driveId}/trace-inbox`,
    );
    return inbox;
  };

  async function requestProof(action: 'enroll' | 'issue-token', record: TraceInboxRecord) {
    const challenge = await strictRequest<{ challengeId: string; envelope: string }>(
      `drives/${driveId}/trace-inbox/challenge`,
      'POST',
      {
        action,
        inbox: {
          keyId: record.keyId,
          publicKey: record.publicKey,
          wrappedPrivateKey: record.wrappedPrivateKey,
        },
      },
    );
    let proof: string;
    try {
      proof = await answerChallenge({
        driveId,
        driveKey: key,
        record,
        envelope: challenge.envelope,
      });
    } catch {
      throw new Error(MISMATCH);
    }
    return { challengeId: challenge.challengeId, proof };
  }

  // Returns the exact record the drive has on the server after this call.
  async function ensureInbox(): Promise<TraceInboxRecord> {
    const verifyRecord = async (record: TraceInboxRecord) => {
      const verdict = await verify(driveId, key);
      if (verdict === 'mismatch') throw new Error(MISMATCH);
      if (verdict === 'unverifiable' && !isDriveBoundSource(source)) throw new Error(EMPTY_DRIVE);
      return record;
    };
    const readWinner = async (reason: unknown) => {
      const winner = await readInbox();
      if (!winner) throw reason;
      return verifyRecord(winner);
    };

    const inbox = await readInbox();
    if (inbox) return verifyRecord(inbox);

    // With no inbox to prove against, use a drive file or trusted recovery material. A vault slot
    // alone cannot identify an empty drive.
    const verdict = await verify(driveId, key);
    if (verdict === 'mismatch') throw new Error(MISMATCH);
    if (verdict === 'unverifiable' && !isDriveBoundSource(source)) throw new Error(EMPTY_DRIVE);

    const created = await createTraceInbox(driveId, key);
    let proof: { challengeId: string; proof: string };
    try {
      proof = await requestProof('enroll', created);
    } catch (reason) {
      if (!conflict(reason)) throw reason;
      // Another tab may have enrolled after the initial read but before this challenge request.
      return readWinner(reason);
    }
    try {
      await strictRequest(`drives/${driveId}/trace-inbox`, 'POST', { ...created, ...proof });
      return created;
    } catch (reason) {
      if (!conflict(reason)) throw reason;
      // Another tab created it first: the key must open that inbox.
      // A fresh issue-token challenge below proves possession of the winner's exact private key.
      return readWinner(reason);
    }
  }

  const expected =
    args.expectedTokenId === undefined ? {} : { expectedTokenId: args.expectedTokenId };
  let record = await ensureInbox();
  try {
    const proof = await requestProof('issue-token', record);
    return await strictRequest<WebhookToken>(`drives/${driveId}/webhook-token`, 'POST', {
      ...proof,
      ...expected,
      keyId: record.keyId,
      publicKey: record.publicKey,
      wrappedPrivateKey: record.wrappedPrivateKey,
    });
  } catch (reason) {
    if (!conflict(reason) || changedInAnotherTab(reason)) throw reason;
    record = await ensureInbox();
    const proof = await requestProof('issue-token', record);
    return strictRequest<WebhookToken>(`drives/${driveId}/webhook-token`, 'POST', {
      ...proof,
      ...expected,
      keyId: record.keyId,
      publicKey: record.publicKey,
      wrappedPrivateKey: record.wrappedPrivateKey,
    });
  }
}
