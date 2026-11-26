// Passkey wrap v1 (docs/crypto.md, "Account key v1"). One optional WebAuthn credential wraps the
// account private key with the output of its PRF extension, so a device unlock needs the passkey,
// not the passphrase. WebCrypto only; runs in browsers with navigator.credentials and in tests
// with a stub. The passkey ceremony never reaches the service and its assertion is never an
// authentication proof — the only thing that leaves this module is the wrap itself. Never log a
// PRF output, a private key or a passphrase.
import {
  b64u,
  parsePasskeyWrap,
  unb64u,
  unwrapPrivateKey,
  type AccountKeyRecord,
  type PasskeyWrap,
} from './account-key';

export type { PasskeyWrap };

const enc = new TextEncoder();
const EC = { name: 'ECDH', namedCurve: 'P-256' } as const;
const NO_CREDENTIALS = 'This browser cannot use passkeys.';
const NO_PASSKEY = 'This account key has no passkey.';
const HAS_PASSKEY = 'This account key already has a passkey.';
const NO_PRF = 'This passkey cannot protect the account key.';
const UNLOCK_FAILED = 'This passkey could not unlock the account key.';
const RECORD_INVALID = 'The passkey record is not valid.';
const SETUP_FAILED = 'Passkey setup did not complete.';

function credentialsApi(): CredentialsContainer {
  const credentials = globalThis.navigator?.credentials;
  if (!credentials) throw new Error(NO_CREDENTIALS);
  return credentials;
}

// `rp.id` is never set, so the browser scopes the credential to the origin's domain. The same
// value is mixed into the PRF input, which keeps the wrap material from moving between RPs.
const rpId = () => globalThis.location?.hostname ?? '';

/** Domain-separated PRF input, identical at enrollment and assertion: RP + account + key id. */
function prfInput(record: AccountKeyRecord): Uint8Array<ArrayBuffer> {
  return enc.encode(`agent-drive:passkey-prf:v1:${rpId()}:${record.accountId}:${record.id}`);
}

/** AAD binding the wrap to the account, the key id, the public key and the credential id. */
function wrapAad(record: AccountKeyRecord, credentialId: Uint8Array): Uint8Array<ArrayBuffer> {
  return enc.encode(
    `agent-drive:passkey:v1:${record.accountId}:${record.id}:${record.publicKey}:${b64u(credentialId)}`,
  );
}

/** The credential's user handle: the account UUID sanitized to its 16-byte form. */
function userHandle(accountId: string): Uint8Array<ArrayBuffer> {
  const hex = accountId.replaceAll('-', '');
  if (!/^[0-9a-fA-F]{32}$/u.test(hex)) throw new Error(RECORD_INVALID);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

const freshChallenge = () => globalThis.crypto.getRandomValues(new Uint8Array(32));

/** Copies a PRF output into an owned buffer. Anything but exactly 32 bytes is absent. */
function prfBytes(first: BufferSource | undefined): Uint8Array<ArrayBuffer> | null {
  if (!first) return null;
  const view =
    first instanceof ArrayBuffer
      ? new Uint8Array(first)
      : new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
  return view.byteLength === 32 ? Uint8Array.from(view) : null;
}

function prfExtension(
  credential: Credential | null,
): AuthenticationExtensionsPRFOutputs | undefined {
  if (!credential || credential.type !== 'public-key') return undefined;
  return (credential as PublicKeyCredential).getClientExtensionResults().prf;
}

/** Runs an assertion on exactly `credentialId` and returns its 32-byte PRF output. */
async function evaluatePrf(
  credentials: CredentialsContainer,
  credentialId: Uint8Array<ArrayBuffer>,
  record: AccountKeyRecord,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const assertion = await credentials.get({
    publicKey: {
      challenge: freshChallenge(),
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: prfInput(record) } } },
    },
    ...(signal ? { signal } : {}),
  });
  const prf = prfBytes(prfExtension(assertion)?.results?.first);
  if (!prf) throw new Error(NO_PRF);
  return prf;
}

/**
 * Verifies `passphrase`, creates one resident passkey credential and wraps the account private
 * key under its PRF output. The wrap — never a credential, key or PRF value — is what the caller
 * stores. Throws the usual passphrase error before any ceremony when the passphrase is wrong.
 */
export async function enrollAccountPasskey(
  record: AccountKeyRecord,
  passphrase: string,
  userName: string,
  signal?: AbortSignal,
): Promise<PasskeyWrap> {
  signal?.throwIfAborted();
  if (record.passkey) throw new Error(HAS_PASSKEY);
  // Extractable only inside this function so the same key can be wrapped a second time.
  const privateKey = await unwrapPrivateKey(record, passphrase, true);
  const credentials = credentialsApi();
  const credential = await credentials.create({
    publicKey: {
      challenge: freshChallenge(),
      rp: { name: 'Agent Drive' },
      user: { id: userHandle(record.accountId), name: userName, displayName: userName },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -8 }, // EdDSA
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      attestation: 'none',
      extensions: { prf: { eval: { first: prfInput(record) } } },
    },
    ...(signal ? { signal } : {}),
  });
  const rawId =
    credential && credential.type === 'public-key'
      ? (credential as PublicKeyCredential).rawId
      : null;
  const credentialId = rawId ? new Uint8Array(rawId) : null;
  if (!credentialId || credentialId.length < 1 || credentialId.length > 1023)
    throw new Error(SETUP_FAILED);
  const prfOut = prfExtension(credential);
  let prf = prfBytes(prfOut?.results?.first);
  if (!prf) {
    // Creation may report support without evaluating; the spec then requires an assertion.
    if (prfOut?.enabled !== true) throw new Error(NO_PRF);
    prf = await evaluatePrf(credentials, credentialId, record, signal);
  }
  try {
    const wrapKey = await globalThis.crypto.subtle.importKey('raw', prf, 'AES-GCM', false, [
      'wrapKey',
    ]);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const wrapped = new Uint8Array(
      await globalThis.crypto.subtle.wrapKey('pkcs8', privateKey, wrapKey, {
        name: 'AES-GCM',
        iv,
        additionalData: wrapAad(record, credentialId),
      }),
    );
    if (wrapped.length < 48 || wrapped.length > 272) throw new Error(SETUP_FAILED);
    return { credentialId: b64u(credentialId), iv: b64u(iv), ciphertext: b64u(wrapped) };
  } finally {
    prf.fill(0);
  }
}

/**
 * Asserts on the record's stored credential id and unwraps the account private key under the
 * assertion's PRF output. Returns the same non-extractable ECDH key as a passphrase unlock.
 */
export async function unlockWithAccountPasskey(
  record: AccountKeyRecord,
  signal?: AbortSignal,
): Promise<CryptoKey> {
  signal?.throwIfAborted();
  const wrap = record.passkey;
  if (!wrap) throw new Error(NO_PASSKEY);
  // Re-checks the contract bounds and canonical encoding even when the record skipped parsing.
  const parsed = parsePasskeyWrap(wrap);
  const credentialId = unb64u(parsed.credentialId);
  const iv = unb64u(parsed.iv);
  const ciphertext = unb64u(parsed.ciphertext);
  const credentials = credentialsApi();
  const prf = await evaluatePrf(credentials, credentialId, record, signal);
  try {
    const unwrapKey = await globalThis.crypto.subtle.importKey('raw', prf, 'AES-GCM', false, [
      'unwrapKey',
    ]);
    return await globalThis.crypto.subtle.unwrapKey(
      'pkcs8',
      ciphertext,
      unwrapKey,
      { name: 'AES-GCM', iv, additionalData: wrapAad(record, credentialId) },
      EC,
      false,
      ['deriveBits'],
    );
  } catch {
    throw new Error(UNLOCK_FAILED);
  } finally {
    prf.fill(0);
  }
}
