import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRIVE,
  MISMATCH,
  WRONG_KEY,
  assertKeyForDrive,
  isDriveBoundSource,
  keySourceFor,
  TAB_CHANGED,
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
    challengeConflictOnce?: boolean;
    tokenConflictOnce?: boolean;
    inboxProof?: boolean;
    inboxProofs?: boolean[];
  } = {},
) {
  const calls: string[] = [];
  const posted: unknown[] = [];
  const challenges: unknown[] = [];
  const proofResults = [...(opts.inboxProofs ?? [opts.inboxProof ?? true])];
  let inbox = opts.inbox ?? false;
  let tokenConflict = opts.tokenConflictOnce ?? false;
  let inboxConflict = opts.inboxConflictOnce ?? false;
  let challengeConflict = opts.challengeConflictOnce ?? false;
  const respond = async (path: string, method = 'GET', body?: unknown): Promise<never> => {
    const name = path.split('/').at(-1);
    if (method === 'POST' && name === 'challenge') {
      challenges.push(body);
      if (challengeConflict) {
        challengeConflict = false;
        inbox = true;
        throw Object.assign(new Error('A trace inbox already exists for this drive.'), {
          status: 409,
        });
      }
      return { challengeId: 'challenge-id', envelope: 'encrypted-challenge' } as never;
    }
    if (method === 'POST') posted.push(body);
    if (name === 'trace-inbox' && method === 'GET')
      return {
        inbox: inbox
          ? { keyId: 'k', publicKey: 'p', wrappedPrivateKey: 'w', createdAt: 'server-only' }
          : null,
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
  const answerChallenge = async () => {
    if (!proofResults.length) return 'proof';
    const valid = proofResults.shift();
    if (!valid) throw new Error(MISMATCH);
    return 'proof';
  };
  return {
    request: request as never,
    strictRequest: strictRequest as never,
    answerChallenge,
    calls,
    posted,
    challenges,
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
    answerChallenge: f.answerChallenge,
  });

describe('assertKeyForDrive', () => {
  it('rejects a key that does not match the drive', async () => {
    await expect(assertKeyForDrive(async () => 'mismatch', driveId, key)).rejects.toThrow(
      WRONG_KEY,
    );
  });
  it.each<Verdict>(['file', 'inbox', 'unverifiable'])('accepts a %s verdict', async (verdict) => {
    await expect(assertKeyForDrive(async () => verdict, driveId, key)).resolves.toBeUndefined();
  });
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
        'strict POST challenge',
        'strict POST trace-inbox',
        'strict POST challenge',
        'strict POST webhook-token',
      ]);
      // The token POST names all fields of the record the key was proven against.
      expect(f.posted.at(-1)).toEqual({
        keyId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        publicKey: expect.any(String),
        wrappedPrivateKey: expect.any(String),
        challengeId: 'challenge-id',
        proof: 'proof',
      });
      expect(f.challenges.map((v) => (v as { action: string }).action)).toEqual([
        'enroll',
        'issue-token',
      ]);
    },
  );
  it('requires the local key to open the encrypted enrollment challenge', async () => {
    const f = fake({ inboxProof: false });
    await expect(run(f, 'trusted', async () => 'unverifiable')).rejects.toThrow(MISMATCH);
    expect(f.calls).toEqual(['GET trace-inbox', 'strict POST challenge']);
    expect(f.posted).toEqual([]);
  });
  it('refuses an unchecked vault slot key on an empty drive', async () => {
    const f = fake();
    await expect(run(f, 'vault', async () => 'unverifiable')).rejects.toThrow(EMPTY_DRIVE);
    expect(f.calls).toEqual(['GET trace-inbox']);
  });
  it('rejects an inbox challenge the key cannot open even when a file proves the drive key', async () => {
    const f = fake({ inbox: true, inboxProof: false });
    await expect(run(f, 'pasted', async () => 'file')).rejects.toThrow(MISMATCH);
    expect(f.calls).toContain('strict POST challenge');
    expect(f.calls).not.toContain('strict POST webhook-token');
  });
  it('keeps the drive-file check when an inbox already exists', async () => {
    const f = fake({ inbox: true });
    await expect(run(f, 'vault', async () => 'mismatch')).rejects.toThrow(MISMATCH);
    expect(f.calls).toEqual(['GET trace-inbox']);
  });
  it('accepts a pasted key only when it opens the exact existing inbox', async () => {
    const f = fake({ inbox: true });
    let driveProofCalls = 0;
    await run(f, 'pasted', async () => {
      driveProofCalls += 1;
      return 'file';
    });
    expect(driveProofCalls).toBe(1);
    expect(f.calls).toEqual([
      'GET trace-inbox',
      'strict POST challenge',
      'strict POST webhook-token',
    ]);
    // The token is bound to the exact record the verifier checked.
    expect(f.posted.at(-1)).toEqual({
      keyId: 'k',
      publicKey: 'p',
      wrappedPrivateKey: 'w',
      challengeId: 'challenge-id',
      proof: 'proof',
    });
    expect(f.challenges[0]).toEqual({
      action: 'issue-token',
      inbox: { keyId: 'k', publicKey: 'p', wrappedPrivateKey: 'w' },
    });
  });
  it('recovers when another tab enrolls before the challenge request', async () => {
    const f = fake({ challengeConflictOnce: true });
    await run(f, 'bundle', async () => 'file');
    expect(f.calls).toEqual([
      'GET trace-inbox',
      'strict POST challenge',
      'GET trace-inbox',
      'strict POST challenge',
      'strict POST webhook-token',
    ]);
    expect(f.challenges).toEqual([
      {
        action: 'enroll',
        inbox: expect.objectContaining({ keyId: expect.any(String) }),
      },
      {
        action: 'issue-token',
        inbox: { keyId: 'k', publicKey: 'p', wrappedPrivateKey: 'w' },
      },
    ]);
    expect(f.posted.at(-1)).toEqual({
      keyId: 'k',
      publicKey: 'p',
      wrappedPrivateKey: 'w',
      challengeId: 'challenge-id',
      proof: 'proof',
    });
  });
  it('re-verifies a 409 inbox winner and stops when its challenge cannot be opened', async () => {
    const f = fake({ inboxConflictOnce: true, inboxProofs: [true, false] });
    await expect(run(f, 'bundle', async () => 'unverifiable')).rejects.toThrow(MISMATCH);
    expect(f.posted).toHaveLength(1); // local enrollment was attempted before the 409
    expect(f.challenges.map((v) => (v as { action: string }).action)).toEqual([
      'enroll',
      'issue-token',
    ]);
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
      'strict POST challenge',
      'strict POST webhook-token',
      'GET trace-inbox',
      'strict POST challenge',
      'strict POST trace-inbox',
      'strict POST challenge',
      'strict POST webhook-token',
    ]);
  });
  it('sends the winning record after a 409 on inbox creation', async () => {
    const f = fake({ inboxConflictOnce: true });
    await run(f, 'bundle', async () => 'unverifiable');
    // The winning record came from a re-read and proof, not the lost create.
    expect(f.challenges).toHaveLength(2);
    expect(f.posted.at(-1)).toEqual({
      keyId: 'k',
      publicKey: 'p',
      wrappedPrivateKey: 'w',
      challengeId: 'challenge-id',
      proof: 'proof',
    });
  });
});

describe('expectedTokenId', () => {
  it('is posted with the token request, including null for Add', async () => {
    for (const expectedTokenId of [null, 't0']) {
      const f = fake({ inbox: true });
      await setUpWebhook({
        request: f.request,
        strictRequest: f.strictRequest,
        driveId,
        key,
        source: 'bundle',
        verify: async () => 'inbox',
        answerChallenge: f.answerChallenge,
        expectedTokenId,
      });
      expect(f.posted.at(-1)).toMatchObject({ expectedTokenId });
    }
  });
  it('stops on "changed in another tab" without retrying', async () => {
    const f = fake({ inbox: true });
    let tokenPosts = 0;
    const strictRequest = (async (path: string, method = 'GET', body?: unknown) => {
      if (path.endsWith('/webhook-token')) {
        tokenPosts += 1;
        throw Object.assign(new Error(TAB_CHANGED), { status: 409 });
      }
      return (f.strictRequest as unknown as (p: string, m: string, b?: unknown) => Promise<unknown>)(path, method, body);
    }) as never;
    await expect(
      setUpWebhook({
        request: f.request,
        strictRequest,
        driveId,
        key,
        source: 'bundle',
        verify: async () => 'inbox',
        answerChallenge: f.answerChallenge,
        expectedTokenId: null,
      }),
    ).rejects.toThrow(TAB_CHANGED);
    expect(tokenPosts).toBe(1);
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
