import { open, owned, seal } from './crypto-format.ts';
import { unsealFileKeyFromInbox, unwrapInboxPrivateKey, type TraceInbox } from './trace-inbox.ts';

export { CHUNK_SIZE, encryptedSize, plaintextSize } from './crypto-format.ts';

export class DriveCryptoError extends Error {
  constructor(
    readonly code:
      | 'missing_drive_key'
      | 'invalid_drive_key'
      | 'decryption_failed'
      | 'inbox_key_required',
    message: string,
  ) {
    super(message);
    this.name = 'DriveCryptoError';
  }
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid base64url.');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) throw new Error('Noncanonical base64url.');
  return bytes;
}

export function decodeDriveKey(value: string | undefined) {
  if (!value)
    throw new DriveCryptoError(
      'missing_drive_key',
      'Missing drive key. Set AGENT_DRIVE_KEY or the per-drive key variable, or load a key file.',
    );
  try {
    if (value.length !== 43) throw new Error('Invalid key length.');
    const key = decodeBase64Url(value);
    if (key.length !== 32) throw new Error('Invalid key length.');
    return key;
  } catch {
    throw new DriveCryptoError(
      'invalid_drive_key',
      'Invalid drive key. Expected a base64url-encoded 32-byte key.',
    );
  }
}

export function generateDriveKey() {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

const INBOX_REQUIRED =
  "This file was sealed to the drive's trace inbox. Fetch the inbox record and retry.";
const WRAP_AAD = new TextEncoder().encode('agent-drive:wrapped-file-key:v1');

async function importDriveKey(key: Uint8Array) {
  return crypto.subtle.importKey('raw', owned(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function failedDecryption() {
  return new DriveCryptoError(
    'decryption_failed',
    'Unable to decrypt: the drive key is wrong, or the file is damaged or incomplete.',
  );
}

export async function encryptFile(plaintext: Uint8Array, driveKey: string | undefined) {
  const drive = await importDriveKey(decodeDriveKey(driveKey));
  const fileKey = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  try {
    const wrapped = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: WRAP_AAD, tagLength: 128 },
        drive,
        fileKey,
      ),
    );
    const envelope = new Uint8Array(61);
    envelope[0] = 1;
    envelope.set(nonce, 1);
    envelope.set(wrapped, 13);
    return {
      ciphertext: await seal(plaintext, fileKey, crypto.getRandomValues(new Uint8Array(8))),
      wrappedKey: encodeBase64Url(envelope),
    };
  } finally {
    fileKey.fill(0);
  }
}

/** 1 for a drive-key-wrapped envelope (82 characters), 2 for a trace-inbox envelope (183). */
export function envelopeVersion(wrappedKey: string): 1 | 2 {
  try {
    const first = decodeBase64Url(wrappedKey)[0];
    if (first === 1 && wrappedKey.length === 82) return 1;
    if (first === 2 && wrappedKey.length === 183) return 2;
  } catch {
    // Falls through to the shared error.
  }
  throw failedDecryption();
}

/** `inbox.driveId` must be the drive the reader requested, not a value from the server record. */
export async function unwrapFileKey(
  wrappedKey: string,
  driveKey: string | undefined,
  inbox?: TraceInbox,
) {
  const drive = await importDriveKey(decodeDriveKey(driveKey));
  try {
    if (envelopeVersion(wrappedKey) === 2) {
      if (!inbox) throw new DriveCryptoError('inbox_key_required', INBOX_REQUIRED);
      const privateKey = await unwrapInboxPrivateKey(inbox, driveKey as string);
      return await unsealFileKeyFromInbox(
        wrappedKey,
        privateKey,
        inbox.keyId,
        inbox.driveId,
        inbox.publicKey,
      );
    }
    const envelope = decodeBase64Url(wrappedKey);
    if (envelope.length !== 61) throw new Error('Invalid wrapped key.');
    const key = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: envelope.slice(1, 13), additionalData: WRAP_AAD, tagLength: 128 },
        drive,
        envelope.slice(13),
      ),
    );
    try {
      return encodeBase64Url(key);
    } finally {
      key.fill(0);
    }
  } catch (error) {
    if (error instanceof DriveCryptoError && error.code === 'inbox_key_required') throw error;
    throw failedDecryption();
  }
}

export async function decryptWithFileKey(ciphertext: Uint8Array, fileKey: string) {
  try {
    return await open(ciphertext, decodeDriveKey(fileKey));
  } catch {
    throw failedDecryption();
  }
}

export async function decryptFile(
  ciphertext: Uint8Array,
  wrappedKey: string,
  driveKey: string | undefined,
  inbox?: TraceInbox,
) {
  return decryptWithFileKey(ciphertext, await unwrapFileKey(wrappedKey, driveKey, inbox));
}
