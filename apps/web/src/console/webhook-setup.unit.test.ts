import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EMPTY_DRIVE, MISMATCH, setUpWebhook, type Source } from './webhook-setup';

const driveId = randomUUID();
const key = randomBytes(32).toString('base64url');
const made = {
  id: 't1',
  token: 'adw_x',
  url: 'https://x/api/webhooks/openrouter/d',
  createdAt: 'now',
};
type Verdict = 'file' | 'inbox' | 'mismatch' | 'unverifiable';

function fake(
  opts: { inbox?: boolean; inboxConflictOnce?: boolean; tokenConflictOnce?: boolean } = {},
) {
  const calls: string[] = [];
  let inbox = opts.inbox ?? false;
  let tokenConflict = opts.tokenConflictOnce ?? false;
  const request = async (path: string, method = 'GET'): Promise<never> => {
    const name = path.split('/').at(-1);
    calls.push(`${method} ${name}`);
    if (name === 'trace-inbox' && method === 'GET')
      return {
        inbox: inbox ? { keyId: 'k', publicKey: 'p', wrappedPrivateKey: 'w' } : null,
      } as never;
    if (name === 'trace-inbox') {
      inbox = true;
      if (opts.inboxConflictOnce) throw Object.assign(new Error('exists'), { status: 409 });
      return {} as never;
    }
    if (tokenConflict) {
      tokenConflict = false;
      inbox = false;
      throw Object.assign(new Error('Create the trace inbox first.'), { status: 409 });
    }
    return made as never;
  };
  return { request: request as never, calls };
}
const run = (f: ReturnType<typeof fake>, source: Source, verify: () => Promise<Verdict>) =>
  setUpWebhook({ request: f.request, driveId, key, source, verify });

describe('setUpWebhook', () => {
  it('refuses a mismatched key before anything is created', async () => {
    const f = fake();
    await expect(run(f, 'bundle', async () => 'mismatch')).rejects.toThrow(MISMATCH);
    expect(f.calls).toEqual([]);
  });
  it('refuses a pasted key on an empty drive', async () => {
    const f = fake();
    await expect(run(f, 'pasted', async () => 'unverifiable')).rejects.toThrow(EMPTY_DRIVE);
    expect(f.calls).toEqual([]);
  });
  it.each<Source>(['trusted', 'recovery-file', 'bundle', 'vault'])(
    'creates inbox and token for %s on an empty drive',
    async (source) => {
      const f = fake();
      expect(await run(f, source, async () => 'unverifiable')).toEqual(made);
      expect(f.calls).toEqual(['GET trace-inbox', 'POST trace-inbox', 'POST webhook-token']);
    },
  );
  it('accepts a pasted key that opens a file, and skips the inbox when it exists', async () => {
    const f = fake({ inbox: true });
    await run(f, 'pasted', async () => 'file');
    expect(f.calls).toEqual(['GET trace-inbox', 'POST webhook-token']);
  });
  it('re-verifies after a 409 on the inbox and stops on mismatch', async () => {
    const f = fake({ inboxConflictOnce: true });
    const results: Verdict[] = ['unverifiable', 'mismatch'];
    let n = 0;
    await expect(run(f, 'bundle', async () => results[n++]!)).rejects.toThrow(MISMATCH);
    expect(n).toBe(2);
    expect(f.calls).not.toContain('POST webhook-token');
  });
  it('continues after a 409 on the inbox when the key opens the winning inbox', async () => {
    const f = fake({ inboxConflictOnce: true });
    const results: Verdict[] = ['unverifiable', 'inbox'];
    let n = 0;
    expect(await run(f, 'bundle', async () => results[n++]!)).toEqual(made);
  });
  it('creates the inbox and retries once when the token POST says there is no inbox', async () => {
    const f = fake({ inbox: true, tokenConflictOnce: true });
    await run(f, 'bundle', async () => 'inbox');
    expect(f.calls).toEqual([
      'GET trace-inbox',
      'POST webhook-token',
      'GET trace-inbox',
      'POST trace-inbox',
      'POST webhook-token',
    ]);
  });
});
