#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { AgentDriveClient, AgentDriveApiError } from './client.js';
import { generateDriveKey } from './crypto.js';
import {
  driveKeyEnvironmentName,
  machineName,
  readConfig,
  resolveConnection,
  resolveDriveKey,
  writeConfig,
} from './config.js';
import { syncDirectory } from './sync.js';

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

async function run(command: string, raw: string[]) {
  const args = parse(raw);
  if (command === 'login') {
    const apiUrl = args.values.api ?? process.env.AGENT_DRIVE_API_URL;
    const apiKey =
      process.env.AGENT_DRIVE_API_KEY ?? (args.values['token-stdin'] ? await stdinText() : '');
    if (!apiUrl || !apiKey)
      throw new Error('Set AGENT_DRIVE_API_URL and AGENT_DRIVE_API_KEY, or use --token-stdin.');
    const client = new AgentDriveClient({ apiUrl, apiKey, machine: machineName() });
    const who = await client.whoami();
    await writeConfig({ apiUrl, apiKey });
    output(who);
    return;
  }
  const client = await connect(args);
  if (command === 'whoami') return output(await client.whoami());
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
      await writeConfig({ driveKeys: { [drive.id]: key } });
      output({
        ...drive,
        driveKey: key,
        warning: 'Back up this drive key; it cannot be recovered.',
      });
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
  login --api URL --token-stdin
  whoami
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
  sync LOCAL_DIRECTORY --drive ID [--prefix PATH] [--overwrite-existing]

Global configuration: AGENT_DRIVE_CONFIG, AGENT_DRIVE_API_URL,
AGENT_DRIVE_API_KEY, and AGENT_DRIVE_MACHINE.
`;
if (!name || name === 'help' || name === '--help' || raw.includes('--help')) {
  process.stdout.write(help);
} else {
  run(name, raw).catch((error: unknown) => {
    const message =
      error instanceof AgentDriveApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Command failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
