#!/usr/bin/env node
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { AgentDriveClient, AgentDriveApiError, publicOutput } from './client.js';
import { generateDriveKey } from './crypto.js';
import {
  apiErrorLines,
  createdDriveNote,
  localKeyMap,
  notBackedUpMessage,
  pickCheckDrive,
  runCheck,
  backupCandidates,
} from './check.js';
import {
  BACKUP_HINT,
  confirmCredentials,
  exportCredentials,
  importCredentials,
  issueCredentials,
  loadConfig,
  reportEnvBackups,
  unbackedUp,
  reportKeyBackup,
} from './credentials.js';
import { installSkill, packagedSkillPath } from './skill.js';
import {
  configPath,
  driveKeyEnvironmentName,
  keysForOrigin,
  machineName,
  resolveLoginApiUrl,
  resolveDriveId,
  resolveConnection,
  resolveDriveKey,
  writeConfig,
  type AgentDriveConfig,
} from './config.js';
import {
  autoSealHeldKeys,
  heldSealTargets,
  recordAgentOnlyDrive,
  sealClientWithDeadline,
  sealDrivesToAccount,
} from './account-seal.js';
import { syncDirectory } from './sync.js';
import { backupDirectory } from './backup.js';
import { CLIPBOARD_CLEAR_SECONDS } from './backup-targets.js';
import { defaultAgentName, deviceLogin, grantLogin, shouldOpenBrowser } from './device.js';
import { runMcp } from './mcp.js';
import { runCapture } from './capture.js';

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
// delay or fail the command it piggybacks on. `done` waits on this set so tests can observe it.
const pendingSeals = new Set<Promise<void>>();

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
  opts: { driveIds?: string[]; force?: boolean; selectedDriveId?: string; keyFile?: string },
) {
  const seal = sealClientWithDeadline(connection.apiUrl, connection.apiKey, machineName());
  sealInBackground(() =>
    autoSealHeldKeys({
      client: seal.client,
      config: connection.config,
      ...opts,
      deadline: seal.deadline,
      warn: (line) => process.stderr.write(`${line}\n`),
    }),
  );
}

async function connect(args: ReturnType<typeof parse>) {
  const connection = await resolveConnection();
  await reportEnvBackups(connection.apiUrl, connection.apiKey);
  // Kept apart from args.values.drive: `check` has its own selection when --drive is omitted.
  try {
    defaultDrive = resolveDriveId(undefined, connection.config, connection.apiUrl);
  } catch (error) {
    missingDrive = error instanceof Error ? error.message : undefined;
  }
  const drive = args.values.drive?.[0] ?? defaultDrive;
  const driveKey = drive
    ? await resolveDriveKey(drive, args.values['key-file'], connection.config)
    : undefined;
  const client = new AgentDriveClient({
    apiUrl: connection.apiUrl,
    apiKey: connection.apiKey,
    machine: machineName(),
    ...(driveKey ? { driveKey } : {}),
  });
  // Throttled (24h/drive) account-key sealing on any command that loads a drive key.
  if (driveKey)
    sealHook(connection, {
      ...(drive ? { selectedDriveId: drive } : {}),
      ...(args.values['key-file'] ? { keyFile: args.values['key-file'] } : {}),
    });
  return client;
}

// Set by connect() when no --drive was given and no single default exists.
let missingDrive: string | undefined;
let defaultDrive: string | undefined;

/** Forced account-key seal after login/grant/import put drive keys on this machine. */
function sealAfterKeyChange() {
  sealInBackground(async () => {
    const config = await loadConfig();
    if (!config.apiUrl || !config.apiKey) return;
    const seal = sealClientWithDeadline(config.apiUrl, config.apiKey, machineName());
    await autoSealHeldKeys({
      client: seal.client,
      config,
      force: true,
      deadline: seal.deadline,
      warn: (line) => process.stderr.write(`${line}\n`),
    });
  });
}

function requiredDrive(args: ReturnType<typeof parse>) {
  const id = args.values.drive?.[0] ?? defaultDrive;
  if (!id) throw new Error(missingDrive ?? 'A --drive ID is required.');
  return id;
}

function limit(value: string | undefined) {
  return value === undefined ? undefined : Number(value);
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
    if (flags.positionals.length || !wrapped.length)
      throw new Error('Usage: capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]');
    process.exitCode = await runCapture({
      command: wrapped,
      ...(flags.values.agent ? { agent: flags.values.agent } : {}),
      ...(flags.values.drive?.[0] ? { drive: flags.values.drive[0] } : {}),
    });
    return;
  }
  const args = parse(raw);
  if (command === 'login') {
    const apiUrl = await resolveLoginApiUrl(args.values.api);
    const apiKey =
      process.env.AGENT_DRIVE_API_KEY ?? (args.values['token-stdin'] ? await stdinText() : '');
    if (!apiKey) {
      await deviceLogin({
        apiUrl,
        name: args.values.name ?? defaultAgentName(),
        machine: machineName(),
        log: (line) => process.stdout.write(`${line}\n`),
        openBrowser: shouldOpenBrowser(args.values['no-browser']),
      });
      sealAfterKeyChange();
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
    const connection = await resolveConnection();
    await reportEnvBackups(connection.apiUrl, connection.apiKey);
    const driveId = resolveDriveId(args.values.drive?.[0], connection.config, connection.apiUrl);
    const key = await resolveDriveKey(driveId, args.values['key-file'], connection.config);
    // Throttled account-key sealing, same as the generic connect() path (backup bypasses it).
    if (key)
      sealHook(connection, {
        selectedDriveId: driveId,
        ...(args.values['key-file'] ? { keyFile: args.values['key-file'] } : {}),
      });
    const backupClient = new AgentDriveClient({
      apiUrl: connection.apiUrl,
      apiKey: connection.apiKey,
      machine: machineName(),
      ...(key ? { driveKey: key } : {}),
    });
    const dryRun = args.values['dry-run'] ?? false;
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
    const written = await installSkill(args.values.target);
    if (!written.length)
      process.stdout.write(
        `No ~/.claude or ~/.codex directory found. The skill is at ${packagedSkillPath()}; copy it to <skills dir>/agent-drive/SKILL.md, or use --target <dir>.\n`,
      );
    for (const path of written) process.stdout.write(`wrote ${path}\n`);
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
        `Backed up credentials for ${result.driveIds.length} drive(s) (${result.method}).\n`,
      );
      await reportKeyBackup(result.apiUrl, result.apiKey, result.driveIds, result.method);
      return;
    }
    if (sub === 'issue') {
      if (!args.values.name) throw new Error('--name is required.');
      const client = await connect(args);
      const result = await issueCredentials(
        {
          name: args.values.name,
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
      const ids = await importCredentials(text, args.values.from ? 'file' : 'stdout');
      process.stdout.write(`imported ${ids.length} drive key(s) into ${configPath()}\n`);
      sealAfterKeyChange();
      return;
    }
    if (sub === 'status') {
      const config = await loadConfig();
      return output({
        drives: Object.fromEntries(
          Object.keys(config.driveKeys ?? {}).map((id) => [
            id,
            config.keyBackup?.[id]
              ? { backedUp: true, ...config.keyBackup[id] }
              : { backedUp: false },
          ]),
        ),
      });
    }
    throw new Error(
      'Usage: credentials export (--to 1password [--vault NAME] | --to clipboard [--keep-clipboard] | --to PATH [--force] | --stdout) | issue --name NAME (--to PATH [--force] | --stdout) | confirm [--method stdout] | import [--from PATH] | status',
    );
  }
  if (command === 'grant') {
    const code = args.positionals[0];
    if (!code) throw new Error('grant requires the CODE shown by `agent-drive login`.');
    const connection = await resolveConnection();
    const drive = args.values.drive?.[0];
    await grantLogin({
      code,
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
    sealAfterKeyChange();
    return;
  }
  if (command === 'account' && args.positionals[0] === 'seal') {
    const connection = await resolveConnection();
    const client = new AgentDriveClient({
      apiUrl: connection.apiUrl,
      apiKey: connection.apiKey,
      machine: machineName(),
    });
    const driveIds = args.values.drive?.length ? args.values.drive : undefined;
    // Paginate fully. A key without `read` cannot list (403): named drives still seal through
    // the slot endpoint's own checks plus this machine's agent-only list.
    const flags = new Map<string, boolean>();
    let listed: string[] | null = [];
    try {
      let cursor: string | undefined;
      for (let page = 0; page < 50; page += 1) {
        const res = await client.listDrives(undefined, cursor);
        for (const drive of res.items ?? []) {
          listed.push(drive.id);
          flags.set(drive.id, drive.agentOnly === true);
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
    const result = await sealDrivesToAccount({
      client,
      config: connection.config,
      targets,
      force: true,
      repin: args.values.repin === true,
    });
    for (const target of targets)
      process.stdout.write(`${target.driveId}: ${result.get(target.driveId)!}\n`);
    return;
  }
  const client = await connect(args);
  if (command === 'whoami') {
    const who = await client.whoami();
    const config = await loadConfig();
    return output({
      ...who,
      localDriveKeys: await localKeyMap(who.driveIds, (id) =>
        resolveDriveKey(id, args.values['key-file'], config),
      ),
      keyBackup: Object.fromEntries(
        Object.keys(config.driveKeys ?? {})
          .filter((id) => !who.driveIds || who.driveIds.includes(id))
          .map((id) => [id, config.keyBackup?.[id] ?? null]),
      ),
    });
  }
  if (command === 'check') {
    const connection = await resolveConnection();
    const who = await client.whoami();
    const candidates = who.driveIds ?? Object.keys(connection.config.driveKeys ?? {});
    const explicit = args.values.drive?.[0];
    const keys = await localKeyMap([...candidates, ...(explicit ? [explicit] : [])], (id) =>
      resolveDriveKey(id, args.values['key-file'], connection.config),
    );
    const driveId = pickCheckDrive(explicit, candidates, keys);
    const unbacked = unbackedUp(
      connection.config,
      backupCandidates(keys, driveId, args.values['key-file']),
    );
    if (unbacked.length) throw new Error(notBackedUpMessage(unbacked));
    const key = await resolveDriveKey(driveId, args.values['key-file'], connection.config);
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
    const drive = await client.createDrive(
      name,
      limit(args.values.quota),
      args.values['agent-only'] ? true : undefined,
    );
    // Agent-only is recorded locally at creation: seals skip this drive even if a later
    // listing (or a caller without it) says otherwise.
    if (drive.agentOnly === true) await recordAgentOnlyDrive(drive.id);
    const connection = await resolveConnection();
    const saved = await loadConfig();
    const existingKey = await resolveDriveKey(drive.id, args.values['key-file'], saved);
    if (drive.created) {
      const key = generateDriveKey();
      await writeConfig({
        driveKeys: { [drive.id]: key },
        driveKeyOrigins: { [drive.id]: new URL(connection.apiUrl).origin },
      });
      output(drive);
      process.stderr.write(`${createdDriveNote(configPath())}\n${BACKUP_HINT}\n`);
    } else {
      if (!existingKey)
        throw new Error(
          `Drive ${drive.id} already exists; load its backup through ${driveKeyEnvironmentName(drive.id)}.`,
        );
      output(drive);
    }
    // Reloaded after the write above so the seal sees the just-created key.
    sealHook(
      { ...connection, config: await loadConfig() },
      {
        driveIds: [drive.id],
        force: true,
        selectedDriveId: drive.id,
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
    if (args.values.overwrite && args.values['if-version'])
      throw new Error('--overwrite and --if-version are mutually exclusive.');
    const version = await client.put(requiredDrive(args), remote, await readFile(local), {
      ...(args.values.overwrite ? { mode: 'overwrite' as const } : {}),
      ...(args.values['if-version'] ? { ifVersionId: args.values['if-version'] } : {}),
      ...(args.values.description ? { description: args.values.description } : {}),
      ...(args.values.user ? { userId: args.values.user } : {}),
      ...(args.values.tag ? { tags: args.values.tag } : {}),
    });
    return output(version);
  }
  if (command === 'get') {
    const remote = args.positionals[0];
    if (!remote) throw new Error('get requires REMOTE.');
    const result = await client.get(
      requiredDrive(args),
      remote,
      args.values.version ? { versionId: args.values.version } : {},
    );
    if (args.values.output) {
      await writeFile(args.values.output, result.bytes, { mode: 0o600 });
      return output(result.version);
    }
    if (result.bytes.byteLength > 1024 * 1024)
      throw new Error('Binary or large output requires --output.');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes);
    } catch {
      throw new Error('Binary output requires --output.');
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) {
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
    return output(
      await syncDirectory(client, requiredDrive(args), args.positionals[0], args.values.prefix, {
        ...(args.values['overwrite-existing'] === undefined
          ? {}
          : { overwriteExisting: args.values['overwrite-existing'] }),
      }),
    );
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
  put LOCAL REMOTE --drive ID [--if-version ID | --overwrite]
  get REMOTE --drive ID [--output FILE]
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
  backup LOCAL_DIRECTORY [--drive ID] [--prefix PATH] [--exclude GLOB]... [--gitignore] [--dry-run] [--yes]
                                        Scans the folder first, then uploads. --gitignore skips paths the folder's .gitignore excludes.
                                        --exclude GLOB matches the root-relative path: 'build/**' skips everything under build/,
                                        '**/node_modules' skips node_modules at any depth, a bare 'node_modules' only the top-level one.
                                        Over 5000 files or 1 GiB needs --yes (or preview with --dry-run). One backup per prefix at a time.
  version                               Print the CLI version
  grant CODE [--drive ID] [--read-only] [--scope S]... [--write-path P]...   Seal this machine's drive key for the login showing CODE; the owner then approves it on /connect
  credentials export (--to 1password [--vault NAME] | --to clipboard [--keep-clipboard] | --to PATH [--force] | --stdout)
                                        Back up the API key and drive keys (bundle "adcred1.…"). Offer 1Password first, then the clipboard (for Apple Passwords or another manager), then a file outside the repo
  credentials issue --name NAME [--drive ID] [--scope S]... [--write-path P]... [--label L] (--to PATH [--force] | --stdout)
                                        Mint a new agent's key (needs the delegate scope) and print its AGENT_DRIVE_CREDENTIALS line
  credentials confirm [--method stdout]   Record a --stdout export as stored (export --stdout | STORE && credentials confirm)
  credentials import [--from PATH]      Merge a bundle (file or stdin) into the config
  credentials status                    Which drive keys are backed up, when, and how
  account seal [--drive ID] [--repin]   Seal held drive keys to your account key for the console
  skill install [--target claude|codex|DIR]   Install the agent-drive SKILL.md for your agent
  capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]   Run an agent with its LLM calls saved as encrypted traces under /traces
  mcp

Without installing: npx -y @dennisonbertram/agent-drive@latest <command>

Global configuration: AGENT_DRIVE_CONFIG, AGENT_DRIVE_API_URL,
AGENT_DRIVE_API_KEY, AGENT_DRIVE_MACHINE, and AGENT_DRIVE_CREDENTIALS (a bundle merged in
memory, never written to disk; its drives count as backed up).
`;
// For `capture`, only flags before `--` are ours; the rest belongs to the wrapped command.
const ownArgs = name === 'capture' && raw.includes('--') ? raw.slice(0, raw.indexOf('--')) : raw;
let done: Promise<void>;
if (!name || name === 'help' || name === '--help' || ownArgs.includes('--help')) {
  process.stdout.write(help);
  done = Promise.resolve();
} else if (name === 'version' || name === '--version') {
  process.stdout.write(`${cliVersion}\n`);
  done = Promise.resolve();
} else if (name === 'mcp') {
  done = runMcp().catch(() => {
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
    .then(() => Promise.allSettled([...pendingSeals]).then(() => undefined));
}
// Exported so in-process tests can await a command's full lifecycle (including best-effort
// side effects like account sealing) instead of racing its first output line.
export { done };
