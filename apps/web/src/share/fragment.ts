import { decodeDriveKey } from '../../../../packages/agent-drive/src/crypto';

export function parseShareFragment(hash: string) {
  const value = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('k');
  if (!value || !/^[A-Za-z0-9_-]{43}$/u.test(value)) return null;
  try {
    const bytes = decodeDriveKey(value);
    bytes.fill(0);
    return value;
  } catch {
    return null;
  }
}
