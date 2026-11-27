import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDriveKey } from './crypto.js';
import { writeConfig } from './config.js';
import {
  describeMountpoint,
  findMountEntry,
  mountRegistryPath,
  mountStatus,
  registerLiveWorkspace,
  setLiveWorkspaceWakePolicy,
  readMountRegistry,
  registerMount,
  validateLiveWorkspaceMountpoint,
  unregisterLiveWorkspaceIfUnchanged,
} from './mount-registry.js';

const API = 'https://x.test/api';
const ORIGIN = 'https://x.test';
const DRIVE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function isolatedConfig() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-drive-mounts-'));
  dirs.push(dir);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
  return dir;
}

async function authorizedConfig(apiUrl = API) {
  const dir = await isolatedConfig();
  await writeConfig({
    apiUrl,
    apiKey: 'tok',
    driveKeys: { [DRIVE]: generateDriveKey() },
    driveKeyOrigins: { [DRIVE]: ORIGIN },
  });
  return dir;
}

function input(dir: string, extra: Record<string, unknown> = {}) {
  return {
    name: 'work',
    mountpoint: join(dir, 'mount'),
    driveId: DRIVE,
    apiUrl: API,
    ...extra,
  };
}

describe('mount registry storage', () => {
  it('stores mounts.json next to the config file', async () => {
    const dir = await isolatedConfig();
    expect(mountRegistryPath()).toBe(join(dir, 'mounts.json'));
  });

  it('treats a missing registry as empty without creating it', async () => {
    const dir = await isolatedConfig();
    expect(await readMountRegistry()).toEqual([]);
    await expect(stat(mountRegistryPath())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(mountRegistryPath().startsWith(dir)).toBe(true);
  });

  it('refuses to treat the credential config as a registry or overwrite it', async () => {
    const dir = await isolatedConfig();
    const credentialsPath = join(dir, 'mounts.json');
    const secretConfig = JSON.stringify({ apiUrl: API, apiKey: 'credential-secret' });
    await writeFile(credentialsPath, secretConfig, { mode: 0o600 });
    vi.stubEnv('AGENT_DRIVE_CONFIG', credentialsPath);

    await expect(registerMount(input(dir))).rejects.toThrow(/collides with.*config/i);
    expect(await readFile(credentialsPath, 'utf8')).toBe(secretConfig);
  });

  it('refuses an existing config-shaped JSON file at the registry path', async () => {
    const dir = await isolatedConfig();
    const registryPath = mountRegistryPath();
    const credentials = JSON.stringify({ apiUrl: API, apiKey: 'credential-secret' });
    await writeFile(registryPath, credentials, { mode: 0o600 });

    await expect(
      registerLiveWorkspace({
        name: 'coordinator',
        mountpoint: join(dir, 'coordinator'),
        sandboxId: 'm_01HZY6Y5JQKCN1W9F2NR4T7V8A',
        root: '/workspace/project',
      }),
    ).rejects.toThrow(/malformed|refusing to overwrite/i);
    expect(await readFile(registryPath, 'utf8')).toBe(credentials);
  });

  it('registers an entry with private file and directory permissions', async () => {
    const dir = await authorizedConfig();
    const nested = join(dir, 'new', 'agent-drive');
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(nested, 'config.json'));
    // writeConfig above ran before the env switch, so authorize again for the nested path.
    await writeConfig({
      apiUrl: API,
      apiKey: 'tok',
      driveKeys: { [DRIVE]: generateDriveKey() },
      driveKeyOrigins: { [DRIVE]: ORIGIN },
    });
    const entry = await registerMount(input(nested));
    expect((await stat(nested)).mode & 0o777).toBe(0o700);
    expect((await stat(mountRegistryPath())).mode & 0o777).toBe(0o600);
    expect(entry).toMatchObject({
      name: 'work',
      mountpoint: join(nested, 'mount'),
      driveId: DRIVE,
      apiUrl: API,
      readOnly: false,
    });
    expect(Date.parse(entry.registeredAt ?? '')).not.toBeNaN();
    expect(await readMountRegistry()).toEqual([entry]);
  });

  it('preserves the read-only flag and an exact sandbox ID verbatim', async () => {
    const dir = await authorizedConfig();
    const entry = await registerMount(
      input(dir, { readOnly: true, sandboxId: 'instabox-sbx-AbC_123.foo' }),
    );
    expect(entry.readOnly).toBe(true);
    expect(entry.sandboxId).toBe('instabox-sbx-AbC_123.foo');
    const raw = JSON.parse(await readFile(mountRegistryPath(), 'utf8')) as {
      mounts: Record<string, unknown>[];
    };
    expect(raw.mounts[0]).toMatchObject({ sandboxId: 'instabox-sbx-AbC_123.foo' });
    // No secret material is ever written into the registry.
    const text = await readFile(mountRegistryPath(), 'utf8');
    expect(text).not.toContain('tok');
  });

  it('registers live workspaces without Agent Drive cloud credentials', async () => {
    const dir = await isolatedConfig();
    const entry = await registerLiveWorkspace({
      name: 'coordinator',
      mountpoint: join(dir, 'coordinator'),
      sandboxId: 'm_01HZY6Y5JQKCN1W9F2NR4T7V8A',
      root: '/workspace/project',
    });

    expect(entry).toMatchObject({
      kind: 'live-workspace',
      name: 'coordinator',
      mountpoint: join(dir, 'coordinator'),
      sandboxId: 'm_01HZY6Y5JQKCN1W9F2NR4T7V8A',
      root: '/workspace/project',
      readOnly: false,
    });
    expect(await readMountRegistry()).toEqual([entry]);
    const text = await readFile(mountRegistryPath(), 'utf8');
    expect(text).not.toContain('driveId');
    expect(text).not.toContain('apiKey');
  });

  it('rejects a second live workspace alias while allowing a different workspace', async () => {
    const dir = await isolatedConfig();
    const first = {
      name: 'coordinator',
      mountpoint: join(dir, 'coordinator'),
      sandboxId: 'm_01HZY6Y5JQKCN1W9F2NR4T7V8A',
      root: '/workspace/project',
    };
    const registered = await registerLiveWorkspace(first, { preventFinderAliases: true });

    await expect(
      registerLiveWorkspace(
        {
          ...first,
          name: 'coordinator-alias',
          mountpoint: join(dir, 'coordinator-alias'),
        },
        { preventFinderAliases: true },
      ),
    ).rejects.toThrow(/already registered as 'coordinator'.*use that Finder mount/i);
    expect(await readMountRegistry()).toEqual([registered]);

    await expect(
      registerLiveWorkspace({
        ...first,
        name: 'linux-alias',
        mountpoint: join(dir, 'linux-alias'),
      }),
    ).resolves.toMatchObject({ name: 'linux-alias' });

    await expect(
      registerLiveWorkspace(
        {
          ...first,
          name: 'other-workspace',
          mountpoint: join(dir, 'other-workspace'),
          sandboxId: 'm_01HZY6Y5JQKCN1W9F2NR4T7V9B',
        },
        { preventFinderAliases: true },
      ),
    ).resolves.toMatchObject({ name: 'other-workspace' });
  });

  it('preflights Finder mountpoint parent and leaf before connect registration', async () => {
    const dir = await isolatedConfig();
    const missingParent = join(dir, 'missing', 'mount');
    await expect(validateLiveWorkspaceMountpoint(missingParent, 'darwin')).rejects.toThrow(
      /parent does not exist/i,
    );

    const file = join(dir, 'occupied-file');
    await writeFile(file, 'synthetic');
    await expect(validateLiveWorkspaceMountpoint(file, 'darwin')).rejects.toThrow(
      /mountpoint already exists/i,
    );

    const occupiedDirectory = join(dir, 'occupied-directory');
    await mkdir(occupiedDirectory);
    await expect(validateLiveWorkspaceMountpoint(occupiedDirectory, 'darwin')).rejects.toThrow(
      /mountpoint already exists/i,
    );

    const mountpoint = join(dir, 'mount');
    await expect(validateLiveWorkspaceMountpoint(mountpoint, 'darwin')).resolves.toBe(mountpoint);
    await expect(
      registerLiveWorkspace({
        name: 'recoverable',
        mountpoint,
        sandboxId: 'm_01HZY6Y5JQKCN1W9F2NR4T7V8A',
        root: '/workspace/project',
      }),
    ).resolves.toMatchObject({ name: 'recoverable' });
  });

  it('does not roll back a live workspace entry changed since startup began', async () => {
    const dir = await isolatedConfig();
    const entry = await registerLiveWorkspace({
      name: 'recoverable',
      mountpoint: join(dir, 'mount'),
      sandboxId: 'm_01HZY6Y5JQKCN1W9F2NR4T7V8A',
      root: '/workspace/project',
    });
    const registry = await readMountRegistry();
    await writeFile(
      mountRegistryPath(),
      JSON.stringify({ version: 1, mounts: [{ ...registry[0], readOnly: true }] }),
    );

    await expect(unregisterLiveWorkspaceIfUnchanged(entry)).resolves.toBe(false);
    await expect(readMountRegistry()).resolves.toMatchObject([
      { name: 'recoverable', readOnly: true },
    ]);
  });

  it('changes wake policy under the registry lock without contacting Instabox', async () => {
    const dir = await isolatedConfig();
    await registerLiveWorkspace({
      name: 'coordinator',
      mountpoint: join(dir, 'coordinator'),
      sandboxId: 'm_01HZY6Y5JQKCN1W9F2NR4T7V8A',
      root: '/workspace/project',
    });
    expect(await setLiveWorkspaceWakePolicy('coordinator', false)).toMatchObject({
      kind: 'live-workspace',
      wakeOnAccess: false,
    });
    expect(await readMountRegistry()).toMatchObject([{ name: 'coordinator', wakeOnAccess: false }]);
    await expect(setLiveWorkspaceWakePolicy('missing', true)).rejects.toThrow(
      /no mount registered/i,
    );
    await writeFile(
      mountRegistryPath(),
      JSON.stringify({
        version: 1,
        mounts: [
          ...(await readMountRegistry()),
          {
            kind: 'drive',
            name: 'drive',
            mountpoint: join(dir, 'drive'),
            driveId: DRIVE,
            apiUrl: API,
            readOnly: false,
          },
        ],
      }),
    );
    await expect(setLiveWorkspaceWakePolicy('drive', true)).rejects.toThrow(
      /not a live workspace/i,
    );
  });

  it('reads older registry entries without a kind as drive mounts', async () => {
    const dir = await isolatedConfig();
    await writeFile(
      mountRegistryPath(),
      JSON.stringify({
        version: 1,
        mounts: [{ name: 'legacy', mountpoint: join(dir, 'mount'), driveId: DRIVE, apiUrl: API }],
      }),
    );

    expect(await readMountRegistry()).toMatchObject([{ kind: 'drive', name: 'legacy' }]);
  });

  it('canonicalizes the mountpoint before storing and comparing it', async () => {
    const dir = await authorizedConfig();
    const entry = await registerMount(input(dir, { mountpoint: join(dir, 'a', '..', 'mount/') }));
    expect(entry.mountpoint).toBe(join(dir, 'mount'));
    await expect(registerMount({ ...input(dir), name: 'other' })).rejects.toThrow(
      'already registered',
    );
  });

  it('rejects duplicate names and mountpoints inside the write lock', async () => {
    const dir = await authorizedConfig();
    await registerMount(input(dir));
    await expect(registerMount(input(dir, { mountpoint: join(dir, 'elsewhere') }))).rejects.toThrow(
      `A mount named 'work' is already registered`,
    );
    await expect(registerMount({ ...input(dir), name: 'other' })).rejects.toThrow(
      `is already registered as 'work'`,
    );
    expect((await readMountRegistry()).length).toBe(1);
  });

  it('appends distinct entries in registration order', async () => {
    const dir = await authorizedConfig();
    await writeConfig({
      driveKeys: { [OTHER]: generateDriveKey() },
      driveKeyOrigins: { [OTHER]: ORIGIN },
    });
    const first = await registerMount(input(dir));
    const second = await registerMount({
      ...input(dir),
      name: 'scratch',
      mountpoint: join(dir, 'scratch'),
      driveId: OTHER,
    });
    expect(await readMountRegistry()).toEqual([first, second]);
  });
});

describe('mount registry validation', () => {
  it.each([
    ['an empty name', { name: '' }],
    ['a name with spaces', { name: 'my mount' }],
    ['a name with a slash', { name: 'a/b' }],
    ['a 65-character name', { name: `a${'b'.repeat(64)}` }],
    ['a leading-dash name', { name: '-work' }],
    ['a relative mountpoint', { mountpoint: 'rel/path' }],
    ['a tilde mountpoint', { mountpoint: '~/mount' }],
    ['an empty drive id', { driveId: '' }],
    ['an overlong drive id', { driveId: 'x'.repeat(257) }],
    ['a non-URL api', { apiUrl: 'not a url' }],
    ['a non-http api', { apiUrl: 'ftp://x.test/api' }],
    ['a spaced sandbox id', { sandboxId: 'sbx one' }],
    ['an empty sandbox id', { sandboxId: '' }],
    ['a shell-looking sandbox id', { sandboxId: 'sbx; rm -rf /' }],
    ['a non-boolean readOnly', { readOnly: 'yes' }],
  ])('rejects %s', async (_label, extra) => {
    const dir = await authorizedConfig();
    await expect(registerMount(input(dir, extra as Record<string, unknown>))).rejects.toThrow();
    expect(await readMountRegistry()).toEqual([]);
  });

  it('accepts an apiUrl without a path (host-only account context)', async () => {
    const dir = await authorizedConfig();
    const entry = await registerMount(input(dir, { apiUrl: 'https://x.test' }));
    expect(entry.apiUrl).toBe('https://x.test');
  });

  it('requires an exact Instabox machine ID for a live workspace', async () => {
    const dir = await isolatedConfig();
    await expect(
      registerLiveWorkspace({
        name: 'work',
        mountpoint: join(dir, 'mount'),
        sandboxId: 'coordinator',
        root: '/workspace/project',
      }),
    ).rejects.toThrow(/exact m_.*ID/u);
    expect(await readMountRegistry()).toEqual([]);
  });

  it.each(['relative/path', '/workspace/../outside', '/workspace//project', '/workspace\\project'])(
    'rejects an unsafe live workspace root %s',
    async (root) => {
      const dir = await isolatedConfig();
      await expect(
        registerLiveWorkspace({
          name: 'work',
          mountpoint: join(dir, 'mount'),
          sandboxId: 'm_valid',
          root,
        }),
      ).rejects.toThrow(/workspace root/u);
      expect(await readMountRegistry()).toEqual([]);
    },
  );
});

describe('mount registry authorization', () => {
  it('requires a saved drive key for the entry drive and API origin', async () => {
    const dir = await isolatedConfig();
    await writeConfig({ apiUrl: API, apiKey: 'tok' });
    await expect(registerMount(input(dir))).rejects.toThrow(
      `No saved drive key for ${DRIVE} on ${ORIGIN}`,
    );
  });

  it('does not count a drive key saved for a different origin', async () => {
    const dir = await isolatedConfig();
    await writeConfig({
      apiUrl: API,
      apiKey: 'tok',
      driveKeys: { [DRIVE]: generateDriveKey() },
      driveKeyOrigins: { [DRIVE]: 'https://other.test' },
    });
    await expect(registerMount(input(dir))).rejects.toThrow(
      `No saved drive key for ${DRIVE} on ${ORIGIN}`,
    );
  });

  it('does not count an environment drive key that is not durably saved', async () => {
    const dir = await isolatedConfig();
    await writeConfig({ apiUrl: API, apiKey: 'tok' });
    vi.stubEnv('AGENT_DRIVE_KEY', generateDriveKey());
    await expect(registerMount(input(dir))).rejects.toThrow(`No saved drive key for ${DRIVE}`);
  });

  it('requires a saved API key bound to the entry API origin', async () => {
    const dir = await isolatedConfig();
    await writeConfig({
      apiUrl: 'https://other.test/api',
      apiKey: 'tok',
      driveKeys: { [DRIVE]: generateDriveKey() },
      driveKeyOrigins: { [DRIVE]: ORIGIN },
    });
    await expect(registerMount(input(dir))).rejects.toThrow(`No saved API key for ${ORIGIN}`);
    await expect(readMountRegistry()).resolves.toEqual([]);
  });

  it('accepts a drive registered under a different apiUrl on the same origin', async () => {
    const dir = await authorizedConfig();
    const entry = await registerMount(input(dir, { apiUrl: 'https://x.test/api/v2' }));
    expect(entry.apiUrl).toBe('https://x.test/api/v2');
  });
});

describe('mount registry file tolerance', () => {
  it('refuses to overwrite a malformed registry', async () => {
    const dir = await authorizedConfig();
    const path = mountRegistryPath();
    await mkdir(dir, { recursive: true });
    await writeFile(path, '{not json');
    await chmod(path, 0o600);
    await expect(readMountRegistry()).rejects.toThrow('malformed');
    await expect(registerMount(input(dir))).rejects.toThrow('malformed');
    expect(await readFile(path, 'utf8')).toBe('{not json');
  });

  it('ignores unknown fields written by newer versions', async () => {
    const dir = await authorizedConfig();
    await writeFile(
      mountRegistryPath(),
      JSON.stringify({
        version: 99,
        mounts: [
          {
            name: 'work',
            mountpoint: join(dir, 'mount'),
            driveId: DRIVE,
            apiUrl: API,
            future: { nested: true },
          },
        ],
        extra: 'kept',
      }),
    );
    const mounts = await readMountRegistry();
    expect(mounts).toEqual([
      {
        kind: 'drive',
        name: 'work',
        mountpoint: join(dir, 'mount'),
        driveId: DRIVE,
        apiUrl: API,
        readOnly: false,
      },
    ]);
  });

  it('rejects entries with corrupt required fields instead of dropping them silently', async () => {
    const dir = await authorizedConfig();
    await writeFile(
      mountRegistryPath(),
      JSON.stringify({ version: 1, mounts: [{ name: 'work' }] }),
    );
    await expect(readMountRegistry()).rejects.toThrow('malformed');
  });
});

describe('mount status and lookup', () => {
  it('reports the filesystem state of each mountpoint without mounting', async () => {
    const dir = await authorizedConfig();
    const free = join(dir, 'free');
    const real = join(dir, 'real');
    const link = join(dir, 'link');
    const file = join(dir, 'file');
    await mkdir(real);
    await writeFile(file, 'x');
    await symlink(real, link);
    for (const [name, mountpoint] of [
      ['free', free],
      ['real', real],
      ['link', link],
      ['file', file],
    ] as const) {
      await registerMount({ name, mountpoint, driveId: DRIVE, apiUrl: API });
    }
    const status = await mountStatus();
    expect(status.map((entry) => [entry.name, entry.filesystem.state])).toEqual([
      ['free', 'free'],
      ['real', 'directory'],
      ['link', 'symlink'],
      ['file', 'other'],
    ]);
    const linked = status.find((entry) => entry.name === 'link');
    expect(linked?.filesystem.target).toBe(real);
  });

  it('filters status to one registered name and rejects unknown names', async () => {
    const dir = await authorizedConfig();
    await registerMount(input(dir));
    expect((await mountStatus('work')).length).toBe(1);
    await expect(mountStatus('missing')).rejects.toThrow(`No mount registered as 'missing'`);
    await expect(findMountEntry('missing')).rejects.toThrow(`No mount registered as 'missing'`);
    expect(await findMountEntry('work')).toMatchObject({ kind: 'drive', driveId: DRIVE });
  });
});
