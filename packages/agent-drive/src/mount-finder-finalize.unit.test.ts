import { describe, expect, it, vi } from 'vitest';
import { createMountBridge } from './mount.js';

const DRIVE = '11111111-1111-4111-8111-111111111111';

describe('Finder final flush retirement', () => {
  it('closes a non-submitted write handle without invoking flush or release', async () => {
    const writeback = {
      openWrite: vi.fn(async () => ({
        handleId: 'staged-handle',
        recoveryPath: '/private/staged.data',
        size: 0,
      })),
      flush: vi.fn(async () => ({ id: 'unexpected', path: '/doc.txt' })),
      release: vi.fn(async () => ({})),
      closeWithoutFlush: vi.fn(async () => ({ recoveryPath: '/private/staged.data' })),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const bridge = await createMountBridge({ browse: vi.fn(), openRangeReader: vi.fn() }, DRIVE, {
      capabilities: {
        readOnly: false,
        write: true,
        delete: false,
        writePaths: [],
        maxReadBytes: 1024,
        maxWriteBytes: 1024,
        ops: ['openWrite', 'closeWrite'],
      },
      writeback: writeback as never,
    });

    try {
      const opened = await bridge.request({
        id: 'open',
        op: 'openWrite',
        path: '/doc.txt',
        baseVersionId: null,
        truncateOnOpen: true,
      });
      expect(opened).toMatchObject({ id: 'open', ok: true, handleId: 'staged-handle' });
      await expect(
        bridge.request({ id: 'close', op: 'closeWrite', handleId: 'staged-handle' }),
      ).resolves.toEqual({
        id: 'close',
        ok: true,
        recoveryPath: '/private/staged.data',
      });
      await expect(
        bridge.request({ id: 'close-again', op: 'closeWrite', handleId: 'staged-handle' }),
      ).resolves.toEqual({ id: 'close-again', ok: true });
      expect(writeback.closeWithoutFlush).toHaveBeenCalledWith('staged-handle');
      expect(writeback.closeWithoutFlush).toHaveBeenCalledTimes(1);
      expect(writeback.flush).not.toHaveBeenCalled();
      expect(writeback.release).not.toHaveBeenCalled();
    } finally {
      await bridge.close();
    }
  });
});
