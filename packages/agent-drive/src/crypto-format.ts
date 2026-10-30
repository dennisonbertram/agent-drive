export const CHUNK_SIZE = 1024 * 1024;
export const HEADER_SIZE = 25;
const TAG_SIZE = 16;
const MAGIC = new Uint8Array([65, 68, 82, 86, 1]);
const MAX_CHUNKS = 0x1_0000_0000;

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

async function importFileKey(key: Uint8Array) {
  if (key.length !== 32) throw new Error('File keys must be 32 bytes.');
  return crypto.subtle.importKey('raw', owned(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Internal format primitive. Callers must use a fresh file key and nonce for each encryption.
export async function seal(plaintext: Uint8Array, fileKey: Uint8Array, baseNonce: Uint8Array) {
  if (baseNonce.length !== 8) throw new Error('Base nonce must be 8 bytes.');
  const header = new Uint8Array(HEADER_SIZE);
  header.set(MAGIC);
  const view = new DataView(header.buffer);
  view.setUint32(5, CHUNK_SIZE, false);
  header.set(baseNonce, 9);
  view.setBigUint64(17, BigInt(plaintext.length), false);
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

export async function open(ciphertext: Uint8Array, fileKey: Uint8Array) {
  if (ciphertext.length < HEADER_SIZE + TAG_SIZE) throw new Error('Truncated ciphertext.');
  const header = owned(ciphertext.subarray(0, HEADER_SIZE));
  if (!MAGIC.every((byte, index) => header[index] === byte)) throw new Error('Unknown format.');
  const view = new DataView(header.buffer);
  if (view.getUint32(5, false) !== CHUNK_SIZE) throw new Error('Unsupported chunk size.');
  const size = Number(view.getBigUint64(17, false));
  if (encryptedSize(size) !== ciphertext.length) throw new Error('Incorrect ciphertext length.');
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
