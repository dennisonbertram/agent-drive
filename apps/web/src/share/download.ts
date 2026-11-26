const DOWNLOAD_PREFIX = 'agent-drive-download-';
const SCRATCH_MARKER = 'agent-drive-download-scratch';
const SCRATCH_MARKER_LOCK = 'agent-drive-scratch-marker';
const SMALL_DOWNLOAD_LIMIT = 32 * 1024 * 1024;
const OPFS_DOWNLOAD_RETENTION_MS = 15 * 60 * 1000;

type SaveWritable = {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
};

type SaveFileHandle = { createWritable?: () => Promise<SaveWritable> };
type SavePicker = (options: { suggestedName: string }) => Promise<SaveFileHandle>;
type DownloadDirectory = {
  getFileHandle(
    name: string,
    options: { create: true },
  ): Promise<SaveFileHandle & { getFile(): Promise<File> }>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterable<[string, unknown]>;
};

type NavigatorWithFiles = Omit<Navigator, 'storage'> & {
  storage?: { getDirectory?: () => Promise<DownloadDirectory> };
  locks?: {
    request<T>(
      name: string,
      options: { ifAvailable: true },
      callback: (lock: object | null) => Promise<T>,
    ): Promise<T>;
    request<T>(name: string, callback: () => Promise<T>): Promise<T>;
  };
};

type WindowWithSavePicker = Window & { showSaveFilePicker?: SavePicker };

export class DownloadSaveError extends Error {
  constructor(readonly code: 'unsupported-large-download' | 'save-gesture-required' | 'aborted') {
    super(
      code === 'unsupported-large-download'
        ? 'This browser does not offer a disk-backed save option for a large file. Continue using browser memory or use the Agent Drive CLI.'
        : code === 'save-gesture-required'
          ? 'Choose Save again to open the browser file picker.'
          : 'The download was canceled.',
    );
  }
}

export interface DownloadSink {
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

function clickDownload(url: string, name: string, revokeAfterMs = 60_000) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.click();
  // The download manager may still be reading the object URL after the click.
  setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs);
}

function withLock<T>(
  name: string,
  callback: (lock: object | null) => Promise<T>,
  ifAvailable = false,
) {
  const locks = (navigator as unknown as NavigatorWithFiles).locks;
  if (!locks) return Promise.resolve().then(() => callback({}));
  return ifAvailable
    ? locks.request(name, { ifAvailable: true }, callback)
    : locks.request(name, callback);
}

function isWritable(value: unknown): value is SaveWritable {
  if (!value || typeof value !== 'object') return false;
  const writable = value as Partial<SaveWritable>;
  return (
    typeof writable.write === 'function' &&
    typeof writable.close === 'function' &&
    typeof writable.abort === 'function'
  );
}

function isDownloadDirectory(value: unknown): value is DownloadDirectory {
  if (!value || typeof value !== 'object') return false;
  const directory = value as Partial<DownloadDirectory>;
  return (
    typeof directory.getFileHandle === 'function' &&
    typeof directory.removeEntry === 'function' &&
    typeof directory.entries === 'function'
  );
}

function scratchDirectory() {
  const nav = navigator as unknown as NavigatorWithFiles;
  return nav.storage?.getDirectory;
}

async function removeScratch(directory: DownloadDirectory, name: string) {
  try {
    await directory.removeEntry(name);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return;
    throw error;
  }
}

/** Delete abandoned scratch files without touching files another tab is writing. */
export async function cleanupDownloadScratch() {
  const nav = navigator as unknown as NavigatorWithFiles;
  const getDirectory = scratchDirectory();
  if (typeof getDirectory !== 'function' || typeof nav.locks?.request !== 'function') return;
  await withLock(SCRATCH_MARKER_LOCK, async () => {
    try {
      if (localStorage.getItem(SCRATCH_MARKER) !== '1') return;
    } catch {
      // Private browsing can block localStorage; continue the cleanup without the hint.
    }
    let directory: DownloadDirectory;
    try {
      const candidate = await getDirectory.call(nav.storage);
      if (!isDownloadDirectory(candidate)) return;
      directory = candidate;
    } catch {
      return;
    }
    let scratchMayRemain = false;
    try {
      for await (const [name] of directory.entries()) {
        if (!name.startsWith(DOWNLOAD_PREFIX)) continue;
        const removed = await withLock(
          `agent-drive-scratch:${name}`,
          async (lock) => {
            if (!lock) return false;
            try {
              await removeScratch(directory, name);
              return true;
            } catch {
              return false;
            }
          },
          true,
        ).catch(() => false);
        if (!removed) scratchMayRemain = true;
      }
    } catch {
      scratchMayRemain = true;
    }
    try {
      if (scratchMayRemain) localStorage.setItem(SCRATCH_MARKER, '1');
      else localStorage.removeItem(SCRATCH_MARKER);
    } catch {
      // Cleanup remains safe if the browser disallows storage for the marker.
    }
  }).catch(() => undefined);
}

/**
 * Use OPFS as a temporary, disk-backed staging file for large downloads. A File snapshot is
 * created only after all chunks authenticate. Browsers may keep reading it after the download
 * starts, so it is removed after 15 minutes or during a later console/share visit. Small files
 * keep the existing one-click Blob download, bounded to 32 MiB.
 */
export async function createDownloadSink(
  name: string,
  expectedBytes: number,
  options: { allowLargeBlob?: boolean } = {},
): Promise<DownloadSink> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)
    throw new Error('The file size is invalid. Reload the file list and try again.');

  const small = expectedBytes <= SMALL_DOWNLOAD_LIMIT;
  const browser = window as WindowWithSavePicker;
  const nav = navigator as unknown as NavigatorWithFiles;
  const getDirectory = scratchDirectory();
  const canUseOpfs = Boolean(typeof getDirectory === 'function' && nav.locks?.request);
  const useMemory = !small && options.allowLargeBlob === true;

  if (!small && !useMemory && typeof browser.showSaveFilePicker === 'function') {
    try {
      const handle = await browser.showSaveFilePicker({ suggestedName: name });
      if (typeof handle?.createWritable === 'function') {
        const writable = await handle.createWritable();
        if (isWritable(writable)) return fileSink(writable, expectedBytes);
      }
      if (!canUseOpfs) throw new DownloadSaveError('unsupported-large-download');
    } catch (error) {
      if (error instanceof DownloadSaveError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError')
        throw new DownloadSaveError('aborted');
      // A picker can lose transient activation after an account-key unlock. Continue with
      // the origin-private staged file when it is available; that path needs no picker gesture.
      if (!canUseOpfs) {
        if (error instanceof DOMException && error.name === 'SecurityError')
          throw new DownloadSaveError('save-gesture-required');
        throw error;
      }
      if (error instanceof DOMException && error.name !== 'SecurityError') throw error;
    }
  }

  if (!small && !useMemory && !canUseOpfs)
    throw new DownloadSaveError('unsupported-large-download');

  if (!small && !useMemory && canUseOpfs) {
    await cleanupDownloadScratch();
    let directory: DownloadDirectory;
    try {
      const candidate = await getDirectory!.call(nav.storage);
      if (!isDownloadDirectory(candidate))
        throw new DownloadSaveError('unsupported-large-download');
      directory = candidate;
    } catch {
      throw new DownloadSaveError('unsupported-large-download');
    }
    const fileName = `${DOWNLOAD_PREFIX}${Date.now()}-${crypto.randomUUID()}.tmp`;
    let release!: () => void;
    let acquired!: () => void;
    const acquiredLock = new Promise<void>((resolve) => (acquired = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    let lockFailure: unknown;
    let handle: Awaited<ReturnType<DownloadDirectory['getFileHandle']>> | undefined;
    let writable: SaveWritable | undefined;
    let lockRequest!: Promise<unknown>;
    try {
      await withLock(SCRATCH_MARKER_LOCK, async () => {
        try {
          localStorage.setItem(SCRATCH_MARKER, '1');
        } catch {
          // The scheduled cleanup and scratch-prefix sweep still run without the hint.
        }
        lockRequest = withLock(`agent-drive-scratch:${fileName}`, async (lock) => {
          if (!lock) throw new Error('A temporary download file could not be reserved.');
          acquired();
          await held;
        }).catch((error: unknown) => {
          lockFailure = error;
          acquired();
        });
        await acquiredLock;
        if (lockFailure) throw lockFailure;
        handle = await directory.getFileHandle(fileName, { create: true });
        if (typeof handle?.createWritable !== 'function')
          throw new DownloadSaveError('unsupported-large-download');
        const candidate = await handle.createWritable();
        if (!isWritable(candidate)) throw new DownloadSaveError('unsupported-large-download');
        writable = candidate;
      });
    } catch (error) {
      await removeScratch(directory, fileName).catch(() => undefined);
      release();
      await lockRequest?.catch(() => undefined);
      throw error;
    }

    let written = 0;
    let settled = false;
    const cleanup = async (abortWriter: boolean, reason?: unknown) => {
      if (settled) return;
      settled = true;
      try {
        if (abortWriter) await writable?.abort(reason).catch(() => undefined);
        await removeScratch(directory, fileName);
      } finally {
        release();
        await lockRequest.catch(() => undefined);
      }
    };
    return {
      async write(chunk) {
        if (settled) throw new Error('The download is no longer active.');
        if (written + chunk.byteLength > expectedBytes) {
          chunk.fill(0);
          throw new Error('The downloaded file was larger than its version metadata.');
        }
        try {
          await writable!.write(chunk);
          written += chunk.byteLength;
        } finally {
          chunk.fill(0);
        }
      },
      async finish() {
        if (written !== expectedBytes) throw new Error('The downloaded file was incomplete.');
        try {
          await writable!.close();
          const snapshot = await handle!.getFile();
          const url = URL.createObjectURL(snapshot);
          settled = true;
          clickDownload(url, name, OPFS_DOWNLOAD_RETENTION_MS);
          setTimeout(() => {
            void removeScratch(directory, fileName)
              .catch(() => undefined)
              .finally(() => {
                release();
                void lockRequest;
              });
          }, OPFS_DOWNLOAD_RETENTION_MS);
        } catch (error) {
          await cleanup(true, error);
          throw error;
        }
      },
      abort: (reason) => cleanup(true, reason),
    };
  }

  const chunks: Uint8Array[] = [];
  let written = 0;
  let settled = false;
  return {
    async write(chunk) {
      if (settled) throw new Error('The download is no longer active.');
      if (
        written + chunk.byteLength > expectedBytes ||
        (!options.allowLargeBlob && written + chunk.byteLength > SMALL_DOWNLOAD_LIMIT)
      ) {
        chunk.fill(0);
        throw new Error('The downloaded file exceeded the browser memory limit.');
      }
      chunks.push(chunk.slice());
      written += chunk.byteLength;
      chunk.fill(0);
    },
    async finish() {
      if (written !== expectedBytes) throw new Error('The downloaded file was incomplete.');
      const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
      settled = true;
      clickDownload(URL.createObjectURL(blob), name);
    },
    async abort() {
      settled = true;
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
    },
  };
}

function fileSink(writable: SaveWritable, expectedBytes: number): DownloadSink {
  let written = 0;
  let settled = false;
  return {
    async write(chunk) {
      if (settled) throw new Error('The download is no longer active.');
      if (written + chunk.byteLength > expectedBytes)
        throw new Error('The downloaded file was too large.');
      try {
        await writable.write(chunk);
        written += chunk.byteLength;
      } finally {
        chunk.fill(0);
      }
    },
    async finish() {
      if (written !== expectedBytes) throw new Error('The downloaded file was incomplete.');
      await writable.close();
      settled = true;
    },
    async abort(reason) {
      if (settled) return;
      settled = true;
      await writable.abort(reason).catch(() => undefined);
    },
  };
}
