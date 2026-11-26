import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('presigned uploads', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('S3_ENDPOINT', 'https://s3.example.test');
    vi.stubEnv('S3_BUCKET', 'agent-drive-fixture');
    vi.stubEnv('S3_REGION', 'us-east-1');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'fixture-access-key');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'fixture-secret-key');
  });

  it('does not include checksum parameters for an empty presigned upload body', async () => {
    const { presignedUpload } = await import('./storage');
    const url = new URL(await presignedUpload('fixture/object', 0));

    expect(
      [...url.searchParams.keys()].filter(
        (key) => key.startsWith('x-amz-checksum-') || key === 'x-amz-sdk-checksum-algorithm',
      ),
    ).toEqual([]);
  });
});

describe('presigned range downloads', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('S3_ENDPOINT', 'https://s3.example.test');
    vi.stubEnv('S3_BUCKET', 'agent-drive-fixture');
    vi.stubEnv('S3_REGION', 'us-east-1');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'fixture-access-key');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'fixture-secret-key');
  });

  it('signs the exact Range header into the short-lived download URL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T12:00:00.000Z'));
    try {
      const storage = (await import('./storage')) as typeof import('./storage') & {
        presignedRangeDownload?: (key: string, range: string) => Promise<string>;
      };
      expect(storage.presignedRangeDownload).toBeTypeOf('function');
      if (!storage.presignedRangeDownload) return;

      const firstRange = 'bytes=25-104';
      const secondRange = 'bytes=125-204';
      const first = new URL(await storage.presignedRangeDownload('fixture/object', firstRange));
      const second = new URL(await storage.presignedRangeDownload('fixture/object', secondRange));

      expect(first.searchParams.get('X-Amz-Expires')).toBe('60');
      expect(first.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('range');
      expect(second.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('range');
      expect(first.searchParams.get('X-Amz-Signature')).not.toBe(
        second.searchParams.get('X-Amz-Signature'),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
