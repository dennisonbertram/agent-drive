// Parses an `adcred1.` credentials bundle (docs/agent-login.md section 9) in the browser.
// The key stays in memory; nothing here sends it anywhere.
export const BUNDLE_PREFIX = 'adcred1.';

export function driveKeyFromBundle(text: string, driveId: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith(BUNDLE_PREFIX)) throw new Error('This is not a credentials bundle.');
  let data: unknown;
  try {
    const b64 = trimmed.slice(BUNDLE_PREFIX.length).replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The credentials bundle could not be decoded.');
  }
  const bundle = data as { v?: unknown; driveKeys?: unknown } | null;
  if (!bundle || bundle.v !== 1 || !bundle.driveKeys || typeof bundle.driveKeys !== 'object')
    throw new Error('The credentials bundle has an unsupported format.');
  const key = (bundle.driveKeys as Record<string, unknown>)[driveId];
  if (typeof key !== 'string' || !key)
    throw new Error('The bundle does not contain a key for this drive.');
  return key;
}
