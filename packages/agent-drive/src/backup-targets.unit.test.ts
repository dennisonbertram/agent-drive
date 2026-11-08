import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDriveKey } from './crypto.js';
import { readConfig, writeConfig } from './config.js';
import { decodeBundle, exportCredentials, loadConfig, unbackedUp } from './credentials.js';
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
    expect(calls[0]!.args).toEqual([]);
    expect(decodeBundle(calls[0]!.input!).apiKey).toBe('tok');
  });

  it('prefers wl-copy on Linux, then xclip, then clip.exe under WSL', async () => {
    await setup();
    const wl = fake(() => ({ code: 0 }), 'linux');
    await exportCredentials({ to: 'clipboard', keepClipboard: true }, stdoutNotTty, wl.deps);
    expect(wl.calls[0]!.command).toBe('wl-copy');

    const x = fake((c) => {
      if (c.command === 'wl-copy') throw enoent();
      return { code: 0 };
    }, 'linux');
    await exportCredentials({ to: 'clipboard', keepClipboard: true }, stdoutNotTty, x.deps);
    expect(x.calls.map((c) => c.command)).toEqual(['wl-copy', 'xclip']);

    const w = fake(
      (c) => {
        if (c.command !== 'clip.exe') throw enoent();
        return { code: 0 };
      },
      'linux',
      { WSL_DISTRO_NAME: 'Ubuntu' },
    );
    await exportCredentials({ to: 'clipboard', keepClipboard: true }, stdoutNotTty, w.deps);
    expect(w.calls.at(-1)!.command).toBe('clip.exe');
  });

  it('fails cleanly with no clipboard tool and records nothing', async () => {
    await setup();
    const { deps } = fake(() => {
      throw enoent();
    }, 'linux');
    await expect(exportCredentials({ to: 'clipboard' }, stdoutNotTty, deps)).rejects.toThrow(
      /No clipboard tool/u,
    );
    expect((await readConfig()).keyBackup?.[D1]).toBeUndefined();
  });

  it('records the backup and never writes the bundle to stdout', async () => {
    await setup();
    const out: string[] = [];
    const { deps } = fake(() => ({ code: 0 }));
    const result = await exportCredentials(
      { to: 'clipboard' },
      { isTTY: false, write: async (s) => void out.push(s) },
      deps,
    );
    expect(out).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('adcred1.');
    expect(unbackedUp(await loadConfig(), [D1])).toEqual([]);
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
    expect(await result.afterBackup!()).toBe(true);
    expect(sleeps).toEqual([60_000]);
    expect(calls.at(-1)).toMatchObject({ command: 'pbcopy', input: '' });
  });

  it('leaves the clipboard alone when it changed', async () => {
    await setup();
    const { deps, calls } = fake((c) =>
      c.command === 'pbpaste' ? { code: 0, stdout: 'something else' } : { code: 0 },
    );
    const result = await exportCredentials({ to: 'clipboard' }, stdoutNotTty, deps);
    expect(await result.afterBackup!()).toBe(false);
    expect(calls.filter((c) => c.command === 'pbcopy')).toHaveLength(1);
  });

  it('--keep-clipboard skips clearing', async () => {
    await setup();
    const { deps, sleeps } = fake(() => ({ code: 0 }));
    const result = await exportCredentials(
      { to: 'clipboard', keepClipboard: true },
      stdoutNotTty,
      deps,
    );
    expect(await result.afterBackup!()).toBe(false);
    expect(sleeps).toEqual([]);
  });
});
