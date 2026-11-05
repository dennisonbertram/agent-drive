import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sealDriveKey, unsealDriveKey } from './seal.js';

const { subtle } = webcrypto;
const text = new TextEncoder();
const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes as ArrayBuffer).toString('base64url');

// Browser-side recipe from docs/agent-login.md section 4.
async function seal(agentPublic: Uint8Array, driveId: string, secret: string) {
  const agent = await subtle.importKey(
    'raw',
    agentPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: agent }, eph.privateKey, 256);
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
    ['encrypt'],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: text.encode(driveId) },
    aes,
    text.encode(secret),
  );
  return { epk: b64(await subtle.exportKey('raw', eph.publicKey)), iv: b64(iv), ct: b64(ct) };
}

describe('unsealDriveKey', () => {
  it('round-trips and binds to the drive id', async () => {
    const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const pub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
    const sealed = await seal(pub, 'drive-1', 'adk-secret-key');
    expect(await unsealDriveKey(pair.privateKey, 'drive-1', sealed)).toBe('adk-secret-key');
    await expect(unsealDriveKey(pair.privateKey, 'drive-2', sealed)).rejects.toThrow();
    const other = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    await expect(unsealDriveKey(other.privateKey, 'drive-1', sealed)).rejects.toThrow();
  });
});

describe('sealDriveKey', () => {
  it('round-trips with unsealDriveKey and binds to the drive id', async () => {
    const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const pub = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64url');
    const sealed = await sealDriveKey(pub, 'drive-1', 'adk-secret-key');
    expect(JSON.stringify(sealed)).not.toContain('adk-secret-key');
    expect(await unsealDriveKey(pair.privateKey, 'drive-1', sealed)).toBe('adk-secret-key');
    await expect(unsealDriveKey(pair.privateKey, 'drive-2', sealed)).rejects.toThrow();
  });
});
