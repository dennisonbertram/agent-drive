export const CHUNK_SIZE = 1024 * 1024;
export const HEADER_SIZE = 25;
const TAG_SIZE = 16;
const MAGIC = new Uint8Array([65, 68, 82, 86, 1]);
const MAX_CHUNKS = 0x1_0000_0000;

export interface AdrV1Header {
  readonly plaintextBytes: number;
  readonly ciphertextBytes: number;
  readonly frameCount: number;
}

export interface CiphertextFrameRange {
  /** Absolute offset into the ciphertext, including the ADRV1 header. */
  readonly offset: number;
  /** Number of contiguous ciphertext bytes covering the requested frames. */
  readonly length: number;
}

export class CryptoStreamSourceError extends Error {
  constructor(readonly sourceError: unknown) {
    super('The ciphertext source failed.');
    this.name = 'CryptoStreamSourceError';
  }
}

export function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

function countChunks(size: number) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid file length.');
  const count = Math.max(1, Math.ceil(size / CHUNK_SIZE));
  if (count > MAX_CHUNKS) throw new Error('File is too large.');
  return count;
}

export function encryptedSize(size: number) {
  return HEADER_SIZE + size + countChunks(size) * TAG_SIZE;
}

/** Inverse of `encryptedSize`: the file size a ciphertext of `size` bytes holds. */
export function plaintextSize(size: number) {
  if (!Number.isSafeInteger(size) || size < HEADER_SIZE + TAG_SIZE)
    throw new Error('Invalid encrypted length.');
  const body = size - HEADER_SIZE;
  return body - Math.max(1, Math.ceil(body / (CHUNK_SIZE + TAG_SIZE))) * TAG_SIZE;
}

function chunkParameters(header: Uint8Array, index: number, final: boolean) {
  const iv = new Uint8Array(12);
  iv.set(header.subarray(9, 17));
  new DataView(iv.buffer).setUint32(8, index, false);
  const additionalData = new Uint8Array(HEADER_SIZE + 5);
  additionalData.set(header);
  new DataView(additionalData.buffer).setUint32(HEADER_SIZE, index, false);
  additionalData[HEADER_SIZE + 4] = final ? 1 : 0;
  return { name: 'AES-GCM', iv, additionalData, tagLength: 128 };
}

class FragmentReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private fragment: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private offset = 0;
  private finished = false;

  constructor(
    source: AsyncIterable<Uint8Array>,
    private readonly markSourceErrors = false,
  ) {
    try {
      this.iterator = source[Symbol.asyncIterator]();
    } catch (error) {
      throw this.sourceError(error);
    }
  }

  private sourceError(error: unknown) {
    return this.markSourceErrors && !(error instanceof CryptoStreamSourceError)
      ? new CryptoStreamSourceError(error)
      : error;
  }

  private async nextFragment() {
    try {
      return await this.iterator.next();
    } catch (error) {
      throw this.sourceError(error);
    }
  }

  async read(length: number) {
    const result = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      while (this.offset === this.fragment.length) {
        if (this.finished) throw new Error('Truncated stream.');
        const next = await this.nextFragment();
        if (next.done) {
          this.finished = true;
          throw new Error('Truncated stream.');
        }
        if (!(next.value instanceof Uint8Array)) throw new Error('Invalid stream fragment.');
        if (next.value.length === 0) continue;
        this.fragment = next.value;
        this.offset = 0;
      }
      const count = Math.min(length - written, this.fragment.length - this.offset);
      result.set(this.fragment.subarray(this.offset, this.offset + count), written);
      this.offset += count;
      written += count;
    }
    return result;
  }

  async expectEnd() {
    if (this.offset < this.fragment.length) throw new Error('Trailing stream bytes.');
    while (!this.finished) {
      const next = await this.nextFragment();
      if (next.done) {
        this.finished = true;
        return;
      }
      if (!(next.value instanceof Uint8Array)) throw new Error('Invalid stream fragment.');
      if (next.value.length > 0) throw new Error('Trailing stream bytes.');
    }
  }

  async cancel() {
    if (!this.finished) {
      this.finished = true;
      try {
        await this.iterator.return?.();
      } catch (error) {
        throw this.sourceError(error);
      }
    }
  }
}

async function importFileKey(key: Uint8Array) {
  if (key.length !== 32) throw new Error('File keys must be 32 bytes.');
  return crypto.subtle.importKey('raw', owned(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Internal format primitive. Callers must use a fresh file key and nonce for each encryption.
export async function seal(plaintext: Uint8Array, fileKey: Uint8Array, baseNonce: Uint8Array) {
  const header = createHeader(plaintext.length, baseNonce);
  const result = new Uint8Array(encryptedSize(plaintext.length));
  result.set(header);
  const key = await importFileKey(fileKey);
  const chunks = countChunks(plaintext.length);
  let offset = HEADER_SIZE;
  for (let index = 0; index < chunks; index++) {
    const chunk = plaintext.subarray(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        chunkParameters(header, index, index === chunks - 1),
        key,
        owned(chunk),
      ),
    );
    result.set(encrypted, offset);
    offset += encrypted.length;
  }
  return result;
}

function createHeader(size: number, baseNonce: Uint8Array) {
  if (baseNonce.length !== 8) throw new Error('Base nonce must be 8 bytes.');
  const header = new Uint8Array(HEADER_SIZE);
  header.set(MAGIC);
  const view = new DataView(header.buffer);
  view.setUint32(5, CHUNK_SIZE, false);
  header.set(baseNonce, 9);
  view.setBigUint64(17, BigInt(size), false);
  return header;
}

/** Encode ADRv1 incrementally; each yielded frame is authenticated before it is exposed. */
export async function* sealStream(
  source: AsyncIterable<Uint8Array>,
  plaintextBytes: number,
  key: CryptoKey,
  baseNonce: Uint8Array,
): AsyncGenerator<Uint8Array> {
  const chunks = countChunks(plaintextBytes);
  const header = createHeader(plaintextBytes, baseNonce);
  const reader = new FragmentReader(source);
  try {
    yield header;
    for (let index = 0; index < chunks; index++) {
      const length = Math.min(CHUNK_SIZE, plaintextBytes - index * CHUNK_SIZE);
      const plaintext = await reader.read(length);
      const encrypted = new Uint8Array(
        await crypto.subtle.encrypt(
          chunkParameters(header, index, index === chunks - 1),
          key,
          plaintext,
        ),
      );
      plaintext.fill(0);
      yield encrypted;
    }
    await reader.expectEnd();
  } finally {
    await reader.cancel();
  }
}

function parseHeader(header: Uint8Array) {
  if (header.length !== HEADER_SIZE || !MAGIC.every((byte, index) => header[index] === byte))
    throw new Error('Unknown format.');
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(5, false) !== CHUNK_SIZE) throw new Error('Unsupported chunk size.');
  const size = Number(view.getBigUint64(17, false));
  // encryptedSize also enforces safe integers and the ADRv1 chunk counter limit.
  const ciphertextBytes = encryptedSize(size);
  return { size, ciphertextBytes };
}

/** Validate an ADRv1 header, optionally against the server-declared ciphertext length. */
export function inspectHeader(header: Uint8Array, expectedCiphertextBytes?: number): AdrV1Header {
  const { size, ciphertextBytes } = parseHeader(header);
  if (
    expectedCiphertextBytes !== undefined &&
    (!Number.isSafeInteger(expectedCiphertextBytes) ||
      expectedCiphertextBytes < HEADER_SIZE + TAG_SIZE ||
      expectedCiphertextBytes !== ciphertextBytes)
  )
    throw new Error('Incorrect ciphertext length.');
  return {
    plaintextBytes: size,
    ciphertextBytes,
    frameCount: countChunks(size),
  };
}

/** Compute the exact contiguous ciphertext range for one or more ADRv1 frames. */
export function ciphertextFrameRange(
  header: AdrV1Header,
  firstFrameIndex: number,
  frameCount: number,
): CiphertextFrameRange {
  if (
    !Number.isSafeInteger(header.plaintextBytes) ||
    header.plaintextBytes < 0 ||
    !Number.isSafeInteger(header.ciphertextBytes) ||
    header.ciphertextBytes !== encryptedSize(header.plaintextBytes) ||
    header.frameCount !== countChunks(header.plaintextBytes) ||
    !Number.isSafeInteger(firstFrameIndex) ||
    !Number.isSafeInteger(frameCount) ||
    firstFrameIndex < 0 ||
    frameCount < 1 ||
    firstFrameIndex + frameCount > header.frameCount
  )
    throw new Error('Invalid ciphertext frame range.');

  const offset = HEADER_SIZE + firstFrameIndex * (CHUNK_SIZE + TAG_SIZE);
  const lastExclusiveIndex = firstFrameIndex + frameCount;
  const end =
    HEADER_SIZE +
    Math.min(lastExclusiveIndex * CHUNK_SIZE, header.plaintextBytes) +
    lastExclusiveIndex * TAG_SIZE;
  const length = end - offset;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    length < TAG_SIZE ||
    offset + length > header.ciphertextBytes
  )
    throw new Error('Invalid ciphertext frame range.');
  return { offset, length };
}

async function readAndDecryptFrame(
  reader: FragmentReader,
  key: CryptoKey,
  header: Uint8Array,
  plaintextBytes: number,
  frameIndex: number,
  frameCount: number,
) {
  const framePlaintextBytes = Math.min(CHUNK_SIZE, plaintextBytes - frameIndex * CHUNK_SIZE);
  const encrypted = await reader.read(framePlaintextBytes + TAG_SIZE);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      chunkParameters(header, frameIndex, frameIndex === frameCount - 1),
      key,
      encrypted,
    ),
  );
  return { plaintext, ciphertextBytes: encrypted.length };
}

/**
 * Decode a contiguous selection of ADRv1 frames. The source must contain exactly
 * the selected ciphertext bytes; each frame is yielded only after GCM verifies it.
 */
export async function* openFrameRange(
  source: AsyncIterable<Uint8Array>,
  key: CryptoKey,
  header: Uint8Array,
  firstFrameIndex: number,
  frameCount: number,
  expectedCiphertextBytes?: number,
): AsyncGenerator<Uint8Array> {
  const parsed = inspectHeader(header, expectedCiphertextBytes);
  const range = ciphertextFrameRange(parsed, firstFrameIndex, frameCount);
  const ownedHeader = owned(header);
  const reader = new FragmentReader(source, true);
  let failed = false;
  try {
    let consumed = 0;
    for (let relativeIndex = 0; relativeIndex < frameCount; relativeIndex++) {
      const index = firstFrameIndex + relativeIndex;
      const frame = await readAndDecryptFrame(
        reader,
        key,
        ownedHeader,
        parsed.plaintextBytes,
        index,
        parsed.frameCount,
      );
      consumed += frame.ciphertextBytes;
      yield frame.plaintext;
    }
    if (consumed !== range.length) throw new Error('Incorrect ciphertext length.');
    await reader.expectEnd();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (failed) await reader.cancel().catch(() => undefined);
    else await reader.cancel();
  }
}

/** Decode ADRv1 incrementally, yielding only complete authenticated chunks. */
export async function* openStream(
  source: AsyncIterable<Uint8Array>,
  key: CryptoKey,
  expectedCiphertextBytes?: number,
): AsyncGenerator<Uint8Array> {
  const reader = new FragmentReader(source, true);
  let failed = false;
  try {
    const header = await reader.read(HEADER_SIZE);
    const parsed = inspectHeader(header, expectedCiphertextBytes);
    let consumed = HEADER_SIZE;
    for (let index = 0; index < parsed.frameCount; index++) {
      const frame = await readAndDecryptFrame(
        reader,
        key,
        header,
        parsed.plaintextBytes,
        index,
        parsed.frameCount,
      );
      consumed += frame.ciphertextBytes;
      yield frame.plaintext;
    }
    if (consumed !== parsed.ciphertextBytes) throw new Error('Incorrect ciphertext length.');
    await reader.expectEnd();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (failed) await reader.cancel().catch(() => undefined);
    else await reader.cancel();
  }
}

export async function open(ciphertext: Uint8Array, fileKey: Uint8Array) {
  if (ciphertext.length < HEADER_SIZE + TAG_SIZE) throw new Error('Truncated ciphertext.');
  const header = owned(ciphertext.subarray(0, HEADER_SIZE));
  const { size, ciphertextBytes } = parseHeader(header);
  if (ciphertextBytes !== ciphertext.length) throw new Error('Incorrect ciphertext length.');
  const key = await importFileKey(fileKey);
  const chunks = countChunks(size);
  const result = new Uint8Array(size);
  let offset = HEADER_SIZE;
  try {
    for (let index = 0; index < chunks; index++) {
      const plaintextSize = Math.min(CHUNK_SIZE, size - index * CHUNK_SIZE);
      const encrypted = ciphertext.subarray(offset, offset + plaintextSize + TAG_SIZE);
      const decrypted = new Uint8Array(
        await crypto.subtle.decrypt(
          chunkParameters(header, index, index === chunks - 1),
          key,
          owned(encrypted),
        ),
      );
      result.set(decrypted, index * CHUNK_SIZE);
      offset += encrypted.length;
    }
    return result;
  } catch (error) {
    result.fill(0);
    throw error;
  }
}
