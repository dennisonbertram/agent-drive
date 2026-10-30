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
