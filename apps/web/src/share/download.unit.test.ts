import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupDownloadScratch, createDownloadSink, DownloadSaveError } from './download';

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

function installStorageAndLocks(directory: object, marker = new Map<string, string>()) {
  const getDirectory = vi.fn(async () => directory);
  const held = new Set<string>();
  const queues = new Map<string, Array<() => void>>();
  const queuedWaiters = new Map<string, Array<() => void>>();
  const release = (name: string) => {
    const next = queues.get(name)?.shift();
    if (next) next();
    else held.delete(name);
  };
  const acquire = (name: string) =>
    new Promise<(() => void) | null>((resolve) => {
      if (!held.has(name)) {
        held.add(name);
        resolve(() => release(name));
        return;
      }
      const waiters = queues.get(name) ?? [];
      waiters.push(() => resolve(() => release(name)));
      queues.set(name, waiters);
      for (const waiter of queuedWaiters.get(name) ?? []) waiter();
    });
  const request = vi.fn(async (name: string, ...args: unknown[]) => {
    const ifAvailable = typeof args[0] !== 'function';
    const callback = (ifAvailable ? args[1] : args[0]) as
      | ((lock: object | null) => Promise<unknown>)
      | undefined;
    if (!callback) return undefined;
    if (ifAvailable && held.has(name)) return callback(null);
    const unlock = await acquire(name);
    try {
      return await callback({});
    } finally {
      unlock?.();
    }
  });
  vi.stubGlobal('window', { showSaveFilePicker: undefined });
  vi.stubGlobal('navigator', { storage: { getDirectory }, locks: { request } });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => marker.get(key) ?? null,
    setItem: (key: string, value: string) => marker.set(key, value),
    removeItem: (key: string) => marker.delete(key),
  });
  return {
    getDirectory,
    marker,
    request,
    waitForQueued: (name: string) =>
      new Promise<void>((resolve) => {
        if ((queues.get(name)?.length ?? 0) > 0) {
          resolve();
          return;
        }
        const waiters = queuedWaiters.get(name) ?? [];
        waiters.push(resolve);
        queuedWaiters.set(name, waiters);
      }),
    isQueued: (name: string) => (queues.get(name)?.length ?? 0) > 0,
  };
}

describe('large download fallback', () => {
  it('does not require optional navigator.storage APIs for small Blob downloads', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {});

    const sink = await createDownloadSink('small.txt', 1);
    await sink.write(new Uint8Array([7]));
    await sink.abort();
  });

  it('turns a picker without a writable stream into an explicit fallback', async () => {
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({}) });
    vi.stubGlobal('navigator', {});

    await expect(createDownloadSink('large.bin', LARGE_BYTES)).rejects.toMatchObject({
      code: 'unsupported-large-download',
    });
  });

  it('turns a partial OPFS file handle without createWritable into an explicit fallback', async () => {
    const removeEntry = vi.fn(async (_name: string) => undefined);
    const directory = {
      entries: async function* () {},
      getFileHandle: vi.fn(async () => ({})),
      removeEntry,
    };
    installOpfs(directory);

    await expect(createDownloadSink('large.bin', LARGE_BYTES)).rejects.toMatchObject({
      code: 'unsupported-large-download',
    });
    expect(removeEntry).toHaveBeenCalledTimes(1);
  });

  it('serializes scratch scanning with writer marker creation across tabs', async () => {
    const marker = new Map([['agent-drive-download-scratch', '1']]);
    const names = new Set<string>();
    let enterScan!: () => void;
    let releaseScan!: () => void;
    const scanEntered = new Promise<void>((resolve) => (enterScan = resolve));
    const scanGate = new Promise<void>((resolve) => (releaseScan = resolve));
    let scans = 0;
    const removeEntry = vi.fn(async (name: string) => {
      names.delete(name);
    });
    const directory = {
      async *entries() {
        const snapshot = [...names];
        scans += 1;
        if (scans === 1) {
          enterScan();
          await scanGate;
        }
        for (const name of snapshot) yield [name, {}] as [string, object];
      },
      async getFileHandle(name: string) {
        names.add(name);
        return {
          createWritable: async () => ({
            write: async () => undefined,
            close: async () => undefined,
            abort: async () => undefined,
          }),
          getFile: async () => new File([], name),
        };
      },
      removeEntry,
    };
    const locks = installStorageAndLocks(directory, marker);
    const cleanup = cleanupDownloadScratch();
    try {
      await scanEntered;
      const sinkPromise = createDownloadSink('large.bin', LARGE_BYTES);
      const writerWaitedForMarker = await Promise.race([
        locks.waitForQueued('agent-drive-scratch-marker').then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      expect(writerWaitedForMarker).toBe(true);
      expect(locks.isQueued('agent-drive-scratch-marker')).toBe(true);
      releaseScan();
      await cleanup;
      const sink = await sinkPromise;
      expect(marker.get('agent-drive-download-scratch')).toBe('1');
      expect(names.size).toBe(1);
      await sink.abort();
    } finally {
      releaseScan();
      await cleanup;
    }
  });

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
