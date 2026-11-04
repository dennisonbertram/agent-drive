import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const text = new TextEncoder();
const curve = { name: 'ECDH', namedCurve: 'P-256' } as const;

export type SealedDriveKey = { epk: string; iv: string; ct: string };

export async function generateDeviceKeyPair() {
  const pair = await subtle.generateKey(curve, true, ['deriveBits']);
  const publicKey = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString(
    'base64url',
  );
  return { privateKey: pair.privateKey, publicKey };
}

// Reverses the browser-side sealing in docs/agent-login.md section 4.
export async function unsealDriveKey(
  privateKey: webcrypto.CryptoKey,
  driveId: string,
  sealed: SealedDriveKey,
) {
  const epk = await subtle.importKey('raw', Buffer.from(sealed.epk, 'base64url'), curve, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: epk }, privateKey, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const aes = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: text.encode('agent-drive-device-v1'),
      info: text.encode(driveId),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plain = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: Buffer.from(sealed.iv, 'base64url'),
      additionalData: text.encode(driveId),
    },
    aes,
    Buffer.from(sealed.ct, 'base64url'),
  );
  return new TextDecoder().decode(plain);
}
