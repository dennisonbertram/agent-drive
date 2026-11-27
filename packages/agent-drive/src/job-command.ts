import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import {
  type FileHandle,
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

/** A mounted job handed to the owner-configured worker command. Structural: engine-independent. */
export type JobRequest = {
  id: string;
  request: Uint8Array;
  inputs: { name: string; bytes: Uint8Array }[];
};

export type JobOutput = { name: string; bytes: Uint8Array };

export type JobHandler = (job: JobRequest, signal: AbortSignal) => Promise<JobOutput[]>;

export type JobHandlerOptions = { timeoutMs?: number };

export const JOB_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
export const JOB_OUTPUT_FILE_LIMIT = 16;
export const JOB_OUTPUT_FILE_BYTES = 8 * 1024 * 1024; // per output file, and stdout
export const JOB_OUTPUT_TOTAL_BYTES = 32 * 1024 * 1024; // all output bytes together

/** Deliberately small: a worker never inherits the owner's PATH, HOME, or any credentials. */
const MINIMAL_PATH =
  process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/local/bin:/usr/bin:/bin';

/** Last-resort settle bound after a kill decision, in case 'close' never arrives. */
const SETTLE_GRACE_MS = 5_000;

/**
 * After the leader exits, how long normal output may still arrive over an inherited
 * pipe before our ends are dropped. Only an out-of-group survivor can hold a pipe
 * this long — the group itself is already dead.
 */
const PIPE_DRAIN_MS = 2_000;

/**
 * Builds a job handler that runs a trusted owner-specified command (CLI args after `--`,
 * never read from the drive) per job. Each run gets a private workspace holding
 * request.md, flat inputs/, outputs/, and an isolated HOME/TMPDIR; the request bytes
 * also go to the child's stdin for CLIs that read prompts there. Non-empty stdout plus
 * bounded regular files in outputs/ form the job result.
 *
 * Process lifetime: on POSIX each run is a new process group. The group is signalled
 * exactly once — promptly at the leader's 'exit', or while cancelling a still-live
 * leader — never later, because a reaped pgid may already be recycled. A process that
 * left the group (setsid/detached) is out of reach: an inherited pipe it holds is
 * dropped after a short drain bound rather than waited on. This is an isolated
 * environment, not an OS sandbox — the operator is trusted, and real sandboxing is
 * the host OS's job.
 */
export function makeJobHandler(command: string[], options: JobHandlerOptions = {}): JobHandler {
  if (command.length === 0 || command[0] === '')
    throw new Error('A worker command is required after `--`.');
  const executable = resolveExecutable(command[0]!, process.cwd());
  const args = command.slice(1);
  const timeoutMs = options.timeoutMs ?? JOB_COMMAND_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('timeoutMs must be a positive number.');

  return async (job, signal) => {
    signal.throwIfAborted();
    const workdir = await mkdtemp(join(tmpdir(), 'agent-drive-job-'));
    try {
      const dirs = { inputs: 'inputs', outputs: 'outputs', home: 'home', tmp: 'tmp' };
      for (const name of Object.values(dirs)) await mkdir(join(workdir, name));
      await writeFile(join(workdir, 'request.md'), job.request);
      await stageInputs(join(workdir, dirs.inputs), job.inputs);

      const outcome = await runWorker({
        executable,
        args,
        cwd: workdir,
        env: workerEnv(join(workdir, dirs.home), join(workdir, dirs.tmp)),
        stdin: job.request,
        signal,
        timeoutMs,
      });
      if (outcome.spawnError)
        throw new Error(
          `cannot spawn the worker command ${JSON.stringify(executable)}: ${outcome.spawnError.message}`,
        );
      if (outcome.streamError)
        throw new Error(`worker output stream failed: ${outcome.streamError.message}`);
      signal.throwIfAborted();
      if (outcome.timedOut)
        throw new Error(`worker command exceeded the ${timeoutMs} ms limit and was killed`);
      if (outcome.stdoutOverflow)
        throw new Error('worker wrote more than 8 MiB to standard output');
      if (outcome.signal) throw new Error(`worker command exited on signal ${outcome.signal}`);
      if (outcome.code !== 0) throw new Error(`worker command exited with code ${outcome.code}`);

      return await gatherOutputs(workdir, join(workdir, dirs.outputs), outcome.stdout);
    } finally {
      // The workspace is ours: remove it only while it is still a real directory, and
      // never follow a swapped symlink. rm never descends through links inside it.
      const stat = await lstat(workdir).catch(() => undefined);
      if (stat?.isDirectory())
        await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

/**
 * Resolves the executable once, at handler-build time, against the owner's launch cwd
 * and trusted host PATH: a path-like command resolves against the cwd; a bare name is
 * looked up like execvp would. The private job dir is never searched, and the child's
 * minimal PATH does not affect the result. An unresolved bare name is returned as-is
 * so spawn can report ENOENT itself (it may still exist on the child's minimal PATH).
 */
function resolveExecutable(command: string, ownerCwd: string): string {
  if (command.includes('/') || command.includes('\\')) return resolve(ownerCwd, command);
  const extensions =
    process.platform === 'win32'
      ? [...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';'), '']
      : [''];
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    for (const ext of extensions) {
      // An empty PATH entry means the cwd, matching execvp — the owner's launch cwd.
      const candidate = resolve(ownerCwd, join(entry, command + ext));
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not here, or present but not executable: keep looking.
      }
    }
  }
  return command;
}

function workerEnv(home: string, tmp: string): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    PATH: MINIMAL_PATH,
    HOME: home,
    TMPDIR: tmp,
    LANG: 'C.UTF-8',
  };
  if (process.platform === 'win32') {
    env.SystemRoot = 'C:\\Windows';
    env.windir = 'C:\\Windows';
  }
  // ProcessEnv declares a required NODE_ENV that the minimal worker env deliberately lacks.
  return env as NodeJS.ProcessEnv;
}

async function stageInputs(dir: string, inputs: JobRequest['inputs']) {
  const seen = new Set<string>();
  for (const input of inputs) {
    if (
      input.name.length === 0 ||
      input.name === '.' ||
      input.name === '..' ||
      input.name.includes('/') ||
      input.name.includes('\\') ||
      input.name.includes('\0') ||
      Buffer.byteLength(input.name) > 255
    )
      throw new Error(
        `unsafe input name ${JSON.stringify(input.name)}: inputs must be flat file names`,
      );
    if (seen.has(input.name)) throw new Error(`duplicate input name ${JSON.stringify(input.name)}`);
    seen.add(input.name);
    // Exclusive create: distinct remote names that collapse on this filesystem
    // (case or Unicode normalization) fail instead of silently replacing bytes.
    try {
      await writeFile(join(dir, input.name), input.bytes, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(
          `input name ${JSON.stringify(input.name)} collides with a staged input on this filesystem`,
        );
      throw error;
    }
  }
}

type WorkerOutcome = {
  spawnError?: Error;
  streamError?: Error;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stdoutOverflow: boolean;
  timedOut: boolean;
};

/**
 * Spawns the worker (never a shell) and resolves once the child has exited and its
 * stdio is closed — the settled point where collecting outputs and cleaning up is
 * safe. Stderr is discarded outright; stdout is buffered only up to the file bound.
 *
 * Signalling discipline: the job-owned process group is SIGKILLed at most once —
 * promptly at the leader's 'exit' (sweeping orphaned members), or while cancelling
 * a still-live leader. It is never signalled from a delayed 'close', a timer, or a
 * late abort, because once the leader is reaped its numeric pgid may be recycled by
 * an unrelated group. Nothing after 'exit' kills by numeric ID.
 */
function runWorker(init: {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: Uint8Array;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<WorkerOutcome> {
  return new Promise((resolve) => {
    const child = spawn(init.executable, init.args, {
      cwd: init.cwd,
      env: init.env,
      stdio: ['pipe', 'pipe', 'ignore'],
      shell: false,
      detached: process.platform !== 'win32',
    });
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let spawnError: Error | undefined;
    let streamError: Error | undefined;
    let stdoutOverflow = false;
    let timedOut = false;
    let settled = false;
    let leaderExited = false;
    let groupRetired = false;
    let killDecided = false;
    let drainTimer: NodeJS.Timeout | undefined;
    let settleTimer: NodeJS.Timeout | undefined;

    /** Signals the job's group exactly once; a second call is always a no-op. */
    const retireGroup = () => {
      if (groupRetired) return;
      groupRetired = true;
      if (process.platform === 'win32' || child.pid === undefined) {
        if (child.exitCode === null && child.signalCode === null)
          try {
            child.kill('SIGKILL');
          } catch {
            // Already gone.
          }
        return;
      }
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Group already gone: nothing to do, and nothing to retry later.
      }
    };
    const dropPipes = () => {
      child.stdout!.destroy();
      child.stdin!.destroy();
    };
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(jobTimer);
      clearTimeout(drainTimer);
      clearTimeout(settleTimer);
      init.signal.removeEventListener('abort', onKill);
      resolve({
        ...(spawnError ? { spawnError } : {}),
        ...(streamError ? { streamError } : {}),
        code,
        signal,
        stdout: Buffer.concat(chunks),
        stdoutOverflow,
        timedOut,
      });
    };
    // Cancels a failing job once. The group is signalled only while the leader is
    // still alive; afterwards we just drop our pipe ends and settle.
    const onKill = () => {
      if (killDecided || settled) return;
      killDecided = true;
      if (!leaderExited) retireGroup();
      clearTimeout(drainTimer);
      dropPipes(); // a failed job needs no more output — settle without waiting
      settleTimer = setTimeout(() => finish(null, 'SIGKILL'), SETTLE_GRACE_MS);
    };
    const jobTimer = setTimeout(() => {
      timedOut = true;
      onKill();
    }, init.timeoutMs);
    init.signal.addEventListener('abort', onKill, { once: true });
    if (init.signal.aborted) onKill();

    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('exit', () => {
      leaderExited = true;
      // The one moment the pgid is still guaranteed to be this job's group.
      retireGroup();
      if (killDecided) return; // already settling — do not wait for drains
      // 'close' follows once the pipes drain. An out-of-group survivor can keep an
      // inherited pipe open: give normal output a short bound to arrive, then drop
      // our ends and settle without waiting on it.
      drainTimer = setTimeout(() => {
        dropPipes();
        settleTimer = setTimeout(() => finish(null, 'SIGKILL'), SETTLE_GRACE_MS);
      }, PIPE_DRAIN_MS);
    });
    child.once('close', (code, signal) => finish(code, signal));
    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > JOB_OUTPUT_FILE_BYTES) {
        if (!stdoutOverflow) {
          stdoutOverflow = true;
          onKill();
        }
        return; // stop retaining once the bound is crossed; the kill settles the rest
      }
      chunks.push(chunk);
    });
    child.stdout!.on('error', (error) => {
      streamError ??= error;
      onKill();
    });
    child.stdin!.on('error', () => {
      // EPIPE when the worker exits without reading; not a job failure.
    });
    child.stdin!.end(init.stdin);
  });
}

/**
 * Collects flat, regular, single-link, bounded files plus stdout as result.md;
 * anything else fails the job. Directory identity is compared before and after the
 * listing, and each file is rechecked on its open handle, so entries swapped or grown
 * mid-read are caught rather than followed. This is hygiene for an untrusted worker's
 * leftovers, not a security sandbox.
 */
async function gatherOutputs(
  workdir: string,
  outputsDir: string,
  stdout: Buffer,
): Promise<JobOutput[]> {
  const workdirStat = await lstat(workdir).catch(() => undefined);
  if (!workdirStat?.isDirectory() || workdirStat.isSymbolicLink())
    throw new Error('worker replaced the job workspace; refusing to collect outputs');
  const dirStat = await lstat(outputsDir).catch(() => undefined);
  if (!dirStat?.isDirectory() || dirStat.isSymbolicLink())
    throw new Error('worker removed or replaced the outputs directory');

  const names: string[] = [];
  const dir = await opendir(outputsDir);
  try {
    for await (const dirent of dir) {
      names.push(dirent.name);
      if (names.length > JOB_OUTPUT_FILE_LIMIT)
        throw new Error(
          `worker produced more than ${JOB_OUTPUT_FILE_LIMIT} output files; the limit is ${JOB_OUTPUT_FILE_LIMIT}`,
        );
    }
  } finally {
    await dir.close().catch(() => undefined);
  }
  const dirAfter = await lstat(outputsDir).catch(() => undefined);
  if (!dirAfter || dirAfter.ino !== dirStat.ino || dirAfter.dev !== dirStat.dev)
    throw new Error('outputs directory changed while it was being read');
  names.sort();

  if (stdout.length > 0 && names.includes('result.md'))
    throw new Error(
      'worker produced standard output and also wrote outputs/result.md; refusing to overwrite it',
    );

  const outputs: JobOutput[] = [];
  let total = 0;
  for (const name of names) {
    const path = join(outputsDir, name);
    const listed = await lstat(path).catch(() => undefined);
    if (!listed?.isFile()) throw new Error(`output ${JSON.stringify(name)} is not a regular file`);
    if (listed.nlink !== 1)
      throw new Error(`output ${JSON.stringify(name)} has more than one link`);
    if (listed.size > JOB_OUTPUT_FILE_BYTES)
      throw new Error(`output ${JSON.stringify(name)} exceeds the 8 MiB file limit`);
    // O_NOFOLLOW|O_NONBLOCK: a symlink or FIFO swapped in after lstat cannot be followed or block.
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      const live = await handle.stat();
      if (!live.isFile() || live.nlink !== 1)
        throw new Error(`output ${JSON.stringify(name)} is not a regular file`);
      if (live.ino !== listed.ino || live.dev !== listed.dev || live.size !== listed.size)
        throw new Error(`output ${JSON.stringify(name)} changed while it was being read`);
      const bytes = await readBounded(handle, name);
      total += bytes.byteLength;
      if (total > JOB_OUTPUT_TOTAL_BYTES)
        throw new Error('worker outputs exceed the 32 MiB total limit');
      outputs.push({ name, bytes });
    } finally {
      await handle.close();
    }
  }

  if (stdout.length > 0) {
    if (outputs.length >= JOB_OUTPUT_FILE_LIMIT)
      throw new Error(
        `worker produced more than ${JOB_OUTPUT_FILE_LIMIT} output files; the limit is ${JOB_OUTPUT_FILE_LIMIT}`,
      );
    total += stdout.byteLength;
    if (total > JOB_OUTPUT_TOTAL_BYTES)
      throw new Error('worker outputs exceed the 32 MiB total limit');
    outputs.push({ name: 'result.md', bytes: stdout });
    outputs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  return outputs;
}

async function readBounded(handle: FileHandle, name: string): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > JOB_OUTPUT_FILE_BYTES)
      throw new Error(
        `output ${JSON.stringify(name)} exceeded the 8 MiB file limit while being read`,
      );
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks, total);
}
