// Independently authenticated recipient binding (docs/agent-login.md §15).
//
// The verification code is a commitment to a public key that a human carries through a channel
// the service cannot write to: the requesting device prints it on its own terminal, and the
// human types it into the approval page or passes it to `agent-drive grant --verify`. Neither
// the page nor the granter trusts the key the service returned until the code matches — a
// substituted public key produces a different code and the seal never happens.
//
// The format is the account key's display fingerprint: the first 8 bytes of the SHA-256 of the
// raw public key as four hex groups ("a1b2 c3d4 e5f6 7890"). Implemented with WebCrypto only so
// the identical code runs in the CLI, the API and the browser.

export const VERIFICATION_CODE_PATTERN = /^[0-9a-f]{4}( [0-9a-f]{4}){3}$/u;

function unb64u(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid base64url.');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * The verification code for a base64url public key. It is not a secret: its value is that the
 * human sees it on the requesting device's own output and nowhere the service can write.
 */
export async function verificationCode(publicKey: string): Promise<string> {
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', unb64u(publicKey) as Uint8Array<ArrayBuffer>),
  ).slice(0, 8);
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return hex.match(/.{4}/gu)!.join(' ');
}

/**
 * Normalizes a typed code: case-insensitive, spaces and punctuation optional. Returns the
 * canonical "xxxx xxxx xxxx xxxx" form, or undefined when the input is not a code at all.
 */
export function normalizeVerificationCode(value: string): string | undefined {
  const compact = value.toLowerCase().replace(/[^0-9a-f]/gu, '');
  if (!/^[0-9a-f]{16}$/u.test(compact)) return undefined;
  return compact.match(/.{4}/gu)!.join(' ');
}
