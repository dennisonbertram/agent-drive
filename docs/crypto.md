# Client encryption format

Agent Drive client encryption uses the versioned `ADRV v1` format. The byte API buffers a
complete file in memory; authenticated chunks are an integrity format, not a constant-memory
streaming claim.

## Ciphertext layout

The first 25 bytes are the header:

| Offset | Length | Meaning                                     |
| ------ | -----: | ------------------------------------------- |
| 0      |      5 | ASCII `ADRV` followed by version byte `1`   |
| 5      |      4 | Chunk size, unsigned big-endian (`1048576`) |
| 9      |      8 | Random base nonce                           |
| 17     |      8 | Plaintext length, unsigned big-endian       |

The payload contains one AES-256-GCM frame per 1 MiB chunk. Each frame is ciphertext followed by
its 16-byte authentication tag. The nonce is the 8-byte header nonce followed by the unsigned
big-endian chunk index. The AAD is the complete 25-byte header followed by the 4-byte chunk index
and a one-byte final-frame flag (`1` only on the last frame). Empty files still contain one
authenticated empty frame.

Every file version gets a fresh random 32-byte file key and nonce. The file key is wrapped by the
32-byte drive key with AES-256-GCM and fixed AAD `agent-drive:wrapped-file-key:v1`. The 61-byte
envelope is `version(1) || nonce(12) || wrapped-file-key-and-tag(48)`, encoded as canonical
unpadded base64url (normally 82 characters). The server stores this opaque envelope but never
receives the drive key or plaintext.

The frozen vectors and tamper/isolation tests in
`packages/agent-drive/src/crypto.unit.test.ts` are permanent compatibility guards. Future
sharing and key-rotation formats must remain explicitly versioned.

## Account key v1

The console can keep an account-level key pair so one passphrase opens every drive the user has
added. The service stores only the records below. It never receives a passphrase, a KEK, the
private key or a drive key. This is separate from `ADRV v1` and the wrapped file key, which do not
change. Implementation: `apps/web/src/console/account-key.ts`. Permanent vectors:
`apps/web/src/console/account-key.vectors.ts` (unit test and a Chromium run in
`tests/e2e/account-key-vectors.spec.ts`).

All base64url is unpadded and canonical (re-encode and compare).

- **Key pair.** ECDH P-256. `publicKey` is the 65-byte raw uncompressed point (`0x04` prefix), 87
  characters. `keyId` is a client-made UUID, new at every reset.
- **KEK.** `passphrase.normalize('NFKC')` as UTF-8, no trimming. PBKDF2-SHA256, 16-byte random
  salt, iterations an integer in 600000 to 2000000 (default 600000). AES-GCM-256 key usable for
  `wrapKey`/`unwrapKey` only.
- **Wrapped private key (format 1).** AAD is UTF-8
  `agent-drive:account-key:v1:{accountId}:{keyId}:{wrapGeneration}:{publicKey}`. The PKCS#8 private
  key is wrapped with AES-GCM and a random 12-byte IV. The record value is
  `base64url(0x01 || iv(12) || ciphertext||tag)`; decoded length is `1 + 12 + 16 + n`, 32 <= n <= 256.
  `wrapGeneration` starts at 1 and goes up by 1 at each passphrase change. A passphrase change
  re-wraps the same key and does not revoke an old wrapper.
- **Slot (format 1).** A drive key (43 characters) sealed with the device seal construction
  (`docs/agent-login.md` section 4) with HKDF salt `agent-drive-account-v1`, and HKDF info and
  AES-GCM AAD both equal to UTF-8 `{keyId}:{driveId}`. Stored as `{ epk, iv, ct }` with 87, 16 and
  79 characters. After unsealing, `decodeDriveKey` must accept the result. The device seal
  (salt `agent-drive-device-v1`, info and AAD = `driveId`) is unchanged.
- **Validation before crypto.** A client parses every server record (`parseAccountKeyRecord`,
  `parseSlot`) before any PBKDF2 or ECDH: format, KDF name, iteration range, canonical base64url,
  salt and IV lengths, wrapped-key length rule, UUIDs, `wrapGeneration` a positive safe integer,
  `accountId` equal to the session account, and the public key imported as a P-256 point.
- **Generated passphrase.** 20 symbols from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, each `byte & 31` of
  `crypto.getRandomValues(new Uint8Array(20))` (100 bits, no modulo bias). The passphrase is the
  20 characters with no separators.
- **Display fingerprint.** First 8 bytes of SHA-256 of the raw public key, as four hex groups. It
  is for display only.
