// Reads a drive key from a recovery file, an `adcred1.` bundle or pasted text, in the browser.
// Errors are plain sentences for the unlock dialog; the key is never sent anywhere.
import { decodeDriveKey } from '../../../../packages/agent-drive/src/crypto.ts';
import { BUNDLE_PREFIX, driveKeyFromBundle } from './credentials-bundle';

const NOT_A_FILE =
  'That is not a recovery file. Choose the agent-drive-….key.json file you downloaded.';
const MAX_FILE_CHARS = 16_384;

function fromBundle(text: string, driveId: string) {
  let key: string;
  try {
    key = driveKeyFromBundle(text, driveId);
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes('does not contain a key')
        ? 'That credentials bundle has no key for this drive.'
        : 'That credentials bundle could not be read.',
    );
  }
  try {
    decodeDriveKey(key);
  } catch {
    throw new Error('That credentials bundle could not be read.');
  }
  return key;
}

export function driveKeyFromRecoveryText(text: string, driveId: string): string {
  if (text.length > MAX_FILE_CHARS) throw new Error(NOT_A_FILE);
  if (text.trim().startsWith(BUNDLE_PREFIX)) return fromBundle(text, driveId);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(NOT_A_FILE);
  }
  const file = data as { driveId?: unknown; key?: unknown } | null;
  if (!file || typeof file.driveId !== 'string' || typeof file.key !== 'string')
    throw new Error(NOT_A_FILE);
  if (file.driveId !== driveId) throw new Error('That recovery file is not for this drive.');
  try {
    decodeDriveKey(file.key);
  } catch {
    throw new Error(NOT_A_FILE);
  }
  return file.key;
}

/** Where pasted text came from: a credentials bundle names its drive, a raw key does not. */
export function keySource(text: string): 'bundle' | 'pasted' {
  return text.trim().startsWith(BUNDLE_PREFIX) ? 'bundle' : 'pasted';
}

export function driveKeyFromPastedText(text: string, driveId: string): string {
  const pasted = text.trim();
  if (pasted.startsWith(BUNDLE_PREFIX)) return fromBundle(pasted, driveId);
  try {
    decodeDriveKey(pasted);
  } catch {
    throw new Error('That key is not valid. Paste the whole key or credentials bundle.');
  }
  return pasted;
}
