import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const filesystemTestHooks = vi.hoisted(() => ({
  alterOutputMtime: false,
  shortenOutputRead: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const path = args[0];
      const handle = await actual.open(...args);
      if (!String(path).endsWith('unstable.bin')) return handle;
      let statCalls = 0;
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'stat')
            return async () => {
              const metadata = await target.stat();
              statCalls += 1;
              if (!filesystemTestHooks.alterOutputMtime || statCalls < 2) return metadata;
              return new Proxy(metadata, {
                get(stats, key, receiver) {
                  if (key === 'mtimeMs') return stats.mtimeMs + 1;
                  return Reflect.get(stats, key, receiver);
                },
              });
            };
          if (property === 'read' && filesystemTestHooks.shortenOutputRead)
            return async (...readArgs: Parameters<typeof target.read>) => {
              const result = await target.read(...readArgs);
              return result.bytesRead > 0 ? { ...result, bytesRead: result.bytesRead - 1 } : result;
            };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

import {
  type JobRequest,
  makeJobHandler,
  WorkerUnavailableError,
  WorkspaceCleanupError,
} from './job-command.js';

const NODE = process.execPath;
const enc = new TextEncoder();
const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  filesystemTestHooks.alterOutputMtime = false;
  filesystemTestHooks.shortenOutputRead = false;
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function testDir() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-drive-jobtest-'));
  dirs.push(dir);
  return dir;
}

const job = (over: Partial<JobRequest> = {}): JobRequest => ({
  id: 'job-unit-test',
  request: enc.encode('# synthetic request\n\nDo a safe thing.\n'),
  inputs: [],
  ...over,
});

const freshSignal = () => new AbortController().signal;
const run = (script: string, args: string[] = []) => [NODE, '-e', script, ...args];

/** Polls until `path` holds JSON, then returns it. */
async function marker(path: string): Promise<{ pid: number; childPid?: number; cwd: string }> {
  let parsed: { pid: number; childPid?: number; cwd: string } | undefined;
  await vi.waitFor(
    async () => {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    },
    { timeout: 10_000, interval: 50 },
  );
  return parsed!;
}

async function expectDead(pid: number) {
  await vi.waitFor(
    () => {
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    },
    { timeout: 10_000, interval: 50 },
  );
}

describe('makeJobHandler', () => {
  it('requires a worker command', () => {
    expect(() => makeJobHandler([])).toThrow(/worker command/u);
    expect(() => makeJobHandler([''])).toThrow(/worker command/u);
  });

  it('rejects an explicit path that does not exist before any job runs', () => {
    expect(() => makeJobHandler(['/definitely/not/a/real/binary-xyz'])).toThrow(
      WorkerUnavailableError,
    );
    expect(() => makeJobHandler(['/definitely/not/a/real/binary-xyz'])).toThrow(
      /definitely\/not\/a\/real\/binary-xyz/u,
    );
  });

  it('rejects a path-like command against the owner cwd, not the job dir', () => {
    expect(() => makeJobHandler(['./no-such-worker-xyz'])).toThrow(
      new RegExp(`${process.cwd()}/no-such-worker-xyz`, 'u'),
    );
  });

  it('rejects a bare command name missing from every searched PATH', () => {
    expect(() => makeJobHandler(['no-such-worker-command-xyz'])).toThrow(WorkerUnavailableError);
  });

  it('rejects an explicit path that exists but is not executable', async () => {
    const dir = await testDir();
    const target = join(dir, 'not-executable');
    await writeFile(target, 'plain data, not a program\n', { mode: 0o644 });
    expect(() => makeJobHandler([target])).toThrow(WorkerUnavailableError);
    expect(() => makeJobHandler([target])).toThrow(/not executable/u);
  });

  it('rejects an explicit path that is a directory', async () => {
    const dir = await testDir();
    await mkdir(join(dir, 'a-dir'));
    expect(() => makeJobHandler([join(dir, 'a-dir')])).toThrow(WorkerUnavailableError);
  });

  it('writes stdout to outputs/result.md and returns it', async () => {
    const handler = makeJobHandler(run(`process.stdout.write('worker said hello')`));
    await expect(handler(job(), freshSignal())).resolves.toEqual([
      { name: 'result.md', bytes: Buffer.from('worker said hello') },
    ]);
  });

  it('materializes request.md in a private cwd and pipes the same bytes to stdin', async () => {
    const script = `
      const fs = require('fs');
      const fromDisk = fs.readFileSync('request.md');
      const fromStdin = fs.readFileSync(0);
      fs.writeFileSync('outputs/disk.bin', fromDisk);
      fs.writeFileSync('outputs/stdin.bin', fromStdin);
      fs.writeFileSync('outputs/cwd.txt', process.cwd());
    `;
    const request = new Uint8Array([0xff, 0x00, 0x41, 0x80, 0x0a]); // not valid UTF-8
    const outputs = await makeJobHandler(run(script))(job({ request }), freshSignal());
    const byName = new Map(outputs.map((o) => [o.name, o.bytes]));
    expect(byName.get('disk.bin')).toEqual(Buffer.from(request));
    expect(byName.get('stdin.bin')).toEqual(Buffer.from(request));
    const cwd = byName.get('cwd.txt')!.toString();
    expect(cwd).toMatch(/agent-drive-job-/u);
    // The private workspace is cleaned up once the job settles.
    await expect(stat(cwd)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stages flat inputs under inputs/ for the worker', async () => {
    const script = `
      const fs = require('fs');
      const names = fs.readdirSync('inputs').sort();
      fs.writeFileSync('outputs/manifest.txt', names.join(','));
      for (const name of names) fs.writeFileSync('outputs/' + name + '.copy', fs.readFileSync('inputs/' + name));
    `;
    const inputs = [
      { name: 'b.bin', bytes: new Uint8Array([2, 3]) },
      { name: 'a.txt', bytes: enc.encode('alpha') },
    ];
    const outputs = await makeJobHandler(run(script))(job({ inputs }), freshSignal());
    const byName = new Map(outputs.map((o) => [o.name, o.bytes]));
    expect(byName.get('manifest.txt')).toEqual(Buffer.from('a.txt,b.bin'));
    expect(byName.get('a.txt.copy')).toEqual(Buffer.from('alpha'));
    expect(byName.get('b.bin.copy')).toEqual(Buffer.from([2, 3]));
  });

  it('returns worker-written outputs sorted by name, including a worker result.md when stdout is empty', async () => {
    const script = `
      const fs = require('fs');
      fs.writeFileSync('outputs/zeta.md', 'z');
      fs.writeFileSync('outputs/alpha.md', 'a');
      fs.writeFileSync('outputs/result.md', 'written by worker');
    `;
    const outputs = await makeJobHandler(run(script))(job(), freshSignal());
    expect(outputs.map((o) => o.name)).toEqual(['alpha.md', 'result.md', 'zeta.md']);
    expect(outputs[1]!.bytes).toEqual(Buffer.from('written by worker'));
  });

  it('returns an empty list when the worker produces nothing', async () => {
    const outputs = await makeJobHandler(run(`process.exit(0)`))(job(), freshSignal());
    expect(outputs).toEqual([]);
  });

  it('runs the worker with a minimal environment and an isolated HOME/TMPDIR', async () => {
    vi.stubEnv('AGENT_DRIVE_API_KEY', 'unit-test-secret');
    vi.stubEnv('OPENAI_API_KEY', 'sk-unit-test');
    vi.stubEnv('ANTHROPIC_API_KEY', 'ant-unit-test');
    vi.stubEnv('JOB_COMMAND_LEAK_PROBE', 'should-not-cross');
    const script = `require('fs').writeFileSync('outputs/env.json', JSON.stringify(process.env))`;
    const outputs = await makeJobHandler(run(script))(job(), freshSignal());
    const env = JSON.parse(outputs[0]!.bytes.toString());
    expect(env.AGENT_DRIVE_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.JOB_COMMAND_LEAK_PROBE).toBeUndefined();
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin:/bin');
    expect(env.PATH).not.toContain(process.env.PATH ?? '__never__');
    expect(env.HOME).toMatch(/agent-drive-job-[^/]+\/home$/u);
    expect(dirname(env.TMPDIR)).toBe(dirname(env.HOME));
    expect(env.TMPDIR).toMatch(/\/tmp$/u);
    expect(Object.keys(env).length).toBeLessThanOrEqual(10);
  });

  it('passes arguments literally without a shell', async () => {
    const tricky = 'a;b $(id) `id` >x |y * ~ $HOME && echo pwned';
    const script = `require('fs').writeFileSync('outputs/argv.json', JSON.stringify(process.argv.slice(1)))`;
    const outputs = await makeJobHandler(run(script, [tricky]))(job(), freshSignal());
    expect(JSON.parse(outputs[0]!.bytes.toString())).toEqual([tricky]);
  });

  it('rejects when the worker exits nonzero', async () => {
    const handler = makeJobHandler(run(`process.exit(3)`));
    await expect(handler(job(), freshSignal())).rejects.toThrow(/code 3/u);
  });

  it('resolves a bare command name on the owner PATH', async () => {
    const outputs = await makeJobHandler(['echo', '-n', 'bare-name-ok'])(job(), freshSignal());
    expect(outputs).toEqual([{ name: 'result.md', bytes: Buffer.from('bare-name-ok') }]);
  });

  it('runs an owner-installed bare command not on the child PATH', async () => {
    const dir = await testDir();
    const bin = join(dir, 'bin');
    await mkdir(bin);
    // Shebang with a full interpreter path: dependable inside the minimal child env.
    await writeFile(
      join(bin, 'owner-worker'),
      `#!${NODE}\nprocess.stdout.write('installed worker ran')\n`,
      { mode: 0o755 },
    );
    // Resolution happens once, at handler build, against the launch PATH.
    vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH}`);
    const handler = makeJobHandler(['owner-worker']);
    vi.unstubAllEnvs();
    await expect(handler(job(), freshSignal())).resolves.toEqual([
      { name: 'result.md', bytes: Buffer.from('installed worker ran') },
    ]);
  });

  it('aborts: kills the whole process group, rejects, and cleans the workspace', async () => {
    const dir = await testDir();
    const markerPath = join(dir, 'marker.json');
    const script = `
      const fs = require('fs');
      const child = require('child_process').spawn(
        process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      fs.writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, childPid: child.pid, cwd: process.cwd() }));
      setInterval(() => {}, 1000);
    `;
    const controller = new AbortController();
    const pending = makeJobHandler(run(script, [markerPath]))(job(), controller.signal);
    const { pid, childPid, cwd } = await marker(markerPath);
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/u);
    await expectDead(pid);
    await expectDead(childPid!); // grandchildren die with the process group
    await expect(stat(cwd)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('times the worker out, kills it, and rejects', async () => {
    const dir = await testDir();
    const markerPath = join(dir, 'marker.json');
    const script = `
      require('fs').writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
      setInterval(() => {}, 1000);
    `;
    const handler = makeJobHandler(run(script, [markerPath]), { timeoutMs: 300 });
    const pending = handler(job(), freshSignal());
    const { pid, cwd } = await marker(markerPath);
    await expect(pending).rejects.toThrow(/timeout|timed out|limit/u);
    await expectDead(pid);
    await expect(stat(cwd)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an already-aborted job without spawning the worker', async () => {
    const dir = await testDir();
    const markerPath = join(dir, 'marker.json');
    const script = `require('fs').writeFileSync(process.argv[1], '{}')`;
    const controller = new AbortController();
    controller.abort();
    await expect(
      makeJobHandler(run(script, [markerPath]))(job(), controller.signal),
    ).rejects.toThrow(/abort/u);
    await expect(stat(markerPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('swallows EPIPE when the worker exits without reading a large stdin', async () => {
    const request = new Uint8Array(1024 * 1024).fill(0x61);
    const outputs = await makeJobHandler(run(`process.exit(0)`))(job({ request }), freshSignal());
    expect(outputs).toEqual([]);
  });
});

describe('worker availability', () => {
  async function fakeWorker(dir: string) {
    const bin = join(dir, 'bin');
    await mkdir(bin);
    const path = join(bin, 'stub-worker');
    await writeFile(path, `#!${NODE}\nprocess.stdout.write('stub ran')\n`, { mode: 0o755 });
    return path;
  }

  it('exposes assertReady on the returned handler', async () => {
    const handler = makeJobHandler([NODE, '-e', 'process.exit(0)']);
    expect(typeof handler.assertReady).toBe('function');
    expect(() => handler.assertReady()).not.toThrow();
  });

  it('fails assertReady once the pinned executable disappears', async () => {
    const dir = await testDir();
    const path = await fakeWorker(dir);
    const handler = makeJobHandler([path]);
    await rm(path);
    expect(() => handler.assertReady()).toThrow(WorkerUnavailableError);
    await expect(handler(job(), freshSignal())).rejects.toThrow(WorkerUnavailableError);
  });

  it('fails assertReady when the pinned executable is replaced by another file', async () => {
    const dir = await testDir();
    const path = await fakeWorker(dir);
    const handler = makeJobHandler([path]);
    await writeFile(join(dir, 'imposter'), `#!${NODE}\nprocess.stdout.write('imposter')\n`, {
      mode: 0o755,
    });
    await rm(path);
    await rename(join(dir, 'imposter'), path);
    expect(() => handler.assertReady()).toThrow(/replaced|unavailable/u);
    expect(() => handler.assertReady()).toThrow(WorkerUnavailableError);
  });

  it('fails assertReady when the pinned executable loses its execute bit', async () => {
    const dir = await testDir();
    const path = await fakeWorker(dir);
    const handler = makeJobHandler([path]);
    await chmod(path, 0o644);
    expect(() => handler.assertReady()).toThrow(WorkerUnavailableError);
  });

  it('rejects a script whose shebang interpreter is missing before any job runs', async () => {
    const dir = await testDir();
    const path = join(dir, 'bad-interp');
    await writeFile(path, '#!/definitely/missing/interp-xyz\n', { mode: 0o755 });
    expect(() => makeJobHandler([path])).toThrow(WorkerUnavailableError);
    expect(() => makeJobHandler([path])).toThrow(/interp-xyz/u);
  });

  it('fails assertReady when a script interpreter disappears after startup', async () => {
    const dir = await testDir();
    // A symlink to a real runtime: present and executable at build, gone later.
    const interp = join(dir, 'gone-interp');
    await symlink(NODE, interp);
    const path = join(dir, 'interp-worker');
    await writeFile(path, `#!${interp}\n`, { mode: 0o755 });
    const handler = makeJobHandler([path]);
    await rm(interp);
    expect(() => handler.assertReady()).toThrow(WorkerUnavailableError);
    await expect(handler(job(), freshSignal())).rejects.toThrow(WorkerUnavailableError);
  });

  it('surfaces an interpreter that cannot exec as WorkerUnavailableError at job time', async () => {
    const dir = await testDir();
    // Present and executable, so readiness passes — but its own shebang names
    // a runtime missing inside this dir, so exec fails ENOENT only at spawn,
    // on macOS and Linux alike.
    const interp = join(dir, 'nested-interp');
    await writeFile(interp, `#!${join(dir, 'missing-runtime')}\n`, { mode: 0o755 });
    const path = join(dir, 'nested-interp-worker');
    await writeFile(path, `#!${interp}\n`, { mode: 0o755 });
    const handler = makeJobHandler([path]);
    expect(() => handler.assertReady()).not.toThrow();
    await expect(handler(job(), freshSignal())).rejects.toBeInstanceOf(WorkerUnavailableError);
  });
});

describe('launcher interpreters', () => {
  it('runs a #!/usr/bin/env node launcher on the Node Agent Drive runs on', async () => {
    const dir = await testDir();
    // Stands in for an owner npm-installed executable: env resolves `node`, but
    // the child's minimal PATH has no node on it — the launch must bind the
    // Node that runs Agent Drive instead of env's lookup.
    const launcher = join(dir, 'node-worker');
    await writeFile(
      launcher,
      '#!/usr/bin/env node\n' +
        'require("fs").writeFileSync("outputs/argv.json", JSON.stringify(process.argv.slice(2)))\n' +
        "process.stdout.write('env node worker ran')\n",
      { mode: 0o755 },
    );
    const outputs = await makeJobHandler([launcher, '--flag', 'lit eral'])(job(), freshSignal());
    const byName = new Map(outputs.map((o) => [o.name, o.bytes]));
    expect(byName.get('argv.json')).toEqual(Buffer.from('["--flag","lit eral"]'));
    expect(byName.get('result.md')).toEqual(Buffer.from('env node worker ran'));
  });

  it('runs an owner-installed bare command with an env shebang not on the child PATH', async () => {
    const dir = await testDir();
    const bin = join(dir, 'bin');
    await mkdir(bin);
    await writeFile(
      join(bin, 'env-worker'),
      "#!/usr/bin/env node\nprocess.stdout.write('env-installed worker ran')\n",
      { mode: 0o755 },
    );
    vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH}`);
    const handler = makeJobHandler(['env-worker']);
    vi.unstubAllEnvs();
    await expect(handler(job(), freshSignal())).resolves.toEqual([
      { name: 'result.md', bytes: Buffer.from('env-installed worker ran') },
    ]);
  });

  it('runs a #!/usr/bin/env launcher for another interpreter on the scoped PATH', async () => {
    const dir = await testDir();
    const launcher = join(dir, 'sh-worker');
    await writeFile(launcher, '#!/usr/bin/env sh\necho env-sh-ran\n', { mode: 0o755 });
    const outputs = await makeJobHandler([launcher])(job(), freshSignal());
    expect(outputs).toEqual([{ name: 'result.md', bytes: Buffer.from('env-sh-ran\n') }]);
  });

  it('rejects an env-shebang interpreter absent from the scoped PATH before any job', async () => {
    const dir = await testDir();
    const launcher = join(dir, 'missing-interp');
    await writeFile(launcher, '#!/usr/bin/env no-such-interp-xyz\n', { mode: 0o755 });
    expect(() => makeJobHandler([launcher])).toThrow(WorkerUnavailableError);
    expect(() => makeJobHandler([launcher])).toThrow(/no-such-interp-xyz/u);
  });

  it('rejects a launcher needing env argument parsing before any job', async () => {
    const dir = await testDir();
    const launcher = join(dir, 'fancy-env');
    await writeFile(launcher, '#!/usr/bin/env -S node --title=worker\n', { mode: 0o755 });
    expect(() => makeJobHandler([launcher])).toThrow(/unsupported|wrap/u);
  });

  it('rejects a launcher with a non-absolute shebang interpreter before any job', async () => {
    const dir = await testDir();
    const launcher = join(dir, 'relative-interp');
    await writeFile(launcher, '#!node\n', { mode: 0o755 });
    expect(() => makeJobHandler([launcher])).toThrow(/unsupported|absolute/u);
  });

  it('runs a script whose shebang names a UTF-8 interpreter path', async () => {
    const dir = await testDir();
    // A valid UTF-8 filesystem path: read as latin1 the accented bytes garble
    // into a name that does not exist, so the interpreter check must decode UTF-8.
    const interp = join(dir, 'nódé');
    await symlink(NODE, interp);
    const path = join(dir, 'utf8-worker');
    await writeFile(path, `#!${interp}\nprocess.stdout.write('utf8 interp ran')\n`, {
      mode: 0o755,
    });
    const outputs = await makeJobHandler([path])(job(), freshSignal());
    expect(outputs).toEqual([{ name: 'result.md', bytes: Buffer.from('utf8 interp ran') }]);
  });
});

describe('orphaned subprocesses', () => {
  it('delivers output written by an out-of-group orphan after the leader exits', async () => {
    // The group is swept at 'exit'; a detached orphan survives and its write arrives
    // inside the drain bound, so 'close' fires when the pipe EOFs — not at leader exit.
    const script = `
      const orphan = require('child_process').spawn(process.execPath, [
        '-e', 'setTimeout(() => process.stdout.write(" +from-orphan"), 400)',
      ], { detached: true, stdio: ['ignore', 'inherit', 'ignore'] });
      orphan.unref(); // leader exits now; the orphan writes to the inherited pipe later
      process.stdout.write('from-worker');
    `;
    const outputs = await makeJobHandler(run(script))(job(), freshSignal());
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.name).toBe('result.md');
    expect(outputs[0]!.bytes.toString()).toContain('from-worker');
    expect(outputs[0]!.bytes.toString()).toContain('from-orphan');
  });

  it('kills a group orphan that holds no pipes at leader exit', async () => {
    const dir = await testDir();
    const markerPath = join(dir, 'marker.json');
    const script = `
      const fs = require('fs');
      const orphan = require('child_process').spawn(
        process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      orphan.unref(); // so this worker can exit while the orphan keeps running
      fs.writeFileSync(process.argv[1], JSON.stringify({ orphanPid: orphan.pid }));
    `;
    const outputs = await makeJobHandler(run(script, [markerPath]))(job(), freshSignal());
    expect(outputs).toEqual([]);
    const { orphanPid } = JSON.parse(await readFile(markerPath, 'utf8')) as {
      orphanPid: number;
    };
    // The single group sweep at 'exit' kills it — it cannot touch outputs afterwards.
    await expectDead(orphanPid);
  });

  it('sweeps a group orphan holding the stdout pipe at leader exit and settles normally', async () => {
    const dir = await testDir();
    const markerPath = join(dir, 'marker.json');
    const script = `
      const fs = require('fs');
      const orphan = require('child_process').spawn(
        process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
      orphan.unref(); // leader exits; the orphan would hold the pipe for a minute
      fs.writeFileSync(process.argv[1], JSON.stringify({ orphanPid: orphan.pid }));
      process.stdout.write('worker-done');
    `;
    const started = Date.now();
    const outputs = await makeJobHandler(run(script, [markerPath]))(job(), freshSignal());
    // 'close' arrives as soon as the swept orphan's pipe end dies — well under a timeout.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(outputs).toEqual([{ name: 'result.md', bytes: Buffer.from('worker-done') }]);
    const { orphanPid } = JSON.parse(await readFile(markerPath, 'utf8')) as {
      orphanPid: number;
    };
    await expectDead(orphanPid);
  });

  it('fails the job when a forced pipe drop cuts stdout short of EOF', async () => {
    // A detached orphan holds the stdout pipe past the drain bound: the pipe ends
    // are destroyed without 'end', so the leader's clean exit must NOT publish
    // whatever partial bytes happened to arrive — the result is truncated data.
    const script = `
      const orphan = require('child_process').spawn(process.execPath, [
        '-e', 'setTimeout(() => {}, 15000)',
      ], { detached: true, stdio: ['ignore', 'inherit', 'ignore'] });
      orphan.unref(); // leader exits; the orphan keeps the pipe, out of group reach
      process.stdout.write('partial-leader-bytes');
    `;
    const started = Date.now();
    await expect(makeJobHandler(run(script))(job(), freshSignal())).rejects.toThrow(
      /truncat|end of stream|EOF|incomplete/u,
    );
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThan(1_500); // normal output was given time to drain
    expect(elapsed).toBeLessThan(10_000); // but not the orphan's 15 s lifetime
  });

  it('settles a timeout on an escaped pipe holder without ever signalling it', async () => {
    const dir = await testDir();
    const markerPath = join(dir, 'marker.json');
    const script = `
      const fs = require('fs');
      const orphan = require('child_process').spawn(
        process.execPath, ['-e', 'setTimeout(() => {}, 15000)'],
        { detached: true, stdio: ['ignore', 'inherit', 'ignore'] });
      orphan.unref(); // leader exits; detached orphan keeps the pipe, out of group reach
      fs.writeFileSync(process.argv[1], JSON.stringify({ orphanPid: orphan.pid }));
    `;
    const handler = makeJobHandler(run(script, [markerPath]), { timeoutMs: 400 });
    const started = Date.now();
    await expect(handler(job(), freshSignal())).rejects.toThrow(/limit|killed/u);
    expect(Date.now() - started).toBeLessThan(10_000);
    const { orphanPid } = JSON.parse(await readFile(markerPath, 'utf8')) as {
      orphanPid: number;
    };
    // Documented limit: outside the job's group it is never signalled — after 'exit'
    // nothing kills by numeric ID, so it simply runs out its own timer.
    expect(() => process.kill(orphanPid, 0)).not.toThrow();
  });
});

describe('output collection', () => {
  it('rejects deterministic metadata and EOF changes reported during a file read', async () => {
    const script = `require('fs').writeFileSync('outputs/unstable.bin', 'stable bytes')`;
    const handler = makeJobHandler(run(script));
    filesystemTestHooks.alterOutputMtime = true;
    await expect(handler(job(), freshSignal())).rejects.toThrow(/changed while it was being read/u);

    filesystemTestHooks.alterOutputMtime = false;
    filesystemTestHooks.shortenOutputRead = true;
    await expect(handler(job(), freshSignal())).rejects.toThrow(/changed while it was being read/u);
    filesystemTestHooks.shortenOutputRead = false;
  });

  it('refuses to overwrite a worker-written result.md with stdout', async () => {
    const script = `
      require('fs').writeFileSync('outputs/result.md', 'from worker');
      process.stdout.write('from stdout');
    `;
    await expect(makeJobHandler(run(script))(job(), freshSignal())).rejects.toThrow(/result\.md/u);
  });

  it('rejects a symlinked output even to a harmless target', async () => {
    const script = `
      const fs = require('fs');
      fs.writeFileSync('outputs/real.txt', 'x');
      fs.symlinkSync('/etc/hosts', 'outputs/evil');
    `;
    await expect(makeJobHandler(run(script))(job(), freshSignal())).rejects.toThrow(
      /not a regular file|symlink/u,
    );
  });

  it('rejects a hardlinked output', async () => {
    const script = `
      const fs = require('fs');
      fs.writeFileSync('outputs/real.txt', 'x');
      fs.linkSync('request.md', 'outputs/hard');
    `;
    await expect(makeJobHandler(run(script))(job(), freshSignal())).rejects.toThrow(/link/u);
  });

  it('rejects a subdirectory inside outputs', async () => {
    const script = `require('fs').mkdirSync('outputs/nested')`;
    await expect(makeJobHandler(run(script))(job(), freshSignal())).rejects.toThrow(
      /not a regular file|directory/u,
    );
  });

  it('rejects a FIFO without ever blocking on it', async () => {
    const script = `
      require('child_process').execFileSync('mkfifo', ['outputs/pipe']);
      require('fs').writeFileSync('outputs/real.txt', 'x');
    `;
    await expect(makeJobHandler(run(script))(job(), freshSignal())).rejects.toThrow(
      /not a regular file/u,
    );
  });

  it('rejects when the worker replaces the outputs directory with a symlink', async () => {
    const script = `
      const fs = require('fs');
      fs.rmdirSync('outputs');
      fs.symlinkSync('/tmp', 'outputs');
      process.stdout.write('hi');
    `;
    await expect(makeJobHandler(run(script))(job(), freshSignal())).rejects.toThrow(
      /outputs directory|outputs/u,
    );
  });

  it('rejects a seventeenth output file', async () => {
    const script = `
      const fs = require('fs');
      for (let i = 0; i < 17; i++) fs.writeFileSync('outputs/f' + i + '.txt', 'x');
    `;
    await expect(makeJobHandler(run(script))(job(), freshSignal())).rejects.toThrow(/16|too many/u);
  });

  it('accepts a file at exactly 8 MiB and rejects one byte more', async () => {
    const exact = `require('fs').writeFileSync('outputs/big.bin', Buffer.alloc(8 * 1024 * 1024, 1))`;
    const outputs = await makeJobHandler(run(exact))(job(), freshSignal());
    expect(outputs[0]!.bytes.byteLength).toBe(8 * 1024 * 1024);

    const over = `require('fs').writeFileSync('outputs/big.bin', Buffer.alloc(8 * 1024 * 1024 + 1, 1))`;
    await expect(makeJobHandler(run(over))(job(), freshSignal())).rejects.toThrow(
      /8 ?MiB|file limit|exceeds/u,
    );
  });

  it('counts stdout toward the 16-file output limit', async () => {
    const script = `
      const fs = require('fs');
      for (let i = 0; i < 16; i++) fs.writeFileSync('outputs/f' + i + '.txt', 'x');
      process.stdout.write('one too many');
    `;
    await expect(makeJobHandler(run(script))(job(), freshSignal())).rejects.toThrow(/16|too many/u);
  });

  it('rejects when outputs exceed 32 MiB in total', async () => {
    const script = `
      const fs = require('fs');
      for (let i = 0; i < 5; i++) fs.writeFileSync('outputs/f' + i + '.bin', Buffer.alloc(7 * 1024 * 1024, i));
    `;
    await expect(makeJobHandler(run(script))(job(), freshSignal())).rejects.toThrow(
      /32 ?MiB|total/u,
    );
  });

  it('rejects stdout over 8 MiB instead of buffering it unboundedly', async () => {
    const script = `process.stdout.write(Buffer.alloc(9 * 1024 * 1024, 2))`;
    await expect(makeJobHandler(run(script))(job(), freshSignal())).rejects.toThrow(
      /8 ?MiB|standard output|stdout/u,
    );
  });

  it('returns raw binary stdout untouched, including invalid UTF-8', async () => {
    const payload = [0x00, 0xff, 0xfe, 0x80, 0x41, 0x0a];
    const script = `process.stdout.write(Buffer.from(${JSON.stringify(payload)}))`;
    const outputs = await makeJobHandler(run(script))(job(), freshSignal());
    expect(outputs).toEqual([{ name: 'result.md', bytes: Buffer.from(payload) }]);
  });
});

describe('workspace cleanup', () => {
  it('surfaces a workspace the runner cannot remove as a fatal cleanup error', async () => {
    const dir = await testDir();
    const markerPath = join(dir, 'marker.json');
    // The worker leaves a directory the runner cannot descend into: cleanup must
    // fail loudly instead of leaving decrypted request/input/output bytes behind.
    const script = `
      const fs = require('fs');
      fs.mkdirSync('tmp/stuck/inner', { recursive: true });
      fs.writeFileSync('tmp/stuck/inner/left.txt', 'plaintext');
      fs.chmodSync('tmp/stuck', 0);
      fs.writeFileSync(process.argv[1], JSON.stringify({ cwd: process.cwd() }));
    `;
    const error = await makeJobHandler(run(script, [markerPath]))(job(), freshSignal()).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(WorkspaceCleanupError);
    expect(error).toBeInstanceOf(WorkerUnavailableError);
    const { cwd } = JSON.parse(await readFile(markerPath, 'utf8')) as { cwd: string };
    // The leftover workspace really is still there for the operator to remove.
    expect(
      await stat(cwd).then(
        () => true,
        () => false,
      ),
    ).toBe(true);
    await chmod(join(cwd, 'tmp', 'stuck'), 0o700);
    await rm(cwd, { recursive: true, force: true });
  });
});
