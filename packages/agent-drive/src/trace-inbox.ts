// Trace inbox v1 and wrapped-key envelope v2 (docs/crypto.md). WebCrypto only; runs in Node and
// browsers. The inbox private key is wrapped under the drive key, so a server that holds only the
// public key can seal file keys to the drive without ever holding the drive key.
import { decodeBase64Url, decodeDriveKey, encodeBase64Url } from './crypto.ts';

const enc = new TextEncoder();
const EC = { name: 'ECDH', namedCurve: 'P-256' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SEAL_SALT = 'agent-drive-trace-inbox-v1';

export type TraceInboxRecord = { keyId: string; publicKey: string; wrappedPrivateKey: string };
/** A stored record plus the drive the reader asked for (never taken from the server). */
export type TraceInbox = TraceInboxRecord & { driveId: string };
/** Test hooks for frozen vectors. Production callers pass nothing. */
export type InboxRandom = { keyPair?: CryptoKeyPair; keyId?: string; iv?: Uint8Array };
export type SealRandom = { ephemeral?: CryptoKeyPair; iv?: Uint8Array };

const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const wrapAad = (i: TraceInbox) =>
  enc.encode(`agent-drive:trace-inbox:v1:${i.driveId}:${i.keyId}:${i.publicKey}`);
/** HKDF info and AES-GCM AAD: binds the drive, key id, serialized epk and recipient public key. */
const label = (keyId: string, driveId: string, epk: Uint8Array, publicKey: string) =>
  enc.encode(`${keyId}:${driveId}:${encodeBase64Url(epk)}:${publicKey}`);

async function importPublicPoint(value: unknown): Promise<CryptoKey> {
  if (typeof value !== 'string' || value.length !== 87) throw new Error('point');
  const raw = decodeBase64Url(value);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('point');
  // Rejects points that are not on the P-256 curve.
  return crypto.subtle.importKey('raw', raw, EC, false, []);
}

/** Validates every field before any key agreement or decryption. */
async function validate(inbox: TraceInbox) {
  const { driveId, keyId, publicKey, wrappedPrivateKey } = inbox;
  if (!isUuid(driveId) || !isUuid(keyId)) throw new Error('Invalid trace inbox record.');
  // 61..285 decoded bytes is 82..380 base64url characters.
  if (
    typeof wrappedPrivateKey !== 'string' ||
    wrappedPrivateKey.length < 82 ||
    wrappedPrivateKey.length > 380
  )
    throw new Error('Invalid trace inbox record.');
  const wrapped = decodeBase64Url(wrappedPrivateKey);
  // version(1) + iv(12) + tag(16) + PKCS#8 length n, 32 <= n <= 256.
  if (wrapped[0] !== 1 || wrapped.length < 61 || wrapped.length > 285)
    throw new Error('Invalid trace inbox record.');
  await importPublicPoint(publicKey);
  return wrapped;
}

function aesDriveKey(driveKey: string, usages: KeyUsage[]) {
  const raw = decodeDriveKey(driveKey) as Uint8Array<ArrayBuffer>;
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);
}

export async function createTraceInbox(
  driveId: string,
  driveKey: string,
  random: InboxRandom = {},
): Promise<TraceInboxRecord> {
  if (!isUuid(driveId)) throw new Error('Invalid drive id.');
  const subtle = crypto.subtle;
  const pair = random.keyPair ?? (await subtle.generateKey(EC, true, ['deriveBits']));
  const publicKey = encodeBase64Url(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)));
  const keyId = random.keyId ?? crypto.randomUUID();
  const iv = random.iv ?? crypto.getRandomValues(new Uint8Array(12));
  const wrapped = new Uint8Array(
    await subtle.wrapKey('pkcs8', pair.privateKey, await aesDriveKey(driveKey, ['wrapKey']), {
      name: 'AES-GCM',
      iv: iv as Uint8Array<ArrayBuffer>,
      additionalData: wrapAad({ driveId, keyId, publicKey, wrappedPrivateKey: '' }),
    }),
  );
  const out = new Uint8Array(1 + 12 + wrapped.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(wrapped, 13);
  return { keyId, publicKey, wrappedPrivateKey: encodeBase64Url(out) };
}

/** Returns a non-extractable ECDH key. Throws if the drive key or the record's drive is wrong. */
export async function unwrapInboxPrivateKey(inbox: TraceInbox, driveKey: string) {
  const wrapped = await validate(inbox);
  return crypto.subtle.unwrapKey(
    'pkcs8',
    wrapped.slice(13) as Uint8Array<ArrayBuffer>,
    await aesDriveKey(driveKey, ['unwrapKey']),
    {
      name: 'AES-GCM',
      iv: wrapped.slice(1, 13) as Uint8Array<ArrayBuffer>,
      additionalData: wrapAad(inbox),
    },
    EC,
    false,
    ['deriveBits'],
  );
}

async function sealKey(bits: ArrayBuffer, context: Uint8Array, usage: KeyUsage) {
  const subtle = crypto.subtle;
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode(SEAL_SALT),
      info: context as Uint8Array<ArrayBuffer>,
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

/** Seals a 43-character file key to the inbox public key. Returns a 183-character envelope. */
export async function sealFileKeyToInbox(
  fileKey: string,
  inbox: Pick<TraceInbox, 'driveId' | 'keyId' | 'publicKey'>,
  random: SealRandom = {},
): Promise<string> {
  decodeDriveKey(fileKey);
  if (!isUuid(inbox.driveId) || !isUuid(inbox.keyId))
    throw new Error('Invalid trace inbox record.');
  const subtle = crypto.subtle;
  const point = await importPublicPoint(inbox.publicKey);
  const ephemeral = random.ephemeral ?? (await subtle.generateKey(EC, true, ['deriveBits']));
  const bits = await subtle.deriveBits({ name: 'ECDH', public: point }, ephemeral.privateKey, 256);
  const rawEpk = new Uint8Array(await subtle.exportKey('raw', ephemeral.publicKey));
  const context = label(inbox.keyId, inbox.driveId, rawEpk, inbox.publicKey);
  const aes = await sealKey(bits, context, 'encrypt');
  const iv = random.iv ?? crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer>, additionalData: context },
      aes,
      enc.encode(fileKey),
    ),
  );
  const out = new Uint8Array(137);
  out[0] = 2;
  out.set(rawEpk, 1);
  out.set(iv, 66);
  out.set(ct, 78);
  return encodeBase64Url(out);
}

/** Opens an envelope v2. `driveId` is the drive the reader requested. Returns the file key. */
export async function unsealFileKeyFromInbox(
  envelope: string,
  privateKey: CryptoKey,
  keyId: string,
  driveId: string,
  publicKey: string,
): Promise<string> {
  if (!isUuid(driveId) || !isUuid(keyId)) throw new Error('Invalid trace inbox record.');
  await importPublicPoint(publicKey);
  if (envelope.length !== 183) throw new Error('Invalid wrapped key.');
  const bytes = decodeBase64Url(envelope);
  if (bytes.length !== 137 || bytes[0] !== 2) throw new Error('Invalid wrapped key.');
  const subtle = crypto.subtle;
  const rawEpk = bytes.slice(1, 66);
  // Only the canonical uncompressed form: the hybrid 0x07 prefix and the negated point would
  // otherwise derive the same ECDH secret.
  if (rawEpk[0] !== 4) throw new Error('Invalid wrapped key.');
  const epk = await subtle.importKey('raw', rawEpk, EC, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: epk }, privateKey, 256);
  const context = label(keyId, driveId, rawEpk, publicKey);
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(66, 78), additionalData: context },
    await sealKey(bits, context, 'decrypt'),
    bytes.slice(78),
  );
  const fileKey = new TextDecoder().decode(plain);
  decodeDriveKey(fileKey);
  return fileKey;
}
