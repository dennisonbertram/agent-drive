import type { Version } from './client.js';
import { CHUNK_SIZE } from './crypto.js';

export type RangeReaderOptions = {
  signal?: AbortSignal;
};

/** A reader pinned to one drive path and version. Cached plaintext is discarded by close(). */
export type RangeReader = {
  readonly version: Version;
  readonly plaintextBytes: number;
  read(offset: number, size: number): Promise<Uint8Array>;
  close(): Promise<void>;
};

const MAX_CIPHERTEXT_FRAME_BYTES = CHUNK_SIZE + 16;

export function sameVersion(left: Version, right: Version) {
  return (
    left.id === right.id &&
    left.path === right.path &&
    left.ciphertextSize === right.ciphertextSize &&
    left.wrappedKey === right.wrappedKey &&
    left.agentId === right.agentId &&
    left.machineId === right.machineId &&
    left.userId === right.userId &&
    left.description === right.description &&
    left.createdAt === right.createdAt &&
    left.tags.length === right.tags.length &&
    left.tags.every((tag, index) => tag === right.tags[index])
  );
}

function readWithAbort<T>(operation: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function cancelBody(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

/** Reads exactly one header or encrypted frame and stops on an overlong, short, or aborted body. */
export async function readExactRangeBody(
  response: Response,
  range: string,
  totalBytes: number,
  signal: AbortSignal,
) {
  const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
  if (!match) throw new TypeError('Invalid authorized byte range.');
  const first = Number(match[1]);
  const last = Number(match[2]);
  const expectedBytes = last - first + 1;
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    !Number.isSafeInteger(totalBytes) ||
    expectedBytes <= 0 ||
    last >= totalBytes ||
    expectedBytes > MAX_CIPHERTEXT_FRAME_BYTES
  )
    throw new TypeError('The authorized byte range is outside the supported frame size.');

  const fail = async (message: string): Promise<never> => {
    await cancelBody(response);
    throw new Error(message);
  };
  if (response.status !== 206) return fail(`Expected HTTP 206 for range ${range}.`);
  if (response.headers.get('content-range') !== `bytes ${first}-${last}/${totalBytes}`)
    return fail('The storage Content-Range did not match the authorized range.');
  if (response.headers.get('content-length') !== String(expectedBytes))
    return fail('The storage Content-Length did not match the authorized range.');
  if (!response.body) return fail('The storage range body is missing.');

  const reader = response.body.getReader();
  const bytes = new Uint8Array(expectedBytes);
  let offset = 0;
  let complete = false;
  try {
    for (;;) {
      const result = await readWithAbort(reader.read(), signal);
      if (result.done) {
        complete = true;
        break;
      }
      if (!(result.value instanceof Uint8Array)) throw new Error('Invalid storage range fragment.');
      if (offset + result.value.byteLength > expectedBytes)
        throw new Error('The storage range body exceeded its authorized length.');
      bytes.set(result.value, offset);
      offset += result.value.byteLength;
    }
    if (offset !== expectedBytes) throw new Error('The storage range body was truncated.');
    return bytes;
  } catch (error) {
    bytes.fill(0);
    if (!complete) await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
