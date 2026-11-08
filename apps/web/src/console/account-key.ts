// Account key v1 (docs/crypto.md, "Account key v1"). WebCrypto only; runs in browsers and Node.
// The service stores only the records produced here. It never sees a passphrase, a KEK, the
// private key or a drive key. Never log or echo any input to these functions.
import { decodeDriveKey } from '../../../../packages/agent-drive/src/crypto.ts';
import { sealDriveKey, type SealedKey } from '../device/seal';

export type { SealedKey };

export const MIN_ITERATIONS = 600_000;
export const MAX_ITERATIONS = 2_000_000;
export const KDF_NAME = 'PBKDF2-SHA256';
const ACCOUNT_SEAL_SALT = 'agent-drive-account-v1';
const NEWER_VERSION = 'This account key needs a newer version of Agent Drive. Reload the page.';
const WRONG_PASSPHRASE = 'That passphrase is not correct.';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const enc = new TextEncoder();
const EC = { name: 'ECDH', namedCurve: 'P-256' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type AccountKeyRecord = {
  id: string;
  accountId: string;
  format: 1;
  publicKey: string;
  wrappedPrivateKey: string;
  wrapGeneration: number;
  kdf: { name: typeof KDF_NAME; iterations: number; salt: string };
};
export type AccountSlot = {
  driveId: string;
  keyId: string;
  format: 1;
  sealed: SealedKey;
  revision: number;
};

function b64u(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

/** Canonical unpadded base64url only: re-encodes and compares. Throws on anything else. */
function unb64u(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('b64');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (b64u(bytes) !== value) throw new Error('b64');
  return bytes;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const isIterations = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= MIN_ITERATIONS && v <= MAX_ITERATIONS;

async function importPublicPoint(value: unknown, expectedChars: number): Promise<string> {
  if (typeof value !== 'string' || value.length !== expectedChars) throw new Error('point');
  const raw = unb64u(value);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('point');
  // Rejects points that are not on the P-256 curve.
  await globalThis.crypto.subtle.importKey('raw', raw, EC, false, []);
  return value;
}

/** Validates a server record. Runs before any key derivation. Throws one generic message. */
export async function parseAccountKeyRecord(
  raw: unknown,
  sessionAccountId: string,
): Promise<AccountKeyRecord> {
  try {
    if (!isObject(raw) || !isObject(raw.kdf)) throw new Error('shape');
    const { id, accountId, format, publicKey, wrappedPrivateKey, wrapGeneration, kdf } = raw as {
      [k: string]: unknown;
      kdf: Record<string, unknown>;
    };
    if (format !== 1 || kdf.name !== KDF_NAME || !isIterations(kdf.iterations))
      throw new Error('version');
    if (!isUuid(id) || !isUuid(accountId) || accountId !== sessionAccountId) throw new Error('ids');
    if (
      typeof wrapGeneration !== 'number' ||
      !Number.isSafeInteger(wrapGeneration) ||
      wrapGeneration < 1
    )
      throw new Error('generation');
    if (unb64u(kdf.salt).length !== 16) throw new Error('salt');
    const wrapped = unb64u(wrappedPrivateKey);
    // version(1) + iv(12) + tag(16) + PKCS#8 length n, 32 <= n <= 256.
    if (wrapped[0] !== 1 || wrapped.length < 1 + 12 + 16 + 32 || wrapped.length > 1 + 12 + 16 + 256)
      throw new Error('wrapped');
    await importPublicPoint(publicKey, 87);
    return {
      id,
      accountId,
      format: 1,
      publicKey: publicKey as string,
      wrappedPrivateKey: wrappedPrivateKey as string,
      wrapGeneration,
      kdf: { name: KDF_NAME, iterations: kdf.iterations, salt: kdf.salt as string },
    };
  } catch {
    throw new Error(NEWER_VERSION);
  }
}

/** Validates one slot as returned by the slots route. Runs before any key agreement. */
export async function parseSlot(raw: unknown): Promise<AccountSlot> {
  try {
    if (!isObject(raw) || !isObject(raw.sealed)) throw new Error('shape');
    const { driveId, keyId, format, revision } = raw;
    const { epk, iv, ct } = raw.sealed;
    if (format !== 1 || !isUuid(driveId) || !isUuid(keyId)) throw new Error('ids');
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1)
      throw new Error('revision');
    if (typeof iv !== 'string' || iv.length !== 16 || unb64u(iv).length !== 12)
      throw new Error('iv');
    if (typeof ct !== 'string' || ct.length !== 79 || unb64u(ct).length !== 59)
      throw new Error('ct');
    await importPublicPoint(epk, 87);
    return { driveId, keyId, format: 1, revision, sealed: { epk: epk as string, iv, ct } };
  } catch {
    throw new Error(NEWER_VERSION);
  }
}

async function deriveKek(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey(
    'raw',
    enc.encode(passphrase.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

const wrapAad = (r: Pick<AccountKeyRecord, 'accountId' | 'id' | 'wrapGeneration' | 'publicKey'>) =>
  enc.encode(
    `agent-drive:account-key:v1:${r.accountId}:${r.id}:${r.wrapGeneration}:${r.publicKey}`,
  );

async function wrapPrivateKey(
  privateKey: CryptoKey,
  passphrase: string,
  iterations: number,
  meta: Pick<AccountKeyRecord, 'accountId' | 'id' | 'wrapGeneration' | 'publicKey'>,
) {
  const subtle = globalThis.crypto.subtle;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveKek(passphrase, salt, iterations);
  const wrapped = new Uint8Array(
    await subtle.wrapKey('pkcs8', privateKey, kek, {
      name: 'AES-GCM',
      iv,
      additionalData: wrapAad(meta),
    }),
  );
  const out = new Uint8Array(1 + 12 + wrapped.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(wrapped, 13);
  return {
    wrappedPrivateKey: b64u(out),
    kdf: { name: KDF_NAME, iterations, salt: b64u(salt) } as AccountKeyRecord['kdf'],
  };
}

async function unwrapPrivateKey(
  record: AccountKeyRecord,
  passphrase: string,
  extractable: boolean,
) {
  const wrapped = unb64u(record.wrappedPrivateKey);
  const kek = await deriveKek(passphrase, unb64u(record.kdf.salt), record.kdf.iterations);
  try {
    return await globalThis.crypto.subtle.unwrapKey(
      'pkcs8',
      wrapped.slice(13),
      kek,
      { name: 'AES-GCM', iv: wrapped.slice(1, 13), additionalData: wrapAad(record) },
      EC,
      extractable,
      ['deriveBits'],
    );
  } catch {
    throw new Error(WRONG_PASSPHRASE);
  }
}

function checkIterations(iterations: number) {
  if (!isIterations(iterations)) throw new Error('The key derivation cost is out of range.');
}

/** Makes a new account key pair wrapped by `passphrase`. The returned key is non-extractable. */
export async function createAccountKey(
  accountId: string,
  passphrase: string,
  iterations = MIN_ITERATIONS,
): Promise<{ record: AccountKeyRecord; privateKey: CryptoKey }> {
  checkIterations(iterations);
  const subtle = globalThis.crypto.subtle;
  const pair = await subtle.generateKey(EC, true, ['deriveBits']);
  const publicKey = b64u(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)));
  const meta = { accountId, id: globalThis.crypto.randomUUID(), wrapGeneration: 1, publicKey };
  const { wrappedPrivateKey, kdf } = await wrapPrivateKey(
    pair.privateKey,
    passphrase,
    iterations,
    meta,
  );
  const record: AccountKeyRecord = { ...meta, format: 1, wrappedPrivateKey, kdf };
  // Hand back the same non-extractable key that unlock would produce.
  return { record, privateKey: await unwrapPrivateKey(record, passphrase, false) };
}

/** Validates `raw`, then unwraps the private key. Throws "That passphrase is not correct." */
export async function unlockAccountKey(
  raw: unknown,
  sessionAccountId: string,
  passphrase: string,
): Promise<CryptoKey> {
  return unwrapPrivateKey(await parseAccountKeyRecord(raw, sessionAccountId), passphrase, false);
}

/**
 * Re-wraps the same private key under a new passphrase and `wrapGeneration + 1`. Does not revoke
 * the old wrapper: the old passphrase plus an old copy of the record still recovers the key.
 */
export async function rewrapAccountKey(
  raw: unknown,
  sessionAccountId: string,
  oldPassphrase: string,
  newPassphrase: string,
  iterations = MIN_ITERATIONS,
): Promise<AccountKeyRecord> {
  const record = await parseAccountKeyRecord(raw, sessionAccountId);
  checkIterations(iterations);
  // Extractable only inside this function, so it can be wrapped again.
  const privateKey = await unwrapPrivateKey(record, oldPassphrase, true);
  const next = { ...record, wrapGeneration: record.wrapGeneration + 1 };
  const { wrappedPrivateKey, kdf } = await wrapPrivateKey(
    privateKey,
    newPassphrase,
    iterations,
    next,
  );
  return { ...next, wrappedPrivateKey, kdf };
}

const sealContext = (keyId: string, driveId: string) => ({
  salt: ACCOUNT_SEAL_SALT,
  label: `${keyId}:${driveId}`,
});

/** Seals a drive key to the account public key. Output is the slot's `sealed` field. */
export async function sealToAccount(
  publicKey: string,
  keyId: string,
  driveId: string,
  driveKey: string,
): Promise<SealedKey> {
  if (!isUuid(keyId) || !isUuid(driveId)) throw new Error('Invalid slot identifiers.');
  decodeDriveKey(driveKey);
  return sealDriveKey(publicKey, driveId, driveKey, sealContext(keyId, driveId));
}

/** Opens a slot. The result has passed `decodeDriveKey`. Throws if anything does not match. */
export async function unsealFromAccount(
  privateKey: CryptoKey,
  keyId: string,
  driveId: string,
  sealed: SealedKey,
): Promise<string> {
  if (!isUuid(keyId) || !isUuid(driveId)) throw new Error('Invalid slot identifiers.');
  const subtle = globalThis.crypto.subtle;
  const { salt, label } = sealContext(keyId, driveId);
  const epk = await subtle.importKey('raw', unb64u(sealed.epk), EC, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: epk }, privateKey, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const aes = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(salt), info: enc.encode(label) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: unb64u(sealed.iv), additionalData: enc.encode(label) },
    aes,
    unb64u(sealed.ct),
  );
  const key = new TextDecoder().decode(plain);
  decodeDriveKey(key);
  return key;
}

/** Display only: first 8 bytes of SHA-256(raw public key) as four hex groups. Not a check. */
export async function fingerprint(publicKey: string): Promise<string> {
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', unb64u(publicKey)),
  ).slice(0, 8);
  const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.match(/.{4}/gu)!.join(' ');
}

/** 20 Crockford base32 symbols (100 bits). 256 is a multiple of 32, so `byte & 31` is unbiased. */
export function generatePassphrase(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => CROCKFORD[b & 31]).join('');
}

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const COMMON = ['agentdrive', 'agent drive', 'password', 'passphrase'];

function hasSequence(text: string): boolean {
  const classOf = (c: string) => (/[a-z]/u.test(c) ? 1 : /[0-9]/u.test(c) ? 2 : 0);
  const chars = [...text];
  for (let i = 0; i + 3 < chars.length; i += 1) {
    const cls = classOf(chars[i]!);
    if (!cls) continue;
    for (const step of [1, -1]) {
      let run = 1;
      while (
        run < 4 &&
        classOf(chars[i + run]!) === cls &&
        chars[i + run]!.charCodeAt(0) - chars[i + run - 1]!.charCodeAt(0) === step
      )
        run += 1;
      if (run === 4) return true;
    }
  }
  return false;
}

export type PassphraseCheck = { ok: true } | { ok: false; reason: string };

/** Local weak-pattern check for custom passphrases. It only catches obvious patterns. */
export function checkPassphrase(passphrase: string, accountEmail = ''): PassphraseCheck {
  const text = passphrase.normalize('NFKC');
  const chars = [...text];
  if (chars.length < 14) return { ok: false, reason: 'Use at least 14 characters.' };
  if (new Set(chars).size < 8) return { ok: false, reason: 'it uses too few different characters' };
  const lower = text.toLowerCase();
  const lowerChars = [...lower];
  if (lowerChars.some((c, i) => i >= 3 && lowerChars.slice(i - 3, i + 1).every((x) => x === c)))
    return { ok: false, reason: 'it repeats one character' };
  if (hasSequence(lower))
    return { ok: false, reason: 'it contains an ascending or descending sequence' };
  for (const row of KEYBOARD_ROWS) {
    const reversed = [...row].reverse().join('');
    for (let i = 0; i + 4 <= row.length; i += 1)
      if (lower.includes(row.slice(i, i + 4)) || lower.includes(reversed.slice(i, i + 4)))
        return { ok: false, reason: 'it contains a keyboard row pattern' };
  }
  // ponytail: local parts shorter than 3 characters are skipped, or "a@x.com" would ban every "a".
  const local = accountEmail.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 3 && lower.includes(local))
    return { ok: false, reason: 'it contains your email name' };
  if (COMMON.some((word) => lower.includes(word)))
    return { ok: false, reason: 'it contains a common word' };
  return { ok: true };
}
