import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  decryptFile,
  encryptedSize,
  plaintextSize,
  decryptWithFileKey,
  encryptFile,
  generateDriveKey,
  unwrapFileKey,
} from './crypto.js';
import { HEADER_SIZE, open, seal } from './crypto-format.js';

const sequence = (size: number) => Uint8Array.from({ length: size }, (_, index) => index % 251);
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');

describe('permanent encryption format regression guards', () => {
  // Frozen v1 vectors generated independently with node:crypto createCipheriv (OpenSSL).
  it.each([
    ['', '414452560100100000000102030405060700000000000000001ec04b432f29a6ed72e0563c7432e5d6'],
    [
      'Agent Drive format v1\n',
      '414452560100100000000102030405060700000000000000166863330a06230f54eb9b99b708fb4e88dcb56126cf7b6f78bd4d67fe58fc7c01f4c29b91f991',
    ],
  ])('matches the fixed vector for %j', async (plaintext, expected) => {
    const key = sequence(32);
    const bytes = new TextEncoder().encode(plaintext);
    expect(hex(await seal(bytes, key, sequence(8)))).toBe(expected);
    expect(await open(Uint8Array.from(Buffer.from(expected, 'hex')), key)).toEqual(bytes);
  });

  it.each([0, 1, CHUNK_SIZE, CHUNK_SIZE * 2 + 11, 100 * CHUNK_SIZE])(
    'round-trips %i bytes',
    async (size) => {
      const plaintext = sequence(size);
      const key = generateDriveKey();
      const result = await encryptFile(plaintext, key);
      const decoded = await decryptFile(result.ciphertext, result.wrappedKey, key);
      expect(Buffer.compare(Buffer.from(decoded), Buffer.from(plaintext))).toBe(0);
    },
    30_000,
  );

  it('rejects wrong and missing keys and a modified wrapped key', async () => {
    const key = generateDriveKey();
    const result = await encryptFile(sequence(100), key);
    await expect(
      decryptFile(result.ciphertext, result.wrappedKey, undefined),
    ).rejects.toMatchObject({ code: 'missing_drive_key' });
    await expect(encryptFile(sequence(1), 'not-a-key')).rejects.toMatchObject({
      code: 'invalid_drive_key',
    });
    await expect(
      decryptFile(result.ciphertext, result.wrappedKey, generateDriveKey()),
    ).rejects.toMatchObject({ code: 'decryption_failed' });
    const changed =
      result.wrappedKey.slice(0, 30) +
      (result.wrappedKey[30] === 'A' ? 'B' : 'A') +
      result.wrappedKey.slice(31);
    await expect(decryptFile(result.ciphertext, changed, key)).rejects.toMatchObject({
      code: 'decryption_failed',
    });
  });

  it('rejects tampering, truncation, appended data, and reordered chunks', async () => {
    const key = generateDriveKey();
    const { ciphertext, wrappedKey } = await encryptFile(sequence(CHUNK_SIZE * 2 + 17), key);
    const variants: Uint8Array[] = [];
    for (const offset of [0, 5, 10, 24, HEADER_SIZE + 5, ciphertext.length - 1]) {
      const changed = ciphertext.slice();
      changed[offset] = changed[offset]! ^ 1;
      variants.push(changed);
    }
    variants.push(ciphertext.slice(0, -1), ciphertext.slice(0, HEADER_SIZE + CHUNK_SIZE + 16));
    const extended = new Uint8Array(ciphertext.length + 1);
    extended.set(ciphertext);
    variants.push(extended);
    const swapped = ciphertext.slice();
    const frameSize = CHUNK_SIZE + 16;
    swapped.set(
      ciphertext.subarray(HEADER_SIZE + frameSize, HEADER_SIZE + frameSize * 2),
      HEADER_SIZE,
    );
    swapped.set(ciphertext.subarray(HEADER_SIZE, HEADER_SIZE + frameSize), HEADER_SIZE + frameSize);
    variants.push(swapped);
    for (const changed of variants) {
      await expect(decryptFile(changed, wrappedKey, key)).rejects.toMatchObject({
        code: 'decryption_failed',
      });
    }
  });

  it('uses a new file key per version and isolates file keys', async () => {
    const driveKey = generateDriveKey();
    const first = await encryptFile(sequence(32), driveKey);
    const second = await encryptFile(sequence(32), driveKey);
    const firstKey = await unwrapFileKey(first.wrappedKey, driveKey);
    expect(first.wrappedKey).not.toBe(second.wrappedKey);
    expect(hex(first.ciphertext)).not.toBe(hex(second.ciphertext));
    expect(await decryptWithFileKey(first.ciphertext, firstKey)).toEqual(sequence(32));
    await expect(decryptWithFileKey(second.ciphertext, firstKey)).rejects.toMatchObject({
      code: 'decryption_failed',
    });
  });
});

describe('plaintextSize', () => {
  it.each([0, 1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, 3 * CHUNK_SIZE, 3 * CHUNK_SIZE + 7])(
    'inverts encryptedSize for %i bytes',
    (size) => {
      expect(plaintextSize(encryptedSize(size))).toBe(size);
    },
  );

  it('rejects sizes smaller than an empty file', () => {
    expect(() => plaintextSize(40)).toThrow();
  });
});
