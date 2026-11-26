import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  encodeBase64Url,
  generateDriveKey,
  openFrameRange as openFileKeyFrameRange,
} from './crypto.js';
import {
  ciphertextFrameRange,
  HEADER_SIZE,
  inspectHeader,
  openFrameRange,
  seal,
} from './crypto-format.js';

const sequence = (size: number) => Uint8Array.from({ length: size }, (_, index) => index % 251);
const RAW_KEY = sequence(32);
const RAW_KEY_B64 = encodeBase64Url(RAW_KEY);

function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function* fragments(bytes: Uint8Array) {
  for (let offset = 0; offset < bytes.length; offset += 7919)
    yield bytes.subarray(offset, Math.min(offset + 7919, bytes.length));
}

async function collect(stream: AsyncIterable<Uint8Array>) {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return concat(parts);
}

describe('ADRv1 indexed frame access', () => {
  it.each([
    [0, 0, 1, HEADER_SIZE, 16],
    [1, 0, 1, HEADER_SIZE, 17],
    [CHUNK_SIZE + 9, 1, 1, HEADER_SIZE + CHUNK_SIZE + 16, 25],
    [2 * CHUNK_SIZE + 9, 1, 2, HEADER_SIZE + CHUNK_SIZE + 16, CHUNK_SIZE + 41],
  ])(
    'validates the header and computes the contiguous range for %i byte files',
    (plaintextBytes, firstFrame, frameCount, offset, length) => {
      const ciphertextBytes =
        HEADER_SIZE + plaintextBytes + Math.max(1, Math.ceil(plaintextBytes / CHUNK_SIZE)) * 16;
      const header = new Uint8Array(HEADER_SIZE);
      header.set([65, 68, 82, 86, 1]);
      new DataView(header.buffer).setUint32(5, CHUNK_SIZE, false);
      new DataView(header.buffer).setBigUint64(17, BigInt(plaintextBytes), false);

      const parsed = inspectHeader(header, ciphertextBytes);
      expect(parsed).toMatchObject({ plaintextBytes, ciphertextBytes });
      expect(ciphertextFrameRange(parsed, firstFrame, frameCount)).toEqual({ offset, length });
    },
  );

  it('rejects malformed headers, mismatched sizes, and frame ranges outside the file', () => {
    const ciphertext = new Uint8Array(HEADER_SIZE + 16);
    ciphertext.set([65, 68, 82, 86, 1]);
    new DataView(ciphertext.buffer).setUint32(5, CHUNK_SIZE, false);
    const parsed = inspectHeader(ciphertext.subarray(0, HEADER_SIZE), ciphertext.length);
    expect(() => inspectHeader(ciphertext.subarray(0, HEADER_SIZE - 1))).toThrow();
    expect(() =>
      inspectHeader(ciphertext.subarray(0, HEADER_SIZE), ciphertext.length + 1),
    ).toThrow();
    expect(() => ciphertextFrameRange(parsed, -1, 1)).toThrow();
    expect(() => ciphertextFrameRange(parsed, 1, 1)).toThrow();
    expect(() => ciphertextFrameRange(parsed, 0, 0)).toThrow();
  });

  it.each([0, 1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 11, 2 * CHUNK_SIZE + 11])(
    'opens selected frames from existing ADRv1 ciphertext for %i bytes',
    async (size) => {
      const plaintext = sequence(size);
      const ciphertext = await seal(plaintext, RAW_KEY, sequence(8));
      const header = ciphertext.subarray(0, HEADER_SIZE);
      const parsed = inspectHeader(header, ciphertext.length);
      const range = ciphertextFrameRange(parsed, 0, parsed.frameCount);
      expect(range).toEqual({ offset: HEADER_SIZE, length: ciphertext.length - HEADER_SIZE });
      expect(
        await collect(
          openFrameRange(
            fragments(ciphertext.subarray(range.offset)),
            await crypto.subtle.importKey('raw', RAW_KEY, 'AES-GCM', false, ['decrypt']),
            header,
            0,
            parsed.frameCount,
            ciphertext.length,
          ),
        ),
      ).toEqual(plaintext);

      const frameIndex = Math.max(0, parsed.frameCount - 1);
      const selected = ciphertextFrameRange(parsed, frameIndex, 1);
      const opened = await openFileKeyFrameRange(
        fragments(ciphertext.subarray(selected.offset, selected.offset + selected.length)),
        RAW_KEY_B64,
        header,
        frameIndex,
        1,
        ciphertext.length,
      );
      expect(await collect(opened)).toEqual(plaintext.subarray(frameIndex * CHUNK_SIZE));
    },
    30_000,
  );

  it('accepts the frozen historical ADRv1 vector without changing its bytes', async () => {
    const ciphertext = Uint8Array.from(
      Buffer.from(
        '414452560100100000000102030405060700000000000000166863330a06230f54eb9b99b708fb4e88dcb56126cf7b6f78bd4d67fe58fc7c01f4c29b91f991',
        'hex',
      ),
    );
    const parsed = inspectHeader(ciphertext.subarray(0, HEADER_SIZE), ciphertext.length);
    expect(parsed.frameCount).toBe(1);
    const range = ciphertextFrameRange(parsed, 0, 1);
    const result = await openFileKeyFrameRange(
      fragments(ciphertext.subarray(range.offset, range.offset + range.length)),
      RAW_KEY_B64,
      ciphertext.subarray(0, HEADER_SIZE),
      0,
      1,
      ciphertext.length,
    );
    expect(new TextDecoder().decode(await collect(result))).toBe('Agent Drive format v1\n');
  });

  it('rejects truncated or overlong ranges and yields only complete authenticated frames', async () => {
    const plaintext = sequence(CHUNK_SIZE * 2);
    const ciphertext = await seal(plaintext, RAW_KEY, sequence(8));
    const header = ciphertext.subarray(0, HEADER_SIZE);
    const firstRange = ciphertextFrameRange(inspectHeader(header, ciphertext.length), 0, 1);
    const selected = ciphertext.subarray(firstRange.offset, firstRange.offset + firstRange.length);
    const oneFrameOnly = ciphertext.subarray(HEADER_SIZE, HEADER_SIZE + selected.length);
    const truncatedReader = openFileKeyFrameRange(
      fragments(oneFrameOnly),
      RAW_KEY_B64,
      header,
      0,
      2,
      ciphertext.length,
    )[Symbol.asyncIterator]();
    expect((await truncatedReader.next()).value).toEqual(plaintext.subarray(0, CHUNK_SIZE));
    await expect(truncatedReader.next()).rejects.toMatchObject({ code: 'decryption_failed' });

    const overlong = new Uint8Array(selected.length + 1);
    overlong.set(selected);
    await expect(
      collect(
        openFileKeyFrameRange(fragments(overlong), RAW_KEY_B64, header, 0, 1, ciphertext.length),
      ),
    ).rejects.toMatchObject({ code: 'decryption_failed' });
  });

  it('does not yield a forged frame index or final flag', async () => {
    const plaintext = sequence(CHUNK_SIZE * 2);
    const ciphertext = await seal(plaintext, RAW_KEY, sequence(8));
    const header = ciphertext.subarray(0, HEADER_SIZE);
    const frameSize = CHUNK_SIZE + 16;
    const indexOne = ciphertext.subarray(HEADER_SIZE + frameSize, HEADER_SIZE + frameSize * 2);
    const wrongIndexReader = openFileKeyFrameRange(
      fragments(indexOne),
      RAW_KEY_B64,
      header,
      0,
      1,
      ciphertext.length,
    )[Symbol.asyncIterator]();
    await expect(wrongIndexReader.next()).rejects.toMatchObject({ code: 'decryption_failed' });

    const baseNonce = header.subarray(9, 17);
    const iv = new Uint8Array(12);
    iv.set(baseNonce);
    new DataView(iv.buffer).setUint32(8, 1, false);
    const additionalData = new Uint8Array(HEADER_SIZE + 5);
    additionalData.set(header);
    new DataView(additionalData.buffer).setUint32(HEADER_SIZE, 1, false);
    additionalData[HEADER_SIZE + 4] = 0; // This frame is intentionally authenticated as non-final.
    const key = await crypto.subtle.importKey('raw', RAW_KEY, 'AES-GCM', false, ['encrypt']);
    const forgedFinal = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
        key,
        sequence(CHUNK_SIZE),
      ),
    );
    const forgedFinalReader = openFileKeyFrameRange(
      fragments(forgedFinal),
      RAW_KEY_B64,
      header,
      1,
      1,
      ciphertext.length,
    )[Symbol.asyncIterator]();
    await expect(forgedFinalReader.next()).rejects.toMatchObject({ code: 'decryption_failed' });
  });

  it('rejects an invalid file key through the shared crypto error contract', async () => {
    const ciphertext = await seal(sequence(8), RAW_KEY, sequence(8));
    const header = ciphertext.subarray(0, HEADER_SIZE);
    await expect(
      collect(
        openFileKeyFrameRange(
          fragments(ciphertext.subarray(HEADER_SIZE)),
          generateDriveKey(),
          header,
          0,
          1,
          ciphertext.length,
        ),
      ),
    ).rejects.toMatchObject({ code: 'decryption_failed' });
  });
});
