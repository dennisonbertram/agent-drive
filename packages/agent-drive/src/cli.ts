#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { AgentDriveClient, AgentDriveApiError } from './client.js';
import { generateDriveKey } from './crypto.js';
import { apiErrorLines, createdDriveNote, localKeyMap, pickCheckDrive, runCheck } from './check.js';
import {
  DEFAULT_API_URL,
  configPath,
  driveKeyEnvironmentName,
  machineName,
  readConfig,
  resolveConnection,
  resolveDriveKey,
  writeConfig,
} from './config.js';
import { syncDirectory } from './sync.js';
import { backupDirectory } from './backup.js';
import { defaultAgentName, deviceLogin, shouldOpenBrowser } from './device.js';
import { runMcp } from './mcp.js';

function parse(raw: string[]) {
  return parseArgs({
    args: raw,
    options: {
      api: { type: 'string' },
      'token-stdin': { type: 'boolean' },
      name: { type: 'string' },
      drive: { type: 'string', multiple: true },
      agent: { type: 'string' },
      scope: { type: 'string', multiple: true },
      label: { type: 'string' },
      quota: { type: 'string' },
      'key-file': { type: 'string' },
      output: { type: 'string' },
      'if-version': { type: 'string' },
      overwrite: { type: 'boolean' },
      'overwrite-existing': { type: 'boolean' },
      prefix: { type: 'string' },
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
    },
    allowPositionals: true,
    strict: true,
  });
}

function output(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
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

async function connect(args: ReturnType<typeof parse>) {
  const connection = await resolveConnection();
  const drive = args.values.drive?.[0];
  const driveKey = drive
    ? await resolveDriveKey(drive, args.values['key-file'], connection.config)
    : undefined;
  return new AgentDriveClient({
    apiUrl: connection.apiUrl,
    apiKey: connection.apiKey,
    machine: machineName(),
    ...(driveKey ? { driveKey } : {}),
  });
}

function requiredDrive(args: ReturnType<typeof parse>) {
  const id = args.values.drive?.[0];
  if (!id) throw new Error('A --drive ID is required.');
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
  const args = parse(raw);
  if (command === 'login') {
    const apiUrl = args.values.api ?? process.env.AGENT_DRIVE_API_URL ?? DEFAULT_API_URL;
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
      return;
    }
    const client = new AgentDriveClient({ apiUrl, apiKey, machine: machineName() });
    const who = await client.whoami();
    await writeConfig({ apiUrl, apiKey });
    output(who);
    return;
  }
  if (command === 'backup') {
    if (!args.positionals[0]) throw new Error('backup requires LOCAL_DIRECTORY.');
    const connection = await resolveConnection();
    let driveId = args.values.drive?.[0];
    if (!driveId) {
      const ids = Object.keys(connection.config.driveKeys ?? {});
      if (ids.length !== 1 || !ids[0])
        throw new Error('Pass --drive ID: the config does not hold exactly one drive key.');
      driveId = ids[0];
    }
    const key = await resolveDriveKey(driveId, args.values['key-file'], connection.config);
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
  const client = await connect(args);
  if (command === 'whoami') {
    const who = await client.whoami();
    const config = await readConfig();
    return output({
      ...who,
      localDriveKeys: await localKeyMap(who.driveIds, (id) =>
        resolveDriveKey(id, args.values['key-file'], config),
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
    const key = await resolveDriveKey(driveId, args.values['key-file'], connection.config);
    const checker = new AgentDriveClient({
      apiUrl: connection.apiUrl,
      apiKey: connection.apiKey,
      machine: machineName(),
      ...(key ? { driveKey: key } : {}),
    });
    process.stdout.write(`${await runCheck(checker, driveId)}\n`);
    return;
  }
  if (command === 'agent' && args.positionals[0] === 'create')
    return output(await client.createAgent(args.values.name ?? args.positionals[1] ?? ''));
  if (command === 'drive' && args.positionals[0] === 'create') {
    const name = args.values.name ?? args.positionals[1];
    if (!name) throw new Error('A drive name is required.');
    const drive = await client.createDrive(name, limit(args.values.quota));
    const saved = await readConfig();
    const existingKey = await resolveDriveKey(drive.id, args.values['key-file'], saved);
    if (drive.created) {
      const key = generateDriveKey();
      await writeConfig({
        driveKeys: { [drive.id]: key },
        driveKeyOrigins: { [drive.id]: new URL((await resolveConnection()).apiUrl).origin },
      });
      output(drive);
      process.stderr.write(`${createdDriveNote(configPath())}\n`);
    } else {
      if (!existingKey)
        throw new Error(
          `Drive ${drive.id} already exists; load its backup through ${driveKeyEnvironmentName(drive.id)}.`,
        );
      output(drive);
    }
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
      ),
    );
  }
  if (command === 'key' && args.positionals[0] === 'revoke') {
    if (!args.positionals[1]) throw new Error('A key ID is required.');
    return output(await client.revokeKey(args.positionals[1]));
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
  if (command === 'recent')
    return output(
      await client.recent(
        requiredDrive(args),
        args.values.since,
        limit(args.values.limit),
        args.values.cursor,
      ),
    );
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
  check [--drive ID]                    Write, read back, and compare a test file; prints "check ok"
  agent create --name NAME
  drive create --name NAME
  key create --agent ID --drive ID --label LABEL --scope read --scope write
  key revoke ID
  put LOCAL REMOTE --drive ID [--if-version ID | --overwrite]
  get REMOTE --drive ID [--output FILE]
  ls --drive ID [--prefix PATH] [--tag TAG] [--agent ID] [--machine NAME] [--user ID]
  mv SOURCE DESTINATION --drive ID
  cp SOURCE DESTINATION --drive ID
  rm PATH --drive ID
  versions PATH --drive ID
  restore PATH --drive ID [--version ID]
  search --drive ID [--query TEXT] [--tag TAG] [--agent ID] [--machine NAME] [--user ID]
  recent --drive ID [--since ISO_TIMESTAMP]
  share PATH --drive ID [--version ID] [--expires-in 30m|24h|7d]
  share list --drive ID
  share revoke SHARE_ID --drive ID
  sync LOCAL_DIRECTORY --drive ID [--prefix PATH] [--overwrite-existing]
  backup LOCAL_DIRECTORY [--drive ID] [--prefix PATH] [--dry-run]
  mcp

Without installing: npx -y https://agent-drive.vercel.app/cli/agent-drive.tgz <command>

Global configuration: AGENT_DRIVE_CONFIG, AGENT_DRIVE_API_URL,
AGENT_DRIVE_API_KEY, and AGENT_DRIVE_MACHINE.
`;
if (!name || name === 'help' || name === '--help' || raw.includes('--help')) {
  process.stdout.write(help);
} else if (name === 'mcp') {
  runMcp().catch(() => {
    process.stderr.write('MCP server failed to start.\n');
    process.exitCode = 1;
  });
} else {
  run(name, raw).catch((error: unknown) => {
    if (error instanceof AgentDriveApiError) {
      process.stderr.write(`${apiErrorLines(error).join('\n')}\n`);
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : 'Command failed.'}\n`);
    }
    process.exitCode = 1;
  });
}
