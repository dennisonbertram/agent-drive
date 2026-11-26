import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriveClient, Version } from './client.js';
import { getFile, putFile } from './node-transfer.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-drive-transfer-'));
  directories.push(directory);
  return directory;
}

const version = { id: 'version', path: '/remote', ciphertextSize: 1 } as Version;

describe('Node file transfer helpers', () => {
  it('streams the statted regular file size and follows a file symlink', async () => {
    const directory = await fixture();
    const source = join(directory, 'source');
    const alias = join(directory, 'alias');
    await writeFile(source, 'streamed contents');
    await symlink(source, alias);
    let supplied = 0;
    const client = {
      putStream: async (
        _drive: string,
        _path: string,
        input: AsyncIterable<Uint8Array>,
        size: number,
      ) => {
        let read = 0;
        for await (const chunk of input) read += chunk.byteLength;
        supplied = size;
        expect(read).toBe(size);
        return version;
      },
    } as unknown as Pick<AgentDriveClient, 'putStream'>;

    expect(await putFile(client, 'drive', alias, '/remote')).toBe(version);
    expect(supplied).toBe(Buffer.byteLength('streamed contents'));
  });

  it('publishes only a complete download and preserves an existing file on failure', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    await writeFile(destination, 'keep this');
    const client = {
      getStream: async () => ({
        plaintext: (async function* () {
          yield new TextEncoder().encode('partial');
          throw new Error('truncated ciphertext');
        })(),
        plaintextBytes: 16,
        version,
        cancel: async () => {},
      }),
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await expect(
      getFile(client, 'drive', '/remote', destination, { overwrite: true, retries: 0 }),
    ).rejects.toThrow('truncated ciphertext');
    expect(await readFile(destination, 'utf8')).toBe('keep this');
    expect((await readdir(directory)).sort()).toEqual(['output']);
  });

  it('retries a failed download with a fresh stream and preserves the existing output mode', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    await writeFile(destination, 'old contents', { mode: 0o640 });
    let attempts = 0;
    const client = {
      getStream: async () => {
        attempts++;
        if (attempts === 1) {
          return {
            plaintext: (async function* () {
              yield new TextEncoder().encode('partial');
              throw new Error('temporary transfer failure');
            })(),
            plaintextBytes: 11,
            version,
            cancel: async () => {},
          };
        }
        return {
          plaintext: (async function* () {
            yield new TextEncoder().encode('new contents');
          })(),
          plaintextBytes: 12,
          version,
          cancel: async () => {},
        };
      },
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await getFile(client, 'drive', '/remote', destination, { overwrite: true });
    expect(attempts).toBe(2);
    expect(await readFile(destination, 'utf8')).toBe('new contents');
    expect((await stat(destination)).mode & 0o777).toBe(0o640);
    expect((await readdir(directory)).sort()).toEqual(['output']);
  });

  it('does not replace an existing create-only destination', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    await writeFile(destination, 'existing');
    const client = {
      getStream: async () => ({
        plaintext: (async function* () {
          yield new TextEncoder().encode('new');
        })(),
        plaintextBytes: 3,
        version,
        cancel: async () => {},
      }),
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await expect(getFile(client, 'drive', '/remote', destination)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(destination, 'utf8')).toBe('existing');
    expect((await readdir(directory)).sort()).toEqual(['output']);
  });
});
