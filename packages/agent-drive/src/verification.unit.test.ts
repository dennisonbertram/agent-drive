import { createHash, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  normalizeVerificationCode,
  verificationCode,
  VERIFICATION_CODE_PATTERN,
} from './verification.js';
import { generateDeviceKeyPair } from './seal.js';
import { accountKeyFingerprint } from './account-seal.js';

const { subtle } = webcrypto;
const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes as ArrayBuffer).toString('base64url');

// The reference: the account key's display fingerprint — SHA-256 of the raw key, first 8 bytes,
// four hex groups. Both sides must agree on this exactly or binding is silently off.
function referenceCode(publicKey: string): string {
  const hex = createHash('sha256')
    .update(Buffer.from(publicKey, 'base64url'))
    .digest('hex')
    .slice(0, 16);
  return hex.match(/.{4}/gu)!.join(' ');
}

describe('verificationCode', () => {
  it('is the raw-key SHA-256 fingerprint in four hex groups', async () => {
    const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const publicKey = b64(await subtle.exportKey('raw', pair.publicKey));
    const code = await verificationCode(publicKey);
    expect(code).toBe(referenceCode(publicKey));
    expect(VERIFICATION_CODE_PATTERN.test(code)).toBe(true);
    expect(code).toBe(accountKeyFingerprint(publicKey));
  });

  it('changes when the public key changes (substituted keys never share a code)', async () => {
    const a = await generateDeviceKeyPair();
    const b = await generateDeviceKeyPair();
    expect(await verificationCode(a.publicKey)).not.toBe(await verificationCode(b.publicKey));
  });
});

describe('normalizeVerificationCode', () => {
  it('accepts the typed code with any casing or spacing', async () => {
    const pair = await generateDeviceKeyPair();
    const code = await verificationCode(pair.publicKey);
    const compact = code.replaceAll(' ', '');
    expect(normalizeVerificationCode(code)).toBe(code);
    expect(normalizeVerificationCode(compact)).toBe(code);
    expect(normalizeVerificationCode(compact.toUpperCase())).toBe(code);
    expect(normalizeVerificationCode(` ${code.replaceAll(' ', '  ')} `)).toBe(code);
    expect(normalizeVerificationCode('A1B2-C3D4.E5F6 7890')).toBe('a1b2 c3d4 e5f6 7890');
  });

  it('rejects input that is not a 16-hex-digit code', () => {
    for (const bad of ['', 'a1b2', 'a1b2 c3d4 e5f6', 'a1b2 c3d4 e5f6 78901', 'g1b2 c3d4 e5f6 7890'])
      expect(normalizeVerificationCode(bad)).toBeUndefined();
  });
});
