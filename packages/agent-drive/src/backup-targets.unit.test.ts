import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDriveKey } from './crypto.js';
import { readConfig, writeConfig } from './config.js';
import {
  confirmCredentials,
  decodeBundle,
  exportCredentials,
  loadConfig,
  unbackedUp,
} from './credentials.js';
import { type TargetDeps } from './backup-targets.js';

const D1 = '11111111-1111-4111-8111-111111111111';
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-drive-targets-'));
  dirs.push(dir);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
  vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
  vi.stubEnv('AGENT_DRIVE_API_URL', '');
  vi.stubEnv('AGENT_DRIVE_API_KEY', '');
  await writeConfig({
    apiUrl: 'https://x.test/api',
    apiKey: 'tok',
    driveKeys: { [D1]: generateDriveKey() },
    driveKeyOrigins: { [D1]: 'https://x.test' },
  });
}

type Call = { command: string; args: string[]; input?: string };
const enoent = () => Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });

/** A fake process runner. `handler` returns a result, or throws to simulate a failure. */
function fake(
  handler: (call: Call) => { code: number; stdout?: string },
  platform: NodeJS.Platform = 'darwin',
  env: Record<string, string | undefined> = {},
) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const deps: TargetDeps = {
    run: async (command, args, input) => {
      const call: Call = { command, args, ...(input === undefined ? {} : { input }) };
      calls.push(call);
      const result = handler(call);
      return { code: result.code, stdout: result.stdout ?? '' };
    },
    sleep: async (ms) => void sleeps.push(ms),
    platform,
    env,
  };
  return { deps, calls, sleeps };
}

const stdoutNotTty = { isTTY: false, write: async () => undefined };
const bundleIn = (calls: Call[]) =>
  decodeBundle(
    (calls.find((c) => c.input?.includes('adcred1.'))?.input ?? '').match(/adcred1\.[\w-]+/u)![0],
  );

describe('export --to 1password', () => {
  it('sends the bundle only on stdin and records the backup', async () => {
    await setup();
    const { deps, calls } = fake(() => ({ code: 0 }));
    const result = await exportCredentials(
      { to: '1password', vault: 'Private' },
      stdoutNotTty,
      deps,
    );
    expect(result.driveIds).toEqual([D1]);
    expect(calls[0]).toMatchObject({ command: 'op', args: ['whoami'] });
    const create = calls[1]!;
    expect(create.args).toEqual(['item', 'create', '--vault', 'Private', '-']);
    const template = JSON.parse(create.input!);
    expect(template.title).toContain('Agent Drive');
    expect(template.title).toContain(D1);
    expect(template.fields[0]).toMatchObject({ type: 'CONCEALED' });
    expect(bundleIn(calls).apiKey).toBe('tok');
    // No argv of any call carries the bundle or the API key.
    for (const call of calls) expect(call.args.join(' ')).not.toMatch(/adcred1|tok/u);
    expect((await readConfig()).keyBackup?.[D1]).toBeDefined();
    expect(unbackedUp(await loadConfig(), [D1])).toEqual([]);
  });

  it('accepts the op alias and omits --vault when none is given', async () => {
    await setup();
    const { deps, calls } = fake(() => ({ code: 0 }));
    await exportCredentials({ to: 'op' }, stdoutNotTty, deps);
    expect(calls[1]!.args).toEqual(['item', 'create', '-']);
  });

  it('prints setup steps and records nothing when op is missing', async () => {
    await setup();
    const { deps, calls } = fake(() => {
      throw enoent();
    });
    await expect(exportCredentials({ to: '1password' }, stdoutNotTty, deps)).rejects.toThrow(
      /not installed[\s\S]*op whoami/u,
    );
    expect(calls).toHaveLength(1);
    expect((await readConfig()).keyBackup?.[D1]).toBeUndefined();
  });

  it('prints setup steps and records nothing when op is signed out', async () => {
    await setup();
    const { deps, calls } = fake((call) => ({ code: call.args[0] === 'whoami' ? 1 : 0 }));
    await expect(exportCredentials({ to: '1password' }, stdoutNotTty, deps)).rejects.toThrow(
      /not signed in[\s\S]*op signin/u,
    );
    expect(calls.some((c) => c.args[0] === 'item')).toBe(false);
    expect((await readConfig()).keyBackup?.[D1]).toBeUndefined();
  });

  it('records nothing when item creation fails', async () => {
    await setup();
    const { deps } = fake((call) => ({ code: call.args[0] === 'item' ? 1 : 0 }));
    await expect(exportCredentials({ to: '1password' }, stdoutNotTty, deps)).rejects.toThrow(
      /could not create/u,
    );
    expect((await readConfig()).keyBackup?.[D1]).toBeUndefined();
  });
});

describe('export --to clipboard', () => {
  it.each([
    ['darwin', 'pbcopy'],
    ['win32', 'clip'],
  ] as const)('uses the %s tool', async (platform, tool) => {
    await setup();
    const { deps, calls } = fake(() => ({ code: 0 }), platform);
    await exportCredentials({ to: 'clipboard', keepClipboard: true }, stdoutNotTty, deps);
    expect(calls[0]!.command).toBe(tool);
    expect(decodeBundle(calls[0]!.input!).apiKey).toBe('tok');
  });

  it('refuses on Linux and WSL, suggesting 1Password or a file', async () => {
    await setup();
    for (const env of [{}, { WSL_DISTRO_NAME: 'Ubuntu' }]) {
      const { deps, calls } = fake(() => ({ code: 0 }), 'linux', env);
      await expect(exportCredentials({ to: 'clipboard' }, stdoutNotTty, deps)).rejects.toThrow(
        /--to 1password[\s\S]*file/u,
      );
      expect(calls).toEqual([]);
    }
    expect((await readConfig()).pendingExport).toBeFalsy();
  });

  it('does not record a backup; confirm does', async () => {
    await setup();
    const out: string[] = [];
    const { deps } = fake(() => ({ code: 0 }));
    const result = await exportCredentials(
      { to: 'clipboard', keepClipboard: true },
      { isTTY: false, write: async (s) => void out.push(s) },
      deps,
    );
    expect(out).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('adcred1.');
    expect((await readConfig()).keyBackup?.[D1]).toBeUndefined();
    await confirmCredentials('stdout');
    expect(unbackedUp(await loadConfig(), [D1])).toEqual([]);
  });

  it('starts the clear timer before the config is written, and keeps it if that fails', async () => {
    await setup();
    const order: string[] = [];
    const { deps } = fake((c) => {
      order.push(c.command);
      return { code: 0, stdout: c.command === 'pbpaste' ? 'x' : '' };
    });
    deps.sleep = async () => void order.push('sleep');
    // Read-only config directory: writeConfig fails after the copy.
    const dir = join(process.env.AGENT_DRIVE_CONFIG!, '..');
    await chmod(dir, 0o500);
    await expect(exportCredentials({ to: 'clipboard' }, stdoutNotTty, deps)).rejects.toThrow();
    expect(order.slice(0, 2)).toEqual(['pbcopy', 'sleep']);
    expect(order).toContain('pbpaste');
    await chmod(dir, 0o700);
  });

  it('clears after 60 seconds only when the clipboard still holds the bundle', async () => {
    await setup();
    let held = '';
    const { deps, calls, sleeps } = fake((c) => {
      if (c.command === 'pbcopy') held = c.input ?? '';
      if (c.command === 'pbpaste') return { code: 0, stdout: held };
      return { code: 0 };
    });
    const result = await exportCredentials({ to: 'clipboard' }, stdoutNotTty, deps);
    expect(await result.clearing).toBe('cleared');
    expect(sleeps).toEqual([60_000]);
    expect(calls.at(-1)).toMatchObject({ command: 'pbcopy', input: '' });
  });

  it('clears with PowerShell on Windows', async () => {
    await setup();
    let held = '';
    const { deps, calls } = fake((c) => {
      if (c.command === 'clip') held = c.input ?? '';
      if (c.args.join(' ').includes('Get-Clipboard')) return { code: 0, stdout: `${held}\r\n` };
      return { code: 0 };
    }, 'win32');
    const result = await exportCredentials({ to: 'clipboard' }, stdoutNotTty, deps);
    expect(await result.clearing).toBe('cleared');
    expect(calls.at(-1)!.args.join(' ')).toContain('Set-Clipboard');
  });

  it('leaves the clipboard alone when it changed', async () => {
    await setup();
    const { deps, calls } = fake((c) =>
      c.command === 'pbpaste' ? { code: 0, stdout: 'something else' } : { code: 0 },
    );
    const result = await exportCredentials({ to: 'clipboard' }, stdoutNotTty, deps);
    expect(await result.clearing).toBe('unchanged');
    expect(calls.filter((c) => c.command === 'pbcopy')).toHaveLength(1);
  });

  it('reports failure when the clipboard cannot be read or cleared', async () => {
    await setup();
    let held = '';
    const bad = fake((c) => {
      if (c.command === 'pbcopy' && c.input) held = c.input;
      if (c.command === 'pbcopy' && c.input === '') return { code: 1 };
      return { code: 0, stdout: held };
    });
    const first = await exportCredentials({ to: 'clipboard' }, stdoutNotTty, bad.deps);
    expect(await first.clearing).toBe('failed');
    const unreadable = fake((c) => ({ code: c.command === 'pbpaste' ? 1 : 0 }));
    const second = await exportCredentials({ to: 'clipboard' }, stdoutNotTty, unreadable.deps);
    expect(await second.clearing).toBe('failed');
  });

  it('--keep-clipboard skips clearing', async () => {
    await setup();
    const { deps, sleeps } = fake(() => ({ code: 0 }));
    const result = await exportCredentials(
      { to: 'clipboard', keepClipboard: true },
      stdoutNotTty,
      deps,
    );
    expect(await result.clearing).toBe('kept');
    expect(sleeps).toEqual([]);
  });
});
