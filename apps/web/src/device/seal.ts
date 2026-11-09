// Browser-to-agent drive-key sealing, docs/agent-login.md section 4.
// Uses only WebCrypto, so it runs in browsers and in Node's globalThis.crypto.

const enc = new TextEncoder();

export type SealedKey = { epk: string; iv: string; ct: string };

function toB64u(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromB64u(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid base64url.');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** HKDF salt and the label used as both HKDF info and AES-GCM AAD. Default is the device seal. */
export type SealContext = { salt: string; label: string };

export async function sealDriveKey(
  agentPublicKey: string,
  driveId: string,
  driveKey: string,
  context: SealContext = { salt: 'agent-drive-device-v1', label: driveId },
): Promise<SealedKey> {
  const subtle = globalThis.crypto.subtle;
  const raw = fromB64u(agentPublicKey);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('The agent public key is invalid.');
  const agent = await subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ephemeral = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: agent }, ephemeral.privateKey, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const aes = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode(context.salt),
      info: enc.encode(context.label),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(context.label) },
    aes,
    enc.encode(driveKey),
  );
  return {
    epk: toB64u(new Uint8Array(await subtle.exportKey('raw', ephemeral.publicKey))),
    iv: toB64u(iv),
    ct: toB64u(new Uint8Array(ct)),
  };
}

/** Reads a console recovery file ({ driveId, key }) and returns its key for `driveId`. */
export function parseRecoveryFile(text: string, driveId: string): string {
  if (text.length > 16_384) throw new Error('This is not a valid drive key file.');
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    throw new Error('Choose a JSON recovery file downloaded from this console.');
  }
  const c = candidate as { driveId?: unknown; key?: unknown } | null;
  if (!c || typeof c !== 'object' || c.driveId !== driveId || typeof c.key !== 'string')
    throw new Error('This recovery file does not belong to the selected drive.');
  return c.key;
}
