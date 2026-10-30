import { describe, expect, it } from 'vitest';
import { parseS3Transfer } from './s3-log';

const log =
  'owner agent-drive-bucket [30/Oct/2026:10:00:00 +0000] 192.0.2.3 requester REQ123 REST.GET.OBJECT objects/account/drive/version "GET /objects/account/drive/version?X-Amz-Signature=synthetic HTTP/1.1" 206 - 713 2048 17 4 "-" "agent with arbitrary quotes" - extra-fields';
describe('actual S3 transfer accounting', () => {
  it('counts response bytes rather than object size, ignoring extensible trailing fields', () => {
    expect(parseS3Transfer(log)).toEqual({
      bucket: 'agent-drive-bucket',
      requestId: 'REQ123',
      objectKey: 'objects/account/drive/version',
      occurredAt: new Date('2026-10-30T10:00:00Z'),
      bytes: 713n,
    });
  });
  it('does not bill failed requests, writes, staging objects or malformed records', () => {
    for (const line of [
      log.replace(' 206 ', ' 403 '),
      log.replace('REST.GET.OBJECT', 'REST.PUT.OBJECT'),
      log.replace('objects/account/drive/version "', 'staging/account/drive/version "'),
      log.replace('30/Oct', '32/Oct'),
      'not a log',
    ])
      expect(parseS3Transfer(line)).toBeNull();
  });
});
