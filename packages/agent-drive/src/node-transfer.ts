import { constants } from 'node:fs';
import { lstat, open, link, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AgentDriveApiError,
  type AgentDriveClient,
  type GetOptions,
  type PutOptions,
  type Version,
} from './client.js';

const TRANSFER_CHUNK_BYTES = 1024 * 1024;

type PutClient = Pick<AgentDriveClient, 'putStream'>;
type GetClient = Pick<AgentDriveClient, 'getStream'>;

/** Stream a regular local file into Agent Drive, checking its size and identity again at EOF. */
export async function putFile(
  client: PutClient,
  driveId: string,
  localPath: string,
  remotePath: string,
  options: PutOptions = {},
): Promise<Version> {
  const handle = await open(localPath, constants.O_RDONLY);
  try {
    const initial = await handle.stat();
    if (!initial.isFile()) throw new Error('put requires a regular file.');
    const plaintextBytes = initial.size;
    async function* plaintext(): AsyncGenerator<Uint8Array> {
      let position = 0;
      while (position < plaintextBytes) {
        const bytes = Buffer.allocUnsafe(Math.min(TRANSFER_CHUNK_BYTES, plaintextBytes - position));
        const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, position);
        if (bytesRead === 0) throw new Error('File changed during upload; refusing to upload it.');
        position += bytesRead;
        yield bytesRead === bytes.byteLength ? bytes : bytes.subarray(0, bytesRead);
      }
      const current = await handle.stat();
      if (
        !current.isFile() ||
        current.dev !== initial.dev ||
        current.ino !== initial.ino ||
        current.size !== initial.size ||
        current.mtimeMs !== initial.mtimeMs ||
        current.ctimeMs !== initial.ctimeMs
      ) {
        throw new Error('File changed during upload; refusing to upload it.');
      }
      const extra = Buffer.allocUnsafe(1);
      const { bytesRead } = await handle.read(extra, 0, 1, position);
      if (bytesRead !== 0) throw new Error('File grew during upload; refusing to upload it.');
    }
    return await client.putStream(driveId, remotePath, plaintext(), plaintextBytes, options);
  } finally {
    await handle.close();
  }
}

export type GetFileOptions = GetOptions & {
  /** Replace an existing regular file. Defaults to create-only. */
  overwrite?: boolean;
  /** Extra complete download attempts after the first failure. Defaults to one. */
  retries?: number;
  signal?: AbortSignal;
};

function abortError(signal: AbortSignal) {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

type DestinationSnapshot = { dev: number; ino: number; mode: number };

function destinationChangedError(message = 'Output path changed during download.') {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'OUTPUT_PATH_CHANGED';
  return error;
}

async function destinationStat(outputPath: string) {
  try {
    return await lstat(outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function assertDestinationUnchanged(
  outputPath: string,
  expected: DestinationSnapshot | undefined,
) {
  const existing = await destinationStat(outputPath);
  if (!existing && !expected) return;
  if (!existing || !expected) throw destinationChangedError();
  if (existing.isSymbolicLink())
    throw destinationChangedError('Refusing to write through a symlink.');
  if (!existing.isFile()) throw destinationChangedError('Output path must be a regular file.');
  if (
    existing.dev !== expected.dev ||
    existing.ino !== expected.ino ||
    (existing.mode & 0o777) !== expected.mode
  ) {
    throw destinationChangedError();
  }
}

/** Download to a private temporary file, then atomically publish only a fully verified result. */
export async function getFile(
  client: GetClient,
  driveId: string,
  remotePath: string,
  outputPath: string,
  options: GetFileOptions = {},
): Promise<Version> {
  const retries = options.retries ?? 1;
  if (!Number.isSafeInteger(retries) || retries < 0)
    throw new TypeError('retries must be a non-negative integer.');
  const overwrite = options.overwrite ?? false;
  const outputDirectory = dirname(outputPath);
  let versionId = options.versionId;
  const initialDestinationStat = await destinationStat(outputPath);
  if (initialDestinationStat?.isSymbolicLink())
    throw new Error('Refusing to write through a symlink.');
  if (initialDestinationStat && !initialDestinationStat.isFile())
    throw new Error('Output path must be a regular file.');
  if (initialDestinationStat && !overwrite) {
    const error = new Error(`Output already exists: ${outputPath}`) as NodeJS.ErrnoException;
    error.code = 'EEXIST';
    throw error;
  }
  const existingDestination = initialDestinationStat
    ? {
        dev: initialDestinationStat.dev,
        ino: initialDestinationStat.ino,
        mode: initialDestinationStat.mode & 0o777,
      }
    : undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (options.signal?.aborted) throw abortError(options.signal);
    const temporaryPath = join(outputDirectory, `.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let created = false;
    let stream: Awaited<ReturnType<GetClient['getStream']>> | undefined;
    let abortListener: (() => void) | undefined;
    try {
      await assertDestinationUnchanged(outputPath, existingDestination);

      stream = await client.getStream(driveId, remotePath, {
        ...(versionId ? { versionId } : {}),
        ...(options.maxPlaintextBytes !== undefined
          ? { maxPlaintextBytes: options.maxPlaintextBytes }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      versionId ??= stream.version.id;
      if (options.signal) {
        abortListener = () => void stream?.cancel(options.signal?.reason).catch(() => undefined);
        options.signal.addEventListener('abort', abortListener, { once: true });
        if (options.signal.aborted) {
          await stream.cancel(options.signal.reason);
          throw abortError(options.signal);
        }
      }
      handle = await open(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      created = true;
      let written = 0;
      for await (const chunk of stream.plaintext) {
        if (options.signal?.aborted) throw abortError(options.signal);
        if (written + chunk.byteLength > stream.plaintextBytes)
          throw new Error('Downloaded file exceeded its declared plaintext size.');
        let offset = 0;
        while (offset < chunk.byteLength) {
          const result = await handle.write(chunk, offset, chunk.byteLength - offset);
          if (!result.bytesWritten) throw new Error('Could not write the downloaded file.');
          offset += result.bytesWritten;
        }
        written += chunk.byteLength;
      }
      if (written !== stream.plaintextBytes) throw new Error('Downloaded file was truncated.');
      await handle.sync();
      if (options.signal?.aborted) throw abortError(options.signal);

      if (overwrite && existingDestination) {
        // Keep the temporary plaintext owner-only through the stream, and don't restore stale
        // permissions if the destination was replaced or chmodded while downloading.
        await assertDestinationUnchanged(outputPath, existingDestination);
        await handle.chmod(existingDestination.mode);
        await handle.sync();
      }

      await handle.close();
      handle = undefined;
      if (options.signal?.aborted) throw abortError(options.signal);

      if (overwrite && existingDestination) {
        // Recheck immediately before the atomic replacement.
        await assertDestinationUnchanged(outputPath, existingDestination);
        await rename(temporaryPath, outputPath);
      } else {
        // A hard link publishes a new file without replacing a path created during the download.
        await link(temporaryPath, outputPath);
        await rm(temporaryPath);
      }
      created = false;
      return stream.version;
    } catch (error) {
      if (stream) await stream.cancel(error).catch(() => undefined);
      if (handle) await handle.close().catch(() => undefined);
      if (created) await rm(temporaryPath, { force: true }).catch(() => undefined);
      const code = (error as NodeJS.ErrnoException)?.code;
      const terminalApiFailure =
        error instanceof AgentDriveApiError && error.status >= 400 && error.status < 500;
      const terminalDestinationChange = code === 'OUTPUT_PATH_CHANGED';
      // getStream has not exposed a selected version yet; retrying "latest" could switch versions.
      const unpinnedLatestFailedBeforeSelection = !versionId && !stream;
      if (
        attempt === retries ||
        code === 'EEXIST' ||
        terminalApiFailure ||
        terminalDestinationChange ||
        unpinnedLatestFailedBeforeSelection ||
        options.signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw error;
      }
    } finally {
      if (abortListener) options.signal?.removeEventListener('abort', abortListener);
    }
  }
  throw new Error('Download failed.');
}
