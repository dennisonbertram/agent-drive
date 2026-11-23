import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateDriveKey } from '../../../../packages/agent-drive/src/crypto.ts';
import { sealDriveKey } from '../../../../packages/agent-drive/src/seal.ts';
import { unsealFromAccount } from './account-key';

const KEY_ID = '33333333-3333-4333-8333-333333333333';
const DRIVE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DRIVE = '22222222-2222-4222-8222-222222222222';
const OTHER_KEY_ID = '44444444-4444-4444-8444-444444444444';

async function accountPair() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString(
    'base64url',
  );
  return { privateKey: pair.privateKey as unknown as CryptoKey, publicKey };
}

// What packages/agent-drive/src/account-seal.ts uses to seal a held drive key for the console.
const cliAccountContext = (keyId: string, driveId: string) => ({
  salt: 'agent-drive-account-v1',
  label: `${keyId}:${driveId}`,
});

describe('CLI-sealed account slot opened by the console code', () => {
  it('unsealFromAccount opens a slot produced by the package sealDriveKey', async () => {
    const account = await accountPair();
    const driveKey = generateDriveKey();
    const sealed = await sealDriveKey(
      account.publicKey,
      DRIVE_ID,
      driveKey,
      cliAccountContext(KEY_ID, DRIVE_ID),
    );
    expect(JSON.stringify(sealed)).not.toContain(driveKey);
    expect(await unsealFromAccount(account.privateKey, KEY_ID, DRIVE_ID, sealed)).toBe(driveKey);
  });

  it('stays bound to keyId and driveId', async () => {
    const account = await accountPair();
    const sealed = await sealDriveKey(
      account.publicKey,
      DRIVE_ID,
      generateDriveKey(),
      cliAccountContext(KEY_ID, DRIVE_ID),
    );
    await expect(
      unsealFromAccount(account.privateKey, KEY_ID, OTHER_DRIVE, sealed),
    ).rejects.toThrow();
    await expect(
      unsealFromAccount(account.privateKey, OTHER_KEY_ID, DRIVE_ID, sealed),
    ).rejects.toThrow();
    const other = await accountPair();
    await expect(unsealFromAccount(other.privateKey, KEY_ID, DRIVE_ID, sealed)).rejects.toThrow();
  });
});
