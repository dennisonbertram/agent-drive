import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inspectWorkspaceMountReadiness,
  linuxMountInfoHasAgentDriveMount,
  waitForWorkspaceMountReadiness,
} from './workspace-service-readiness.js';

const roots: string[] = [];
async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-readiness-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('workspace mount readiness', () => {
  it('requires the exact Linux FUSE mountpoint and source', () => {
    const expected = '/tmp/work space';
    const valid = '41 25 0:36 / /tmp/work\\040space rw,nosuid - fuse.agent-drive agent-drive rw\n';
    expect(linuxMountInfoHasAgentDriveMount(expected, valid)).toBe(true);
    expect(
      linuxMountInfoHasAgentDriveMount(
        expected,
        `${valid}42 25 0:37 / /tmp/work\\040space-old rw - fuse.agent-drive agent-drive rw\n`,
      ),
    ).toBe(true);
    expect(
      linuxMountInfoHasAgentDriveMount(
        expected,
        '41 25 0:36 / /tmp/work\\040space rw - tmpfs tmpfs rw\n',
      ),
    ).toBe(false);
  });

  it('accepts only a Finder alias to the expected domain path under CloudStorage', async () => {
    const home = await temporaryRoot();
    const cloudStorage = join(home, 'Library', 'CloudStorage');
    const actualPath = join(cloudStorage, 'Agent Drive abcdef01');
    const mountpoint = join(home, 'Workspaces', 'coordinator');
    await mkdir(actualPath, { recursive: true });
    await mkdir(join(home, 'Workspaces'), { recursive: true });
    await symlink(actualPath, mountpoint);

    const ready = await inspectWorkspaceMountReadiness({
      platform: 'darwin',
      mountpoint,
      expectedDomainId: 'abcdef01-2345-4234-9234-abcdef012345',
      io: { home },
    });
    expect(ready).toMatchObject({
      ready: true,
      actualPath,
      evidence: 'file-provider-domain-alias',
    });

    await rm(mountpoint);
    await symlink(join(cloudStorage, 'AgentDrive-AgentDrivedeadbeef'), mountpoint);
    await mkdir(join(cloudStorage, 'AgentDrive-AgentDrivedeadbeef'));
    expect(
      await inspectWorkspaceMountReadiness({
        platform: 'darwin',
        mountpoint,
        expectedDomainId: 'abcdef01-2345-4234-9234-abcdef012345',
        io: { home },
      }),
    ).toMatchObject({ ready: false });
  });

  it('accepts the File Provider Finder URL alias for the selected domain', async () => {
    const home = await temporaryRoot();
    const cloudStorage = join(home, 'Library', 'CloudStorage');
    const actualPath = join(cloudStorage, 'AgentDrive-AgentDriveabcdef01');
    const mountpoint = join(home, 'Workspaces', 'coordinator');
    await mkdir(actualPath, { recursive: true });
    await mkdir(join(home, 'Workspaces'), { recursive: true });
    await symlink(actualPath, mountpoint);

    await expect(
      inspectWorkspaceMountReadiness({
        platform: 'darwin',
        mountpoint,
        expectedDomainId: 'abcdef01-2345-4234-9234-abcdef012345',
        io: { home },
      }),
    ).resolves.toMatchObject({ ready: true, actualPath, evidence: 'file-provider-domain-alias' });

    await rm(mountpoint);
    const cachedPath = join(cloudStorage, 'AgentDrive-AgentDriveabcdef01 2026-11-27 12.00.00');
    await mkdir(cachedPath, { recursive: true });
    await symlink(cachedPath, mountpoint);
    await expect(
      inspectWorkspaceMountReadiness({
        platform: 'darwin',
        mountpoint,
        expectedDomainId: 'abcdef01-2345-4234-9234-abcdef012345',
        io: { home },
      }),
    ).resolves.toMatchObject({ ready: false });

    await rm(mountpoint);
    const nestedPath = join(cloudStorage, 'Cached', 'AgentDrive-AgentDriveabcdef01');
    await mkdir(nestedPath, { recursive: true });
    await symlink(nestedPath, mountpoint);
    await expect(
      inspectWorkspaceMountReadiness({
        platform: 'darwin',
        mountpoint,
        expectedDomainId: 'abcdef01-2345-4234-9234-abcdef012345',
        io: { home },
      }),
    ).resolves.toMatchObject({ ready: false });
  });

  it('waits for a local Linux mount signal and reports an attachment timeout distinctly', async () => {
    let probes = 0;
    const result = await waitForWorkspaceMountReadiness({
      platform: 'linux',
      mountpoint: '/tmp/work',
      timeoutMs: 200,
      pollIntervalMs: 1,
      io: {
        readMountInfo: async () => {
          probes += 1;
          return probes === 1
            ? ''
            : '41 25 0:36 / /tmp/work rw - fuse.agent-drive agent-drive rw\n';
        },
      },
      sleep: async () => {},
    });
    expect(result).toMatchObject({ ready: true, evidence: 'fuse-agent-drive-mountinfo' });
    expect(probes).toBe(2);

    await expect(
      waitForWorkspaceMountReadiness({
        platform: 'linux',
        mountpoint: '/tmp/work',
        timeoutMs: 3,
        pollIntervalMs: 1,
        io: { readMountInfo: async () => '' },
        sleep: async () => new Promise((resolve) => setTimeout(resolve, 1)),
      }),
    ).rejects.toThrow(/service did not attach.*No exact Agent Drive FUSE mount/u);
  });
});
