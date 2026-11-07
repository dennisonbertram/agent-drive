import { unwrapFileKey } from '../../../../packages/agent-drive/src/crypto.ts';

export type ShareExpiry = '1h' | '24h' | '7d' | '30d';
export const DEFAULT_EXPIRY: ShareExpiry = '7d';

export type Request = <T>(path: string, method?: string, body?: unknown) => Promise<T>;

const HOUR = 3_600_000;
// The server allows at most 30 days from its own clock; 1 hour of margin covers a fast client clock.
const OFFSET: Record<ShareExpiry, number> = {
  '1h': HOUR,
  '24h': 24 * HOUR,
  '7d': 168 * HOUR,
  '30d': 719 * HOUR,
};

export function expiresAtFor(choice: ShareExpiry, now: number): string {
  return new Date(now + OFFSET[choice]).toISOString();
}

export type ShareRow = {
  id: string;
  path: string;
  versionId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  status: 'active' | 'expired' | 'revoked' | 'unavailable';
};

export type ShareLink = { id: string; url: string; expiresAt: string; createdAt: string };

export const shareUrl = (origin: string, id: string, fileKey: string) =>
  `${origin}/s/${id}#k=${fileKey}`;

/** Adds a row unless a row with that id is already listed (a list load and a create can both bring it). */
export function addShareRow(items: ShareRow[], row: ShareRow): ShareRow[] {
  return items.some((item) => item.id === row.id) ? items : [row, ...items];
}

/**
 * After a failure that may have come after the server created the link (a lost response, a 5xx),
 * look for it in the drive's newest links: same path and version, not listed before the attempt,
 * created since it began. Returns its URL, rebuilt from the file key already held, or null.
 */
export async function recoverShareLink(
  request: Request,
  args: {
    origin: string;
    driveId: string;
    path: string;
    versionId: string;
    fileKey: string;
    knownIds: Set<string>;
    since: number;
  },
): Promise<ShareLink | null> {
  const page = await request<{ items: ShareRow[] }>(
    `drives/${encodeURIComponent(args.driveId)}/shares?limit=100`,
  );
  const found = page.items
    .filter(
      (row) =>
        row.path === args.path &&
        row.versionId === args.versionId &&
        row.status === 'active' &&
        !args.knownIds.has(row.id) &&
        Date.parse(row.createdAt) >= args.since,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return found
    ? {
        id: found.id,
        url: shareUrl(args.origin, found.id, args.fileKey),
        expiresAt: found.expiresAt,
        createdAt: found.createdAt,
      }
    : null;
}

export async function createShareLink(
  request: Request,
  args: {
    origin: string;
    driveId: string;
    path: string;
    driveKey: string;
    expiry: ShareExpiry;
    now?: number;
    // Called once the file key is unwrapped and the POST is about to be sent: from then on a failure
    // can mean the server created the link, so the caller keeps what it needs to look for it.
    onPrepared?: (prepared: { fileKey: string; versionId: string }) => void;
  },
): Promise<ShareLink> {
  const drive = `drives/${encodeURIComponent(args.driveId)}`;
  const meta = await request<{ id: string; wrappedKey: string }>(
    `${drive}/get?path=${encodeURIComponent(args.path)}&metadataOnly=1`,
  );
  // Unwrap before the POST so a wrong drive key fails without creating a share.
  const fileKey = await unwrapFileKey(meta.wrappedKey, args.driveKey);
  args.onPrepared?.({ fileKey, versionId: meta.id });
  const created = await request<{ id: string; expiresAt: string; createdAt: string }>(
    `${drive}/shares`,
    'POST',
    {
      path: args.path,
      versionId: meta.id,
      expiresAt: expiresAtFor(args.expiry, args.now ?? Date.now()),
    },
  );
  return {
    id: created.id,
    url: shareUrl(args.origin, created.id, fileKey),
    expiresAt: created.expiresAt,
    createdAt: created.createdAt,
  };
}
