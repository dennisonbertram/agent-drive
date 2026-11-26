import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAccountKey,
  parseAccountKeyRecord,
  parsePasskeyWrap,
  rewrapAccountKey,
  unlockAccountKey,
  type AccountKeyRecord,
  type PasskeyWrap,
} from './account-key';
import { enrollAccountPasskey, unlockWithAccountPasskey } from './passkey';
import { RECORD_VECTOR } from './account-key.vectors';

const subtle = webcrypto.subtle;
const ACCOUNT = RECORD_VECTOR.accountId;
const FAST = 600_000;
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));
const text = (v: BufferSource | undefined) =>
  new TextDecoder().decode(
    v instanceof ArrayBuffer ? v : new Uint8Array(v!.buffer, v!.byteOffset, v!.byteLength),
  );

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function derivedRaw(privateKey: CryptoKey | webcrypto.CryptoKey, publicKey: string) {
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

function bytesOf(source: BufferSource): Uint8Array {
  return source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

type FakeCredential = {
  type: 'public-key';
  rawId: ArrayBuffer;
  getClientExtensionResults: () => {
    prf?: { enabled?: boolean; results?: { first?: BufferSource } };
  };
};

/**
 * A fake `navigator.credentials`. `secret` stands in for the per-credential PRF output: a real
 * authenticator returns the same 32 bytes for the same input on the same credential.
 */
function fakeCredentials(
  options: {
    createResults?: boolean;
    enabled?: boolean;
    prfLength?: number;
  } = {},
) {
  const { createResults = true, enabled = true, prfLength = 32 } = options;
  const store = new Map<string, { rawId: ArrayBuffer; secret: Uint8Array<ArrayBuffer> }>();
  const lastCreateOptions: { value: CredentialCreationOptions | undefined } = { value: undefined };
  const lastGetOptions: { value: CredentialRequestOptions | undefined } = { value: undefined };
  const create = vi.fn(async (o?: CredentialCreationOptions) => {
    lastCreateOptions.value = o;
    const rawId = globalThis.crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer;
    const secret = globalThis.crypto.getRandomValues(new Uint8Array(prfLength));
    store.set(b64u(new Uint8Array(rawId)), { rawId, secret });
    const credential: FakeCredential = {
      type: 'public-key',
      rawId,
      getClientExtensionResults: () => ({
        prf: { enabled, ...(createResults ? { results: { first: secret } } : {}) },
      }),
    };
    return credential;
  });
  const get = vi.fn(async (o?: CredentialRequestOptions): Promise<FakeCredential | null> => {
    lastGetOptions.value = o;
    const allow = o?.publicKey?.allowCredentials ?? [];
    const cred = allow.length === 1 ? store.get(b64u(bytesOf(allow[0]!.id))) : undefined;
    if (!cred) throw new DOMException('The operation was not allowed.', 'NotAllowedError');
    const credential: FakeCredential = {
      type: 'public-key',
      rawId: cred.rawId,
      getClientExtensionResults: () => ({ prf: { results: { first: cred.secret } } }),
    };
    return credential;
  });
  vi.stubGlobal('navigator', { credentials: { create, get } });
  return { create, get, lastCreateOptions, lastGetOptions };
}

function cancelled() {
  const fail = vi.fn(async () => {
    throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError');
  });
  vi.stubGlobal('navigator', { credentials: { create: fail, get: fail } });
  return fail;
}

describe('passkey wrap on the account key record', () => {
  it('parses a legacy record with no passkey field as passkey null', async () => {
    const parsed = await parseAccountKeyRecord(RECORD_VECTOR.record, ACCOUNT);
    expect(parsed.passkey).toBeNull();
    const explicitNull = await parseAccountKeyRecord(
      { ...RECORD_VECTOR.record, passkey: null },
      ACCOUNT,
    );
    expect(explicitNull.passkey).toBeNull();
  });

  it('keeps a valid passkey wrap through parse', async () => {
    const wrap: PasskeyWrap = {
      credentialId: b64u(new Uint8Array(32).fill(9)),
      iv: b64u(new Uint8Array(12).fill(4)),
      ciphertext: b64u(new Uint8Array(154).fill(2)),
    };
    const parsed = await parseAccountKeyRecord({ ...RECORD_VECTOR.record, passkey: wrap }, ACCOUNT);
    expect(parsed.passkey).toEqual(wrap);
    expect(parsePasskeyWrap(wrap)).toEqual(wrap);
  });

  it('rejects malformed passkey fields instead of dropping them', async () => {
    const good: PasskeyWrap = {
      credentialId: b64u(new Uint8Array(32).fill(9)),
      iv: b64u(new Uint8Array(12).fill(4)),
      ciphertext: b64u(new Uint8Array(154).fill(2)),
    };
    const bad: unknown[] = [
      'nope',
      {},
      [],
      { ...good, credentialId: `${good.credentialId}==` },
      { ...good, credentialId: 'a+b/c==' },
      { ...good, credentialId: '' },
      { ...good, credentialId: b64u(new Uint8Array(1024)) },
      { ...good, iv: good.iv.slice(0, -1) },
      { ...good, iv: b64u(new Uint8Array(11)) },
      { ...good, iv: b64u(new Uint8Array(13)) },
      { ...good, ciphertext: b64u(new Uint8Array(47)) },
      { ...good, ciphertext: b64u(new Uint8Array(273)) },
      { ...good, ciphertext: `${good.ciphertext}=` },
      { credentialId: good.credentialId, iv: good.iv },
    ];
    for (const passkey of bad) {
      await expect(
        parseAccountKeyRecord({ ...RECORD_VECTOR.record, passkey }, ACCOUNT),
      ).rejects.toThrow(/newer version|Reload the page/u);
      expect(() => parsePasskeyWrap(passkey)).toThrow();
    }
  });

  it('preserves the passkey wrap across a passphrase change', async () => {
    const { record } = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    const wrap: PasskeyWrap = {
      credentialId: b64u(new Uint8Array(32).fill(9)),
      iv: b64u(new Uint8Array(12).fill(4)),
      ciphertext: b64u(new Uint8Array(154).fill(2)),
    };
    const next = await rewrapAccountKey(
      { ...record, passkey: wrap },
      ACCOUNT,
      'a fresh passphrase here',
      'a brand new passphrase',
      FAST,
    );
    expect(next.passkey).toEqual(wrap);
  });
});

describe('enrollAccountPasskey', () => {
  it('verifies the passphrase before any credential ceremony', async () => {
    const { record } = await createAccountKey(ACCOUNT, 'right passphrase one', FAST);
    const fake = fakeCredentials();
    await expect(
      enrollAccountPasskey(record, 'wrong passphrase', 'dennison@example.com'),
    ).rejects.toThrow('That passphrase is not correct.');
    expect(fake.create).not.toHaveBeenCalled();
    expect(fake.get).not.toHaveBeenCalled();
  });

  it('creates a resident-key credential with UV required, fresh challenge, no fixed RP id', async () => {
    const { record } = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    const fake = fakeCredentials();
    const signal = new AbortController().signal;
    await enrollAccountPasskey(record, 'a fresh passphrase here', 'dennison@example.com', signal);
    const options = fake.lastCreateOptions.value!;
    expect(options.signal).toBe(signal);
    const pk = options.publicKey!;
    expect(bytesOf(pk.challenge).length).toBe(32);
    expect(pk.rp.id).toBeUndefined();
    expect(pk.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    });
    expect(pk.user?.name).toBe('dennison@example.com');
    // The user handle is the account id itself, sanitized to its 16-byte UUID form.
    expect(b64u(bytesOf(pk.user!.id))).toBe(
      Buffer.from(record.accountId.replaceAll('-', ''), 'hex').toString('base64url'),
    );
    const input = text(pk.extensions?.prf?.eval?.first);
    expect(input).toContain(record.accountId);
    expect(input).toContain(record.id);
    expect(input).not.toContain('a fresh passphrase');
  });

  it('produces a contract-shaped wrap that unlocks the same private key', async () => {
    const { record } = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    fakeCredentials();
    const wrap = await enrollAccountPasskey(
      record,
      'a fresh passphrase here',
      'dennison@example.com',
    );
    expect(unb64u(wrap.iv).length).toBe(12);
    const credId = unb64u(wrap.credentialId);
    expect(credId.length).toBeGreaterThanOrEqual(1);
    expect(credId.length).toBeLessThanOrEqual(1023);
    const ct = unb64u(wrap.ciphertext);
    expect(ct.length).toBeGreaterThanOrEqual(48);
    expect(ct.length).toBeLessThanOrEqual(272);
    // Roundtrip: the same private key comes back, non-extractable.
    const parsed = await parseAccountKeyRecord({ ...record, passkey: wrap }, ACCOUNT);
    const key = await unlockWithAccountPasskey(parsed);
    expect(key.extractable).toBe(false);
    const viaPassphrase = await unlockAccountKey(record, ACCOUNT, 'a fresh passphrase here');
    expect(await derivedRaw(key, record.publicKey)).toBe(
      await derivedRaw(viaPassphrase, record.publicKey),
    );
  });

  it('falls back to an assertion when creation reports enabled without results', async () => {
    const { record } = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    const fake = fakeCredentials({ createResults: false });
    const wrap = await enrollAccountPasskey(record, 'a fresh passphrase here', 'd@example.com');
    expect(fake.create).toHaveBeenCalledTimes(1);
    expect(fake.get).toHaveBeenCalledTimes(1);
    // The fallback asserts on exactly the new credential id.
    const allow = fake.lastGetOptions.value!.publicKey!.allowCredentials!;
    expect(allow).toHaveLength(1);
    expect(b64u(bytesOf(allow[0]!.id))).toBe(wrap.credentialId);
    expect(wrap.ciphertext.length).toBeGreaterThan(0);
  });

  it('rejects when the authenticator has no PRF support, without a second ceremony', async () => {
    const { record } = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    const fake = fakeCredentials({ enabled: false, createResults: false });
    await expect(
      enrollAccountPasskey(record, 'a fresh passphrase here', 'd@example.com'),
    ).rejects.toThrow();
    expect(fake.get).not.toHaveBeenCalled();
  });

  it('rejects a wrong-length PRF result', async () => {
    const { record } = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    fakeCredentials({ prfLength: 16 });
    await expect(
      enrollAccountPasskey(record, 'a fresh passphrase here', 'd@example.com'),
    ).rejects.toThrow();
  });

  it('propagates user cancellation instead of storing anything', async () => {
    const { record } = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    cancelled();
    await expect(
      enrollAccountPasskey(record, 'a fresh passphrase here', 'd@example.com'),
    ).rejects.toThrow(DOMException);
  });

  it('throws when passkeys are unavailable', async () => {
    const { record } = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    vi.stubGlobal('navigator', {});
    await expect(
      enrollAccountPasskey(record, 'a fresh passphrase here', 'd@example.com'),
    ).rejects.toThrow();
  });
});

describe('unlockWithAccountPasskey', () => {
  async function enrolled() {
    const { record } = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    const browser = fakeCredentials();
    const wrap = await enrollAccountPasskey(record, 'a fresh passphrase here', 'd@example.com');
    return { record: { ...record, passkey: wrap }, wrap, browser };
  }

  it('asserts on exactly the stored credential id with UV required', async () => {
    const { record, wrap, browser } = await enrolled();
    const signal = new AbortController().signal;
    await unlockWithAccountPasskey(record, signal);
    const options = browser.lastGetOptions.value!;
    expect(options.signal).toBe(signal);
    const pk = options.publicKey!;
    expect(pk.userVerification).toBe('required');
    expect(bytesOf(pk.challenge).length).toBe(32);
    expect(pk.allowCredentials).toHaveLength(1);
    expect(b64u(bytesOf(pk.allowCredentials![0]!.id))).toBe(wrap.credentialId);
    const input = text(pk.extensions?.prf?.eval?.first);
    expect(input).toContain(record.accountId);
    expect(input).toContain(record.id);
  });

  it('rejects when the record has no passkey', async () => {
    const { record } = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    fakeCredentials();
    await expect(unlockWithAccountPasskey(record)).rejects.toThrow();
    await expect(unlockWithAccountPasskey({ ...record, passkey: null })).rejects.toThrow();
  });

  it('rejects every tampered part of the wrap and record binding', async () => {
    const { record, wrap } = await enrolled();
    const ct = unb64u(wrap.ciphertext);
    ct[20] = ct[20]! ^ 1;
    const variants: AccountKeyRecord[] = [
      { ...record, passkey: { ...wrap, ciphertext: b64u(ct) } },
      { ...record, passkey: { ...wrap, iv: b64u(new Uint8Array(12).fill(1)) } },
    ];
    for (const tampered of variants)
      await expect(unlockWithAccountPasskey(tampered)).rejects.toThrow();
    // AAD binds account, key id and public key: changing any of them fails authentication.
    const other = await createAccountKey(ACCOUNT, 'another passphrase set', FAST);
    await expect(
      unlockWithAccountPasskey({ ...record, publicKey: other.record.publicKey }),
    ).rejects.toThrow();
    await expect(unlockWithAccountPasskey({ ...record, id: other.record.id })).rejects.toThrow();
    await expect(
      unlockWithAccountPasskey({
        ...record,
        accountId: '55555555-5555-4555-8555-555555555555',
      }),
    ).rejects.toThrow();
  });

  it('still unlocks after a passphrase change', async () => {
    const { record } = await enrolled();
    const next = await rewrapAccountKey(
      record,
      ACCOUNT,
      'a fresh passphrase here',
      'a brand new passphrase',
      FAST,
    );
    const key = await unlockWithAccountPasskey(next);
    const viaPassphrase = await unlockAccountKey(next, ACCOUNT, 'a brand new passphrase');
    expect(await derivedRaw(key, next.publicKey)).toBe(
      await derivedRaw(viaPassphrase, next.publicKey),
    );
  });

  it('rejects when the assertion carries no usable PRF result', async () => {
    const { record, wrap, browser } = await enrolled();
    browser.get.mockImplementation(async () => ({
      type: 'public-key',
      rawId: unb64u(wrap.credentialId).buffer as ArrayBuffer,
      getClientExtensionResults: () => ({ prf: {} }),
    }));
    await expect(unlockWithAccountPasskey(record)).rejects.toThrow();
    browser.get.mockImplementation(async () => null);
    await expect(unlockWithAccountPasskey(record)).rejects.toThrow();
  });

  it('propagates user cancellation', async () => {
    cancelled();
    const { record } = await createAccountKey(ACCOUNT, 'a fresh passphrase here', FAST);
    const wrap: PasskeyWrap = {
      credentialId: b64u(new Uint8Array(16).fill(3)),
      iv: b64u(new Uint8Array(12)),
      ciphertext: b64u(new Uint8Array(154)),
    };
    await expect(unlockWithAccountPasskey({ ...record, passkey: wrap })).rejects.toThrow(
      DOMException,
    );
  });
});
