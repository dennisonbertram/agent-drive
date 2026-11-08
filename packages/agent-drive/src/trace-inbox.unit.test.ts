import { describe, expect, it } from 'vitest';
import { generateDriveKey } from './crypto.js';
import {
  createTraceInbox,
  sealFileKeyToInbox,
  unsealFileKeyFromInbox,
  unwrapInboxPrivateKey,
} from './trace-inbox.js';
import { vector as v } from './trace-inbox.vectors.js';

const EC = { name: 'ECDH', namedCurve: 'P-256' } as const;
const pairFrom = async (j: JsonWebKey) => ({
  privateKey: await crypto.subtle.importKey('jwk', j, EC, true, ['deriveBits']),
  publicKey: await crypto.subtle.importKey(
    'jwk',
    { kty: j.kty!, crv: j.crv!, x: j.x!, y: j.y! },
    EC,
    true,
    [],
  ),
});
const record = { keyId: v.keyId, publicKey: v.publicKey, wrappedPrivateKey: v.wrappedPrivateKey };
const inbox = { driveId: v.driveId, ...record };
const OTHER_DRIVE = '99999999-2222-4333-8444-555555555555';
const OTHER_KEY = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// Flip one character of a base64url string at `index` to a different valid character.
const flip = (s: string, index: number) =>
  s.slice(0, index) + (s[index] === 'A' ? 'B' : 'A') + s.slice(index + 1);

describe('trace inbox frozen vectors', () => {
  it('creates the frozen record from fixed inputs', async () => {
    const made = await createTraceInbox(v.driveId, v.driveKey, {
      keyPair: await pairFrom(v.inboxJwk),
      keyId: v.keyId,
      iv: v.inboxIv,
    });
    expect(made).toEqual(record);
  });

  it('seals the frozen 183-character envelope from fixed inputs', async () => {
    const env = await sealFileKeyToInbox(v.fileKey, inbox, {
      ephemeral: await pairFrom(v.ephemeralJwk),
      iv: v.envelopeIv,
    });
    expect(env).toBe(v.envelope);
    expect(env).toHaveLength(183);
  });

  it('opens the frozen envelope', async () => {
    const key = await unwrapInboxPrivateKey(inbox, v.driveKey);
    expect(await unsealFileKeyFromInbox(v.envelope, key, v.keyId, v.driveId)).toBe(v.fileKey);
  });
});

describe('trace inbox round trip and failures', () => {
  it('round-trips with a fresh inbox', async () => {
    const driveKey = generateDriveKey();
    const rec = await createTraceInbox(v.driveId, driveKey);
    const env = await sealFileKeyToInbox(v.fileKey, { driveId: v.driveId, ...rec });
    const key = await unwrapInboxPrivateKey({ driveId: v.driveId, ...rec }, driveKey);
    expect(await unsealFileKeyFromInbox(env, key, rec.keyId, v.driveId)).toBe(v.fileKey);
  });

  it('rejects tampering with epk, iv and ct, and a wrong driveId or keyId', async () => {
    const key = await unwrapInboxPrivateKey(inbox, v.driveKey);
    const open = (env: string, keyId = v.keyId, driveId = v.driveId) =>
      unsealFileKeyFromInbox(env, key, keyId, driveId);
    await expect(open(flip(v.envelope, 20))).rejects.toThrow(); // epk
    await expect(open(flip(v.envelope, 90))).rejects.toThrow(); // iv
    await expect(open(flip(v.envelope, 150))).rejects.toThrow(); // ct
    await expect(open(v.envelope, v.keyId, OTHER_DRIVE)).rejects.toThrow();
    await expect(open(v.envelope, OTHER_KEY)).rejects.toThrow();
  });

  it('cannot unwrap the private key with a wrong drive key or for another drive', async () => {
    await expect(unwrapInboxPrivateKey(inbox, generateDriveKey())).rejects.toThrow();
    await expect(
      unwrapInboxPrivateKey({ ...inbox, driveId: OTHER_DRIVE }, v.driveKey),
    ).rejects.toThrow();
  });

  it('validates the record before any crypto', async () => {
    const bad = [
      { ...inbox, driveId: 'nope' },
      { ...inbox, keyId: 'nope' },
      { ...inbox, publicKey: v.publicKey + 'A' },
      { ...inbox, publicKey: v.publicKey.slice(0, 86) + 'B' }, // non-canonical trailing bits
      { ...inbox, publicKey: 'A'.repeat(87) }, // not a P-256 point
      { ...inbox, wrappedPrivateKey: v.wrappedPrivateKey.slice(0, 81) },
      { ...inbox, wrappedPrivateKey: 'A'.repeat(400) },
      { ...inbox, wrappedPrivateKey: flip(v.wrappedPrivateKey, 0) }, // version byte
    ];
    for (const rec of bad) await expect(unwrapInboxPrivateKey(rec, v.driveKey)).rejects.toThrow();
  });

  it('refuses to seal a malformed file key or public key', async () => {
    await expect(sealFileKeyToInbox('short', inbox)).rejects.toThrow();
    await expect(
      sealFileKeyToInbox(v.fileKey, { ...inbox, publicKey: 'A'.repeat(87) }),
    ).rejects.toThrow();
  });
});
