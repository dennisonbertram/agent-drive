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
