import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { driveKeyFromPastedText, driveKeyFromRecoveryText, keySource } from './recovery-file';

const key = randomBytes(32).toString('base64url');
const file = (driveId: string, k = key) =>
  JSON.stringify({ format: 'agent-drive-key-v1', driveId, key: k });
const bundle = (value: unknown) =>
  `adcred1.${Buffer.from(JSON.stringify(value)).toString('base64url')}`;

const NOT_FILE =
  'That is not a recovery file. Choose the agent-drive-….key.json file you downloaded.';
const messages: string[] = [];
function message(run: () => unknown) {
  try {
    run();
  } catch (error) {
    const text = (error as Error).message;
    messages.push(text);
    return text;
  }
  throw new Error('expected a throw');
}

describe('driveKeyFromRecoveryText', () => {
  it('returns the key from the right recovery file and from a bundle', () => {
    expect(driveKeyFromRecoveryText(file('d1'), 'd1')).toBe(key);
    expect(driveKeyFromRecoveryText(bundle({ v: 1, driveKeys: { d1: key } }), 'd1')).toBe(key);
  });
  it('uses the exact copy for each failure', () => {
    expect(message(() => driveKeyFromRecoveryText(file('other'), 'd1'))).toBe(
      'That recovery file is not for this drive.',
    );
    expect(message(() => driveKeyFromRecoveryText('plain text', 'd1'))).toBe(NOT_FILE);
    expect(message(() => driveKeyFromRecoveryText('{"driveId":"d1"}', 'd1'))).toBe(NOT_FILE);
    expect(message(() => driveKeyFromRecoveryText(file('d1', 'short'), 'd1'))).toBe(NOT_FILE);
    expect(message(() => driveKeyFromRecoveryText(' '.repeat(16_385) + file('d1'), 'd1'))).toBe(
      NOT_FILE,
    );
    expect(
      message(() => driveKeyFromRecoveryText(bundle({ v: 1, driveKeys: { d2: key } }), 'd1')),
    ).toBe('That credentials bundle has no key for this drive.');
    expect(message(() => driveKeyFromRecoveryText('adcred1.@@@', 'd1'))).toBe(
      'That credentials bundle could not be read.',
    );
  });
  it('never mentions base64url or 32-byte', () => {
    expect(message(() => driveKeyFromPastedText('nope', 'd1'))).toBe(
      'That key is not valid. Paste the whole key or credentials bundle.',
    );
    expect(driveKeyFromPastedText(` ${key}\n`, 'd1')).toBe(key);
    for (const text of messages) expect(text).not.toMatch(/base64url|32-byte/);
  });
});

describe('keySource', () => {
  it('is bundle for adcred1. text and pasted otherwise', () => {
    expect(keySource(bundle({ v: 1, driveKeys: { d1: key } }))).toBe('bundle');
    expect(keySource(`  ${bundle({ v: 1, driveKeys: {} })}\n`)).toBe('bundle');
    expect(keySource(key)).toBe('pasted');
  });
});
