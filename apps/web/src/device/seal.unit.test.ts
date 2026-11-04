import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseRecoveryFile, sealDriveKey } from './seal';

const subtle = webcrypto.subtle;
const enc = new TextEncoder();
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

// Test-local reverse of docs/agent-login.md section 4.
async function unseal(
  privateKey: webcrypto.CryptoKey,
  driveId: string,
  sealed: { epk: string; iv: string; ct: string },
) {
  const epk = await subtle.importKey(
    'raw',
    unb64u(sealed.epk),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const bits = await subtle.deriveBits({ name: 'ECDH', public: epk }, privateKey, 256);
  const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const aes = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('agent-drive-device-v1'),
      info: enc.encode(driveId),
    },
    hk,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: unb64u(sealed.iv), additionalData: enc.encode(driveId) },
    aes,
    unb64u(sealed.ct),
  );
  return new TextDecoder().decode(pt);
}

async function agentKeys() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: b64u(raw), raw };
}

describe('sealDriveKey', () => {
  it('round-trips and rejects a different drive id', async () => {
    const agent = await agentKeys();
    const driveId = '11111111-1111-4111-8111-111111111111';
    const sealed = await sealDriveKey(agent.publicKey, driveId, 'ad_key_secret');
    expect(agent.raw.length).toBe(65);
    expect(unb64u(sealed.epk).length).toBe(65);
    expect(unb64u(sealed.iv).length).toBe(12);
    expect(sealed.ct).not.toMatch(/[=+/]/);
    expect(await unseal(agent.privateKey, driveId, sealed)).toBe('ad_key_secret');
    await expect(
      unseal(agent.privateKey, '22222222-2222-4222-8222-222222222222', sealed),
    ).rejects.toThrow();
  });

  it('rejects a malformed agent public key', async () => {
    await expect(sealDriveKey('AAAA', 'd', 'k')).rejects.toThrow();
  });
});

describe('parseRecoveryFile', () => {
  it('returns the key for the matching drive only', () => {
    const text = JSON.stringify({ driveId: 'd1', key: 'abc' });
    expect(parseRecoveryFile(text, 'd1')).toBe('abc');
    expect(() => parseRecoveryFile(text, 'd2')).toThrow(/does not belong/);
    expect(() => parseRecoveryFile('nope', 'd1')).toThrow(/JSON/);
  });
});
