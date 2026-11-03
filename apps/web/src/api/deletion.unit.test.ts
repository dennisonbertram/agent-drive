import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { purgePrefix } from './deletion';

afterEach(() => vi.restoreAllMocks());

describe('deletion prefix cleanup', () => {
  it('uses version listing and deletes versions for AWS-compatible storage', async () => {
    const store = new S3Client({});
    const send = vi.spyOn(store, 'send');
    send.mockImplementation(async (command) => {
      if (command instanceof ListObjectVersionsCommand) {
        if (
          send.mock.calls.filter(([call]) => call instanceof ListObjectVersionsCommand).length === 1
        )
          return { Versions: [{ Key: 'objects/a', VersionId: 'v1' }], IsTruncated: true } as never;
        return {} as never;
      }
      if (command instanceof DeleteObjectsCommand) return {} as never;
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    });

    await expect(purgePrefix(store, 'objects/')).resolves.toBe(true);

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListObjectVersionsCommand);
    const deletion = send.mock.calls.find(
      ([command]) => command instanceof DeleteObjectsCommand,
    )?.[0];
    expect(deletion).toBeInstanceOf(DeleteObjectsCommand);
    expect((deletion as DeleteObjectsCommand).input.Delete?.Objects).toEqual([
      { Key: 'objects/a', VersionId: 'v1' },
    ]);
    expect(send.mock.calls.every(([command]) => !(command instanceof ListObjectsV2Command))).toBe(
      true,
    );
  });

  it('falls back to ListObjectsV2 after R2 rejects version listing and deletes by key', async () => {
    const store = new S3Client({});
    const send = vi.spyOn(store, 'send');
    let versionAttempts = 0;
    send.mockImplementation(async (command) => {
      if (command instanceof ListObjectVersionsCommand) {
        versionAttempts++;
        const error = Object.assign(new Error('Not implemented'), {
          name: 'NotImplemented',
          $metadata: { httpStatusCode: 501 },
        });
        throw error;
      }
      if (command instanceof ListObjectsV2Command) {
        const v2Calls = send.mock.calls.filter(
          ([call]) => call instanceof ListObjectsV2Command,
        ).length;
        return v2Calls === 1
          ? ({ Contents: [{ Key: 'objects/r2' }], IsTruncated: true } as never)
          : ({} as never);
      }
      if (command instanceof DeleteObjectsCommand) return {} as never;
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    });

    await expect(purgePrefix(store, 'objects/')).resolves.toBe(true);
    await expect(purgePrefix(store, 'other/')).resolves.toBe(true);

    expect(versionAttempts).toBe(1);
    const listInputs = send.mock.calls.flatMap(([command]) =>
      command instanceof ListObjectsV2Command ? [(command as ListObjectsV2Command).input] : [],
    );
    expect(listInputs).toHaveLength(3);
    expect(listInputs.map((input) => input.Prefix)).toEqual(['objects/', 'objects/', 'other/']);
    expect(listInputs[0]?.MaxKeys).toBe(100);
    expect(listInputs[1]?.MaxKeys).toBe(1);
    const deletion = send.mock.calls.find(
      ([command]) => command instanceof DeleteObjectsCommand,
    )?.[0];
    expect(deletion).toBeInstanceOf(DeleteObjectsCommand);
    expect((deletion as DeleteObjectsCommand).input.Delete?.Objects).toEqual([
      { Key: 'objects/r2' },
    ]);
  });
});
