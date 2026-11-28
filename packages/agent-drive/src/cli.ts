#!/usr/bin/env node
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AgentDriveClient, AgentDriveApiError, publicOutput } from './client.js';
import { decodeDriveKey, generateDriveKey } from './crypto.js';
import {
  apiErrorLines,
  backupState,
  createdDriveNote,
  keySourceLabel,
  localKeyMap,
  notBackedUpMessage,
  pickCheckDrive,
  runCheck,
} from './check.js';
import {
  BACKUP_HINT,
  confirmCredentials,
  exportCredentials,
  importCredentials,
  issueCredentials,
  loadConfig,
  reportEnvBackups,
  reportKeyBackup,
} from './credentials.js';
import { installSkill, packagedSkillPath } from './skill.js';
import {
  configPath,
  DEFAULT_API_URL,
  driveKeyEnvironmentName,
  keysForOrigin,
  machineName,
  originOf,
  readConfig,
  resolveLoginApiUrl,
  resolveDriveId,
  resolveConnection,
  resolveDriveKey,
  writeConfig,
  type AgentDriveConfig,
} from './config.js';
import {
  autoSealHeldKeys,
  clearAgentOnlyIntent,
  expectedAccountFingerprint,
  heldSealTargets,
  pendingAgentOnlyNames,
  PIN_REQUIRED_HINT,
  recordAgentOnlyDrive,
  recordAgentOnlyIntent,
  sealClientWithDeadline,
  sealDrivesToAccount,
  UNKNOWN_TYPE_HINT,
  UNVERIFIED_HINT,
} from './account-seal.js';
import { SyncInterruptedError, syncDirectory } from './sync.js';
import { backupDirectory } from './backup.js';
import { CLIPBOARD_CLEAR_SECONDS } from './backup-targets.js';
import { defaultAgentName, deviceLogin, grantLogin, shouldOpenBrowser } from './device.js';
import { getFile, putFile } from './node-transfer.js';
import { getPipe, parsePipeSize, putPipe } from './cli-pipes.js';
import { consoleFolderUrl } from './console-link.js';

// Resolves to the package root from both src/ and dist/.
const { version: cliVersion } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

function parse(raw: string[]) {
  return parseArgs({
    args: raw,
    options: {
      api: { type: 'string' },
      'token-stdin': { type: 'boolean' },
      name: { type: 'string' },
      wait: { type: 'string' },
      drive: { type: 'string', multiple: true },
      agent: { type: 'string' },
      scope: { type: 'string', multiple: true },
      'write-path': { type: 'string', multiple: true },
      label: { type: 'string' },
      quota: { type: 'string' },
      'key-file': { type: 'string' },
      output: { type: 'string' },
      size: { type: 'string' },
      'if-version': { type: 'string' },
      overwrite: { type: 'boolean' },
      'overwrite-existing': { type: 'boolean' },
      prefix: { type: 'string' },
      folder: { type: 'string' },
      sort: { type: 'string' },
      description: { type: 'string' },
      user: { type: 'string' },
      machine: { type: 'string' },
      tag: { type: 'string', multiple: true },
      query: { type: 'string' },
      since: { type: 'string' },
      limit: { type: 'string' },
      cursor: { type: 'string' },
      version: { type: 'string' },
      'expires-in': { type: 'string' },
      'no-browser': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      exclude: { type: 'string', multiple: true },
      gitignore: { type: 'boolean' },
      yes: { type: 'boolean' },
      to: { type: 'string' },
      from: { type: 'string' },
      force: { type: 'boolean' },
      vault: { type: 'string' },
      'keep-clipboard': { type: 'boolean' },
      stdout: { type: 'boolean' },
      'read-only': { type: 'boolean' },
      method: { type: 'string' },
      target: { type: 'string' },
      'agent-only': { type: 'boolean' },
      repin: { type: 'boolean' },
      verify: { type: 'string' },
      fingerprint: { type: 'string' },
      once: { type: 'boolean' },
      sandbox: { type: 'string' },
      root: { type: 'string' },
      'wake-on-access': { type: 'boolean' },
      'no-wake-on-access': { type: 'boolean' },
      persist: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });
}

function output(value: unknown) {
  process.stdout.write(`${JSON.stringify(publicOutput(value))}\n`);
}

const STALE_BACKUP_NOTE =
  'The API key changed, so earlier credential backups are out of date. Run `agent-drive credentials export` again.\n';

/** Resolves once stdout has accepted the text; rejects on EPIPE or any write error. */
function writeStdout(text: string) {
  return new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error);
    process.stdout.once('error', fail);
    process.stdout.write(text, (error) => {
      process.stdout.off('error', fail);
      if (error) reject(error);
      else resolve();
    });
  });
}

async function stdinText() {
  return await new Promise<string>((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (value += chunk));
    process.stdin.on('end', () => resolve(value.trim()));
    process.stdin.on('error', reject);
  });
}

// Automatic sealing runs in the background with its own deadline-bounded client so it can never
// delay or fail the command it piggybacks on. Commands only SCHEDULE seal work here; `done`
// starts it after the command's output has been written and then waits on it so tests can
// observe it.
const pendingSeals = new Set<Promise<void>>();
const scheduledSeals: Array<() => Promise<void>> = [];

function sealInBackground(work: () => Promise<void>) {
  const task = Promise.resolve()
    .then(work)
    .catch(() => {})
    .finally(() => pendingSeals.delete(task));
  pendingSeals.add(task);
}

/** Deadline-bounded sealing hook shared by connect/backup/create/key-change paths. */
function sealHook(
  connection: { apiUrl: string; apiKey: string; config: AgentDriveConfig },
  opts: {
    driveIds?: string[];
    force?: boolean;
    selectedDriveId?: string;
    keyFile?: string;
    keys?: Record<string, string>;
  },
) {
  scheduledSeals.push(async () => {
    const seal = sealClientWithDeadline(connection.apiUrl, connection.apiKey, machineName());
    await autoSealHeldKeys({
      client: seal.client,
      config: connection.config,
      ...opts,
      deadline: seal.deadline,
      deadlineAt: seal.deadlineAt,
      warn: (line) => process.stderr.write(`${line}\n`),
    });
  });
}

async function connect(
  args: ReturnType<typeof parse>,
  options: { requireDriveKey?: boolean } = {},
) {
  const connection = await resolveConnection(args.values.api);
  await reportEnvBackups(connection.apiUrl, connection.apiKey);
  // Kept apart from args.values.drive: `check` has its own selection when --drive is omitted.
  try {
    defaultDrive = resolveDriveId(undefined, connection.config, connection.apiUrl);
  } catch (error) {
    missingDrive = error instanceof Error ? error.message : undefined;
  }
  const drive = args.values.drive?.[0] ?? defaultDrive;
  const driveKey = drive
    ? await resolveDriveKey(drive, connection.apiUrl, args.values['key-file'], connection.config)
    : undefined;
  if (options.requireDriveKey && drive) decodeDriveKey(driveKey);
  const client = new AgentDriveClient({
    apiUrl: connection.apiUrl,
    apiKey: connection.apiKey,
    machine: machineName(),
    ...(driveKey ? { driveKey } : {}),
  });
  // Throttled (24h/drive) account-key sealing on any command that loads a drive key. The exact
  // key the command resolved goes with it, so sealing never falls back to a different stored key.
  if (driveKey && drive)
    sealHook(connection, {
      selectedDriveId: drive,
      keys: { [drive]: driveKey },
      ...(args.values['key-file'] ? { keyFile: args.values['key-file'] } : {}),
    });
  // Callers that seal later work (drive create) must reuse this exact connection: resolving
  // again could seal through an account or origin that changed since the command connected.
  return { client, connection };
}

// Set by connect() when no --drive was given and no single default exists.
let missingDrive: string | undefined;
let defaultDrive: string | undefined;

/** Forced account-key seal after login/grant/import put drive keys on this machine. */
function sealAfterKeyChange(connection: Awaited<ReturnType<typeof resolveConnection>>) {
  scheduledSeals.push(async () => {
    const seal = sealClientWithDeadline(connection.apiUrl, connection.apiKey, machineName());
    await autoSealHeldKeys({
      client: seal.client,
      config: connection.config,
      force: true,
      deadline: seal.deadline,
      deadlineAt: seal.deadlineAt,
      warn: (line) => process.stderr.write(`${line}\n`),
    });
  });
}

async function sealSavedConnectionAfterKeyChange() {
  const saved = await readConfig();
  if (!saved.apiUrl || !saved.apiKey) return;
  let config = saved;
  try {
    // Keep the imported/saved connection as the seal client, but include valid in-scope
    // environment-bundle keys using the same origin-aware merge as ordinary config loads.
    config = await loadConfig(saved.apiUrl, saved.apiKey);
  } catch {
    // A malformed or unrelated environment bundle must not turn a successful import into a
    // command failure. The saved keys remain safe to seal with their saved connection.
  }
  sealAfterKeyChange({ apiUrl: saved.apiUrl, apiKey: saved.apiKey, config });
}

function requiredDrive(args: ReturnType<typeof parse>) {
  const id = args.values.drive?.[0] ?? defaultDrive;
  if (!id) throw new Error(missingDrive ?? 'A --drive ID is required.');
  return id;
}

function limit(value: string | undefined) {
  return value === undefined ? undefined : Number(value);
}

function validateJobOptions(args: ReturnType<typeof parse>, allowed: readonly string[]) {
  const unknown = Object.keys(args.values).filter((name) => !allowed.includes(name));
  if (unknown.length)
    throw new Error(
      `Unsupported jobs option${unknown.length === 1 ? '' : 's'}: ${unknown.map((name) => `--${name}`).join(', ')}.`,
    );
  if ((args.values.drive?.length ?? 0) > 1) throw new Error('Pass only one --drive ID.');
}

function validateMountsOptions(args: ReturnType<typeof parse>, allowed: readonly string[]) {
  const unknown = Object.keys(args.values).filter((name) => !allowed.includes(name));
  if (unknown.length)
    throw new Error(
      `Unsupported mounts option${unknown.length === 1 ? '' : 's'}: ${unknown.map((name) => `--${name}`).join(', ')}.`,
    );
  if ((args.values.drive?.length ?? 0) > 1) throw new Error('Pass only one --drive ID.');
}

function validateConnectOptions(args: ReturnType<typeof parse>) {
  const allowed = new Set([
    'sandbox',
    'root',
    'read-only',
    'wake-on-access',
    'no-wake-on-access',
    'persist',
  ]);
  const unknown = Object.keys(args.values).filter((name) => !allowed.has(name));
  if (unknown.length)
    throw new Error(
      `Unsupported connect option${unknown.length === 1 ? '' : 's'}: ${unknown.map((name) => `--${name}`).join(', ')}.`,
    );
}

type LiveWorkspaceProviderHandle = {
  dispatch(request: unknown, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
};

type LiveWorkspaceMountHandle = {
  waitForExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  close(): Promise<void>;
};

async function runLiveWorkspaceMount(
  entry: import('./mount-registry.js').LiveWorkspaceRegistryEntry,
  readOnly: boolean,
) {
  const controller = new AbortController();
  let interruptedBy: 'SIGINT' | 'SIGTERM' | undefined;
  let closeMount: (() => Promise<void>) | undefined;
  const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
    if (interruptedBy) {
      process.exit(signal === 'SIGINT' ? 130 : 143);
      return;
    }
    interruptedBy = signal;
    controller.abort(signal);
    void closeMount?.();
  };
  const onSigint = () => onSignal('SIGINT');
  const onSigterm = () => onSignal('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  let provider: LiveWorkspaceProviderHandle | undefined;
  let mount: LiveWorkspaceMountHandle | undefined;
  try {
    const { createLiveWorkspaceProvider } = await import('./live-workspace.js');
    const { startWorkspaceMount } = await import('./workspace-mount.js');
    const waker = (await import('./workspace-wake.js')).createInstaboxWorkspaceWaker({
      registeredMachineIds: [entry.sandboxId],
      ...(process.env.AGENT_DRIVE_INSTABOX_CLI
        ? { cliPath: process.env.AGENT_DRIVE_INSTABOX_CLI }
        : {}),
    });
    const beforeIO = async (machineId: string, signal?: AbortSignal) => {
      await waker.ensureAvailable(machineId, {
        wakeOnAccess: entry.wakeOnAccess,
        ...(signal ? { signal } : {}),
      });
    };
    provider = await createLiveWorkspaceProvider({
      sandboxId: entry.sandboxId,
      root: entry.root,
      readOnly,
      beforeIO,
    });
    if (!controller.signal.aborted) {
      mount = await startWorkspaceMount({
        workspaceId: JSON.stringify([entry.sandboxId, entry.root]),
        mountPoint: entry.mountpoint,
        readOnly,
        signal: controller.signal,
        dispatch: (request, signal) => provider!.dispatch(request, signal),
      });
      closeMount = () => mount!.close();
      if (controller.signal.aborted) await closeMount();
      const exit = await mount.waitForExit();
      if (!interruptedBy && (exit.code !== 0 || exit.signal !== null))
        throw new Error(
          `Workspace mount helper exited (${exit.signal ?? exit.code ?? 'unknown'}).`,
        );
    }
  } finally {
    try {
      await closeMount?.();
    } finally {
      try {
        await provider?.close();
      } finally {
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
        if (interruptedBy) process.exitCode = interruptedBy === 'SIGINT' ? 130 : 143;
      }
    }
  }
}

async function installAndWaitForWorkspaceService(
  name: string,
  entry: import('./mount-registry.js').MountRegistryEntry,
) {
  const service = await import('./workspace-service.js');
  const options = {
    name,
    cliPath: fileURLToPath(import.meta.url),
    configPath: configPath(),
    ...(entry.kind === 'live-workspace'
      ? { instaboxPath: await service.resolveInstaboxExecutable() }
      : {}),
  };
  const installed = await service.installWorkspaceService(options);
  let runtime = await service.getWorkspaceServiceRuntimeStatus(options);
  if (runtime.state !== 'installed')
    throw new Error(`Workspace service '${name}' was not installed successfully.`);
  if (installed.updated && runtime.active) await service.restartWorkspaceService(options);
  runtime = await service.getWorkspaceServiceRuntimeStatus(options);
  if (runtime.state === 'installed' && !runtime.active)
    await service.activateWorkspaceService(options);
  runtime = await service.getWorkspaceServiceRuntimeStatus(options);
  if (runtime.state !== 'installed' || !runtime.active)
    throw new Error(`Workspace service '${name}' did not become active.`);

  const { waitForWorkspaceMountReadiness } = await import('./workspace-service-readiness.js');
  const readinessOptions = {
    mountpoint: entry.mountpoint,
    expectedDomainId:
      entry.kind === 'live-workspace'
        ? (await import('./workspace-mount.js')).workspaceMountDomainId(
            JSON.stringify([entry.sandboxId, entry.root]),
          )
        : entry.driveId,
  };
  await waitForWorkspaceMountReadiness(readinessOptions);
  return runtime;
}

export function parseShareExpiry(value: string, now?: number): string;
export function parseShareExpiry(value: undefined, now?: number): undefined;
export function parseShareExpiry(value: string | undefined, now = Date.now()) {
  if (value === undefined) return undefined;
  const match = /^([0-9]+)(m|h|d)$/u.exec(value);
  if (!match) throw new Error('--expires-in must use a duration such as 30m, 24h, or 7d.');
  const amount = Number(match[1]);
  const multiplier = match[2] === 'm' ? 60_000 : match[2] === 'h' ? 3_600_000 : 86_400_000;
  const milliseconds = amount * multiplier;
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 2 * 60_000 ||
    milliseconds > 30 * 86_400_000
  )
    throw new Error(
      '--expires-in must be between 2m and 30d to allow for API request transit (API minimum: 60 seconds).',
    );
  return new Date(now + milliseconds).toISOString();
}

async function run(command: string, raw: string[]) {
  if (command === 'capture') {
    // The wrapped command has its own flags, so only the part before `--` is parsed here.
    const split = raw.indexOf('--');
    const flags = parse(split < 0 ? raw : raw.slice(0, split));
    const wrapped = split < 0 ? [] : raw.slice(split + 1);
    if (flags.values['token-stdin']) throw new Error('--token-stdin is only supported by `login`.');
    if (flags.values.size !== undefined) throw new Error('--size is only supported by `put -`.');
    if (flags.positionals.length || !wrapped.length)
      throw new Error('Usage: capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]');
    const { runCapture } = await import('./capture.js');
    process.exitCode = await runCapture({
      command: wrapped,
      ...(flags.values.agent ? { agent: flags.values.agent } : {}),
      ...(flags.values.drive?.[0] ? { drive: flags.values.drive[0] } : {}),
      ...(flags.values.api ? { apiUrl: flags.values.api } : {}),
    });
    return;
  }
  const args = parse(raw);
  if (command === 'jobs') {
    const mode = args.positionals[0];
    if (mode === 'work') {
      const separator = raw.indexOf('--');
      if (separator < 0)
        throw new Error('Usage: jobs work [--drive ID] [--once] -- COMMAND [ARGS...]');
      const flags = parse(raw.slice(0, separator));
      const child = raw.slice(separator + 1);
      validateJobOptions(flags, ['drive', 'api', 'key-file', 'once']);
      if (
        flags.positionals.length !== 1 ||
        flags.positionals[0] !== 'work' ||
        !child.length ||
        !child[0]?.trim()
      )
        throw new Error('Usage: jobs work [--drive ID] [--once] -- COMMAND [ARGS...]');
      const { client } = await connect(flags, { requireDriveKey: true });
      const driveId = requiredDrive(flags);
      const [{ runJobs }, { makeJobHandler }] = await Promise.all([
        import('./jobs.js'),
        import('./job-command.js'),
      ]);
      const controller = new AbortController();
      let interruptedBy: 'SIGINT' | 'SIGTERM' | undefined;
      const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
        if (interruptedBy) {
          process.exit(signal === 'SIGINT' ? 130 : 143);
          return;
        }
        interruptedBy = signal;
        controller.abort(signal);
      };
      const onSigint = () => onSignal('SIGINT');
      const onSigterm = () => onSignal('SIGTERM');
      process.on('SIGINT', onSigint);
      process.on('SIGTERM', onSigterm);
      try {
        await runJobs(client, driveId, makeJobHandler(child), {
          once: flags.values.once ?? false,
          signal: controller.signal,
        });
        if (interruptedBy) process.exitCode = interruptedBy === 'SIGINT' ? 130 : 143;
      } finally {
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
      }
      return;
    }
    if (mode === 'init') {
      validateJobOptions(args, ['drive', 'api', 'key-file']);
      if (args.positionals.length !== 1 || args.values.once)
        throw new Error('Usage: jobs init [--drive ID]');
      const { client } = await connect(args, { requireDriveKey: true });
      const driveId = requiredDrive(args);
      const { initJobs } = await import('./jobs.js');
      output(await initJobs(client, driveId));
      return;
    }
    if (mode === 'submit') {
      validateJobOptions(args, ['drive', 'api', 'key-file']);
      const id = args.positionals[1];
      if (
        args.positionals.length !== 2 ||
        !id ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(id) ||
        args.values.once
      )
        throw new Error('Usage: jobs submit ID [--drive ID]');
      const { client } = await connect(args);
      const driveId = requiredDrive(args);
      const { submitJob } = await import('./jobs.js');
      output(await submitJob(client, driveId, id));
      return;
    }
    throw new Error(
      'Usage: jobs init [--drive ID] | jobs submit ID [--drive ID] | jobs work [--drive ID] [--once] -- COMMAND [ARGS...]',
    );
  }
  if (args.values.once) throw new Error('--once is only supported by `jobs work`.');
  if (args.values['token-stdin'] && command !== 'login')
    throw new Error('--token-stdin is only supported by `login`.');
  if (
    args.values['read-only'] &&
    command !== 'mount' &&
    command !== 'grant' &&
    command !== 'mounts' &&
    command !== 'connect'
  )
    throw new Error(
      '--read-only is only supported by `mount`, `grant`, `mounts add` and `connect`.',
    );
  if (args.values.verify !== undefined && command !== 'grant')
    throw new Error('--verify is only supported by `grant`.');
  if (
    args.values.fingerprint !== undefined &&
    !(command === 'account' && args.positionals[0] === 'seal')
  )
    throw new Error('--fingerprint is only supported by `account seal`.');
  if (args.values.sandbox !== undefined && command !== 'mounts' && command !== 'connect')
    throw new Error('--sandbox is only supported by `mounts add` and `connect`.');
  if (args.values.root !== undefined && command !== 'connect')
    throw new Error('--root is only supported by `connect`.');
  if (args.values['wake-on-access'] && command !== 'connect')
    throw new Error('--wake-on-access is only supported by `connect`.');
  if (args.values.persist && command !== 'connect')
    throw new Error('--persist is only supported by `connect`.');
  if (args.values['no-wake-on-access'] && command !== 'connect')
    throw new Error('--no-wake-on-access is only supported by `connect`.');
  if (command === 'put') {
    if (args.values.overwrite && args.values['if-version'] !== undefined)
      throw new Error('--overwrite and --if-version are mutually exclusive.');
    if (args.values['if-version'] !== undefined && !args.values['if-version'].trim())
      throw new Error('--if-version must not be empty.');
  }
  if (command === 'get' && args.values.version !== undefined && !args.values.version.trim())
    throw new Error('--version must not be empty.');
  // `mount --name NAME` mounts a registry entry: its recorded drive, API context,
  // mountpoint and read-only flag apply; conflicting flags are errors, never overrides.
  let registryMount: import('./mount-registry.js').MountRegistryEntry | undefined;
  if (command === 'mount' && args.values.name !== undefined) {
    const name = args.values.name.trim();
    if (!name || args.positionals.length !== 0)
      throw new Error('Usage: mount --name NAME | mount MOUNTPOINT [--drive ID] [--read-only]');
    const { findMountEntry } = await import('./mount-registry.js');
    registryMount = await findMountEntry(name);
    if (registryMount.kind === 'live-workspace') {
      if (
        args.values.drive !== undefined ||
        args.values.api !== undefined ||
        args.values['key-file']
      )
        throw new Error(
          `Live workspace '${name}' does not use Agent Drive credentials or --drive/--api flags.`,
        );
    } else {
      if (
        args.values.drive !== undefined &&
        (args.values.drive.length !== 1 || args.values.drive[0] !== registryMount.driveId)
      )
        throw new Error(`--drive does not match the drive registered for '${name}'.`);
      if (args.values.api !== undefined && args.values.api !== registryMount.apiUrl)
        throw new Error(`--api does not match the API recorded for '${name}'.`);
      const environmentApiKey = process.env.AGENT_DRIVE_API_KEY;
      if (environmentApiKey) {
        const environmentApiUrl = process.env.AGENT_DRIVE_API_URL;
        if (!environmentApiUrl || originOf(environmentApiUrl) !== originOf(registryMount.apiUrl))
          throw new Error(
            `The environment API key has no matching origin for the API registered as '${name}'. Unset AGENT_DRIVE_API_KEY or set AGENT_DRIVE_API_URL to the registered origin.`,
          );
      }
      args.values.drive = [registryMount.driveId];
      args.values.api = registryMount.apiUrl;
    }
    args.values['read-only'] = (args.values['read-only'] ?? false) || registryMount.readOnly;
  }
  if (
    command === 'mount' &&
    registryMount === undefined &&
    (args.positionals.length !== 1 || !args.positionals[0]?.trim())
  )
    throw new Error('Usage: mount MOUNTPOINT [--drive ID] [--read-only] | mount --name NAME');
  let stdinSize: number | undefined;
  if (args.values.size !== undefined) {
    if (command !== 'put' || args.positionals[0] !== '-')
      throw new Error('--size is only supported by `put -`.');
    stdinSize = parsePipeSize(args.values.size);
  }
  // One flag set is parsed for every command, so backup-only flags parse for sync
  // too — and would be silently ignored, turning `sync --dry-run` into a real
  // upload. Reject them before connect() performs any key or network lookup.
  if (command === 'sync') {
    const backupOnly = (['dry-run', 'exclude', 'gitignore'] as const)
      .filter((name) => args.values[name] !== undefined)
      .map((name) => `--${name}`);
    if (backupOnly.length)
      throw new Error(`sync does not support ${backupOnly.join(' ')}; use backup instead.`);
  }
  if (command === 'login') {
    const apiUrl = await resolveLoginApiUrl(args.values.api);
    const apiKey =
      // An explicit --token-stdin key wins; the environment key must never be sent in its place.
      (args.values['token-stdin'] ? await stdinText() : process.env.AGENT_DRIVE_API_KEY) ?? '';
    if (!apiKey) {
      await deviceLogin({
        apiUrl,
        name: args.values.name ?? defaultAgentName(),
        machine: machineName(),
        log: (line) => process.stdout.write(`${line}\n`),
        openBrowser: shouldOpenBrowser(args.values['no-browser']),
      });
      await sealSavedConnectionAfterKeyChange();
      return;
    }
    const client = new AgentDriveClient({ apiUrl, apiKey, machine: machineName() });
    const who = await client.whoami();
    const { backupsCleared } = await writeConfig({ apiUrl, apiKey });
    if (backupsCleared) process.stderr.write(STALE_BACKUP_NOTE);
    output(who);
    return;
  }
  if (command === 'backup') {
    if (!args.positionals[0]) throw new Error('backup requires LOCAL_DIRECTORY.');
    const connection = await resolveConnection(args.values.api);
    await reportEnvBackups(connection.apiUrl, connection.apiKey);
    const driveId = resolveDriveId(args.values.drive?.[0], connection.config, connection.apiUrl);
    const key = await resolveDriveKey(
      driveId,
      connection.apiUrl,
      args.values['key-file'],
      connection.config,
    );
    const dryRun = args.values['dry-run'] ?? false;
    // Throttled account-key sealing, same as the generic connect() path (backup bypasses it).
    // A dry run previews the upload and must not seal — it neither creates nor holds anything.
    if (key && !dryRun)
      sealHook(connection, {
        selectedDriveId: driveId,
        keys: { [driveId]: key },
        ...(args.values['key-file'] ? { keyFile: args.values['key-file'] } : {}),
      });
    const backupClient = new AgentDriveClient({
      apiUrl: connection.apiUrl,
      apiKey: connection.apiKey,
      machine: machineName(),
      ...(key ? { driveKey: key } : {}),
    });
    const result = await backupDirectory(
      backupClient,
      driveId,
      args.positionals[0],
      args.values.prefix ?? `/backups/${machineName()}`,
      {
        dryRun,
        ...(args.values['key-file'] ? { keyFile: args.values['key-file'] } : {}),
        ...(args.values.exclude ? { exclude: args.values.exclude } : {}),
        gitignore: args.values.gitignore ?? false,
        yes: args.values.yes ?? false,
        log: (line) => process.stderr.write(`${line}\n`),
      },
    );
    for (const path of result.wouldUpload) process.stdout.write(`would upload ${path}\n`);
    process.stdout.write(
      `backup uploaded=${result.uploaded} unchanged=${result.unchanged} failed=${result.failed}\n`,
    );
    if (result.failed) process.exitCode = 1;
    return;
  }
  if (command === 'skill' && args.positionals[0] === 'install') {
    const replaced: string[] = [];
    const written = await installSkill(args.values.target, undefined, replaced);
    if (!written.length) {
      process.stderr.write(
        `Nothing installed: no ~/.claude or ~/.codex directory found. The skill is at ${packagedSkillPath()}; copy it to <skills dir>/agent-drive/SKILL.md, or use --target claude|codex|DIR.\n`,
      );
      process.exitCode = 1;
    }
    for (const path of written)
      process.stdout.write(`${replaced.includes(path) ? 'replaced' : 'wrote'} ${path}\n`);
    return;
  }
  if (command === 'credentials') {
    const sub = args.positionals[0];
    if (sub === 'export') {
      const result = await exportCredentials(
        {
          ...(args.values.to ? { to: args.values.to } : {}),
          ...(args.values.force ? { force: true } : {}),
          ...(args.values.stdout ? { stdout: true } : {}),
          ...(args.values.vault ? { vault: args.values.vault } : {}),
          ...(args.values['keep-clipboard'] ? { keepClipboard: true } : {}),
        },
        { isTTY: Boolean(process.stdout.isTTY), write: writeStdout },
      );
      if (result.target === '1password') {
        await reportKeyBackup(result.apiUrl, result.apiKey, result.driveIds, result.method);
        process.stderr.write(
          `Saved the credentials for ${result.driveIds.length} drive(s) to 1Password.\n`,
        );
        return;
      }
      if (result.target === 'clipboard') {
        process.stderr.write(
          `Copied the credentials to the clipboard. Paste them into Apple Passwords or your password manager, then run \`agent-drive credentials confirm\`.${
            args.values['keep-clipboard']
              ? ' The clipboard is not cleared (--keep-clipboard).'
              : ` The clipboard is cleared in ${CLIPBOARD_CLEAR_SECONDS} seconds.`
          }\n`,
        );
        if ((await result.clearing) === 'failed')
          process.stderr.write('Could not clear the clipboard; clear it yourself.\n');
        return;
      }
      if (result.method === 'stdout') {
        // The bundle owns stdout, so notes go to stderr. Nothing is recorded until `confirm`.
        process.stderr.write(
          'Exported. After the secret store has saved it, run `agent-drive credentials confirm`.\n',
        );
        return;
      }
      process.stderr.write(
        `Backed up credentials for ${result.driveIds.length} drive(s) to ${args.values.to} (${result.method}). Keep that file outside any repository or synced folder.\n`,
      );
      await reportKeyBackup(result.apiUrl, result.apiKey, result.driveIds, result.method);
      return;
    }
    if (sub === 'issue') {
      if (!args.values.name) throw new Error('--name is required.');
      const { client, connection } = await connect(args);
      const result = await issueCredentials(
        {
          name: args.values.name,
          apiUrl: connection.apiUrl,
          ...(args.values.drive?.[0] ? { drive: args.values.drive[0] } : {}),
          ...(args.values.scope ? { scopes: args.values.scope } : {}),
          ...(args.values['write-path'] ? { writePaths: args.values['write-path'] } : {}),
          ...(args.values.label ? { label: args.values.label } : {}),
          machine: machineName(),
          ...(args.values.to ? { to: args.values.to } : {}),
          ...(args.values.force ? { force: true } : {}),
          ...(args.values.stdout ? { stdout: true } : {}),
        },
        { isTTY: Boolean(process.stdout.isTTY), write: writeStdout },
        client.createKey.bind(client),
      );
      process.stderr.write(
        `Created agent "${result.agentName}" with key ${result.keyId}: scopes ${result.scopes.join(' ')}${
          result.writePaths.length ? `, writes only under ${result.writePaths.join(', ')}` : ''
        }.\nStore this line as a secret in the sandbox. Revoke it from the console under Agents.\n`,
      );
      return;
    }
    if (sub === 'confirm') {
      const method = args.values.method ?? 'stdout';
      if (method !== 'stdout' && method !== 'file')
        throw new Error('--method must be "stdout" or "file".');
      const result = await confirmCredentials(method);
      process.stderr.write(
        `Recorded the credential backup for ${result.driveIds.length} drive(s) (${result.method}).\n`,
      );
      await reportKeyBackup(result.apiUrl, result.apiKey, result.driveIds, result.method);
      return;
    }
    if (sub === 'import') {
      const text = args.values.from ? await readFile(args.values.from, 'utf8') : await stdinText();
      const result = await importCredentials(text, args.values.from ? 'file' : 'stdout');
      if (result.kind === 'bundle') {
        process.stdout.write(
          `imported ${result.driveIds.length} drive key(s) into ${configPath()}\n`,
        );
        await sealSavedConnectionAfterKeyChange();
        return;
      }
      const id = result.driveIds[0]!;
      // loadConfig covers env keys and a usable env bundle; fall back to the file alone so a
      // malformed AGENT_DRIVE_CREDENTIALS cannot fail an import that already saved the key.
      const saved = await loadConfig().catch(() => readConfig());
      if (!saved.apiKey && !process.env.AGENT_DRIVE_API_KEY) {
        process.stdout.write(
          `Saved the drive key for drive ${id}. Next: run \`agent-drive login\` to connect this machine to your account.\n`,
        );
        return;
      }
      process.stdout.write(`Saved the drive key for drive ${id} into ${configPath()}.\n`);
      // Say plainly when the account on this machine cannot see the imported drive.
      const who = await resolveConnection()
        .then((connection) =>
          new AgentDriveClient({
            apiUrl: connection.apiUrl,
            apiKey: connection.apiKey,
            machine: machineName(),
          }).whoami(),
        )
        .catch(() => undefined);
      if (who?.driveIds && !who.driveIds.includes(id))
        process.stderr.write(
          `Warning: the API key on this machine has no access to drive ${id}. The key is saved, but this account cannot use it.\n`,
        );
      await sealSavedConnectionAfterKeyChange();
      return;
    }
    if (sub === 'status') {
      const config = await loadConfig();
      return output({
        drives: Object.fromEntries(
          Object.keys(config.driveKeys ?? {}).map((id) => {
            const keyFrom = keySourceLabel(id, { config, checkedDriveId: id });
            return [
              id,
              config.keyBackup?.[id]
                ? { backedUp: true, ...config.keyBackup[id], ...(keyFrom ? { keyFrom } : {}) }
                : keyFrom
                  ? { backedUp: true, keyFrom }
                  : { backedUp: false },
            ];
          }),
        ),
      });
    }
    throw new Error(
      'Usage: credentials export (--to 1password [--vault NAME] | --to clipboard [--keep-clipboard] | --to PATH [--force] | --stdout) | issue --name NAME (--to PATH [--force] | --stdout) | confirm [--method stdout] | import [--from PATH] | status',
    );
  }
  if (command === 'connect') {
    validateConnectOptions(args);
    const [name, mountpoint] = args.positionals;
    const sandboxId = args.values.sandbox;
    const root = args.values.root;
    if (args.positionals.length !== 2 || !name || !mountpoint || !sandboxId || !root)
      throw new Error(
        'Usage: connect NAME MOUNTPOINT --sandbox ID --root /WORKSPACE/PATH [--read-only] [--wake-on-access | --no-wake-on-access] [--persist]',
      );
    if (args.values['wake-on-access'] && args.values['no-wake-on-access'])
      throw new Error('Use only one of --wake-on-access or --no-wake-on-access.');
    const {
      registerLiveWorkspace,
      unregisterLiveWorkspaceIfUnchanged,
      validateLiveWorkspaceMountpoint,
    } = await import('./mount-registry.js');
    await validateLiveWorkspaceMountpoint(mountpoint);
    const entry = await registerLiveWorkspace(
      {
        name,
        mountpoint,
        sandboxId,
        root,
        ...(args.values['read-only'] !== undefined ? { readOnly: args.values['read-only'] } : {}),
        wakeOnAccess: args.values['no-wake-on-access'] !== true,
      },
      { preventFinderAliases: process.platform === 'darwin' },
    );
    if (args.values.persist) {
      const runtime = await installAndWaitForWorkspaceService(name, entry);
      output(entry);
      output(runtime);
      return;
    }
    output(entry);
    try {
      await runLiveWorkspaceMount(entry, entry.readOnly);
    } catch (error) {
      await unregisterLiveWorkspaceIfUnchanged(entry);
      throw error;
    }
    return;
  }
  if (command === 'mounts') {
    const mode = args.positionals[0];
    const usage =
      'Usage: mounts add NAME MOUNTPOINT [--drive ID] [--api URL] [--read-only] [--sandbox ID] | mounts list | mounts status [NAME] | mounts forget NAME | mounts wake NAME on|off | mounts service install|status|remove NAME';
    const registry = await import('./mount-registry.js');
    if (mode === 'service') {
      validateMountsOptions(args, []);
      const [action, name] = args.positionals.slice(1);
      if (args.positionals.length !== 3 || !name) throw new Error(usage);
      const entry = await registry.findMountEntry(name);
      const service = await import('./workspace-service.js');
      const options = {
        name,
        cliPath: fileURLToPath(import.meta.url),
        configPath: configPath(),
        ...(entry.kind === 'live-workspace'
          ? { instaboxPath: await service.resolveInstaboxExecutable() }
          : {}),
      };
      if (action === 'install') {
        const installed = await service.installWorkspaceService(options);
        let current = await service.getWorkspaceServiceRuntimeStatus(options);
        if (installed.updated && current.state === 'installed' && current.active)
          await service.restartWorkspaceService(options);
        current = await service.getWorkspaceServiceRuntimeStatus(options);
        if (current.state === 'installed' && !current.active)
          await service.activateWorkspaceService(options);
        current = await service.getWorkspaceServiceRuntimeStatus(options);
        if (current.state !== 'installed' || !current.active)
          throw new Error(`Workspace service '${name}' did not become active.`);
        const { waitForWorkspaceMountReadiness } = await import('./workspace-service-readiness.js');
        await waitForWorkspaceMountReadiness({
          mountpoint: entry.mountpoint,
          expectedDomainId:
            entry.kind === 'live-workspace'
              ? (await import('./workspace-mount.js')).workspaceMountDomainId(
                  JSON.stringify([entry.sandboxId, entry.root]),
                )
              : entry.driveId,
        });
        output(current);
        return;
      }
      if (action === 'status') {
        output(await service.getWorkspaceServiceRuntimeStatus(options));
        return;
      }
      if (action === 'remove') {
        output(await service.removeWorkspaceService(options));
        return;
      }
      throw new Error(usage);
    }
    if (mode === 'add') {
      validateMountsOptions(args, ['drive', 'api', 'read-only', 'sandbox']);
      const [name, mountpoint] = [args.positionals[1], args.positionals[2]];
      if (args.positionals.length !== 3 || !name || !mountpoint) throw new Error(usage);
      const config = await readConfig();
      const apiUrl =
        args.values.api || process.env.AGENT_DRIVE_API_URL || config.apiUrl || DEFAULT_API_URL;
      const driveId = resolveDriveId(args.values.drive?.[0], config, apiUrl);
      output(
        await registry.registerMount({
          name,
          mountpoint,
          driveId,
          apiUrl,
          ...(args.values['read-only'] !== undefined ? { readOnly: args.values['read-only'] } : {}),
          ...(args.values.sandbox !== undefined ? { sandboxId: args.values.sandbox } : {}),
        }),
      );
      return;
    }
    if (mode === 'list') {
      validateMountsOptions(args, []);
      if (args.positionals.length !== 1) throw new Error(usage);
      output(await registry.readMountRegistry());
      return;
    }
    if (mode === 'status') {
      validateMountsOptions(args, []);
      if (args.positionals.length > 2) throw new Error(usage);
      output(await registry.mountStatus(args.positionals[1]));
      return;
    }
    if (mode === 'forget') {
      validateMountsOptions(args, []);
      const name = args.positionals[1];
      if (args.positionals.length !== 2 || !name) throw new Error('Usage: mounts forget NAME');
      const entry = await registry.findMountEntry(name);
      if (entry.kind !== 'live-workspace')
        throw new Error(`Mount '${name}' is not a live workspace.`);
      const service = await import('./workspace-service.js');
      const serviceStatus = await service.getWorkspaceServiceRuntimeStatus({
        name,
        cliPath: fileURLToPath(import.meta.url),
        configPath: configPath(),
      });
      if (serviceStatus.state !== 'missing')
        throw new Error(
          `Cannot forget '${name}' while its login service is ${serviceStatus.state}. Remove or repair it with \`agent-drive mounts service remove ${name}\` first.`,
        );
      const filesystem = await registry.describeMountpoint(entry.mountpoint);
      if (process.platform === 'darwin' && filesystem.state !== 'free')
        throw new Error(
          `Cannot forget '${name}' while its Finder mountpoint is present. Stop the mount and try again.`,
        );
      if (process.platform === 'linux') {
        if (filesystem.state === 'symlink' || filesystem.state === 'other')
          throw new Error(`Cannot safely verify the mountpoint for '${name}'.`);
        if (filesystem.state === 'directory') {
          const mountInfo = await readFile('/proc/self/mountinfo', 'utf8').catch(() => {
            throw new Error(`Cannot safely verify whether '${name}' is mounted.`);
          });
          if (registry.linuxMountInfoContainsPath(mountInfo, entry.mountpoint))
            throw new Error(`Cannot forget '${name}' while its mountpoint is active.`);
        }
      } else if (process.platform !== 'darwin' && filesystem.state !== 'free') {
        throw new Error(`Cannot safely verify the mountpoint for '${name}'.`);
      }
      if (!(await registry.unregisterLiveWorkspaceIfUnchanged(entry)))
        throw new Error(`Mount '${name}' changed during the forget operation. Retry the command.`);
      output({ forgotten: name });
      return;
    }
    if (mode === 'wake') {
      validateMountsOptions(args, []);
      const [name, policy] = args.positionals.slice(1);
      if (args.positionals.length !== 3 || !name || (policy !== 'on' && policy !== 'off'))
        throw new Error('Usage: mounts wake NAME on|off');
      const { setLiveWorkspaceWakePolicy } = await import('./mount-registry.js');
      const previous = await registry.findMountEntry(name);
      const requestedPolicy = policy === 'on';
      const service = await import('./workspace-service.js');
      const previousLive = previous.kind === 'live-workspace' ? previous : undefined;
      const serviceOptions =
        previousLive && previousLive.wakeOnAccess !== requestedPolicy
          ? {
              name,
              cliPath: fileURLToPath(import.meta.url),
              configPath: configPath(),
              instaboxPath: await service.resolveInstaboxExecutable(),
            }
          : undefined;
      const current = serviceOptions
        ? await service.getWorkspaceServiceRuntimeStatus(serviceOptions)
        : undefined;
      if (current?.state === 'conflict')
        throw new Error(
          `Cannot change wake policy because the managed service '${name}' is not the exact owned definition.`,
        );
      const updated = await setLiveWorkspaceWakePolicy(name, requestedPolicy);
      if (previousLive && serviceOptions && current?.state === 'installed' && current.active) {
        try {
          await service.restartWorkspaceService(serviceOptions);
          const { waitForWorkspaceMountReadiness } = await import(
            './workspace-service-readiness.js'
          );
          await waitForWorkspaceMountReadiness({
            mountpoint: previousLive.mountpoint,
            expectedDomainId: (await import('./workspace-mount.js')).workspaceMountDomainId(
              JSON.stringify([previousLive.sandboxId, previousLive.root]),
            ),
          });
        } catch (error) {
          await setLiveWorkspaceWakePolicy(name, previousLive.wakeOnAccess);
          throw error;
        }
      }
      output(updated);
      return;
    }
    throw new Error(usage);
  }
  if (command === 'mount' && registryMount?.kind === 'live-workspace') {
    await runLiveWorkspaceMount(
      registryMount,
      (args.values['read-only'] ?? false) || registryMount.readOnly,
    );
    return;
  }
  if (command === 'grant') {
    const code = args.positionals[0];
    if (!code) throw new Error('grant requires the CODE shown by `agent-drive login`.');
    // The recipient's public key comes from the API — a channel whose trust is in question —
    // so sealing needs the verification code the human read on the new agent's terminal.
    if (!args.values.verify)
      throw new Error(
        'grant requires --verify <verification code>: the code the new agent printed under ' +
          '"Verification code:" when it ran `agent-drive login`. Ask the human for it.',
      );
    const connection = await resolveConnection(args.values.api);
    const drive = args.values.drive?.[0];
    await grantLogin({
      code,
      verify: args.values.verify,
      ...(drive ? { drive } : {}),
      ...(args.values['read-only'] ? { readOnly: true } : {}),
      ...(args.values.scope ? { scopes: args.values.scope } : {}),
      ...(args.values['write-path'] ? { writePaths: args.values['write-path'] } : {}),
      client: new AgentDriveClient({
        apiUrl: connection.apiUrl,
        apiKey: connection.apiKey,
        machine: machineName(),
      }),
      config: connection.config,
      log: (line) => process.stdout.write(`${line}\n`),
    });
    sealAfterKeyChange(connection);
    return;
  }
  if (command === 'account' && args.positionals[0] === 'seal') {
    const connection = await resolveConnection(args.values.api);
    const client = new AgentDriveClient({
      apiUrl: connection.apiUrl,
      apiKey: connection.apiKey,
      machine: machineName(),
    });
    const driveIds = args.values.drive?.length ? args.values.drive : undefined;
    // Paginate fully. A key without `read` cannot list (403): then no drive's type is proven
    // by the listing, so only locally marked agent-only drives are known — everything else is
    // skipped as 'unknown type' rather than sent a key it may not accept.
    const flags = new Map<string, boolean>();
    let listed: string[] | null = [];
    const pendingNames = await pendingAgentOnlyNames(client.apiOrigin);
    try {
      let cursor: string | undefined;
      for (let page = 0; page < 50; page += 1) {
        const res = await client.listDrives(undefined, cursor);
        for (const drive of res.items ?? []) {
          listed.push(drive.id);
          flags.set(drive.id, drive.agentOnly === true || pendingNames.has(drive.name));
        }
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
    } catch (error) {
      if (!(error instanceof AgentDriveApiError && error.status === 403)) throw error;
      listed = null;
    }
    const candidates = driveIds ?? [
      ...new Set([
        ...Object.keys(keysForOrigin(connection.config, client.apiOrigin)),
        ...(listed ?? []),
      ]),
    ];
    const targets = await heldSealTargets({
      config: connection.config,
      origin: client.apiOrigin,
      driveIds: candidates,
      agentOnly: flags,
      // With a single --drive, AGENT_DRIVE_KEY and --key-file resolve for it like commands do.
      ...(driveIds?.length === 1 ? { selectedDriveId: driveIds[0] } : {}),
      ...(args.values['key-file'] ? { keyFile: args.values['key-file'] } : {}),
    });
    if (driveIds?.length) {
      const missing = driveIds.filter((id) => !targets.some((t) => t.driveId === id));
      if (missing.length)
        throw new Error(`No drive key on this machine for ${missing.join(', ')}.`);
    }
    if (!targets.length) {
      process.stdout.write('No drive keys on this machine.\n');
      return;
    }
    // First use and repin need the fingerprint the human read in the console, supplied by
    // --fingerprint or AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT — never trusted to the API alone.
    const flagFingerprint = expectedAccountFingerprint(args.values.fingerprint);
    if (args.values.fingerprint !== undefined && !flagFingerprint)
      throw new Error(
        '--fingerprint must look like "a1b2 c3d4 e5f6 7890", exactly as the console shows it.',
      );
    const rawEnvironmentFingerprint = process.env.AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT;
    const environmentFingerprint = expectedAccountFingerprint(rawEnvironmentFingerprint);
    if (rawEnvironmentFingerprint !== undefined && !environmentFingerprint)
      throw new Error('AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT must look like "a1b2 c3d4 e5f6 7890".');
    if (args.values.repin === true && !flagFingerprint)
      throw new Error(`--repin requires --fingerprint. ${PIN_REQUIRED_HINT}`);
    const expectedFingerprint = flagFingerprint ?? environmentFingerprint;
    const result = await sealDrivesToAccount({
      client,
      config: connection.config,
      targets,
      force: true,
      repin: args.values.repin === true,
      ...(expectedFingerprint ? { expectedFingerprint } : {}),
      onRepair: () =>
        process.stderr.write(
          'The account-key pin file was unreadable, so a new one was started. Pins for other API origins are gone — run `agent-drive account seal --repin --fingerprint` under each of them.\n',
        ),
      requireVerifiedType: true,
      verifiedDriveIds: new Set(listed ?? []),
    });
    for (const target of targets)
      process.stdout.write(`${target.driveId}: ${result.get(target.driveId)!}\n`);
    const statuses = [...result.values()];
    if (statuses.includes('unknown type')) process.stderr.write(`${UNKNOWN_TYPE_HINT}\n`);
    if (statuses.includes('unverified')) process.stderr.write(`${UNVERIFIED_HINT}\n`);
    if (
      statuses.some(
        (status) => status === 'failed' || status === 'unknown type' || status === 'unverified',
      )
    )
      process.exitCode = 1;
    return;
  }
  const { client, connection } = await connect(args, {
    requireDriveKey: (command === 'put' && args.positionals[0] === '-') || command === 'mount',
  });
  if (command === 'mount') {
    const driveId = requiredDrive(args);
    const mountPoint = registryMount?.mountpoint ?? args.positionals[0]!;
    const mountIdentity = await client.whoami();
    if (
      !Array.isArray(mountIdentity.scopes) ||
      mountIdentity.scopes.some((scope) => typeof scope !== 'string')
    )
      throw new Error('The mount permissions returned by the API are invalid.');
    if (!mountIdentity.scopes.includes('read')) {
      throw new Error(
        'This API key lacks read access. Use a key with read access to the selected drive.',
      );
    }
    if (
      mountIdentity.driveIds !== null &&
      (!Array.isArray(mountIdentity.driveIds) ||
        mountIdentity.driveIds.some((id) => typeof id !== 'string'))
    ) {
      throw new Error('The mount drive permissions returned by the API are invalid.');
    }
    if (mountIdentity.driveIds === null && !mountIdentity.scopes.includes('manage')) {
      throw new Error('The mount drive permissions returned by the API are invalid.');
    }
    if (mountIdentity.driveIds !== null && !mountIdentity.driveIds.includes(driveId)) {
      throw new Error(
        'This API key is not scoped to the selected drive. Use a key with read access to the selected drive.',
      );
    }
    const writePaths = mountIdentity.writePaths ?? [];
    if (
      !Array.isArray(writePaths) ||
      writePaths.some(
        (path) =>
          typeof path !== 'string' ||
          !path.startsWith('/') ||
          path.includes('\\') ||
          path.includes('//') ||
          (path !== '/' && path.endsWith('/')) ||
          path.split('/').some((part) => part === '.' || part === '..'),
      )
    )
      throw new Error('The mount write-path permissions returned by the API are invalid.');
    const {
      createMountBridge,
      resolveMountHelper,
      runLinuxMount,
      MOUNT_MAX_READ_BYTES,
      MOUNT_MAX_WRITE_BYTES,
    } = await import('./mount.js');
    const hasWriteScope = mountIdentity.scopes.includes('write');
    const writeEnabled = hasWriteScope && args.values['read-only'] !== true;
    const deleteEnabled = writeEnabled && mountIdentity.scopes.includes('delete');
    const sharedMountOps = ['capabilities', 'stat', 'list', 'read'];
    const sharedWriteOps = ['openWrite', 'write', 'truncate', 'readStaged', 'mkdir', 'rename'];
    const platformWriteOps =
      process.platform === 'darwin'
        ? ['finalizeWrite', 'flushStatus', 'closeWrite']
        : ['flush', 'release'];
    const mountCapabilities = {
      readOnly: !writeEnabled,
      write: writeEnabled,
      delete: deleteEnabled,
      writePaths,
      maxReadBytes: MOUNT_MAX_READ_BYTES,
      maxWriteBytes: MOUNT_MAX_WRITE_BYTES,
      ops: [
        ...sharedMountOps,
        ...(writeEnabled ? [...sharedWriteOps, ...platformWriteOps] : []),
        ...(deleteEnabled ? ['unlink', 'rmdir'] : []),
      ],
    };
    const controller = new AbortController();
    let interruptedBy: 'SIGINT' | 'SIGTERM' | undefined;
    let closeMacMount: (() => Promise<void>) | undefined;
    const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
      if (interruptedBy) {
        process.exit(signal === 'SIGINT' ? 130 : 143);
        return;
      }
      interruptedBy = signal;
      controller.abort(signal);
      void closeMacMount?.();
    };
    const onSigint = () => onSignal('SIGINT');
    const onSigterm = () => onSignal('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    try {
      if (process.platform === 'darwin') {
        const bridge = await createMountBridge(client, driveId, {
          signal: controller.signal,
          capabilities: mountCapabilities,
        });
        try {
          if (controller.signal.aborted) return;
          const { startMacMount } = await import('./mount-mac.js');
          const mount = await startMacMount({
            driveId,
            requestedMountpoint: mountPoint,
            dispatch: bridge.request,
          });
          closeMacMount = () => mount.close();
          if (controller.signal.aborted) await closeMacMount();
          await mount.waitForExit();
        } finally {
          try {
            await closeMacMount?.();
          } finally {
            await bridge.close();
          }
        }
      } else {
        await runLinuxMount(client, driveId, mountPoint, {
          helperPath: resolveMountHelper(),
          signal: controller.signal,
          readWrite: writeEnabled,
          capabilities: mountCapabilities,
        });
      }
      if (interruptedBy) process.exitCode = interruptedBy === 'SIGINT' ? 130 : 143;
    } finally {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    }
    return;
  }
  if (command === 'whoami') {
    const who = await client.whoami();
    const config = connection.config;
    return output({
      ...who,
      localDriveKeys: await localKeyMap(who.driveIds, (id) =>
        resolveDriveKey(id, connection.apiUrl, args.values['key-file'], config),
      ),
      keyBackup: Object.fromEntries(
        Object.keys(config.driveKeys ?? {})
          .filter((id) => !who.driveIds || who.driveIds.includes(id))
          .map((id) => [id, config.keyBackup?.[id] ?? null]),
      ),
    });
  }
  if (command === 'check') {
    const who = await client.whoami();
    const candidates = who.driveIds ?? Object.keys(connection.config.driveKeys ?? {});
    const explicit = args.values.drive?.[0];
    const keys = await localKeyMap([...candidates, ...(explicit ? [explicit] : [])], (id) =>
      resolveDriveKey(id, connection.apiUrl, args.values['key-file'], connection.config),
    );
    const driveId = pickCheckDrive(explicit, candidates, keys);
    const { missing, notes } = backupState(
      keys,
      driveId,
      connection.config,
      args.values['key-file'],
    );
    if (missing.length) throw new Error(notBackedUpMessage(missing));
    for (const note of notes)
      process.stderr.write(
        `The key for drive ${note.driveId} came from ${note.label}, so a copy exists elsewhere.\n`,
      );
    const key = await resolveDriveKey(
      driveId,
      connection.apiUrl,
      args.values['key-file'],
      connection.config,
    );
    const checker = new AgentDriveClient({
      apiUrl: connection.apiUrl,
      apiKey: connection.apiKey,
      machine: machineName(),
      ...(key ? { driveKey: key } : {}),
    });
    process.stdout.write(
      `${await runCheck(checker, driveId, { scopes: who.scopes, writePaths: who.writePaths ?? [] })}\n`,
    );
    return;
  }
  if (command === 'agent' && args.positionals[0] === 'create')
    return output(await client.createAgent(args.values.name ?? args.positionals[1] ?? ''));
  if (command === 'drive' && args.positionals[0] === 'create') {
    const name = args.values.name ?? args.positionals[1];
    if (!name) throw new Error('A drive name is required.');
    const agentOnly = args.values['agent-only'] === true;
    const origin = client.apiOrigin;
    // Record the user's choice BEFORE the remote drive exists: if this state write fails the
    // command stops here, so a state failure can never strand a remote drive with no mark.
    if (agentOnly) await recordAgentOnlyIntent(name, origin);
    const drive = await client.createDrive(name, limit(args.values.quota), agentOnly || undefined);
    // Seal through the same connection that created the drive — a second resolveConnection
    // could pick up an account or origin another process just changed.
    const saved = await loadConfig();
    const existingKey = await resolveDriveKey(
      drive.id,
      connection.apiUrl,
      args.values['key-file'],
      saved,
    );
    let sealedKey = existingKey;
    if (drive.created) {
      const key = generateDriveKey();
      await writeConfig({
        driveKeys: { [drive.id]: key },
        driveKeyOrigins: { [drive.id]: origin },
        driveKeySources: { [drive.id]: 'generated' },
      });
      output(drive);
      process.stderr.write(`${createdDriveNote(configPath())}\n${BACKUP_HINT}\n`);
      sealedKey = key;
    } else {
      if (!existingKey)
        throw new Error(
          `Drive ${drive.id} already exists; load its backup through ${driveKeyEnvironmentName(drive.id)}.`,
        );
      output(drive);
    }
    if (agentOnly) {
      if (drive.created) {
        // The user's flag — not the API's echo — marks the drive agent-only. If recording the
        // id fails, the name intent recorded above still stops seals via the listing.
        try {
          await recordAgentOnlyDrive(drive.id, origin);
          await clearAgentOnlyIntent(name, origin);
        } catch {
          // The pending intent stays as the fallback marker.
        }
      } else {
        await clearAgentOnlyIntent(name, origin).catch(() => {});
      }
    } else if (drive.created) {
      // An earlier --agent-only attempt for this name may have died mid-create; the user's flag
      // is authoritative, so an ordinary create retires its stale intent. Best-effort: keeping
      // it only mis-marks (fail closed), never leaks a key. The name check is a lock-free read
      // first, so the usual case never waits on the state lock.
      if ((await pendingAgentOnlyNames(origin)).has(name))
        await clearAgentOnlyIntent(name, origin).catch(() => {});
    }
    // Agent-only is also learned from the API's own state when this machine did not set the flag
    // (a drive created elsewhere): seals skip this drive even if a listing later disagrees.
    if (drive.agentOnly === true && (!agentOnly || !drive.created))
      await recordAgentOnlyDrive(drive.id, origin).catch(() => {});
    // Reloaded after the write above so the seal sees the just-created key — and seals that
    // exact key, never a different stored or env key.
    sealHook(
      { ...connection, config: await loadConfig() },
      {
        driveIds: [drive.id],
        force: true,
        selectedDriveId: drive.id,
        ...(sealedKey ? { keys: { [drive.id]: sealedKey } } : {}),
      },
    );
    return;
  }
  if (command === 'key' && args.positionals[0] === 'create') {
    const agent = args.values.agent;
    const drives = args.values.drive ?? [];
    if (!agent || !drives.length || !args.values.label)
      throw new Error('--agent, --drive, and --label are required.');
    return output(
      await client.createKey(
        agent,
        args.values.label,
        drives,
        args.values.scope ?? ['read', 'write'],
        args.values['write-path'],
      ),
    );
  }
  if (command === 'key' && args.positionals[0] === 'revoke') {
    if (!args.positionals[1]) throw new Error('A key ID is required.');
    return output(await client.revokeKey(args.positionals[1]));
  }
  if (
    command === 'ls' &&
    args.values.sort !== undefined &&
    !['path', 'modified'].includes(args.values.sort)
  )
    throw new Error('--sort must be path or modified.');
  if (command === 'ls' && (args.values.folder !== undefined || args.values.sort === 'modified')) {
    if (args.values.folder !== undefined && args.values.prefix !== undefined)
      throw new Error('Use either --folder or --prefix, not both.');
    return output(
      await client.browse(requiredDrive(args), {
        ...(args.values.folder !== undefined ? { folder: args.values.folder } : {}),
        ...(args.values.prefix !== undefined ? { prefix: args.values.prefix } : {}),
        ...(args.values.sort ? { sort: args.values.sort as 'path' | 'modified' } : {}),
        ...(args.values.limit !== undefined ? { limit: Number(args.values.limit) } : {}),
        ...(args.values.cursor ? { cursor: args.values.cursor } : {}),
        filters: {
          ...(args.values.tag?.[0] ? { tag: args.values.tag[0] } : {}),
          ...(args.values.agent ? { agentId: args.values.agent } : {}),
          ...(args.values.machine ? { machine: args.values.machine } : {}),
          ...(args.values.user ? { user: args.values.user } : {}),
        },
      }),
    );
  }
  if (command === 'ls')
    return output(
      await client.list(
        requiredDrive(args),
        args.values.prefix,
        limit(args.values.limit),
        args.values.cursor,
        {
          ...(args.values.tag?.[0] ? { tag: args.values.tag[0] } : {}),
          ...(args.values.agent ? { agentId: args.values.agent } : {}),
          ...(args.values.machine ? { machine: args.values.machine } : {}),
          ...(args.values.user ? { user: args.values.user } : {}),
        },
      ),
    );
  if (command === 'versions')
    return output(
      await client.versions(
        requiredDrive(args),
        args.positionals[0] ?? '',
        limit(args.values.limit),
        args.values.cursor,
      ),
    );
  if (command === 'recent') {
    const wait = args.values.wait;
    if (wait !== undefined) {
      const seconds = Number(wait);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300)
        throw new Error('--wait must be a whole number of seconds from 1 to 300.');
      const pageLimit = limit(args.values.limit);
      return output(
        await client.waitForRecent(requiredDrive(args), {
          waitMs: seconds * 1000,
          ...(args.values.since ? { since: args.values.since } : {}),
          ...(args.values.cursor ? { cursor: args.values.cursor } : {}),
          ...(pageLimit ? { limit: pageLimit } : {}),
        }),
      );
    }
    return output(
      await client.recent(
        requiredDrive(args),
        args.values.since,
        limit(args.values.limit),
        args.values.cursor,
      ),
    );
  }
  if (command === 'search') {
    const query = {
      ...(args.values.query ? { q: args.values.query } : {}),
      ...(args.values.tag?.[0] ? { tag: args.values.tag[0] } : {}),
      ...(args.values.agent ? { agentId: args.values.agent } : {}),
      ...(args.values.machine ? { machine: args.values.machine } : {}),
      ...(args.values.user ? { user: args.values.user } : {}),
    };
    return output(
      await client.search(requiredDrive(args), query, limit(args.values.limit), args.values.cursor),
    );
  }
  if (command === 'share') {
    const driveId = requiredDrive(args);
    if (args.positionals[0] === 'list')
      return output(await client.listShares(driveId, limit(args.values.limit), args.values.cursor));
    if (args.positionals[0] === 'revoke') {
      const shareId = args.positionals[1];
      if (!shareId) throw new Error('share revoke requires SHARE_ID.');
      return output(await client.revokeShare(driveId, shareId));
    }
    const path = args.positionals[0];
    if (!path) throw new Error('share requires PATH, or use share list/revoke.');
    return output(
      await client.createShare(driveId, path, {
        ...(args.values.version ? { versionId: args.values.version } : {}),
        ...(args.values['expires-in']
          ? { expiresAt: parseShareExpiry(args.values['expires-in']) }
          : {}),
      }),
    );
  }
  if (command === 'put') {
    const local = args.positionals[0];
    const remote = args.positionals[1];
    if (!local || !remote) throw new Error('put requires LOCAL and REMOTE.');
    const driveId = requiredDrive(args);
    const options = {
      ...(args.values.overwrite ? { mode: 'overwrite' as const } : {}),
      ...(args.values['if-version'] ? { ifVersionId: args.values['if-version'] } : {}),
      ...(args.values.description ? { description: args.values.description } : {}),
      ...(args.values.user ? { userId: args.values.user } : {}),
      ...(args.values.tag ? { tags: args.values.tag } : {}),
    };
    const version =
      local === '-'
        ? await putPipe(client, driveId, remote, process.stdin, stdinSize, options)
        : await putFile(client, driveId, local, remote, options);
    const folderUrl = consoleFolderUrl(client.apiOrigin, driveId, version.path);
    return output({ ...version, ...(folderUrl ? { folderUrl } : {}) });
  }
  if (command === 'get') {
    const remote = args.positionals[0];
    if (!remote) throw new Error('get requires REMOTE.');
    if (args.values.output) {
      if (args.values.output === '-') {
        await getPipe(client, requiredDrive(args), remote, process.stdout, {
          ...(args.values.version ? { versionId: args.values.version } : {}),
        });
        return;
      }
      return output(
        await getFile(client, requiredDrive(args), remote, args.values.output, {
          ...(args.values.version ? { versionId: args.values.version } : {}),
          overwrite: true,
        }),
      );
    }
    const result = await client.getStream(requiredDrive(args), remote, {
      ...(args.values.version ? { versionId: args.values.version } : {}),
      maxPlaintextBytes: 1024 * 1024,
    });
    if (result.plaintextBytes > 1024 * 1024) {
      await result.cancel();
      throw new Error('Binary or large output requires --output.');
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for await (const chunk of result.plaintext) {
        length += chunk.byteLength;
        if (length > 1024 * 1024) throw new Error('Binary or large output requires --output.');
        chunks.push(chunk);
      }
    } catch (error) {
      await result.cancel(error);
      throw error;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      await result.cancel();
      throw new Error('Binary output requires --output.');
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) {
      await result.cancel();
      throw new Error('Binary output requires --output.');
    }
    process.stdout.write(`${text}${text.endsWith('\n') ? '' : '\n'}`);
    return;
  }
  if (command === 'mv')
    return output(
      await client.move(
        requiredDrive(args),
        args.positionals[0] ?? '',
        args.positionals[1] ?? '',
        args.values.user,
      ),
    );
  if (command === 'cp')
    return output(
      await client.copy(requiredDrive(args), args.positionals[0] ?? '', args.positionals[1] ?? '', {
        ...(args.values.version ? { versionId: args.values.version } : {}),
        ...(args.values.user ? { userId: args.values.user } : {}),
      }),
    );
  if (command === 'rm')
    return output(
      await client.delete(requiredDrive(args), args.positionals[0] ?? '', args.values.user),
    );
  if (command === 'restore')
    return output(
      await client.restore(
        requiredDrive(args),
        args.positionals[0] ?? '',
        args.values.version,
        args.values.user,
      ),
    );
  if (command === 'sync') {
    if (!args.positionals[0]) throw new Error('sync requires LOCAL_DIRECTORY.');
    const controller = new AbortController();
    let interruptedBy: 'SIGINT' | 'SIGTERM' | undefined;
    const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
      if (interruptedBy) {
        process.exit(signal === 'SIGINT' ? 130 : 143);
        return;
      }
      interruptedBy = signal;
      controller.abort(signal);
    };
    const onSigint = () => onSignal('SIGINT');
    const onSigterm = () => onSignal('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    try {
      const result = await syncDirectory(
        client,
        requiredDrive(args),
        args.positionals[0],
        args.values.prefix,
        {
          ...(args.values['overwrite-existing'] === undefined
            ? {}
            : { overwriteExisting: args.values['overwrite-existing'] }),
          signal: controller.signal,
        },
      );
      return output(result);
    } catch (error) {
      if (!(error instanceof SyncInterruptedError)) throw error;
      const signal = error.signalName ?? interruptedBy;
      if (!signal) throw error;
      process.stderr.write(`Sync interrupted by ${signal}.\n`);
      process.exitCode = signal === 'SIGINT' ? 130 : 143;
    } finally {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    }
    return;
  }
  throw new Error('Unknown command.');
}

const [name, ...raw] = process.argv.slice(2);
const help = `Agent Drive CLI

Commands:
  login [--name AGENT] [--no-browser]   Approve in a browser (device flow); name defaults to "<machine> agent"
  login --api URL --token-stdin         Save an existing API key
  whoami                                Also shows localDriveKeys (which drives have a key here)
  check [--drive ID]                    Write, read back, compare a test file (read-only keys: decrypt an existing file); needs backed-up keys; prints "check ok"
  agent create --name NAME
  drive create --name NAME [--agent-only]
  key create --agent ID --drive ID --label LABEL --scope read --scope write [--write-path P]...
  key revoke ID
  put LOCAL|- REMOTE --drive ID [--size N] [--if-version ID | --overwrite]
                                        --size starts the 10-minute upload intent before stdin; input, upload and commit must fit.
                                        Without it, stdin is spooled first; upload and commit then have 10 minutes.
  get REMOTE --drive ID [--output FILE|-]   Use --output - for raw binary stdout
  connect NAME MOUNTPOINT --sandbox ID --root PATH [--read-only] [--wake-on-access | --no-wake-on-access] [--persist]
                                        Save and start a live workspace mount without Agent Drive credentials
  mounts forget NAME                    Forget an offline live workspace registration
  mounts wake NAME on|off               Change saved wake-on-first-access policy locally
  mount MOUNTPOINT --drive ID [--read-only]  Mount a drive; write scope enables edits
  mount --name NAME                    Mount a saved drive or live workspace
  mounts list | status [NAME]           List saved mounts or inspect a mountpoint
  mounts service install|status|remove NAME  Manage login startup for a saved mount
  mounts add NAME MOUNTPOINT [--drive ID] [--api URL] [--read-only] [--sandbox ID]
                                        Register a named local mount connection (offline; stored in mounts.json)
  mounts list                             List registered mounts without starting any
  mounts status [NAME]                    Show each entry's mountpoint filesystem state
  jobs init [--drive ID]                    Create the /jobs guide in a drive
  jobs submit ID [--drive ID]               Explicitly submit one drafted job
  jobs work [--drive ID] [--once] -- COMMAND [ARGS...]
                                        Run one configured local worker for submitted jobs
  ls --drive ID [--prefix PATH | --folder PATH] [--sort path|modified] [--tag TAG] [--agent ID] [--machine NAME] [--user ID]
  mv SOURCE DESTINATION --drive ID
  cp SOURCE DESTINATION --drive ID
  rm PATH --drive ID
  versions PATH --drive ID
  restore PATH --drive ID [--version ID]
  search --drive ID [--query TEXT] [--tag TAG] [--agent ID] [--machine NAME] [--user ID]
  recent --drive ID [--since ISO_TIMESTAMP] [--cursor C] [--wait SECONDS]
  share PATH --drive ID [--version ID] [--expires-in 30m|24h|7d]
  share list --drive ID
  share revoke SHARE_ID --drive ID
  sync LOCAL_DIRECTORY --drive ID [--prefix PATH] [--overwrite-existing]
                                        sync takes no filter or preview flags; the backup-only flags below are rejected, not ignored.
  backup LOCAL_DIRECTORY [--drive ID] [--prefix PATH] [--exclude GLOB]... [--gitignore] [--dry-run] [--yes]
                                        Scans the folder first, then uploads. --gitignore skips paths the folder's .gitignore excludes
                                        and .git control metadata (a .git directory or a linked worktree's .git file). Without it or
                                        --exclude, everything is uploaded, .git included.
                                        --exclude GLOB matches the root-relative path: 'build/**' skips everything under build/,
                                        '**/node_modules' skips node_modules at any depth, a bare 'node_modules' only the top-level one.
                                        Over 5000 files or 1 GiB needs --yes (or preview with --dry-run). One backup per prefix at a time.
  version                               Print the CLI version
  grant CODE --verify CODE2 [--drive ID] [--read-only] [--scope S]... [--write-path P]...
                                        Check the new agent's printed verification code before sealing; the owner then approves on /connect
  credentials export (--to 1password [--vault NAME] | --to clipboard [--keep-clipboard] | --to PATH [--force] | --stdout)
                                        Back up the API key and drive keys (bundle "adcred1.…"). Offer 1Password first, then the clipboard (for Apple Passwords or another manager), then a file outside the repo
  credentials issue --name NAME [--drive ID] [--scope S]... [--write-path P]... [--label L] (--to PATH [--force] | --stdout)
                                        Mint a new agent's key (needs the delegate scope) and print its AGENT_DRIVE_CREDENTIALS line
  credentials confirm [--method stdout]   Record a --stdout export as stored (export --stdout | STORE && credentials confirm)
  credentials import [--from PATH]      Merge a credentials bundle or a console recovery file (agent-drive-<id>.key.json) into the config
  credentials status                    Which drive keys are backed up, when, and how
  account seal [--drive ID] [--fingerprint CODE] [--repin]
                                        Verify the console's account-key fingerprint before sealing or repinning
  skill install [--target claude|codex|DIR]   Install the agent-drive SKILL.md for your agent
  capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]   Run an agent with its LLM calls saved as encrypted traces under /traces
  mcp

Without installing: npx -y @dennisonbertram/agent-drive@latest <command>

Global configuration: AGENT_DRIVE_CONFIG, AGENT_DRIVE_API_URL,
AGENT_DRIVE_API_KEY, AGENT_DRIVE_MACHINE, AGENT_DRIVE_CREDENTIALS (a bundle merged in
memory, never written to disk; its drives count as backed up), and AGENT_DRIVE_KEY or
AGENT_DRIVE_KEY_<DRIVE_ID> (a drive key supplied by the environment).
`;
const skillHelp = `Usage: agent-drive skill install [--target claude|codex|DIR]

Copies the agent-drive SKILL.md into your agent's skills folder.
  (no --target)  each of ~/.claude and ~/.codex that exists; exits 1 if neither does
  --target claude  ~/.claude/skills/agent-drive/SKILL.md
  --target codex   ~/.codex/skills/agent-drive/SKILL.md
  --target DIR     DIR/SKILL.md (DIR itself is the skill folder; it is created if missing)
An existing SKILL.md is replaced, and the output says "replaced".
`;
// Arguments after the `--` terminator are positionals — for `capture` and `jobs
// work`, the delegated command — never this CLI's own flags.
const terminator = raw.indexOf('--');
const ownArgs = terminator < 0 ? raw : raw.slice(0, terminator);
let done: Promise<void>;
if (name === 'skill' && ownArgs.includes('--help')) {
  process.stdout.write(skillHelp);
  done = Promise.resolve();
} else if (!name || name === 'help' || name === '--help' || ownArgs.includes('--help')) {
  process.stdout.write(help);
  done = Promise.resolve();
} else if (name !== 'jobs' && ownArgs.includes('--once')) {
  process.stderr.write('--once is only supported by `jobs work`.\n');
  process.exitCode = 1;
  done = Promise.resolve();
} else if (name === 'version' || name === '--version') {
  process.stdout.write(`${cliVersion}\n`);
  done = Promise.resolve();
} else if (name === 'mcp') {
  done = import('./mcp.js')
    .then(({ runMcp }) => runMcp())
    .catch(() => {
      process.stderr.write('MCP server failed to start.\n');
      process.exitCode = 1;
    });
} else {
  done = run(name, raw)
    .catch((error: unknown) => {
      if (error instanceof AgentDriveApiError) {
        process.stderr.write(`${apiErrorLines(error).join('\n')}\n`);
      } else {
        process.stderr.write(`${error instanceof Error ? error.message : 'Command failed.'}\n`);
      }
      process.exitCode = 1;
    })
    .then(() => {
      // Only now, once the command's output has settled, do the scheduled seals start.
      for (const work of scheduledSeals.splice(0)) sealInBackground(work);
      return Promise.allSettled([...pendingSeals]).then(() => undefined);
    });
}
// Exported so in-process tests can await a command's full lifecycle (including best-effort
// side effects like account sealing) instead of racing its first output line.
export { done };
