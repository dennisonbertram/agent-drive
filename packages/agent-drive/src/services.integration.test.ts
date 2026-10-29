import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const database = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const bucket = process.env.S3_BUCKET ?? 'agent-drive-local';
const objectStorage = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'agent_drive_local',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'agent_drive_local_secret',
  },
});

afterAll(async () => {
  objectStorage.destroy();
  await database.end();
});

describe('local service scaffold smoke (not product acceptance)', () => {
  it('executes a PostgreSQL query', async () => {
    const result = await database.query<{ result: number }>('select 1 as result');

    expect(result.rows[0]?.result).toBe(1);
  });

  it('puts, gets, and deletes an object in MinIO', async () => {
    const key = `scaffold-smoke/${randomUUID()}`;
    const body = 'Agent Drive Phase 0 service smoke';

    try {
      await objectStorage.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
        }),
      );

      const response = await objectStorage.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      expect(await response.Body?.transformToString()).toBe(body);
    } finally {
      await objectStorage.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    }

    await expect(
      objectStorage.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      ),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
  });
});
