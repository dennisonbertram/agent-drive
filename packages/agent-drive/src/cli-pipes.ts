import { constants } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AgentDriveClient, GetOptions, PutOptions, Version } from './client.js';
import { encryptedSize, plaintextSize } from './crypto-format.js';

const MAX_CIPHERTEXT_BYTES = 5 * 1024 ** 3;
const TRANSFER_CHUNK_BYTES = 1024 * 1024;
const MAX_PLAINTEXT_BYTES = plaintextSize(MAX_CIPHERTEXT_BYTES);

type PutClient = Pick<AgentDriveClient, 'putStream'>;
type GetClient = Pick<AgentDriveClient, 'getStream'>;

/** Parse a CLI byte count, allowing whitespace from commands such as `wc -c`. */
export function parsePipeSize(value: string): number {
  if (!/^\s*\d+\s*$/u.test(value)) throw new Error('--size must be a non-negative safe integer.');
  const size = Number(value.trim());
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error('--size must be a non-negative safe integer.');
  validatePipeSize(size);
  return size;
}

function validatePipeSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error('The stdin size must be a non-negative safe integer.');
  if (size > MAX_PLAINTEXT_BYTES)
    throw new Error('The file exceeds the 5 GiB encrypted upload limit.');
  // Keep the crypto framing and API ciphertext ceiling aligned at the boundary.
  if (encryptedSize(size) > MAX_CIPHERTEXT_BYTES)
    throw new Error('The file exceeds the 5 GiB encrypted upload limit.');
}

type FileHandle = Awaited<ReturnType<typeof open>>;

async function writeAll(handle: FileHandle, bytes: Uint8Array, position: number) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, position + offset);
    if (result.bytesWritten === 0) throw new Error('Could not write the private stdin spool.');
    offset += result.bytesWritten;
  }
}

async function readExact(handle: FileHandle, size: number, position: number) {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, position + offset);
    if (result.bytesRead === 0) throw new Error('The private stdin spool was truncated.');
    offset += result.bytesRead;
  }
  return bytes;
}

async function* fileSource(handle: FileHandle, size: number) {
  let position = 0;
  while (position < size) {
    const bytes = await readExact(
      handle,
      Math.min(TRANSFER_CHUNK_BYTES, size - position),
      position,
    );
    position += bytes.byteLength;
    yield bytes;
  }
}

async function* decryptedFileSource(
  handle: FileHandle,
  size: number,
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  let position = 0;
  while (position < size) {
    const ciphertext = await readExact(
      handle,
      Math.min(TRANSFER_CHUNK_BYTES, size - position),
      position,
    );
    position += ciphertext.byteLength;
    const plaintext = decipher.update(ciphertext);
    if (plaintext.byteLength > 0) yield plaintext;
  }
  decipher.setAuthTag(authTag);
  const final = decipher.final();
  if (final.byteLength > 0) yield final;
}

/** Upload stdin directly when its exact size is known, otherwise spool it to bounded private disk. */
export async function putPipe(
  client: PutClient,
  driveId: string,
  remotePath: string,
  input: AsyncIterable<Uint8Array>,
  knownSize?: number,
  options: PutOptions = {},
): Promise<Version> {
  if (knownSize !== undefined) {
    // Validate before even requesting stdin's iterator so malformed flags never consume input.
    validatePipeSize(knownSize);
    return await client.putStream(driveId, remotePath, input, knownSize, options);
  }

  const path = join(tmpdir(), `agent-drive-stdin-${randomUUID()}`);
  const handle = await open(
    path,
    constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  let size = 0;
  let hasNamedTemporaryFile = true;
  try {
    await rm(path);
    hasNamedTemporaryFile = false;
  } catch {
    // Some platforms cannot unlink an open file; use an authenticated encrypted spool there.
  }
  const spoolKey = hasNamedTemporaryFile ? randomBytes(32) : undefined;
  const spoolIv = hasNamedTemporaryFile ? randomBytes(12) : undefined;
  const cipher = spoolKey && spoolIv ? createCipheriv('aes-256-gcm', spoolKey, spoolIv) : undefined;
  let spoolAuthTag: Buffer | undefined;
  let spoolPosition = 0;
  let closed = false;
  const cleanup = async () => {
    if (!closed) {
      closed = true;
      await handle.close().catch(() => {});
    }
    spoolKey?.fill(0);
    spoolIv?.fill(0);
    spoolAuthTag?.fill(0);
    if (hasNamedTemporaryFile) await rm(path, { force: true }).catch(() => {});
  };
  let interrupted = false;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  if (process.platform === 'win32') {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const handler = () => {
        if (interrupted) return;
        interrupted = true;
        void cleanup().finally(() => {
          process.removeListener(signal, handler);
          process.kill(process.pid, signal);
        });
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
  }

  try {
    for await (const chunk of input) {
      if (!(chunk instanceof Uint8Array)) throw new Error('stdin produced a non-binary chunk.');
      if (size + chunk.byteLength > MAX_PLAINTEXT_BYTES)
        throw new Error('The file exceeds the 5 GiB encrypted upload limit.');
      for (let offset = 0; offset < chunk.byteLength; offset += TRANSFER_CHUNK_BYTES) {
        const part = chunk.subarray(
          offset,
          Math.min(offset + TRANSFER_CHUNK_BYTES, chunk.byteLength),
        );
        const bytes = cipher ? cipher.update(part) : part;
        await writeAll(handle, bytes, spoolPosition);
        spoolPosition += bytes.byteLength;
      }
      size += chunk.byteLength;
    }
    validatePipeSize(size);
    if (cipher) {
      const final = cipher.final();
      await writeAll(handle, final, spoolPosition);
      spoolPosition += final.byteLength;
      spoolAuthTag = cipher.getAuthTag();
    }
    const version = await client.putStream(
      driveId,
      remotePath,
      cipher && spoolKey && spoolIv && spoolAuthTag
        ? decryptedFileSource(handle, spoolPosition, spoolKey, spoolIv, spoolAuthTag)
        : fileSource(handle, size),
      size,
      options,
    );
    return version;
  } finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    await cleanup();
  }
}

async function* validatedPlaintext(source: AsyncIterable<Uint8Array>, expectedBytes: number) {
  let seen = 0;
  for await (const chunk of source) {
    if (seen + chunk.byteLength > expectedBytes)
      throw new Error('Downloaded file exceeded its declared plaintext size.');
    seen += chunk.byteLength;
    yield chunk;
  }
  if (seen !== expectedBytes)
    throw new Error('Downloaded file did not match its declared plaintext size.');
}

/** Write a pinned download to a binary writable with callback backpressure and no text framing. */
export async function getPipe(
  client: GetClient,
  driveId: string,
  remotePath: string,
  output: Writable,
  options: GetOptions = {},
): Promise<void> {
  const result = await client.getStream(driveId, remotePath, options);
  try {
    await pipeline(validatedPlaintext(result.plaintext, result.plaintextBytes), output, {
      end: false,
    });
  } catch (error) {
    await result.cancel(error).catch(() => {});
    throw error;
  }
}
