import { Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { getPipe, parsePipeSize, putPipe } from './cli-pipes.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const filesystem = await importOriginal<typeof import('node:fs/promises')>();
  return { ...filesystem, rm: vi.fn(filesystem.rm) };
});

const originalRm = vi.mocked(rm).getMockImplementation();
afterEach(() => {
  if (originalRm) vi.mocked(rm).mockImplementation(originalRm);
});

const VERSION = {
  id: '11111111-1111-4111-8111-111111111111',
  path: '/x',
  ciphertextSize: 44,
  wrappedKey: 'wrapped',
  agentId: 'a',
  machineId: null,
  userId: null,
  tags: [],
  description: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('CLI binary pipes', () => {
  it('passes a known-size stdin source directly to putStream, including an empty source', async () => {
    const source = Readable.from((async function* () {})());
    const putStream = vi.fn(async () => VERSION);
    await putPipe({ putStream } as never, 'd', '/x', source, 0);

    expect(putStream).toHaveBeenCalledWith('d', '/x', source, 0, {});
  });

  it('rejects an invalid known size before asking stdin for an iterator', async () => {
    const read = vi.fn();
    const source = new Readable({ read });
    const putStream = vi.fn();
    await expect(putPipe({ putStream } as never, 'd', '/x', source, -1)).rejects.toThrow(
      'non-negative safe integer',
    );
    expect(read).not.toHaveBeenCalled();
    expect(putStream).not.toHaveBeenCalled();
  });

  it('accepts the exact 5 GiB ciphertext boundary and rejects the next plaintext byte', () => {
    expect(parsePipeSize(' 5368627175 ')).toBe(5368627175);
    expect(() => parsePipeSize('5368627176')).toThrow('5 GiB encrypted upload limit');
  });

  it('spools an unknown-size input once and uploads the same bytes', async () => {
    const inputReads = vi.fn();
    async function* input() {
      inputReads();
      yield Buffer.from([0, 255, 1]);
      inputReads();
      yield Buffer.from([2, 3]);
    }
    const received: number[] = [];
    const putStream = vi.fn(async (_drive, _path, plaintext: AsyncIterable<Uint8Array>, size) => {
      expect(size).toBe(5);
      for await (const chunk of plaintext) received.push(...chunk);
      return VERSION;
    });

    await putPipe({ putStream } as never, 'd', '/x', Readable.from(input()));

    expect(inputReads).toHaveBeenCalledTimes(2);
    expect(received).toEqual([0, 255, 1, 2, 3]);
    expect(putStream).toHaveBeenCalledTimes(1);
  });

  it('spools an empty unknown-size input and uploads a zero-byte stream', async () => {
    let received = 0;
    const putStream = vi.fn(async (_drive, _path, plaintext: AsyncIterable<Uint8Array>, size) => {
      expect(size).toBe(0);
      for await (const chunk of plaintext) received += chunk.byteLength;
      return VERSION;
    });

    await putPipe({ putStream } as never, 'd', '/x', Readable.from([]));

    expect(received).toBe(0);
    expect(putStream).toHaveBeenCalledTimes(1);
  });

  it('encrypts a named fallback spool and refuses to commit after ciphertext changes', async () => {
    const payload = Buffer.from('private spool contents');
    let spoolPath = '';
    let rmCount = 0;
    vi.mocked(rm).mockImplementation(async (path, options) => {
      rmCount++;
      if (rmCount === 1) {
        spoolPath = String(path);
        throw Object.assign(new Error('open file cannot be unlinked'), { code: 'EPERM' });
      }
      return await originalRm!(path, options);
    });

    let committed = false;
    const putStream = vi.fn(async (_drive, _path, plaintext: AsyncIterable<Uint8Array>, size) => {
      expect(size).toBe(payload.byteLength);
      const onDisk = await readFile(spoolPath);
      expect(onDisk.toString()).not.toBe(payload.toString());
      const corrupted = Buffer.from(onDisk);
      corrupted[0] = (corrupted[0] ?? 0) ^ 1;
      await writeFile(spoolPath, corrupted);
      for await (const _chunk of plaintext) {
      }
      committed = true;
      return VERSION;
    });

    await expect(
      putPipe(
        { putStream } as never,
        'd',
        '/x',
        Readable.from(
          (async function* () {
            yield payload;
          })(),
        ),
      ),
    ).rejects.toThrow();

    expect(putStream).toHaveBeenCalledTimes(1);
    expect(committed).toBe(false);
    expect(rmCount).toBe(2);
    await expect(readFile(spoolPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes exact binary bytes and respects stdout backpressure', async () => {
    const read = vi.fn();
    const plaintext = (async function* () {
      for (let index = 0; index < 10; index++) {
        read();
        yield Buffer.alloc(32 * 1024, index);
      }
    })();
    const output: Buffer[] = [];
    let releaseFirstWrite!: () => void;
    let firstWriteStarted!: () => void;
    const firstWrite = new Promise<void>((resolve) => (firstWriteStarted = resolve));
    const firstWriteGate = new Promise<void>((resolve) => (releaseFirstWrite = resolve));
    let writeCount = 0;
    const stdout = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        output.push(Buffer.from(chunk));
        if (writeCount++ === 0) {
          firstWriteStarted();
          void firstWriteGate.then(() => callback());
        } else callback();
      },
    });
    const getStream = vi.fn(async () => ({
      plaintext,
      plaintextBytes: 10 * 32 * 1024,
      version: VERSION,
      cancel: vi.fn(async () => {}),
    }));

    const transfer = getPipe({ getStream } as never, 'd', '/x', stdout);
    await firstWrite;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(read.mock.calls.length).toBeLessThan(10);
    releaseFirstWrite();
    await transfer;

    expect(Buffer.concat(output)).toEqual(
      Buffer.concat(Array.from({ length: 10 }, (_, index) => Buffer.alloc(32 * 1024, index))),
    );
    expect(read).toHaveBeenCalledTimes(10);
    expect(stdout.writableEnded).toBe(false);
    expect(stdout.destroyed).toBe(false);
    expect(getStream).toHaveBeenCalledWith('d', '/x', {});
  });

  it('cancels the download and rejects when stdout reports EPIPE', async () => {
    const cancel = vi.fn(async () => {});
    const plaintext = (async function* () {
      yield Buffer.from([1]);
      yield Buffer.from([2]);
    })();
    const stdout = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error('closed pipe'), { code: 'EPIPE' }));
      },
    });
    const getStream = vi.fn(async () => ({
      plaintext,
      plaintextBytes: 2,
      version: VERSION,
      cancel,
    }));

    await expect(getPipe({ getStream } as never, 'd', '/x', stdout)).rejects.toMatchObject({
      code: 'EPIPE',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('waits for a delayed final stdout callback and rejects its EPIPE', async () => {
    let releaseWrite!: (error?: Error | null) => void;
    let writeStarted!: () => void;
    const started = new Promise<void>((resolve) => (writeStarted = resolve));
    const pendingWrite = new Promise<void>((resolve, reject) => {
      releaseWrite = (error) => (error ? reject(error) : resolve());
    });
    let settled = false;
    const stdout = new Writable({
      highWaterMark: 1024,
      write(_chunk, _encoding, callback) {
        writeStarted();
        void pendingWrite.then(
          () => callback(),
          (error: Error) => callback(error),
        );
      },
    });
    // Keep the test process safe if an implementation reports success before this late error.
    stdout.on('error', () => {});
    const cancel = vi.fn(async () => {});
    const getStream = vi.fn(async () => ({
      plaintext: (async function* () {
        yield Buffer.from([1]);
      })(),
      plaintextBytes: 1,
      version: VERSION,
      cancel,
    }));
    const transfer = getPipe({ getStream } as never, 'd', '/x', stdout).then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );

    await started;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const settledBeforeCallback = settled;
    releaseWrite(Object.assign(new Error('closed pipe after source EOF'), { code: 'EPIPE' }));
    const error = await transfer;

    expect(settledBeforeCallback).toBe(false);
    expect(error).toMatchObject({ code: 'EPIPE' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('aborts a pending stdin read and does not call putStream', async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort(new Error('cancelled before read'));
    const untouchedRead = vi.fn();
    const untouched = new Readable({ read: untouchedRead });
    const putStream = vi.fn();
    await expect(
      putPipe({ putStream } as never, 'd', '/x', untouched, undefined, {
        signal: alreadyAborted.signal,
      }),
    ).rejects.toThrow('cancelled before read');
    expect(untouchedRead).not.toHaveBeenCalled();
    expect(untouched.destroyed).toBe(false);

    const read = vi.fn();
    const input = new Readable({ read });
    const controller = new AbortController();
    const transfer = putPipe({ putStream } as never, 'd', '/x', input, undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    controller.abort(new Error('cancelled while waiting'));
    const outcome = await Promise.race([
      transfer.then(
        () => 'fulfilled',
        () => 'rejected',
      ),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ]);
    expect(outcome).toBe('rejected');
    expect(input.destroyed).toBe(true);
    expect(putStream).not.toHaveBeenCalled();
  });
});
