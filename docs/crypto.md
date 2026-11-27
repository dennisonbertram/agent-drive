# Encryption format

This page gives the byte-level formats Agent Drive uses to encrypt files and keys. Use it to write a compatible client, to audit the design, or to check what the service stores. For what each key is for and what losing it means, see [Keys and recovery](keys-and-recovery.md). For what the service can and cannot see, see [Threat model](threat-model.md).

All encryption happens on the client (the CLI, the MCP server or the browser). The service receives ciphertext and opaque key records only. It never receives a drive key, a passphrase or plaintext, with one exception described under [Trace inbox](#trace-inbox-v1-and-envelope-v2).

## Overview

There are three layers:

1. **File body.** Each file version is encrypted with a fresh random 32-byte file key in the `ADRV v1` format.
2. **Wrapped file key.** The file key is encrypted ("wrapped") with the 32-byte drive key. The service stores the wrapped key beside the version.
3. **Sealed keys.** To hand a key to someone else, a client encrypts it to that party's public key. This is used for connecting an agent, for the console passphrase unlock and for the trace inbox. A share link does not use a public key; it carries the file key in the URL fragment.

Everything uses AES-256-GCM, ECDH on P-256, HKDF-SHA-256 and PBKDF2-SHA-256 through WebCrypto. All base64url values are unpadded and canonical: a decoder must re-encode the bytes and compare them to the input.

## ADRV v1 ciphertext

The byte API buffers a complete file in memory. Node file-backed helpers and folder commands read files in bounded chunks and process one 1 MiB frame at a time, plus transport buffers. Callers that pass their own stream should also yield bounded chunks if they need bounded memory. The streaming APIs keep the same `ADRV v1` header, frame boundaries, nonces, associated data and size formula as the byte API. A byte API can read a file written by a streaming API, and vice versa; existing versions need no rewrite or migration.

The first 25 bytes are the header:

| Offset | Length | Meaning                                     |
| ------ | -----: | ------------------------------------------- |
| 0      |      5 | ASCII `ADRV` followed by version byte `1`   |
| 5      |      4 | Chunk size, unsigned big-endian (`1048576`) |
| 9      |      8 | Random base nonce                           |
| 17     |      8 | Plaintext length, unsigned big-endian       |

The payload has one AES-256-GCM frame per 1 MiB (1,048,576 byte) chunk. The last chunk can be shorter. Each frame is the ciphertext followed by its 16-byte authentication tag.

- **Nonce (12 bytes).** The 8-byte base nonce from the header, then the chunk index as an unsigned big-endian 4-byte integer.
- **AAD.** The complete 25-byte header, then the chunk index (4 bytes, big-endian), then one byte that is `1` on the final frame and `0` on every other frame.
- **Empty files.** An empty file still has one authenticated empty frame, so the ciphertext is 25 + 16 = 41 bytes.
- **Size.** Ciphertext size is `25 + plaintext length + 16 * max(1, ceil(plaintext length / 1048576))`.

A reader rejects a ciphertext with an unknown magic, a chunk size other than 1 MiB, or a length that does not match the length in the header. Binding the chunk index and the final flag into the AAD means chunks cannot be reordered, and a file cannot be truncated, without detection. A streaming reader yields a plaintext frame only after its tag verifies. If a later frame is truncated or corrupt, iteration then throws, but earlier verified frames have already been yielded. A caller that writes each yielded frame directly to stdout can therefore leave partial output; use the Node `getFile` helper when output must be published only after the whole file verifies.

## Wrapped file key

Every file version gets a fresh random 32-byte file key and a fresh base nonce. The drive key encrypts the file key with AES-256-GCM:

- Key: the 32-byte drive key. Nonce: 12 random bytes. AAD: the UTF-8 text `agent-drive:wrapped-file-key:v1`.
- The envelope is 61 bytes: `version(1) || nonce(12) || wrapped file key and tag(48)`. The version byte is `1`.
- It is stored and sent as unpadded base64url, 82 characters.

The service stores this envelope but cannot open it. A drive key is 32 random bytes written as 43 characters of unpadded base64url.

## Account key v1

The console can keep an account-level key pair so that one passphrase opens every drive the person has added. This layer is separate from `ADRV v1` and the wrapped file key, which do not change. The service stores only the records below. It never receives a passphrase, the derived key, the private key or a drive key.

- **Key pair.** ECDH P-256. `publicKey` is the 65-byte raw uncompressed point (first byte `0x04`), 87 characters. `keyId` is a UUID made by the client, and it is new after every reset.
- **Passphrase key (KEK).** The passphrase is normalized with Unicode NFKC and encoded as UTF-8, with no trimming. PBKDF2-SHA-256 with a 16-byte random salt and an iteration count that is an integer from 600000 to 2000000 (default 600000). The result is an AES-GCM-256 key that can only wrap and unwrap keys.
- **Wrapped private key (format 1).** The PKCS#8 private key is wrapped with AES-GCM and a random 12-byte IV. The AAD is the UTF-8 text `agent-drive:account-key:v1:{accountId}:{keyId}:{wrapGeneration}:{publicKey}`. The stored value is `base64url(0x01 || iv(12) || ciphertext || tag)`. The decoded length is `1 + 12 + 16 + n` bytes, where the PKCS#8 length `n` is from 32 to 256. `wrapGeneration` starts at 1 and goes up by 1 at each passphrase change. A passphrase change re-wraps the same key. It does not revoke an old wrapper.
- **Slot (format 1).** One slot per drive holds that drive's key, sealed to the account public key with the device seal construction below. Differences: the HKDF salt is `agent-drive-account-v1`, and the HKDF info and the AES-GCM AAD are both the UTF-8 text `{keyId}:{driveId}`. The slot is stored as `{ epk, iv, ct }` with 87, 16 and 79 characters. After unsealing, the result must pass the 43-character drive key check.
- **Validation before crypto.** A client parses every record from the server before it runs PBKDF2 or ECDH. It checks the format, the KDF name, the iteration range, canonical base64url, the salt and IV lengths, the wrapped-key length rule, the UUIDs, that `wrapGeneration` is a positive safe integer, that `accountId` equals the session account, and that the public key imports as a valid P-256 point.
- **Generated passphrase.** 20 symbols from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, each chosen as `byte & 31` of 20 random bytes. That is 100 bits with no modulo bias. The passphrase is the 20 characters without separators.
- **Display fingerprint.** The first 8 bytes of the SHA-256 of the raw public key, shown as four hex groups. It is for display and verification: the console shows it under Settings, and a CLI pins it only when the owner supplies it outside the API (`--fingerprint` or `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT`). The device-login verification code uses the same construction over the login's `public_key` — the agent prints it, the person types it on `/connect` or passes it to `grant --verify`, and every side that seals first recomputes it from the public key it was handed.
- **Passkey wrapper.** An enrolled passkey wraps the same PKCS#8 private key a second way, under an AES-GCM key derived from the authenticator's WebAuthn PRF output. The authenticator returns the PRF output to the browser, which uses it locally. The service stores only the public credential ID, an IV and the wrapped private key. The account key pair, `keyId`, slots and the passphrase wrapper are unchanged — the passkey is another way to unwrap the same private key, not a new key.

Slots are not backups of the drive key. See [Keys and recovery](keys-and-recovery.md).

## Device seal

The device seal moves a drive key to an agent without the service seeing it. It is used when a person approves an agent's login in the browser, and when an agent with the `delegate` scope runs `agent-drive grant`.

1. The agent makes an ECDH P-256 key pair for each login. Its `public_key` is the 65-byte raw uncompressed point, as unpadded base64url.
2. The sender makes an ephemeral ECDH P-256 key pair and derives 256 bits with the agent's public key.
3. HKDF-SHA-256 over those bits gives an AES-GCM-256 key. The salt is the UTF-8 text `agent-drive-device-v1`. The info is the UTF-8 drive ID.
4. The sender encrypts the UTF-8 drive key string (43 characters) with AES-GCM, a random 12-byte IV, and the drive ID as the AAD.
5. The sender sends `{ epk, iv, ct }`: the ephemeral public key (65 bytes), the IV, and the ciphertext with its tag (59 bytes), all as unpadded base64url.

The agent reverses these steps with its private key and saves the drive key in its config. If one drive key fails to unseal, login reports that drive and goes on with the others.

The protocol around this seal (device codes, approval, rate limits) is in [HTTP API: device login and delegation](api-device-login.md).

## Share link keys

A share link carries one file key. It does not carry the drive key, so a link opens one file version and nothing else.

- The CLI or console unwraps that version's wrapped file key with the drive key, then writes the 43-character file key into the URL fragment: `https://<origin>/s/<share id>#k=<file key>`.
- Browsers do not send the fragment to servers. The share page downloads the ciphertext through a presigned URL and decrypts it in the browser.
- A link's key cannot open a different file in the same drive, because each version has its own file key. Copy and restore keep the same ciphertext and wrapped key, so the key also opens copies of that version.

The whole URL is a bearer secret. Anyone who has it can read that version until the link expires or is revoked. See [Share links](sharing.md).

## Trace inbox v1 and envelope v2

A trace inbox lets the service encrypt a file for a drive without holding the drive key. Each drive has at most one inbox: a P-256 key pair whose private key is stored wrapped under the drive key. Anyone who holds the drive key can unwrap it. It is used by the OpenRouter webhook. See [Capture traces](trace-capture.md).

- **Stored record.** `{ keyId, publicKey, wrappedPrivateKey, createdAt }`. `keyId` is a UUID. `publicKey` is the 65-byte raw uncompressed point, 87 characters. A reader adds the `driveId` it asked for before calling crypto. It never trusts a `driveId` inside the server record.
- **Wrapped private key.** The PKCS#8 private key is wrapped with AES-GCM under the drive key. The AAD is the UTF-8 text `agent-drive:trace-inbox:v1:{driveId}:{keyId}:{publicKey}`. The value is `base64url(0x01 || iv(12) || ciphertext || tag)`, with decoded length `1 + 12 + 16 + n` and `n` from 32 to 256. Because the AAD includes `driveId`, a record copied from another drive does not unwrap.
- **Envelope v2.** `0x02 || epk(65) || iv(12) || ct(59)`, which is 137 bytes or 183 characters. `epk` is an ephemeral raw P-256 point. `ct` is the 43-character base64url file key plus a 16-byte tag. Key agreement is ECDH, then HKDF-SHA-256 with salt `agent-drive-trace-inbox-v1`. The HKDF info and the AES-GCM AAD are both the UTF-8 text `{keyId}:{driveId}:{epk}:{publicKey}`, where `epk` is the 87-character base64url of the envelope's ephemeral point and `publicKey` is the inbox public key. This binds the serialized point, so a negated or re-encoded `epk` does not open. A reader also rejects any `epk` whose first byte is not `0x04`.
- **Possession challenge envelope v3.** `0x03 || epk(65) || iv(12) || ct(59)`, also 137 bytes or 183 characters. Its plaintext is a random 32-byte challenge encoded as canonical base64url. It uses a separate HKDF salt, `agent-drive-trace-inbox-possession-challenge-v1`, and a separate AAD/HKDF-info prefix, `agent-drive:trace-inbox-possession-challenge:v1:`. The distinct version, KDF salt and authenticated context prevent a stored file-key envelope from being opened or submitted as challenge proof.
- **Reading.** `envelopeVersion(wrappedKey)` returns 1 for an 82-character drive-key envelope and 2 for a 183-character inbox envelope. `unwrapFileKey` and `decryptFile` take an optional `inbox` record. A v2 envelope without one fails with `inbox_key_required`. Challenge v3 envelopes are opened only by the possession-challenge code and are not file-key envelopes. Every record field is validated before any key agreement.
- **Pair check.** `verifyInboxKeypair` goes one step further than `unwrapInboxPrivateKey`: after unwrapping the private key it derives an ECDH secret in both directions — unwrapped private key against a fresh ephemeral public key, and ephemeral private key against the stored public point — and accepts only when both agree. That proves the stored `publicKey` corresponds to the wrapped private key, so a record that unwraps cleanly yet pairs a different key is rejected instead of being sealed to. The console runs this before trusting an existing inbox.

Envelope v1 and the `ADRV v1` body format are unchanged. A trace sealed to the inbox has an `ADRV v1` body like any other file. Only its wrapped file key differs.

The webhook is the one place where the service handles plaintext. `POST /api/webhooks/openrouter/:driveId` reads the OpenRouter trace once, in memory, seals it with a random file key, wraps that key as envelope v2 to the inbox public key, and stores the result. It logs nothing from the body or the token. After the request, the service cannot read the stored file, because it holds the inbox public key but not the drive key.

## Test vectors

Frozen vectors are permanent compatibility guards. They are never regenerated to make a change pass.

- `ADRV v1` and the wrapped file key: `packages/agent-drive/src/crypto.unit.test.ts`, with tamper and isolation tests.
- Streaming and byte-API interoperability, truncation, trailing-byte and tag failures: `packages/agent-drive/src/crypto-stream.unit.test.ts`.
- Trace inbox v1 and envelope v2: `packages/agent-drive/src/trace-inbox.vectors.ts`.
- Account key v1: `apps/web/src/console/account-key.vectors.ts`, run by a unit test and by a Chromium test in `tests/e2e/account-key-vectors.spec.ts`.

Future sharing and key-rotation formats must be versioned explicitly. Agent Drive has no key rotation format today.
