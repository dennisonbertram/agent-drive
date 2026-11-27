import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  lstat,
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

export type WorkspaceServicePlatform = 'darwin' | 'linux';
export type WorkspaceServiceOptions = {
  platform?: WorkspaceServicePlatform;
  home?: string;
  name: string;
  cliPath: string;
  nodePath?: string;
  configPath?: string;
  instaboxPath?: string;
};
export type WorkspaceServicePaths = { directory: string; path: string };
export type WorkspaceServiceStatus = {
  state: 'missing' | 'installed' | 'conflict';
  path: string;
};
export type WorkspaceServiceCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};
export type WorkspaceServiceRunner = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<WorkspaceServiceCommandResult>;

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const execFileAsync = promisify(execFile);

const runCommand: WorkspaceServiceRunner = async (command, args, options) => {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: options?.timeoutMs ?? 15_000,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    if (typeof failure.code === 'number')
      return {
        code: failure.code,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
      };
    throw new Error(`Could not run ${command}: ${failure.message}`);
  }
};

function platformOf(value?: WorkspaceServicePlatform): WorkspaceServicePlatform {
  const platform = value ?? process.platform;
  if (platform !== 'darwin' && platform !== 'linux')
    throw new Error(`Persistent mounts are unsupported on ${platform}`);
  return platform;
}

function validateName(name: string): void {
  if (!NAME_PATTERN.test(name)) throw new Error('Invalid workspace service name');
}

function validatePath(value: string, label: string): void {
  if (!value || value.includes('\0') || /[\r\n]/.test(value) || !value.startsWith('/'))
    throw new Error(`${label} must be a newline-free absolute path`);
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function systemdArg(value: string): string {
  // ExecStart is parsed by systemd, not a shell. Double quoted arguments preserve spaces;
  // percent and dollar are escaped because systemd expands specifiers and variables.
  return `"${value
    .replaceAll('%', '%%')
    .replaceAll('$', () => '$$')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')}"`;
}

function servicePath(nodePath: string, instaboxPath?: string): string {
  const directories = [dirname(nodePath), ...(instaboxPath ? [dirname(instaboxPath)] : [])];
  if (directories.some((directory) => directory.includes(':')))
    throw new Error('Node and Instabox directories cannot contain a colon in the service PATH.');
  return [
    ...new Set([
      ...directories,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]),
  ].join(':');
}

export async function resolveInstaboxExecutable(
  options: {
    searchPath?: string;
    home?: string;
  } = {},
): Promise<string> {
  const home = options.home ?? homedir();
  validatePath(home, 'Home directory');
  const directories = [
    ...(options.searchPath ?? process.env.PATH ?? '').split(':').filter(Boolean),
    join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  const visited = new Set<string>();
  for (const directory of directories) {
    if (!directory.startsWith('/') || directory.includes('\0') || /[\r\n]/.test(directory))
      continue;
    const normalized = resolve(directory);
    if (visited.has(normalized)) continue;
    visited.add(normalized);
    const candidate = join(normalized, 'instabox');
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      await access(candidate, constants.X_OK);
      const executable = await realpath(candidate);
      validatePath(executable, 'Instabox path');
      return executable;
    } catch {
      // Keep searching the bounded list of absolute executable locations.
    }
  }
  throw new Error('Could not find an executable Instabox CLI in PATH or ~/.local/bin.');
}

function ownerMarker(platform: WorkspaceServicePlatform, name: string): string {
  return platform === 'darwin'
    ? `<!-- agent-drive-workspace-service:v1:${name} -->`
    : `# agent-drive-workspace-service:v1:${name}`;
}

function normalizedConfigPath(
  options: Pick<WorkspaceServiceOptions, 'configPath' | 'home'>,
): string {
  return resolve(
    options.configPath ?? join(options.home ?? homedir(), '.config', 'agent-drive', 'config.json'),
  );
}

function registryOwnerMarker(configPath: string): string {
  const digest = createHash('sha256').update(resolve(configPath)).digest('hex');
  return `# agent-drive-workspace-service-registry:v1:${digest}`;
}

function isLegacyOwnedDefinition(
  value: string,
  platform: WorkspaceServicePlatform,
  name: string,
  configPath: string,
): boolean {
  if (platform === 'linux') {
    const lines = value.replace(/\n+$/u, '').split('\n');
    return (
      lines.length === 13 &&
      lines[0] === '# Managed by Agent Drive. Do not edit while the named mount is installed.' &&
      lines[1] === '[Unit]' &&
      lines[2] === `Description=Agent Drive persistent mount ${name}` &&
      lines[3] === '' &&
      lines[4] === '[Service]' &&
      /^Environment="PATH=(?:\\.|[^"\\])*"$/u.test(lines[5] ?? '') &&
      lines[6] === `Environment=${systemdArg(`AGENT_DRIVE_CONFIG=${resolve(configPath)}`)}` &&
      lines[7] === 'Type=simple' &&
      new RegExp(
        `^ExecStart="/(?:\\\\.|[^"\\\\])*" "/(?:\\\\.|[^"\\\\])*" "mount" "--name" "${name}"$`,
        'u',
      ).test(lines[8] ?? '') &&
      lines[9] === 'Restart=on-failure' &&
      lines[10] === '' &&
      lines[11] === '[Install]' &&
      lines[12] === 'WantedBy=default.target'
    );
  }
  return (
    value.includes(`<key>Label</key><string>com.agentdrive.mount.${name}</string>`) &&
    value.includes('<key>EnvironmentVariables</key>') &&
    /<key>PATH<\/key><string>\/(?:\\.|[^<])*<\/string>/u.test(value) &&
    value.includes(`<key>AGENT_DRIVE_CONFIG</key><string>${xml(resolve(configPath))}</string>`) &&
    new RegExp(
      `<key>ProgramArguments</key>\\s*<array>\\s*<string>/(?:\\\\.|[^<])*<\\/string>\\s*<string>/(?:\\\\.|[^<])*<\\/string>\\s*<string>mount<\\/string>\\s*<string>--name<\\/string>\\s*<string>${name}<\\/string>\\s*<\\/array>`,
      'u',
    ).test(value)
  );
}

function isOwnedDefinition(
  value: string,
  platform: WorkspaceServicePlatform,
  name: string,
  configPath: string,
): boolean {
  const lines = value.split(/\r?\n/u).map((line) => line.trim());
  // OS service filenames use only the mount name, while names are scoped to a
  // credential registry. Require the exact config path, including for legacy files.
  if (platform === 'linux') {
    const hasNameMarker = lines.includes(ownerMarker(platform, name));
    const hasConfigPath = lines.includes(
      `Environment=${systemdArg(`AGENT_DRIVE_CONFIG=${resolve(configPath)}`)}`,
    );
    const registryMarker = registryOwnerMarker(configPath);
    const registryMarkers = lines.filter((line) =>
      line.startsWith('# agent-drive-workspace-service-registry:'),
    );
    return (
      (hasNameMarker &&
        hasConfigPath &&
        (registryMarkers.length === 0 || lines.includes(registryMarker))) ||
      isLegacyOwnedDefinition(value, platform, name, configPath)
    );
  }
  return (
    (lines.includes(ownerMarker(platform, name)) ||
      isLegacyOwnedDefinition(value, platform, name, configPath)) &&
    value.includes(`<key>AGENT_DRIVE_CONFIG</key><string>${xml(resolve(configPath))}</string>`)
  );
}

export function workspaceServicePaths(
  options: Pick<WorkspaceServiceOptions, 'platform' | 'home' | 'name'>,
): WorkspaceServicePaths {
  validateName(options.name);
  const platform = platformOf(options.platform);
  const home = options.home ?? process.env.HOME;
  if (!home) throw new Error('Could not determine the user home directory');
  validatePath(home, 'Home directory');
  const directory =
    platform === 'darwin'
      ? join(home, 'Library', 'LaunchAgents')
      : join(home, '.config', 'systemd', 'user');
  const filename =
    platform === 'darwin'
      ? `com.agentdrive.mount.${options.name}.plist`
      : `agent-drive-mount-${options.name}.service`;
  return { directory, path: join(directory, filename) };
}

export function renderWorkspaceService(
  options: Pick<
    WorkspaceServiceOptions,
    'platform' | 'home' | 'name' | 'cliPath' | 'nodePath' | 'configPath' | 'instaboxPath'
  >,
): string {
  validateName(options.name);
  validatePath(options.cliPath, 'CLI path');
  const platform = platformOf(options.platform);
  const nodePath = options.nodePath ?? process.execPath;
  validatePath(nodePath, 'Node path');
  if (options.instaboxPath) validatePath(options.instaboxPath, 'Instabox path');
  const instaboxPath = options.instaboxPath ? resolve(options.instaboxPath) : undefined;
  const path = servicePath(nodePath, instaboxPath);
  const configFilePath = normalizedConfigPath(options);
  validatePath(configFilePath, 'Agent Drive config path');
  if (platform === 'darwin') {
    const label = `com.agentdrive.mount.${options.name}`;
    const args = [nodePath, options.cliPath, 'mount', '--name', options.name]
      .map((arg) => `    <string>${xml(arg)}</string>`)
      .join('\n');
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      `  ${ownerMarker(platform, options.name)}`,
      `  <key>Label</key><string>${xml(label)}</string>`,
      '  <key>EnvironmentVariables</key>',
      '  <dict>',
      `    <key>PATH</key><string>${xml(path)}</string>`,
      `    <key>AGENT_DRIVE_CONFIG</key><string>${xml(configFilePath)}</string>`,
      ...(instaboxPath
        ? [`    <key>AGENT_DRIVE_INSTABOX_CLI</key><string>${xml(instaboxPath)}</string>`]
        : []),
      '  </dict>',
      '  <key>ProgramArguments</key>',
      '  <array>',
      args,
      '  </array>',
      '  <key>RunAtLoad</key><true/>',
      '  <key>KeepAlive</key><true/>',
      '  <key>StandardOutPath</key><string>/dev/null</string>',
      '  <key>StandardErrorPath</key><string>/dev/null</string>',
      '</dict>',
      '</plist>',
      '',
    ].join('\n');
  }
  return [
    ownerMarker(platform, options.name),
    registryOwnerMarker(configFilePath),
    '[Unit]',
    `Description=Agent Drive persistent mount ${options.name}`,
    '',
    '[Service]',
    `Environment=${systemdArg(`PATH=${path}`)}`,
    `Environment=${systemdArg(`AGENT_DRIVE_CONFIG=${configFilePath}`)}`,
    ...(instaboxPath
      ? [`Environment=${systemdArg(`AGENT_DRIVE_INSTABOX_CLI=${instaboxPath}`)}`]
      : []),
    'Type=simple',
    `ExecStart=${[nodePath, options.cliPath, 'mount', '--name', options.name].map(systemdArg).join(' ')}`,
    'Restart=on-failure',
    // mixed mode signals only the mount process first, keeping the SSH transport
    // alive while open files drain; systemd kills remaining children at timeout.
    'KillMode=mixed',
    'TimeoutStopSec=5min',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

function contents(options: WorkspaceServiceOptions): string {
  return renderWorkspaceService(options);
}

export async function getWorkspaceServiceStatus(
  options: WorkspaceServiceOptions,
): Promise<WorkspaceServiceStatus> {
  const { path } = workspaceServicePaths(options);
  const platform = platformOf(options.platform);
  let existing: string;
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      (info.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())
    )
      return { state: 'conflict', path };
    existing = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing', path };
    throw error;
  }
  return {
    state: isOwnedDefinition(existing, platform, options.name, normalizedConfigPath(options))
      ? 'installed'
      : 'conflict',
    path,
  };
}

export async function installWorkspaceService(
  options: WorkspaceServiceOptions,
): Promise<{ state: 'installed'; path: string; updated: boolean }> {
  const { directory, path } = workspaceServicePaths(options);
  const expected = contents(options);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const current = await getWorkspaceServiceStatus(options);
  if (current.state === 'installed') {
    const existing = await readFile(path, 'utf8');
    if (existing === expected) return { state: 'installed', path, updated: false };
    const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(expected, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      const currentInfo = await lstat(path);
      const currentText = await readFile(path, 'utf8');
      if (
        !currentInfo.isFile() ||
        (currentInfo.mode & 0o777) !== 0o600 ||
        (typeof process.getuid === 'function' && currentInfo.uid !== process.getuid()) ||
        !isOwnedDefinition(
          currentText,
          platformOf(options.platform),
          options.name,
          normalizedConfigPath(options),
        )
      )
        throw new Error(`Refusing to update an unowned service definition at ${path}`);
      await rename(temporaryPath, path);
    } finally {
      await unlink(temporaryPath).catch(() => {});
    }
    return { state: 'installed', path, updated: true };
  }
  if (current.state === 'conflict') throw new Error(`Service definition collision at ${path}`);

  // Write a private temporary file, then hard-link it into place without replacing a collision.
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(expected, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') throw new Error(`Service definition collision at ${path}`);
      throw error;
    });
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
  return { state: 'installed', path, updated: false };
}

export async function removeWorkspaceService(
  options: WorkspaceServiceOptions,
  runner: WorkspaceServiceRunner = runCommand,
): Promise<{ state: 'removed' | 'missing'; path: string }> {
  const status = await getWorkspaceServiceStatus(options);
  if (status.state === 'missing') return { state: 'missing', path: status.path };
  if (status.state === 'conflict')
    throw new Error(
      `Refusing to remove a service definition without matching ownership at ${status.path}`,
    );
  await deactivateWorkspaceService(options, runner);
  // Re-read just before unlink so edits made after the status check are preserved.
  const current = await readFile(status.path, 'utf8');
  if (
    !isOwnedDefinition(
      current,
      platformOf(options.platform),
      options.name,
      normalizedConfigPath(options),
    )
  )
    throw new Error(
      `Refusing to remove a service definition without matching ownership at ${status.path}`,
    );
  await unlink(status.path);
  if (platformOf(options.platform) === 'linux') {
    const result = await runner('/usr/bin/systemctl', ['--user', 'daemon-reload']);
    if (result.code !== 0)
      throw new Error(
        `Could not reload the systemd user manager after removing ${status.path}: ${result.stderr || result.stdout}`,
      );
  }
  return { state: 'removed', path: status.path };
}

function serviceTarget(options: WorkspaceServiceOptions) {
  const platform = platformOf(options.platform);
  const paths = workspaceServicePaths(options);
  return platform === 'darwin'
    ? { platform, paths, unit: `com.agentdrive.mount.${options.name}` }
    : { platform, paths, unit: `agent-drive-mount-${options.name}.service` };
}

function launchAgentDomain(): string {
  if (typeof process.getuid !== 'function')
    throw new Error('Could not determine the current user for launchctl');
  return `gui/${process.getuid()}`;
}

async function assertOwned(options: WorkspaceServiceOptions): Promise<WorkspaceServicePaths> {
  const status = await getWorkspaceServiceStatus(options);
  if (status.state !== 'installed')
    throw new Error(
      `Refusing service-manager operation because the definition is ${status.state}: ${status.path}`,
    );
  return workspaceServicePaths(options);
}

export async function activateWorkspaceService(
  options: WorkspaceServiceOptions,
  runner: WorkspaceServiceRunner = runCommand,
): Promise<void> {
  const target = serviceTarget(options);
  const paths = await assertOwned(options);
  const runtime = await getWorkspaceServiceRuntimeStatus(options, runner);
  if (runtime.active) return;
  const commands: Array<[string, string[]]> =
    target.platform === 'darwin'
      ? [['/bin/launchctl', ['bootstrap', launchAgentDomain(), paths.path]]]
      : [
          ['/usr/bin/systemctl', ['--user', 'daemon-reload']],
          ['/usr/bin/systemctl', ['--user', 'enable', '--now', target.unit]],
        ];
  for (const [command, args] of commands) {
    const result = await runner(command, args);
    if (result.code !== 0)
      throw new Error(
        `Could not activate workspace service (${command} ${args.join(' ')}): ${result.stderr || result.stdout}`,
      );
  }
}

export async function restartWorkspaceService(
  options: WorkspaceServiceOptions,
  runner: WorkspaceServiceRunner = runCommand,
): Promise<{ restarted: boolean; active: boolean }> {
  await assertOwned(options);
  const before = await getWorkspaceServiceRuntimeStatus(options, runner);
  if (!before.active) return { restarted: false, active: false };
  await deactivateWorkspaceService(options, runner);
  await activateWorkspaceService(options, runner);
  const after = await getWorkspaceServiceRuntimeStatus(options, runner);
  if (!after.active) throw new Error('Workspace service did not become active after restart.');
  return { restarted: true, active: true };
}

export async function deactivateWorkspaceService(
  options: WorkspaceServiceOptions,
  runner: WorkspaceServiceRunner = runCommand,
): Promise<void> {
  const target = serviceTarget(options);
  const paths = await assertOwned(options);
  const runtime = await getWorkspaceServiceRuntimeStatus(options, runner);
  if (target.platform === 'darwin' && !runtime.active) return;
  const command = target.platform === 'darwin' ? '/bin/launchctl' : '/usr/bin/systemctl';
  const args =
    target.platform === 'darwin'
      ? ['bootout', launchAgentDomain(), paths.path]
      : ['--user', 'disable', '--now', target.unit];
  // This blocking systemctl command waits for the stop job; its deadline must
  // exceed the unit's TimeoutStopSec so the inactive check can run afterward.
  const result = await runner(
    command,
    args,
    target.platform === 'linux' ? { timeoutMs: 6 * 60_000 } : undefined,
  );
  if (result.code !== 0)
    throw new Error(
      `Could not deactivate workspace service (${command} ${args.join(' ')}): ${result.stderr || result.stdout}`,
    );
  if (target.platform === 'linux') {
    // systemctl --now waits for the stop job; confirm it is inactive before callers remove the unit.
    const stopped = await getWorkspaceServiceRuntimeStatus(options, runner);
    if (stopped.active)
      throw new Error(`Workspace service did not become inactive after stopping: ${paths.path}`);
    if (runtime.active) {
      const stopResult = await runner('/usr/bin/systemctl', [
        '--user',
        'show',
        '--property=Result',
        '--value',
        target.unit,
      ]);
      if (stopResult.code !== 0 || stopResult.stdout.trim() !== 'success')
        throw new Error(
          `Workspace service stop did not complete successfully: ${stopResult.stderr || stopResult.stdout || `systemctl exited ${stopResult.code}`}`,
        );
    }
  }
}

export async function getWorkspaceServiceRuntimeStatus(
  options: WorkspaceServiceOptions,
  runner: WorkspaceServiceRunner = runCommand,
): Promise<WorkspaceServiceStatus & { active: boolean }> {
  const target = serviceTarget(options);
  const status = await getWorkspaceServiceStatus(options);
  if (status.state !== 'installed') return { ...status, active: false };
  const command = target.platform === 'darwin' ? '/bin/launchctl' : '/usr/bin/systemctl';
  const args =
    target.platform === 'darwin'
      ? ['print', `${launchAgentDomain()}/${target.unit}`]
      : ['--user', 'is-active', target.unit];
  const result = await runner(command, args);
  return { ...status, active: result.code === 0 };
}
