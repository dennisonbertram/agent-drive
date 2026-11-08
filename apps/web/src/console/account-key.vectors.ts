// Permanent test vectors for "Account key v1" (docs/crypto.md). Never regenerate or edit these:
// a failing vector means the format changed, which needs a new format number instead.
export const RECORD_VECTOR = {
  accountId: '11111111-1111-4111-8111-111111111111',
  passphrase: 'correct horse battery staple',
  pkcs8:
    'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg7cz5pyprDuZ-yBYSnqdtIbrBbB1LV7iLrCJOnQEThPKhRANCAARYkEKJzvZdX7rWii9q_bd3vga5tZFjqnxMS0ROCRjt5NCIJ6vZB2Yifg5dk7pC_jPFwpVWdDmFwLTRQthZ1VCi',
  record: {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: '11111111-1111-4111-8111-111111111111',
    format: 1,
    publicKey:
      'BFiQQonO9l1futaKL2r9t3e-Brm1kWOqfExLRE4JGO3k0Ignq9kHZiJ-Dl2TukL-M8XClVZ0OYXAtNFC2FnVUKI',
    wrappedPrivateKey:
      'AbCxsrO0tba3uLm6u8-INuRjC00YSqXmvmlBk_463cC78juAaR21fH08N25DVd8-yDHO0wmRjWDCj0GEw8TJrnyXF43bHqWVpmuG20Uty--FJuTEeDrRe2ITNQhYrLSwj8hMThKvB_fj1gIHDLRVy1IKiNtsmXC72MvuuYcmftM0BPhIqoSbEhiwVj--nToEcLCClZ7o5_ObJJe81CfU9np86g0hk94',
    wrapGeneration: 1,
    kdf: { name: 'PBKDF2-SHA256', iterations: 600000, salt: 'oKGio6SlpqeoqaqrrK2urw' },
  },
} as const;

// A drive key sealed to RECORD_VECTOR's public key. keyId is RECORD_VECTOR.record.id.
export const SLOT_VECTOR = {
  keyId: '22222222-2222-4222-8222-222222222222',
  driveId: '33333333-3333-4333-8333-333333333333',
  driveKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  sealed: {
    epk: 'BKj_y9b-NrxynGLfAydt8YPjpXUvStz8hDUihV1MCoMwV0o7-BhB5HGftxxaz0i0uUSDfe3EtrIkC6cJJrovldg',
    iv: 'Hwp7USyOS-rQaY-I',
    ct: 'IbdC8IXSAWUB-uP5wEhPyGI-a82ohGeByxTPi9YKUNqLX_WxbGE6NHaMIQ-0YO6YOQUD1lDPXE6uRP0',
  },
} as const;
