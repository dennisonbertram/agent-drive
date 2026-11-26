import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentDriveApiError, type AgentDriveClient, type Version } from './client.js';
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

  it('keeps plaintext temporary files private until the verified stream completes', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    await writeFile(destination, 'old contents');
    await chmod(destination, 0o644);
    let modeWhileWriting: number | undefined;
    const client = {
      getStream: async () => ({
        plaintext: (async function* () {
          const temporary = (await readdir(directory)).find((name) => name.endsWith('.tmp'))!;
          modeWhileWriting = (await stat(join(directory, temporary))).mode & 0o777;
          yield new TextEncoder().encode('new contents');
        })(),
        plaintextBytes: 12,
        version,
        cancel: async () => {},
      }),
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await getFile(client, 'drive', '/remote', destination, { overwrite: true, retries: 0 });
    expect(modeWhileWriting).toBe(0o600);
    expect(await readFile(destination, 'utf8')).toBe('new contents');
    expect((await stat(destination)).mode & 0o777).toBe(0o644);
  });

  it('refuses publication when destination permissions change during download', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    await writeFile(destination, 'old contents');
    await chmod(destination, 0o644);
    let attempts = 0;
    const client = {
      getStream: async () => {
        attempts++;
        return {
          plaintext: (async function* () {
            if (attempts === 1) await chmod(destination, 0o600);
            yield new TextEncoder().encode('new contents');
          })(),
          plaintextBytes: 12,
          version,
          cancel: async () => {},
        };
      },
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await expect(
      getFile(client, 'drive', '/remote', destination, { overwrite: true }),
    ).rejects.toThrow('Output path changed during download.');
    expect(attempts).toBe(1);
    expect(await readFile(destination, 'utf8')).toBe('old contents');
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    expect((await readdir(directory)).sort()).toEqual(['output']);
  });

  it('refuses publication when destination identity changes during download', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    const movedOriginal = join(directory, 'original-output');
    await writeFile(destination, 'old contents');
    let attempts = 0;
    const client = {
      getStream: async () => {
        attempts++;
        return {
          plaintext: (async function* () {
            if (attempts === 1) {
              await rename(destination, movedOriginal);
              await writeFile(destination, 'replacement created during download');
            }
            yield new TextEncoder().encode('new contents');
          })(),
          plaintextBytes: 12,
          version,
          cancel: async () => {},
        };
      },
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await expect(
      getFile(client, 'drive', '/remote', destination, { overwrite: true }),
    ).rejects.toThrow('Output path changed during download.');
    expect(attempts).toBe(1);
    expect(await readFile(destination, 'utf8')).toBe('replacement created during download');
    expect(await readFile(movedOriginal, 'utf8')).toBe('old contents');
  });

  it('does not retry or overwrite a replacement made after a transient network failure', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    const movedOriginal = join(directory, 'original-output');
    await writeFile(destination, 'old contents');
    let attempts = 0;
    const client = {
      getStream: async () => {
        attempts++;
        if (attempts === 1) {
          return {
            plaintext: (async function* () {
              yield new TextEncoder().encode('partial');
              await rename(destination, movedOriginal);
              await writeFile(destination, 'replacement during retry');
              throw new Error('temporary network failure');
            })(),
            plaintextBytes: 20,
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

    await expect(
      getFile(client, 'drive', '/remote', destination, { overwrite: true }),
    ).rejects.toThrow('Output path changed during download.');
    expect(attempts).toBe(1);
    expect(await readFile(destination, 'utf8')).toBe('replacement during retry');
    expect(await readFile(movedOriginal, 'utf8')).toBe('old contents');
    expect((await readdir(directory)).sort()).toEqual(['original-output', 'output']);
  });

  it('does not republish when an existing destination is removed during download', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    await writeFile(destination, 'old contents');
    let attempts = 0;
    const client = {
      getStream: async () => {
        attempts++;
        return {
          plaintext: (async function* () {
            if (attempts === 1) await rm(destination);
            yield new TextEncoder().encode('new contents');
          })(),
          plaintextBytes: 12,
          version,
          cancel: async () => {},
        };
      },
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await expect(
      getFile(client, 'drive', '/remote', destination, { overwrite: true }),
    ).rejects.toThrow('Output path changed during download.');
    expect(attempts).toBe(1);
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(directory)).sort()).toEqual([]);
  });

  it('does not overwrite a destination created between network attempts', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    let attempts = 0;
    const client = {
      getStream: async () => {
        attempts++;
        if (attempts === 1) {
          return {
            plaintext: (async function* () {
              yield new TextEncoder().encode('partial');
              await writeFile(destination, 'appeared during retry');
              throw new Error('temporary network failure');
            })(),
            plaintextBytes: 20,
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

    await expect(
      getFile(client, 'drive', '/remote', destination, { overwrite: true }),
    ).rejects.toThrow('Output path changed during download.');
    expect(attempts).toBe(1);
    expect(await readFile(destination, 'utf8')).toBe('appeared during retry');
    expect((await readdir(directory)).sort()).toEqual(['output']);
  });

  it('forwards the plaintext cap to getStream before downloading', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    let receivedOptions: { maxPlaintextBytes?: number } | undefined;
    const client = {
      getStream: async (
        _drive: string,
        _path: string,
        options?: { maxPlaintextBytes?: number },
      ) => {
        receivedOptions = options;
        throw new Error('size cap rejected before transfer');
      },
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await expect(
      getFile(client, 'drive', '/remote', destination, { maxPlaintextBytes: 8 }),
    ).rejects.toThrow('size cap rejected before transfer');
    expect(receivedOptions).toEqual({ maxPlaintextBytes: 8 });
    expect((await readdir(directory)).sort()).toEqual([]);
  });

  it('uses a short temporary basename for a valid near-limit destination name', async () => {
    const directory = await fixture();
    const destination = join(directory, 'x'.repeat(240));
    const client = {
      getStream: async () => ({
        plaintext: (async function* () {
          yield new TextEncoder().encode('new contents');
        })(),
        plaintextBytes: 12,
        version,
        cancel: async () => {},
      }),
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await getFile(client, 'drive', '/remote', destination, { retries: 0 });
    expect(await readFile(destination, 'utf8')).toBe('new contents');
    expect(await readdir(directory)).toEqual(['x'.repeat(240)]);
  });

  it('pins a retry to the version selected by the first stream', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    const latestVersion = { ...version, id: 'new-latest-version' };
    const requestedVersions: Array<string | undefined> = [];
    let attempts = 0;
    const client = {
      getStream: async (_drive: string, _path: string, options?: { versionId?: string }) => {
        attempts++;
        requestedVersions.push(options?.versionId);
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
        const selected = options?.versionId === version.id ? version : latestVersion;
        return {
          plaintext: (async function* () {
            yield new TextEncoder().encode('new contents');
          })(),
          plaintextBytes: 12,
          version: selected,
          cancel: async () => {},
        };
      },
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    const downloaded = await getFile(client, 'drive', '/remote', destination);
    expect(attempts).toBe(2);
    expect(requestedVersions).toEqual([undefined, version.id]);
    expect(downloaded.id).toBe(version.id);
    expect(await readFile(destination, 'utf8')).toBe('new contents');
  });

  it('rejects a destination that becomes a directory before publication', async () => {
    const directory = await fixture();
    const destination = join(directory, 'output');
    await writeFile(destination, 'old contents');
    const client = {
      getStream: async () => ({
        plaintext: (async function* () {
          yield new TextEncoder().encode('new contents');
          await rm(destination);
          await mkdir(destination);
          await writeFile(join(destination, 'keep'), 'directory stays');
        })(),
        plaintextBytes: 12,
        version,
        cancel: async () => {},
      }),
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await expect(
      getFile(client, 'drive', '/remote', destination, { overwrite: true, retries: 0 }),
    ).rejects.toThrow('Output path must be a regular file.');
    expect(await readFile(join(destination, 'keep'), 'utf8')).toBe('directory stays');
  });

  it('does not retry terminal API errors by default', async () => {
    const directory = await fixture();
    let attempts = 0;
    const client = {
      getStream: async () => {
        attempts++;
        throw new AgentDriveApiError('validation_error', 400, 'Invalid request.');
      },
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await expect(
      getFile(client, 'drive', '/remote', join(directory, 'output')),
    ).rejects.toMatchObject({
      code: 'validation_error',
      status: 400,
    });
    expect(attempts).toBe(1);
  });

  it('does not retry an unpinned latest lookup when getStream fails before returning metadata', async () => {
    const directory = await fixture();
    let attempts = 0;
    const client = {
      getStream: async () => {
        attempts++;
        throw new AgentDriveApiError('internal_error', 503, 'Temporary storage failure.');
      },
    } as unknown as Pick<AgentDriveClient, 'getStream'>;

    await expect(
      getFile(client, 'drive', '/remote', join(directory, 'output')),
    ).rejects.toMatchObject({
      code: 'internal_error',
      status: 503,
    });
    expect(attempts).toBe(1);
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
