import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDownloadSink } from './download';

const LARGE_BYTES = 32 * 1024 * 1024 + 1;

afterEach(() => vi.unstubAllGlobals());

function installOpfs(directory: object) {
  const getDirectory = vi.fn(async () => directory);
  const request = vi.fn(async (_name: string, ...args: unknown[]) => {
    const callback = args.find((value) => typeof value === 'function') as
      | ((lock: object | null) => Promise<unknown>)
      | undefined;
    return callback?.({});
  });
  vi.stubGlobal('window', { showSaveFilePicker: vi.fn() });
  vi.stubGlobal('navigator', {
    storage: { getDirectory },
    locks: { request },
  });
  return { getDirectory, request };
}

describe('large download fallback', () => {
  it('uses the explicitly confirmed memory sink without retrying the picker or OPFS', async () => {
    const getDirectory = vi.fn(async () => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    const picker = vi.fn();
    vi.stubGlobal('window', { showSaveFilePicker: picker });
    vi.stubGlobal('navigator', { storage: { getDirectory }, locks: { request: vi.fn() } });

    const sink = await createDownloadSink('large.bin', LARGE_BYTES, { allowLargeBlob: true });
    const chunk = new Uint8Array([7]);
    await sink.write(chunk);
    expect(chunk[0]).toBe(0);
    expect(picker).not.toHaveBeenCalled();
    expect(getDirectory).not.toHaveBeenCalled();
    await sink.abort();
  });

  it('surfaces OPFS quota failure and removes its named scratch entry', async () => {
    const removeEntry = vi.fn(async (_name: string) => undefined);
    const directory = {
      entries: async function* () {},
      getFileHandle: vi.fn(async () => {
        throw new DOMException('Storage is full', 'QuotaExceededError');
      }),
      removeEntry,
    };
    const { getDirectory } = installOpfs(directory);

    await expect(createDownloadSink('large.bin', LARGE_BYTES)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(removeEntry).toHaveBeenCalledTimes(1);
    expect(removeEntry.mock.calls[0]?.[0]).toMatch(/^agent-drive-download-/u);
    expect(getDirectory).toHaveBeenCalledTimes(2);
  });

  it('removes the plaintext scratch entry after an OPFS write quota failure is aborted', async () => {
    const removeEntry = vi.fn(async (_name: string) => undefined);
    const writable = {
      write: vi.fn(async () => {
        throw new DOMException('Storage is full', 'QuotaExceededError');
      }),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    const directory = {
      entries: async function* () {},
      getFileHandle: vi.fn(async () => ({
        createWritable: async () => writable,
        getFile: async () => new File([], 'large.bin'),
      })),
      removeEntry,
    };
    installOpfs(directory);
    const sink = await createDownloadSink('large.bin', LARGE_BYTES);
    await expect(sink.write(new Uint8Array([7]))).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    await sink.abort();
    expect(writable.abort).toHaveBeenCalledTimes(1);
    expect(removeEntry).toHaveBeenCalledTimes(1);
  });
});
