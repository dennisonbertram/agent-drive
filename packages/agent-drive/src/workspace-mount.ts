import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import type { MountResponse } from './mount.js';
import { runLinuxMountBridge, type LinuxMountExit } from './mount.js';
import { startMacMount } from './mount-mac.js';

const WORKSPACE_DOMAIN_NAMESPACE = 'agent-drive-workspace-mount/v1';
const WORKSPACE_READ_OPS = new Set(['capabilities', 'stat', 'list', 'read']);

export type WorkspaceMountDispatch = (request: unknown, signal?: AbortSignal) => Promise<unknown>;

export type WorkspaceMountPlatform = 'macos' | 'linux';

export type WorkspaceMountExit = { code: number | null; signal: NodeJS.Signals | null };

export type WorkspaceMountHandle = {
  platform: WorkspaceMountPlatform;
  workspaceId: string;
  /** The stable File Provider domain suffix; macOS mounts only. */
  domainId: string | undefined;
  actualPath: string;
  requestedPath: string;
  waitForExit(): Promise<WorkspaceMountExit>;
  close(): Promise<void>;
};

export type WorkspaceMountOptions = {
  /** Stable identifier for the selected workspace (account, sandbox and root). */
  workspaceId: string;
  mountPoint: string;
  dispatch: WorkspaceMountDispatch;
  readOnly?: boolean;
  signal?: AbortSignal;
  /** Overrides the native mount helper; Linux mounts only. */
  helperPath?: string;
  /** Defaults to `process.platform`; exists so embedders can pick a backend explicitly. */
  platform?: NodeJS.Platform;
};

function validWorkspaceId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.includes('\0')
  );
}

/**
 * Derives the stable File Provider domain identity for a workspace. The
 * domain is a deterministic RFC 9562 version-8 UUID over the workspace
 * identity, never over its display name, so reconnects reattach to the same
 * domain and connected agents mounting distinct workspaces coexist.
 */
export function workspaceMountDomainId(workspaceId: string): string {
  if (!validWorkspaceId(workspaceId)) throw new Error('Invalid workspace id.');
  const digest = createHash('sha256')
    .update(WORKSPACE_DOMAIN_NAMESPACE)
    .update('\0')
    .update(workspaceId, 'utf8')
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function workspaceReadOnlyDispatch(dispatch: WorkspaceMountDispatch): WorkspaceMountDispatch {
  return async (request, signal) => {
    const record = request as Record<string, unknown> | null | undefined;
    const op = record && typeof record.op === 'string' ? record.op : undefined;
    const id =
      record && (typeof record.id === 'string' || typeof record.id === 'number') ? record.id : '';
    if (op !== undefined && !WORKSPACE_READ_OPS.has(op)) return { id, ok: false, errno: 'EROFS' };
    const response = await dispatch(request, signal);
    if (op !== 'capabilities') return response;
    const envelope = response as Record<string, unknown> | null | undefined;
    const capabilities = envelope?.capabilities as Record<string, unknown> | null | undefined;
    if (!envelope || envelope.ok !== true || !capabilities || typeof capabilities !== 'object')
      return response;
    const ops = Array.isArray(capabilities.ops)
      ? capabilities.ops.filter(
          (value): value is string => typeof value === 'string' && WORKSPACE_READ_OPS.has(value),
        )
      : [];
    return {
      ...envelope,
      capabilities: {
        ...capabilities,
        readOnly: true,
        write: false,
        delete: false,
        writePaths: [],
        ops,
      },
    };
  };
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('The workspace mount signal is already aborted.');
}

async function startMacWorkspaceMount(
  options: WorkspaceMountOptions,
  dispatch: WorkspaceMountDispatch,
): Promise<WorkspaceMountHandle> {
  const domainId = workspaceMountDomainId(options.workspaceId);
  const mount = await startMacMount({
    driveId: domainId,
    requestedMountpoint: options.mountPoint,
    dispatch,
  });
  const onAbort = () => {
    void mount.close();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const detach = () => options.signal?.removeEventListener('abort', onAbort);
  let closePromise: Promise<void> | undefined;
  return {
    platform: 'macos',
    workspaceId: options.workspaceId,
    domainId,
    actualPath: mount.actualPath,
    requestedPath: mount.requestedPath,
    waitForExit: async () => {
      const exit = await mount.waitForExit();
      detach();
      return exit;
    },
    close: async () => {
      detach();
      closePromise ??= mount.close();
      await closePromise;
    },
  };
}

async function startLinuxWorkspaceMount(
  options: WorkspaceMountOptions,
  dispatch: WorkspaceMountDispatch,
): Promise<WorkspaceMountHandle> {
  const requestedPath = resolve(options.mountPoint);
  const lifecycle = new AbortController();
  const onAbort = () => {
    if (!lifecycle.signal.aborted) lifecycle.abort(options.signal?.reason);
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const detach = () => options.signal?.removeEventListener('abort', onAbort);
  type LinuxCompletion = { exit: LinuxMountExit | undefined } | { error: unknown };
  const completion: Promise<LinuxCompletion> = runLinuxMountBridge(
    requestedPath,
    () => ({
      request: async (input: unknown, requestSignal?: AbortSignal) =>
        (await dispatch(input, requestSignal)) as MountResponse,
    }),
    {
      ...(options.helperPath !== undefined ? { helperPath: options.helperPath } : {}),
      signal: lifecycle.signal,
      ...(options.readOnly === true ? {} : { readWrite: true }),
    },
  ).then(
    (exit) => ({ exit }),
    (error: unknown) => ({ error }),
  );
  const finish = () => {
    detach();
    return completion;
  };
  return {
    platform: 'linux',
    workspaceId: options.workspaceId,
    domainId: undefined,
    actualPath: requestedPath,
    requestedPath,
    waitForExit: async () => {
      const result = await finish();
      if ('error' in result) throw result.error;
      return result.exit ?? { code: null, signal: null };
    },
    close: async () => {
      if (!lifecycle.signal.aborted) lifecycle.abort(new Error('Workspace mount closed.'));
      await finish();
    },
  };
}

/**
 * Mounts an explicitly selected live workspace filesystem through the
 * provided dispatch. macOS uses the Finder File Provider domain derived from
 * the workspace identity; Linux uses the native helper lifecycle shared with
 * `runLinuxMount`. Aborting `signal` (or `close()`) unmounts gracefully.
 */
export async function startWorkspaceMount(
  options: WorkspaceMountOptions,
): Promise<WorkspaceMountHandle> {
  if (!validWorkspaceId(options?.workspaceId)) throw new Error('Invalid workspace id.');
  if (!isAbsolute(options.mountPoint)) throw new Error('Workspace mountpoint must be absolute.');
  if (typeof options.dispatch !== 'function')
    throw new Error('A workspace mount dispatch is required.');
  if (options.signal?.aborted) throw abortReason(options.signal);
  const dispatch =
    options.readOnly === true ? workspaceReadOnlyDispatch(options.dispatch) : options.dispatch;
  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') return await startMacWorkspaceMount(options, dispatch);
  if (platform === 'linux') return await startLinuxWorkspaceMount(options, dispatch);
  throw new Error(`Workspace mounts are unavailable on ${String(platform)}.`);
}
