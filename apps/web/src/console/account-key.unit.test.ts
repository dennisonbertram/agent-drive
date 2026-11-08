import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkPassphrase,
  normalizeGeneratedPassphrase,
  createAccountKey,
  fingerprint,
  generatePassphrase,
  parseAccountKeyRecord,
  parseSlot,
  rewrapAccountKey,
  sealToAccount,
  unlockAccountKey,
  unsealFromAccount,
} from './account-key';
import { RECORD_VECTOR, SLOT_VECTOR } from './account-key.vectors';

const subtle = webcrypto.subtle;
const ACCOUNT = RECORD_VECTOR.accountId;
const DRIVE = '33333333-3333-4333-8333-333333333333';
const DRIVE_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));
const FAST = 600_000; // the minimum allowed; each PBKDF2 call takes roughly 0.2 s

afterEach(() => vi.restoreAllMocks());

async function derivedRaw(privateKey: CryptoKey | webcrypto.CryptoKey, publicKey: string) {
  // A non-extractable key cannot be exported, so compare ECDH output against a fixed peer.
  const peer = await subtle.importKey(
    'raw',
    unb64u(publicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  return b64u(
    new Uint8Array(
      await subtle.deriveBits(
        { name: 'ECDH', public: peer },
        privateKey as webcrypto.CryptoKey,
        256,
      ),
    ),
  );
}

describe('frozen vectors', () => {
  it('unlocks the frozen account record and yields the frozen private key', async () => {
    const key = await unlockAccountKey(RECORD_VECTOR.record, ACCOUNT, RECORD_VECTOR.passphrase);
    expect(key.extractable).toBe(false);
    const expected = await subtle.importKey(
      'pkcs8',
      unb64u(RECORD_VECTOR.pkcs8),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const peer = RECORD_VECTOR.record.publicKey;
    expect(await derivedRaw(key, peer)).toBe(await derivedRaw(expected, peer));
  });

  it('unseals the frozen slot', async () => {
    const key = await unlockAccountKey(RECORD_VECTOR.record, ACCOUNT, RECORD_VECTOR.passphrase);
    expect(
      await unsealFromAccount(key, SLOT_VECTOR.keyId, SLOT_VECTOR.driveId, SLOT_VECTOR.sealed),
    ).toBe(SLOT_VECTOR.driveKey);
  });

  it('fingerprints the frozen public key', async () => {
    expect(await fingerprint(RECORD_VECTOR.record.publicKey)).toMatch(
      /^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/u,
    );
  });
});

describe('account key record', () => {
  it('rejects a wrong passphrase and every changed AAD part', async () => {
    const r = RECORD_VECTOR.record;
    await expect(unlockAccountKey(r, ACCOUNT, 'wrong passphrase')).rejects.toThrow(
      'That passphrase is not correct.',
    );
    const other = await createAccountKey(ACCOUNT, 'another long passphrase', FAST);
    const variants = [
      { ...r, id: '44444444-4444-4444-8444-444444444444' },
      { ...r, wrapGeneration: 2 },
      { ...r, publicKey: other.record.publicKey },
    ];
    for (const v of variants)
      await expect(unlockAccountKey(v, ACCOUNT, RECORD_VECTOR.passphrase)).rejects.toThrow(
        'That passphrase is not correct.',
      );
    const otherAccount = '55555555-5555-4555-8555-555555555555';
    await expect(
      unlockAccountKey({ ...r, accountId: otherAccount }, otherAccount, RECORD_VECTOR.passphrase),
    ).rejects.toThrow('That passphrase is not correct.');
  });

  it('rejects a flipped byte in the wrapped key', async () => {
    const bytes = unb64u(RECORD_VECTOR.record.wrappedPrivateKey);
    bytes[40] = bytes[40]! ^ 1;
    await expect(
      unlockAccountKey(
        { ...RECORD_VECTOR.record, wrappedPrivateKey: b64u(bytes) },
        ACCOUNT,
        RECORD_VECTOR.passphrase,
      ),
    ).rejects.toThrow('That passphrase is not correct.');
  });

  it('creates a record that unlocks, with a non-extractable key and generation 1', async () => {
    const made = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    expect(made.privateKey.extractable).toBe(false);
    expect(made.record.format).toBe(1);
    expect(made.record.wrapGeneration).toBe(1);
    expect(made.record.accountId).toBe(ACCOUNT);
    expect(unb64u(made.record.publicKey).length).toBe(65);
    const again = await unlockAccountKey(made.record, ACCOUNT, 'a fresh passphrase here');
    expect(await derivedRaw(again, made.record.publicKey)).toBe(
      await derivedRaw(made.privateKey, made.record.publicKey),
    );
  });

  it('rewrap keeps the old wrapper working and binds the new one to generation + 1', async () => {
    const r = RECORD_VECTOR.record;
    const next = await rewrapAccountKey(
      r,
      ACCOUNT,
      RECORD_VECTOR.passphrase,
      'brand new passphrase',
      FAST,
    );
    expect(next.wrapGeneration).toBe(2);
    expect(next.id).toBe(r.id);
    expect(next.publicKey).toBe(r.publicKey);
    const viaNew = await unlockAccountKey(next, ACCOUNT, 'brand new passphrase');
    const viaOld = await unlockAccountKey(r, ACCOUNT, RECORD_VECTOR.passphrase);
    expect(await derivedRaw(viaNew, r.publicKey)).toBe(await derivedRaw(viaOld, r.publicKey));
    await expect(unlockAccountKey(next, ACCOUNT, RECORD_VECTOR.passphrase)).rejects.toThrow(
      'That passphrase is not correct.',
    );
    await expect(
      rewrapAccountKey(r, ACCOUNT, 'wrong passphrase', 'brand new passphrase', FAST),
    ).rejects.toThrow('That passphrase is not correct.');
  });
});

describe('validation happens before any key derivation', () => {
  const r = RECORD_VECTOR.record;
  const cases: Record<string, unknown> = {
    'iterations 599999': { ...r, kdf: { ...r.kdf, iterations: 599_999 } },
    'iterations 2000001': { ...r, kdf: { ...r.kdf, iterations: 2_000_001 } },
    'non-integer iterations': { ...r, kdf: { ...r.kdf, iterations: 600_000.5 } },
    'string iterations': { ...r, kdf: { ...r.kdf, iterations: '600000' } },
    'unknown kdf': { ...r, kdf: { ...r.kdf, name: 'scrypt' } },
    'format 2': { ...r, format: 2 },
    'salt of 15 bytes': { ...r, kdf: { ...r.kdf, salt: b64u(new Uint8Array(15)) } },
    'noncanonical salt': { ...r, kdf: { ...r.kdf, salt: r.kdf.salt.replace(/.$/u, 'x') } },
    'padded base64': { ...r, kdf: { ...r.kdf, salt: `${r.kdf.salt}==` } },
    'version-only wrapped key': { ...r, wrappedPrivateKey: b64u(new Uint8Array([1])) },
    'wrapped key too short': { ...r, wrappedPrivateKey: b64u(new Uint8Array(1 + 12 + 16 + 31)) },
    'wrapped key too long': { ...r, wrappedPrivateKey: b64u(new Uint8Array(1 + 12 + 16 + 257)) },
    'wrapped key version 2': {
      ...r,
      wrappedPrivateKey: b64u(Uint8Array.from([2, ...unb64u(r.wrappedPrivateKey).slice(1)])),
    },
    'off-curve public key': {
      ...r,
      publicKey: b64u(
        Uint8Array.from([4, ...new Uint8Array(32).fill(1), ...new Uint8Array(32).fill(2)]),
      ),
    },
    'public key without 0x04': {
      ...r,
      publicKey: b64u(Uint8Array.from([5, ...unb64u(r.publicKey).slice(1)])),
    },
    'short public key': { ...r, publicKey: r.publicKey.slice(0, 80) },
    'bad key id': { ...r, id: 'not-a-uuid' },
    'bad generation 0': { ...r, wrapGeneration: 0 },
    'unsafe generation': { ...r, wrapGeneration: 2 ** 53 },
    'other account': { ...r, accountId: '55555555-5555-4555-8555-555555555555' },
    'not an object': 'nope',
  };
  for (const [name, bad] of Object.entries(cases)) {
    it(`rejects ${name}`, async () => {
      const derive = vi.spyOn(subtle, 'deriveKey');
      const bits = vi.spyOn(subtle, 'deriveBits');
      await expect(parseAccountKeyRecord(bad, ACCOUNT)).rejects.toThrow(
        /newer version|Reload the page/u,
      );
      await expect(unlockAccountKey(bad, ACCOUNT, RECORD_VECTOR.passphrase)).rejects.toThrow();
      await expect(rewrapAccountKey(bad, ACCOUNT, 'x', 'y', FAST)).rejects.toThrow();
      expect(derive).not.toHaveBeenCalled();
      expect(bits).not.toHaveBeenCalled();
    });
  }

  it('accepts the frozen record and tolerates server timestamps', async () => {
    const parsed = await parseAccountKeyRecord(
      { ...r, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ACCOUNT,
    );
    expect(parsed.id).toBe(r.id);
  });

  it('rejects bad iteration counts when creating or rewrapping', async () => {
    await expect(createAccountKey(ACCOUNT, 'long enough passphrase', 599_999)).rejects.toThrow();
    await expect(createAccountKey(ACCOUNT, 'long enough passphrase', 2_000_001)).rejects.toThrow();
  });
});

describe('account slots', () => {
  const slot = { driveId: DRIVE, keyId: RECORD_VECTOR.record.id, format: 1, revision: 1 };

  it('seals and unseals a drive key, with the stated sizes', async () => {
    const made = await createAccountKey(ACCOUNT, 'slot test passphrase', FAST);
    const sealed = await sealToAccount(made.record.publicKey, made.record.id, DRIVE, DRIVE_KEY);
    expect(sealed.epk.length).toBe(87);
    expect(sealed.iv.length).toBe(16);
    expect(sealed.ct.length).toBe(79);
    expect(await unsealFromAccount(made.privateKey, made.record.id, DRIVE, sealed)).toBe(DRIVE_KEY);
    await parseSlot({ ...slot, keyId: made.record.id, sealed });
  });

  it('does not unseal under another keyId or driveId, and is not a device seal', async () => {
    const made = await createAccountKey(ACCOUNT, 'slot test passphrase', FAST);
    const sealed = await sealToAccount(made.record.publicKey, made.record.id, DRIVE, DRIVE_KEY);
    await expect(
      unsealFromAccount(made.privateKey, '66666666-6666-4666-8666-666666666666', DRIVE, sealed),
    ).rejects.toThrow();
    await expect(
      unsealFromAccount(
        made.privateKey,
        made.record.id,
        '77777777-7777-4777-8777-777777777777',
        sealed,
      ),
    ).rejects.toThrow();
    // A device seal of the same plaintext must not open as an account slot.
    const { sealDriveKey } = await import('../device/seal');
    const device = await sealDriveKey(made.record.publicKey, DRIVE, DRIVE_KEY);
    await expect(
      unsealFromAccount(made.privateKey, made.record.id, DRIVE, device),
    ).rejects.toThrow();
  });

  it('refuses to hand back text that is not a valid drive key', async () => {
    const made = await createAccountKey(ACCOUNT, 'slot test passphrase', FAST);
    const { sealDriveKey } = await import('../device/seal');
    const sealed = await sealDriveKey(
      made.record.publicKey,
      made.record.id + ':' + DRIVE,
      'x'.repeat(43),
      {
        salt: 'agent-drive-account-v1',
        label: `${made.record.id}:${DRIVE}`,
      },
    );
    await expect(
      unsealFromAccount(made.privateKey, made.record.id, DRIVE, sealed),
    ).rejects.toThrow();
  });

  it('rejects bad slots before any crypto', async () => {
    const good = {
      epk: SLOT_VECTOR.sealed.epk,
      iv: SLOT_VECTOR.sealed.iv,
      ct: SLOT_VECTOR.sealed.ct,
    };
    const base = { ...slot, sealed: good };
    const bad: unknown[] = [
      { ...base, format: 2 },
      { ...base, driveId: 'x' },
      { ...base, keyId: 'x' },
      { ...base, revision: 0 },
      { ...base, sealed: { ...good, epk: good.epk.slice(1) } },
      { ...base, sealed: { ...good, iv: good.iv + 'A' } },
      { ...base, sealed: { ...good, ct: good.ct.slice(1) } },
      {
        ...base,
        sealed: { ...good, epk: b64u(Uint8Array.from([4, ...new Uint8Array(64).fill(1)])) },
      },
      { ...base, sealed: { ...good, epk: b64u(Uint8Array.from([3, ...new Uint8Array(64)])) } },
      { ...base, sealed: { ...good, ct: `${good.ct.slice(0, -1)}x` } },
      { ...base, sealed: null },
    ];
    const bits = vi.spyOn(subtle, 'deriveBits');
    for (const b of bad) await expect(parseSlot(b)).rejects.toThrow();
    expect(bits).not.toHaveBeenCalled();
    await expect(
      parseSlot({ ...base, driveId: SLOT_VECTOR.driveId, keyId: SLOT_VECTOR.keyId }),
    ).resolves.toBeTruthy();
  });
});

describe('generatePassphrase', () => {
  it('maps each random byte to Crockford base32 with byte & 31', () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i * 13 + 7);
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((a: Uint8Array) => {
      a.set(bytes);
      return a;
    }) as never);
    const expected = [...bytes].map((b) => alphabet[b & 31]).join('');
    expect(generatePassphrase()).toBe(expected);
    expect(expected.length).toBe(20);
  });

  it('asks for exactly 20 bytes and uses every symbol of the alphabet', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) for (const ch of generatePassphrase()) seen.add(ch);
    expect(spy.mock.calls[0]?.[0]).toHaveLength(20);
    expect(seen.size).toBe(32);
    expect([...seen].some((c) => 'ILOU'.includes(c))).toBe(false);
  });
});

describe('checkPassphrase', () => {
  const email = 'dennison@example.com';
  const reason = (p: string) => {
    const r = checkPassphrase(p, email);
    return r.ok ? null : r.reason;
  };

  it('accepts a reasonable 14-character phrase', () => {
    expect(checkPassphrase('blue-kettle-72-moss', email)).toEqual({ ok: true });
    expect(checkPassphrase('Tr0ub4dor&3xyz', email)).toEqual({ ok: true });
  });

  it('requires 14 characters', () => {
    expect(reason('Tr0ub4dor&3xy')).toBe('Use at least 14 characters.');
  });

  it('rejects each weak pattern', () => {
    expect(reason('abababababababab')).toMatch(/few different characters/u);
    expect(reason('Zk9mQp2xLvwwwwRt')).toMatch(/repeats/u);
    expect(reason('Zk9mQp2xLvABCDRt')).toMatch(/sequence/u);
    expect(reason('Zk9mQp2xLv4321Rt')).toMatch(/sequence/u);
    expect(reason('Zk9mQp2xLvqwerRt')).toMatch(/keyboard/u);
    expect(reason('Zk9mQp2xLvrewqRt')).toMatch(/keyboard/u);
    expect(reason('Zk9mQp2xLvASDFRt')).toMatch(/keyboard/u);
    expect(reason('Zk9mQp2xLvcvbnRt')).toMatch(/keyboard/u);
    expect(reason('Zk9mQp2xDennisonRt')).toMatch(/email/u);
    expect(reason('Zk9mQp2xAgentDriveRt')).toMatch(/common/u);
    expect(reason('Zk9mQp2xagent drive')).toMatch(/common/u);
    expect(reason('Zk9mQp2xPassWORDRt')).toMatch(/common/u);
    expect(reason('Zk9mQp2xPassphraseRt')).toMatch(/common/u);
  });

  it('counts a letter-and-digit mix without treating 9a as a sequence', () => {
    expect(checkPassphrase('Zk8m9aQp2xLvbTrN', email)).toEqual({ ok: true });
  });
});

describe('oversized stored values', () => {
  it('rejects a multi-megabyte salt or wrapper without decoding it', async () => {
    const r = RECORD_VECTOR.record;
    const huge = 'A'.repeat(8_000_000);
    const atobSpy = vi.spyOn(globalThis, 'atob');
    const start = Date.now();
    await expect(
      parseAccountKeyRecord({ ...r, kdf: { ...r.kdf, salt: huge } }, ACCOUNT),
    ).rejects.toThrow(/newer version/u);
    await expect(parseAccountKeyRecord({ ...r, wrappedPrivateKey: huge }, ACCOUNT)).rejects.toThrow(
      /newer version/u,
    );
    await expect(
      parseSlot({
        driveId: SLOT_VECTOR.driveId,
        keyId: SLOT_VECTOR.keyId,
        format: 1,
        revision: 1,
        sealed: { ...SLOT_VECTOR.sealed, ct: huge },
      }),
    ).rejects.toThrow(/newer version/u);
    // Other fields may be decoded; the huge one must never be.
    expect(atobSpy.mock.calls.every(([v]) => v.length < 1000)).toBe(true);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('normalizeGeneratedPassphrase', () => {
  it('normalizes only the generated format', () => {
    expect(normalizeGeneratedPassphrase('abcd-efgh jkmn-pqrs-tvwx')).toBe('ABCDEFGHJKMNPQRSTVWX');
    expect(normalizeGeneratedPassphrase('ABCD EFGH JKMN PQRS TVWX')).toBe('ABCDEFGHJKMNPQRSTVWX');
    expect(normalizeGeneratedPassphrase('my own long passphrase')).toBe('my own long passphrase');
    expect(normalizeGeneratedPassphrase('abcd-efgh-ilou-pqrs-tvwx')).toBe(
      'abcd-efgh-ilou-pqrs-tvwx',
    );
    expect(normalizeGeneratedPassphrase('ABCDEFGHJKMNPQRSTVW')).toBe('ABCDEFGHJKMNPQRSTVW');
  });
});
