import { lstat, readFile, readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

export type WorkspaceReadinessPlatform = 'darwin' | 'linux';
export type WorkspaceMountReadiness =
  | {
      ready: true;
      platform: 'linux';
      mountpoint: string;
      evidence: 'fuse-agent-drive-mountinfo';
    }
  | {
      ready: true;
      platform: 'darwin';
      mountpoint: string;
      actualPath: string;
      domainId: string;
      evidence: 'file-provider-domain-alias';
    };
export type WorkspaceMountReadinessProbe =
  | { ready: false; reason: string }
  | WorkspaceMountReadiness;

export type WorkspaceReadinessIO = {
  readMountInfo?: () => Promise<string>;
  lstat?: typeof lstat;
  readlink?: typeof readlink;
  home?: string;
};

export type WorkspaceReadinessOptions = {
  mountpoint: string;
  platform?: WorkspaceReadinessPlatform;
  /** UUID suffix used by the selected File Provider domain on macOS. */
  expectedDomainId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  io?: WorkspaceReadinessIO;
  sleep?: (durationMs: number) => Promise<void>;
};

function platformOf(platform?: WorkspaceReadinessPlatform): WorkspaceReadinessPlatform {
  const actual = platform ?? process.platform;
  if (actual !== 'darwin' && actual !== 'linux')
    throw new Error(`Workspace mount readiness is unsupported on ${actual}.`);
  return actual;
}

function decodeMountInfoPath(value: string): string {
  return value.replace(/\\([0-7]{3})/gu, (_match, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

export function linuxMountInfoHasAgentDriveMount(mountpoint: string, mountInfo: string): boolean {
  const expected = resolve(mountpoint);
  return mountInfo.split('\n').some((line) => {
    const separator = line.indexOf(' - ');
    if (separator < 0) return false;
    const mountFields = line.slice(0, separator).split(' ');
    const filesystemFields = line.slice(separator + 3).split(' ');
    return (
      decodeMountInfoPath(mountFields[4] ?? '') === expected &&
      filesystemFields[0] === 'fuse.agent-drive' &&
      filesystemFields[1] === 'agent-drive'
    );
  });
}

export async function inspectWorkspaceMountReadiness(
  options: Pick<WorkspaceReadinessOptions, 'mountpoint' | 'platform' | 'expectedDomainId'> & {
    io?: WorkspaceReadinessIO;
  },
): Promise<WorkspaceMountReadinessProbe> {
  const platform = platformOf(options.platform);
  if (!isAbsolute(options.mountpoint) || options.mountpoint.includes('\0'))
    throw new Error('Workspace mountpoint must be an absolute path.');
  const mountpoint = resolve(options.mountpoint);
  const io = options.io ?? {};
  if (platform === 'linux') {
    const mountInfo = await (
      io.readMountInfo ?? (() => readFile('/proc/self/mountinfo', 'utf8'))
    )();
    return linuxMountInfoHasAgentDriveMount(mountpoint, mountInfo)
      ? { ready: true, platform, mountpoint, evidence: 'fuse-agent-drive-mountinfo' }
      : {
          ready: false,
          reason: 'No exact Agent Drive FUSE mount is attached at the requested path.',
        };
  }

  if (!options.expectedDomainId || !/^[0-9a-f-]{36}$/iu.test(options.expectedDomainId))
    return { ready: false, reason: 'The expected File Provider domain UUID is unavailable.' };
  const ioLstat = io.lstat ?? lstat;
  const ioReadlink = io.readlink ?? readlink;
  let linkInfo;
  try {
    linkInfo = await ioLstat(mountpoint);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { ready: false, reason: 'The requested Finder alias is not present.' };
    throw error;
  }
  if (!linkInfo.isSymbolicLink())
    return { ready: false, reason: 'The requested mountpoint is not an Agent Drive Finder alias.' };
  const linkTarget = await ioReadlink(mountpoint);
  const actualPath = resolve(dirname(mountpoint), linkTarget);
  const cloudStorage = resolve(io.home ?? homedir(), 'Library', 'CloudStorage');
  const domainSuffix = options.expectedDomainId.slice(0, 8);
  // File Provider's user-visible URL can include the provider name before its
  // domain display name. Keep both accepted spellings exact and domain-bound.
  const expectedDomainNames = new Set([
    `Agent Drive ${domainSuffix}`,
    `AgentDrive-AgentDrive${domainSuffix}`,
  ]);
  if (
    dirname(actualPath) !== cloudStorage ||
    !expectedDomainNames.has(basename(actualPath))
  )
    return {
      ready: false,
      reason:
        'The Finder alias does not target the selected Agent Drive domain under CloudStorage.',
    };
  try {
    const targetInfo = await ioLstat(actualPath);
    if (!targetInfo.isDirectory())
      return { ready: false, reason: 'The selected File Provider domain path is not a directory.' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { ready: false, reason: 'The selected File Provider domain path is not present.' };
    throw error;
  }
  return {
    ready: true,
    platform,
    mountpoint,
    actualPath,
    domainId: options.expectedDomainId,
    evidence: 'file-provider-domain-alias',
  };
}

export async function waitForWorkspaceMountReadiness(
  options: WorkspaceReadinessOptions,
): Promise<WorkspaceMountReadiness> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new RangeError('Workspace readiness timeout must be a positive integer.');
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1)
    throw new RangeError('Workspace readiness poll interval must be a positive integer.');

  const deadline = Date.now() + timeoutMs;
  let lastReason = 'The mount has not been observed yet.';
  do {
    const status = await inspectWorkspaceMountReadiness(options);
    if (status.ready) return status;
    lastReason = status.reason;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await (
      options.sleep ??
      ((duration) => new Promise((resolveSleep) => setTimeout(resolveSleep, duration)))
    )(Math.min(pollIntervalMs, remaining));
  } while (Date.now() < deadline);
  throw new Error(
    `Workspace service did not attach the requested mount within ${timeoutMs} ms: ${lastReason}`,
  );
}
