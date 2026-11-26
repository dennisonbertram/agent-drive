import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  decryptFile,
  decryptWithFileKeyStream,
  encodeBase64Url,
  encryptedSize,
  encryptFile,
  encryptFileStream,
  generateDriveKey,
  unwrapFileKey,
} from './crypto.js';
import { HEADER_SIZE, open, openStream, seal, sealStream } from './crypto-format.js';

const sequence = (size: number) => Uint8Array.from({ length: size }, (_, index) => index % 251);
const RAW_KEY = sequence(32);
const RAW_KEY_B64 = encodeBase64Url(RAW_KEY);
const importKey = () =>
  crypto.subtle.importKey('raw', Uint8Array.from(RAW_KEY), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);

function concat(parts: Uint8Array[]) {
  let total = 0;
  for (const part of parts) total += part.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function expectBytesEqual(actual: Uint8Array, expected: Uint8Array) {
  expect(actual.byteLength).toBe(expected.byteLength);
  expect(
    Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength).equals(
      Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength),
    ),
  ).toBe(true);
}

async function collect(stream: AsyncIterable<Uint8Array>) {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return concat(parts);
}

/** Emits `bytes` as successive fragments of the given sizes; the leftover is the last fragment. */
async function* fragmentsOf(bytes: Uint8Array, sizes: number[]) {
  let offset = 0;
  for (const size of sizes) {
    if (offset >= bytes.length) return;
    yield bytes.subarray(offset, Math.min(offset + size, bytes.length));
    offset += size;
  }
  if (offset < bytes.length) yield bytes.subarray(offset);
}

function countedSource(bytes: Uint8Array, sizes: number[]) {
  const state = { nexts: 0, returns: 0 };
  const iterable: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      const inner = fragmentsOf(bytes, sizes)[Symbol.asyncIterator]();
      return {
        next: async () => {
          state.nexts += 1;
          return inner.next();
        },
        return: async () => {
          state.returns += 1;
          await inner.return?.(undefined);
          return { done: true as const, value: undefined };
        },
      };
    },
  };
  return { iterable, state };
}

describe('encryptFileStream', () => {
  it.each([0, 1, 100, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, 2 * CHUNK_SIZE + 11])(
    'produces ADRv1 ciphertext the byte reader opens for %i bytes',
    async (size) => {
      const plaintext = sequence(size);
      const driveKey = generateDriveKey();
      const result = await encryptFileStream(
        fragmentsOf(plaintext, [1, 7, 4099, CHUNK_SIZE - 5, 33]),
        size,
        driveKey,
      );
      expect(result.ciphertextSize).toBe(encryptedSize(size));
      const ciphertext = await collect(result.ciphertext);
      expect(ciphertext.length).toBe(result.ciphertextSize);
      expectBytesEqual(await decryptFile(ciphertext, result.wrappedKey, driveKey), plaintext);
    },
    30_000,
  );

  it('writes byte-identical output to seal for the same key and nonce', async () => {
    const plaintext = sequence(CHUNK_SIZE + 500);
    const nonce = sequence(8);
    const streamed = await collect(
      sealStream(
        fragmentsOf(plaintext, [13, 999, 64 * 1024]),
        plaintext.length,
        await importKey(),
        nonce,
      ),
    );
    expect(
      Buffer.compare(Buffer.from(streamed), Buffer.from(await seal(plaintext, RAW_KEY, nonce))),
    ).toBe(0);
  });

  it('yields the header before pulling any plaintext', async () => {
    const plaintext = sequence(100);
    const { iterable, state } = countedSource(plaintext, [100]);
    const { ciphertext } = await encryptFileStream(iterable, 100, generateDriveKey());
    const iterator = ciphertext[Symbol.asyncIterator]();
    expect(state.nexts).toBe(0);
    const first = await iterator.next();
    expect(first.value).toHaveLength(HEADER_SIZE);
    expect(state.nexts).toBe(0);
    await iterator.return?.(undefined);
    expect(state.returns).toBe(1);
  });

  it('rejects a source shorter or longer than the declared length', async () => {
    const key = generateDriveKey();
    const short = await encryptFileStream(fragmentsOf(sequence(50), [50]), 100, key);
    await expect(collect(short.ciphertext)).rejects.toThrow();
    const long = await encryptFileStream(fragmentsOf(sequence(150), [150]), 100, key);
    await expect(collect(long.ciphertext)).rejects.toThrow();
  });

  it('rejects an invalid declared length before any iteration', async () => {
    const key = generateDriveKey();
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER])
      await expect(encryptFileStream(fragmentsOf(sequence(0), []), bad, key)).rejects.toThrow();
  });

  it('rejects a missing or invalid drive key', async () => {
    const source = fragmentsOf(sequence(1), [1]);
    await expect(encryptFileStream(source, 1, undefined)).rejects.toMatchObject({
      code: 'missing_drive_key',
    });
    await expect(encryptFileStream(source, 1, 'not-a-key')).rejects.toMatchObject({
      code: 'invalid_drive_key',
    });
  });
});

describe('decryptWithFileKeyStream', () => {
  it.each([0, 1, 100, CHUNK_SIZE, CHUNK_SIZE + 1, 2 * CHUNK_SIZE + 11])(
    'reads byte-API ciphertext for %i bytes',
    async (size) => {
      const plaintext = sequence(size);
      const ciphertext = await seal(plaintext, RAW_KEY, sequence(8));
      const sizes = [1, HEADER_SIZE, 3, 1024, CHUNK_SIZE - 9, 17, 4096];
      expectBytesEqual(
        await collect(decryptWithFileKeyStream(fragmentsOf(ciphertext, sizes), RAW_KEY_B64)),
        plaintext,
      );
    },
    30_000,
  );

  it('reads stream-writer output through the byte reader too', async () => {
    const plaintext = sequence(CHUNK_SIZE + 77);
    const key = await importKey();
    const ciphertext = await collect(
      sealStream(fragmentsOf(plaintext, [plaintext.length]), plaintext.length, key, sequence(8)),
    );
    expectBytesEqual(await open(ciphertext, RAW_KEY), plaintext);
    expectBytesEqual(
      await collect(openStream(fragmentsOf(ciphertext, [ciphertext.length]), key)),
      plaintext,
    );
  });

  it('ignores zero-length fragments', async () => {
    const plaintext = sequence(300);
    const ciphertext = await seal(plaintext, RAW_KEY, sequence(8));
    async function* zeroPadded() {
      yield new Uint8Array(0);
      yield ciphertext.subarray(0, 10);
      yield new Uint8Array(0);
      yield ciphertext.subarray(10);
      yield new Uint8Array(0);
    }
    expectBytesEqual(await collect(decryptWithFileKeyStream(zeroPadded(), RAW_KEY_B64)), plaintext);
  });

  it('checks expectedCiphertextBytes before the body', async () => {
    const ciphertext = await seal(sequence(CHUNK_SIZE + 5), RAW_KEY, sequence(8));
    const good = await collect(
      decryptWithFileKeyStream(
        fragmentsOf(ciphertext, [ciphertext.length]),
        RAW_KEY_B64,
        ciphertext.length,
      ),
    );
    expectBytesEqual(good, sequence(CHUNK_SIZE + 5));
    for (const bad of [ciphertext.length + 1, ciphertext.length - 16, Number.NaN, 0])
      await expect(
        collect(
          decryptWithFileKeyStream(fragmentsOf(ciphertext, [ciphertext.length]), RAW_KEY_B64, bad),
        ),
      ).rejects.toMatchObject({ code: 'decryption_failed' });
  });

  it('rejects a bad file key as decryption_failed', async () => {
    const ciphertext = await seal(sequence(10), RAW_KEY, sequence(8));
    const source = fragmentsOf(ciphertext, [ciphertext.length]);
    expect(() => decryptWithFileKeyStream(source, 'not-a-key')).not.toThrow();
    await expect(
      collect(decryptWithFileKeyStream(fragmentsOf(ciphertext, [ciphertext.length]), 'not-a-key')),
    ).rejects.toMatchObject({ code: 'decryption_failed' });
  });

  it('preserves an upstream abort while reading ciphertext', async () => {
    const plaintext = sequence(CHUNK_SIZE + 10);
    const ciphertext = await seal(plaintext, RAW_KEY, sequence(8));
    const sourceFailure = new DOMException('synthetic reader abort', 'AbortError');
    async function* failingSource() {
      yield ciphertext.subarray(0, HEADER_SIZE + CHUNK_SIZE + 16);
      throw sourceFailure;
    }

    const chunks: Uint8Array[] = [];
    let error: unknown;
    try {
      for await (const chunk of decryptWithFileKeyStream(failingSource(), RAW_KEY_B64))
        chunks.push(chunk);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBe(sourceFailure);
    expectBytesEqual(concat(chunks), plaintext.subarray(0, CHUNK_SIZE));
  });

  it.each([
    ['empty', 0],
    ['a partial header', HEADER_SIZE - 1],
    ['the bare header', HEADER_SIZE],
    ['mid first frame', HEADER_SIZE + 100],
    ['one full frame of two', HEADER_SIZE + CHUNK_SIZE + 16],
    ['mid final tag', HEADER_SIZE + 2 * CHUNK_SIZE + 16 + 8],
  ])('rejects ciphertext truncated at %s', async (_label, cut) => {
    const plaintext = sequence(2 * CHUNK_SIZE + 20);
    const ciphertext = await seal(plaintext, RAW_KEY, sequence(8));
    const truncated = ciphertext.subarray(0, Math.min(cut, ciphertext.length));
    await expect(
      collect(decryptWithFileKeyStream(fragmentsOf(truncated, [truncated.length]), RAW_KEY_B64)),
    ).rejects.toMatchObject({ code: 'decryption_failed' });
  });

  it('emits only authenticated chunks before a late truncation error', async () => {
    const plaintext = sequence(2 * CHUNK_SIZE);
    const ciphertext = await seal(plaintext, RAW_KEY, sequence(8));
    const truncated = ciphertext.subarray(0, HEADER_SIZE + CHUNK_SIZE + 16);
    const parts: Uint8Array[] = [];
    let error: unknown;
    try {
      for await (const part of decryptWithFileKeyStream(
        fragmentsOf(truncated, [truncated.length]),
        RAW_KEY_B64,
      ))
        parts.push(part);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'decryption_failed' });
    expectBytesEqual(concat(parts), plaintext.subarray(0, CHUNK_SIZE));
  });

  it.each([1, 40, CHUNK_SIZE + 16])('rejects %i trailing bytes', async (extra) => {
    const plaintext = sequence(CHUNK_SIZE + 9);
    const ciphertext = await seal(plaintext, RAW_KEY, sequence(8));
    const extended = new Uint8Array(ciphertext.length + extra);
    extended.set(ciphertext);
    const parts: Uint8Array[] = [];
    let error: unknown;
    try {
      for await (const part of decryptWithFileKeyStream(
        fragmentsOf(extended, [ciphertext.length - 3, extra + 3]),
        RAW_KEY_B64,
      ))
        parts.push(part);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'decryption_failed' });
    expectBytesEqual(concat(parts), plaintext);
  });

  it.each([0, 5, 10, 24, HEADER_SIZE + 5])(
    'rejects a header/body byte tampered at offset %i',
    async (offset) => {
      const ciphertext = await seal(sequence(CHUNK_SIZE + 50), RAW_KEY, sequence(8));
      const tampered = ciphertext.slice();
      tampered[offset] = tampered[offset]! ^ 1;
      await expect(
        collect(decryptWithFileKeyStream(fragmentsOf(tampered, [tampered.length]), RAW_KEY_B64)),
      ).rejects.toMatchObject({ code: 'decryption_failed' });
    },
  );

  it('rejects a tampered final tag without emitting that chunk', async () => {
    const plaintext = sequence(2 * CHUNK_SIZE);
    const ciphertext = await seal(plaintext, RAW_KEY, sequence(8));
    const tampered = ciphertext.slice();
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    const parts: Uint8Array[] = [];
    let error: unknown;
    try {
      for await (const part of decryptWithFileKeyStream(
        fragmentsOf(tampered, [tampered.length]),
        RAW_KEY_B64,
      ))
        parts.push(part);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'decryption_failed' });
    expectBytesEqual(concat(parts), plaintext.subarray(0, CHUNK_SIZE));
  });

  it('rejects reordered chunks', async () => {
    const ciphertext = await seal(sequence(2 * CHUNK_SIZE + 17), RAW_KEY, sequence(8));
    const swapped = ciphertext.slice();
    const frameSize = CHUNK_SIZE + 16;
    swapped.set(
      ciphertext.subarray(HEADER_SIZE + frameSize, HEADER_SIZE + frameSize * 2),
      HEADER_SIZE,
    );
    swapped.set(ciphertext.subarray(HEADER_SIZE, HEADER_SIZE + frameSize), HEADER_SIZE + frameSize);
    await expect(
      collect(decryptWithFileKeyStream(fragmentsOf(swapped, [swapped.length]), RAW_KEY_B64)),
    ).rejects.toMatchObject({ code: 'decryption_failed' });
  });

  it('pulls lazily and cancels the source on early return', async () => {
    const ciphertext = await seal(sequence(3 * CHUNK_SIZE), RAW_KEY, sequence(8));
    const { iterable, state } = countedSource(ciphertext, [
      HEADER_SIZE,
      CHUNK_SIZE + 16,
      ciphertext.length - HEADER_SIZE - CHUNK_SIZE - 16,
    ]);
    const iterator = decryptWithFileKeyStream(iterable, RAW_KEY_B64)[Symbol.asyncIterator]();
    expect(state.nexts).toBe(0);
    const first = await iterator.next();
    expect(first.value).toHaveLength(CHUNK_SIZE);
    expect(state.nexts).toBeLessThanOrEqual(2);
    await iterator.return?.(undefined);
    expect(state.returns).toBe(1);
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });
});
