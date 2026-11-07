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

export async function createShareLink(
  request: Request,
  args: {
    origin: string;
    driveId: string;
    path: string;
    driveKey: string;
    expiry: ShareExpiry;
    now?: number;
  },
): Promise<{ id: string; url: string; expiresAt: string; createdAt: string }> {
  const drive = `drives/${encodeURIComponent(args.driveId)}`;
  const meta = await request<{ id: string; wrappedKey: string }>(
    `${drive}/get?path=${encodeURIComponent(args.path)}&metadataOnly=1`,
  );
  // Unwrap before the POST so a wrong drive key fails without creating a share.
  const fileKey = await unwrapFileKey(meta.wrappedKey, args.driveKey);
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
    url: `${args.origin}/s/${created.id}#k=${fileKey}`,
    expiresAt: created.expiresAt,
    createdAt: created.createdAt,
  };
}
