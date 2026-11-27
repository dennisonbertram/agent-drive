import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRIVE,
  MISMATCH,
  isDriveBoundSource,
  keySourceFor,
  setUpWebhook,
  type Source,
} from './webhook-setup';

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
  opts: {
    inbox?: boolean;
    inboxConflictOnce?: boolean;
    tokenConflictOnce?: boolean;
    inboxProof?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const posted: unknown[] = [];
  const proofs: unknown[] = [];
  let inbox = opts.inbox ?? false;
  let tokenConflict = opts.tokenConflictOnce ?? false;
  let inboxConflict = opts.inboxConflictOnce ?? false;
  const respond = async (path: string, method = 'GET', body?: unknown): Promise<never> => {
    const name = path.split('/').at(-1);
    if (method === 'POST') posted.push(body);
    if (name === 'trace-inbox' && method === 'GET')
      return {
        inbox: inbox ? { keyId: 'k', publicKey: 'p', wrappedPrivateKey: 'w' } : null,
      } as never;
    if (name === 'trace-inbox') {
      inbox = true;
      if (inboxConflict) {
        inboxConflict = false;
        throw Object.assign(new Error('exists'), { status: 409 });
      }
      return {} as never;
    }
    if (tokenConflict) {
      tokenConflict = false;
      inbox = false;
      throw Object.assign(new Error('Create the trace inbox first.'), { status: 409 });
    }
    return made as never;
  };
  const request = async (path: string, method = 'GET', body?: unknown) => {
    calls.push(`${method} ${path.split('/').at(-1)}`);
    return respond(path, method, body);
  };
  const strictRequest = async (path: string, method = 'GET', body?: unknown) => {
    calls.push(`strict ${method} ${path.split('/').at(-1)}`);
    return respond(path, method, body);
  };
  const verifyInbox = async (_driveId: string, _key: string, record: unknown) => {
    proofs.push(record);
    return opts.inboxProof ?? true;
  };
  return {
    request: request as never,
    strictRequest: strictRequest as never,
    verifyInbox,
    calls,
    posted,
    proofs,
  };
}
const run = (f: ReturnType<typeof fake>, source: Source, verify: () => Promise<Verdict>) =>
  setUpWebhook({
    request: f.request,
    strictRequest: f.strictRequest,
    driveId,
    key,
    source,
    verify,
    verifyInbox: f.verifyInbox,
  });

describe('setUpWebhook', () => {
  it('refuses a mismatched key before anything is created', async () => {
    const f = fake();
    await expect(run(f, 'bundle', async () => 'mismatch')).rejects.toThrow(MISMATCH);
    expect(f.calls).toEqual(['GET trace-inbox']);
  });
  it('refuses a pasted key on an empty drive', async () => {
    const f = fake();
    await expect(run(f, 'pasted', async () => 'unverifiable')).rejects.toThrow(EMPTY_DRIVE);
    expect(f.calls).toEqual(['GET trace-inbox']);
  });
  it.each<Source>(['trusted', 'recovery-file', 'bundle'])(
    'creates inbox and token for %s on an empty drive',
    async (source) => {
      const f = fake();
      expect(await run(f, source, async () => 'unverifiable')).toEqual(made);
      expect(f.calls).toEqual([
        'GET trace-inbox',
        'strict POST trace-inbox',
        'strict POST webhook-token',
      ]);
      // The token POST names all fields of the record the key was proven against.
      expect(f.posted.at(-1)).toEqual({
        keyId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        publicKey: expect.any(String),
        wrappedPrivateKey: expect.any(String),
      });
    },
  );
  it('proves the locally created inbox snapshot before posting it', async () => {
    const f = fake({ inboxProof: false });
    await expect(run(f, 'trusted', async () => 'unverifiable')).rejects.toThrow(MISMATCH);
    expect(f.calls).toEqual(['GET trace-inbox']);
    expect(f.posted).toEqual([]);
  });
  it('refuses an unchecked vault slot key on an empty drive', async () => {
    const f = fake();
    await expect(run(f, 'vault', async () => 'unverifiable')).rejects.toThrow(EMPTY_DRIVE);
    expect(f.calls).toEqual(['GET trace-inbox']);
  });
  it('rejects an inbox that the key cannot open even when a file proves the drive key', async () => {
    const f = fake({ inbox: true, inboxProof: false });
    await expect(run(f, 'pasted', async () => 'file')).rejects.toThrow(MISMATCH);
    expect(f.proofs).toHaveLength(1);
    expect(f.calls).not.toContain('strict POST webhook-token');
  });
  it('accepts a pasted key only when it opens the exact existing inbox', async () => {
    const f = fake({ inbox: true });
    let driveProofCalls = 0;
    await run(f, 'pasted', async () => {
      driveProofCalls += 1;
      return 'file';
    });
    expect(driveProofCalls).toBe(0);
    expect(f.calls).toEqual(['GET trace-inbox', 'strict POST webhook-token']);
    expect(f.proofs).toEqual([{ keyId: 'k', publicKey: 'p', wrappedPrivateKey: 'w' }]);
    // The token is bound to the exact record the verifier checked.
    expect(f.posted.at(-1)).toEqual({ keyId: 'k', publicKey: 'p', wrappedPrivateKey: 'w' });
  });
  it('re-verifies after a 409 on the inbox and stops on mismatch', async () => {
    const f = fake({ inboxConflictOnce: true, inboxProof: false });
    await expect(run(f, 'bundle', async () => 'unverifiable')).rejects.toThrow(MISMATCH);
    expect(f.proofs).toHaveLength(1);
    expect(f.calls).not.toContain('strict POST webhook-token');
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
      'strict POST webhook-token',
      'GET trace-inbox',
      'strict POST trace-inbox',
      'strict POST webhook-token',
    ]);
  });
  it('sends the winning record after a 409 on inbox creation', async () => {
    const f = fake({ inboxConflictOnce: true });
    await run(f, 'bundle', async () => 'unverifiable');
    // The winning record came from a re-read and proof, not the lost create.
    expect(f.proofs).toHaveLength(2);
    expect(f.proofs.at(-1)).toEqual({ keyId: 'k', publicKey: 'p', wrappedPrivateKey: 'w' });
    expect(f.posted.at(-1)).toEqual({ keyId: 'k', publicKey: 'p', wrappedPrivateKey: 'w' });
  });
});

describe('keySourceFor', () => {
  it('trusts only the key the tab generated, not a later replacement', () => {
    expect(keySourceFor('k1', 'pasted', 'k1')).toBe('trusted');
    // Forget key, then load an unrelated raw key: the drive's old trust does not carry over.
    expect(keySourceFor('k1', 'pasted', 'k2')).toBe('pasted');
    expect(keySourceFor(undefined, 'bundle', 'k2')).toBe('bundle');
    expect(keySourceFor(undefined, undefined, 'k2')).toBe('pasted');
  });
});

describe('isDriveBoundSource', () => {
  it.each(['trusted', 'recovery-file', 'bundle'] as const)(
    '%s identifies an empty drive',
    (source) => {
      expect(isDriveBoundSource(source)).toBe(true);
    },
  );

  it.each(['pasted', 'vault'] as const)('%s cannot identify an empty drive', (source) => {
    expect(isDriveBoundSource(source)).toBe(false);
  });
});
