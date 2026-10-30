import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let client: S3Client | undefined;

function config() {
  const production = process.env.NODE_ENV === 'production';
  const endpoint = process.env.S3_ENDPOINT ?? (production ? undefined : 'http://127.0.0.1:9000');
  const bucket = process.env.S3_BUCKET ?? (production ? undefined : 'agent-drive-local');
  const region = process.env.S3_REGION ?? (production ? undefined : 'us-east-1');
  if (!bucket || !region || (production && endpoint && !endpoint.startsWith('https://'))) {
    throw new Error('A secure S3 bucket and region are required.');
  }
  return {
    endpoint,
    bucket,
    region,
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? (production ? undefined : 'agent_drive_local'),
    secretAccessKey:
      process.env.S3_SECRET_ACCESS_KEY ?? (production ? undefined : 'agent_drive_local_secret'),
  };
}

export function storageClient() {
  if (!client) {
    const settings = config();
    client = new S3Client({
      region: settings.region,
      ...(settings.endpoint ? { endpoint: settings.endpoint, forcePathStyle: true } : {}),
      ...(settings.accessKeyId && settings.secretAccessKey
        ? {
            credentials: {
              accessKeyId: settings.accessKeyId,
              secretAccessKey: settings.secretAccessKey,
            },
          }
        : {}),
    });
  }
  return client;
}

export async function presignedUpload(key: string, size: number) {
  const settings = config();
  return getSignedUrl(
    storageClient(),
    new PutObjectCommand({ Bucket: settings.bucket, Key: key, ContentLength: size }),
    { expiresIn: 600 },
  );
}

export async function presignedDownload(key: string, expiresIn = 600) {
  const settings = config();
  return getSignedUrl(
    storageClient(),
    new GetObjectCommand({ Bucket: settings.bucket, Key: key }),
    {
      expiresIn,
    },
  );
}

export async function objectInfo(key: string) {
  const settings = config();
  const response = await storageClient().send(
    new HeadObjectCommand({ Bucket: settings.bucket, Key: key }),
  );
  return { size: response.ContentLength ?? 0, etag: response.ETag };
}

export async function copyObject(source: string, target: string, etag?: string) {
  const settings = config();
  await storageClient().send(
    new CopyObjectCommand({
      Bucket: settings.bucket,
      CopySource: `${settings.bucket}/${source.split('/').map(encodeURIComponent).join('/')}`,
      ...(etag ? { CopySourceIfMatch: etag } : {}),
      Key: target,
    }),
  );
}

export async function deleteObject(key: string) {
  const settings = config();
  await storageClient().send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
}
