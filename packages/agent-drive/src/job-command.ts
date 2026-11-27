import { spawn } from 'node:child_process';
import { accessSync, constants, statSync, type Stats } from 'node:fs';
import {
  type FileHandle,
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  rmdir,
  rm,
  stat,
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

/**
 * The handler makeJobHandler returns. `assertReady` is deliberately an extra
 * method on the callable — an engine that does not know about it still gets a
 * plain JobHandler, while a current engine calls it before claiming each job so
 * a gone or swapped program halts the worker instead of consuming claim ids.
 */
export type CommandJobHandler = JobHandler & {
  /** Re-validates the pinned worker executable; throws WorkerUnavailableError. */
  assertReady(): void;
};

export type JobHandlerOptions = { timeoutMs?: number };

export const JOB_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
export const JOB_OUTPUT_FILE_LIMIT = 16;
export const JOB_OUTPUT_FILE_BYTES = 8 * 1024 * 1024; // per output file, and stdout
export const JOB_OUTPUT_TOTAL_BYTES = 32 * 1024 * 1024; // all output bytes together

/**
 * The configured worker program is missing, not executable, or no longer the
 * file pinned when the handler was built — also thrown when a real spawn
 * reports ENOENT/EACCES-style failures. Fatal for the worker, never a per-job
 * failure: the engine must stop claiming and let the owner fix the command.
 */
export class WorkerUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkerUnavailableError';
  }
}

/**
 * The job workspace could not be verified as ours or fully removed, so plaintext
 * request, input, or output bytes may remain on the host. Fatal for the worker:
 * an operator must inspect/remove the leftover workspace named in the message.
 * When the job already failed for its own reason, that error is kept on
 * `jobError`. Messages carry paths and errno codes only — never file contents.
 */
export class WorkspaceCleanupError extends WorkerUnavailableError {
  /** The job's own failure, when cleanup failure arrived on top of it. */
  jobError?: unknown;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkspaceCleanupError';
  }
}

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
 * Spawn failures that mean the configured program cannot run at all — not a
 * per-job outcome. They map to WorkerUnavailableError so the worker halts
 * instead of burning through the queued job ids.
 */
const SPAWN_UNAVAILABLE = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC', 'ENOTDIR', 'ELOOP']);

/** A short, content-free tag for error messages: an errno code, nothing else. */
function errCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && code.length > 0 ? code : 'unexpected error';
}

/**
 * Builds a job handler that runs a trusted owner-specified command (CLI args after `--`,
 * never read from the drive) per job. Each run gets a private workspace holding
 * request.md, flat inputs/, outputs/, and an isolated HOME/TMPDIR; the request bytes
 * also go to the child's stdin for CLIs that read prompts there. Non-empty stdout plus
 * bounded regular files in outputs/ form the job result.
 *
 * The executable is resolved and pinned (dev/ino) when the handler is built — a
 * missing or non-executable program throws immediately, before the engine scans
 * anything — and re-validated per job via `assertReady`. The output limits are
 * enforced at collection time; bounding the workspace's disk usage DURING
 * execution is the host's job (e.g. an OS quota on TMPDIR), per the operator guide.
 *
 * Process lifetime: on POSIX each run is a new process group. The group is signalled
 * exactly once — promptly at the leader's 'exit', or while cancelling a still-live
 * leader — never later, because a reaped pgid may already be recycled. A process that
 * left the group (setsid/detached) is out of reach: an inherited pipe it holds is
 * dropped after a short drain bound rather than waited on. This is an isolated
 * environment, not an OS sandbox — the operator is trusted, and real sandboxing is
 * the host OS's job.
 */
export function makeJobHandler(
  command: string[],
  options: JobHandlerOptions = {},
): CommandJobHandler {
  if (command.length === 0 || command[0] === '')
    throw new Error('A worker command is required after `--`.');
  const timeoutMs = options.timeoutMs ?? JOB_COMMAND_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('timeoutMs must be a positive number.');
  // Resolve AND pin before the caller scans anything: a missing or
  // non-executable program stops the worker here, never after claims land.
  const executable = resolveExecutable(command[0]!, process.cwd());
  const pin = pinExecutable(executable);
  const args = command.slice(1);

  const assertReady = () => {
    const now = pinExecutable(executable);
    if (now.dev !== pin.dev || now.ino !== pin.ino)
      throw new WorkerUnavailableError(
        `the worker command ${JSON.stringify(executable)} was replaced after startup`,
      );
  };

  const run: JobHandler = async (job, signal) => {
    signal.throwIfAborted();
    assertReady();
    const workdir = await mkdtemp(join(tmpdir(), 'agent-drive-job-'));
    let owned: Stats;
    try {
      // Pin the workspace inode so cleanup never recursively removes a
      // directory the worker swapped into its place.
      owned = await stat(workdir);
    } catch (error) {
      // Pin failed before staging: only remove the empty directory we created.
      // Never recursively remove a path whose identity could not be verified.
      await rmdir(workdir).catch(() => undefined);
      throw error;
    }
    let primary: unknown;
    let failed = false;
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
      if (outcome.spawnError) {
        const code = (outcome.spawnError as NodeJS.ErrnoException).code;
        if (typeof code === 'string' && SPAWN_UNAVAILABLE.has(code))
          throw new WorkerUnavailableError(
            `the worker command ${JSON.stringify(executable)} could not be spawned (${code}); the owner must fix the command`,
            { cause: outcome.spawnError },
          );
        throw new Error(
          `cannot spawn the worker command ${JSON.stringify(executable)}: ${outcome.spawnError.message}`,
        );
      }
      if (outcome.streamError)
        throw new Error(`worker output stream failed: ${outcome.streamError.message}`);
      signal.throwIfAborted();
      if (outcome.timedOut)
        throw new Error(`worker command exceeded the ${timeoutMs} ms limit and was killed`);
      if (outcome.stdoutOverflow)
        throw new Error('worker wrote more than 8 MiB to standard output');
      if (outcome.signal) throw new Error(`worker command exited on signal ${outcome.signal}`);
      if (outcome.code !== 0) throw new Error(`worker command exited with code ${outcome.code}`);
      if (outcome.stdoutTruncated)
        throw new Error(
          'worker stdout was cut short of end-of-stream when its pipe was dropped; the truncated result was discarded',
        );

      return await gatherOutputs(workdir, join(workdir, dirs.outputs), outcome.stdout);
    } catch (error) {
      failed = true;
      primary = error;
      throw error;
    } finally {
      try {
        await cleanWorkspace(workdir, owned);
      } catch (error) {
        const cleanupError =
          error instanceof WorkspaceCleanupError
            ? error
            : new WorkspaceCleanupError(
                `could not finish cleaning the job workspace at ${workdir}; remove it manually`,
                { cause: error },
              );
        if (failed) cleanupError.jobError = primary;
        throw cleanupError;
      }
    }
  };
  (run as CommandJobHandler).assertReady = assertReady;
  return run as CommandJobHandler;
}

/**
 * Resolves the executable once, at handler-build time, against the owner's launch cwd
 * and trusted host PATH: a path-like command resolves against the cwd; a bare name is
 * looked up like execvp would — owner PATH first, then the child's minimal PATH, the
 * same order the spawned child would search. The private job dir is never searched.
 * An unresolved bare name is a WorkerUnavailableError, not a deferred spawn failure.
 */
function resolveExecutable(command: string, ownerCwd: string): string {
  if (command.includes('/') || command.includes('\\')) return resolve(ownerCwd, command);
  const extensions =
    process.platform === 'win32'
      ? [...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';'), '']
      : [''];
  const search = [...(process.env.PATH ?? '').split(delimiter), ...MINIMAL_PATH.split(delimiter)];
  for (const entry of search) {
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
  throw new WorkerUnavailableError(
    `the worker command ${JSON.stringify(command)} was not found on the owner's PATH or the worker's minimal PATH`,
  );
}

/**
 * Stats and execute-checks the resolved program, returning its dev/ino pin.
 * Reused by assertReady: a changed pin means the program was replaced.
 */
function pinExecutable(executable: string): { dev: number; ino: number } {
  let meta: Stats;
  try {
    meta = statSync(executable);
  } catch (error) {
    throw new WorkerUnavailableError(
      `the worker command ${JSON.stringify(executable)} is not available (${errCode(error)})`,
      { cause: error },
    );
  }
  if (!meta.isFile())
    throw new WorkerUnavailableError(
      `the worker command ${JSON.stringify(executable)} is not a regular file`,
    );
  try {
    accessSync(executable, constants.X_OK);
  } catch (error) {
    throw new WorkerUnavailableError(
      `the worker command ${JSON.stringify(executable)} is not executable (${errCode(error)})`,
      { cause: error },
    );
  }
  return { dev: meta.dev, ino: meta.ino };
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

/**
 * Removes the job workspace only while the path still names the inode this run
 * created (pinned at mkdtemp). rm never descends through symlinks, so a swapped-
 * in tree is left untouched for the operator rather than recursively deleted.
 * Any failure is fatal: plaintext may remain, and the bounded message says
 * where — never what — was left behind.
 */
async function cleanWorkspace(workdir: string, owned: { dev: number; ino: number }): Promise<void> {
  let now: Stats;
  try {
    now = await lstat(workdir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; // nothing remains
    throw new WorkspaceCleanupError(
      `could not inspect the job workspace at ${workdir} (${errCode(error)}); check it manually`,
      { cause: error },
    );
  }
  if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== owned.dev || now.ino !== owned.ino)
    throw new WorkspaceCleanupError(
      `the job workspace at ${workdir} was replaced or moved; find and remove the leftover workspace manually`,
    );
  try {
    await rm(workdir, { recursive: true, force: true });
  } catch (error) {
    throw new WorkspaceCleanupError(
      `could not remove the job workspace at ${workdir} (${errCode(error)}); remove it manually`,
      { cause: error },
    );
  }
  try {
    await lstat(workdir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; // fully removed
    throw new WorkspaceCleanupError(
      `could not confirm removal of the job workspace at ${workdir} (${errCode(error)})`,
      { cause: error },
    );
  }
  throw new WorkspaceCleanupError(
    `the job workspace at ${workdir} still exists after cleanup; remove it manually`,
  );
}

type WorkerOutcome = {
  spawnError?: Error;
  streamError?: Error;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stdoutOverflow: boolean;
  /** Our pipe ends were destroyed before stdout reached 'end': partial bytes only. */
  stdoutTruncated: boolean;
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
    let stdoutEnded = false;
    let stdoutDropped = false;
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
      // Destroyed before 'end': the buffered prefix is partial, never a result.
      if (!stdoutEnded) stdoutDropped = true;
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
        stdoutTruncated: stdoutDropped && !stdoutEnded,
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
    child.stdout!.once('end', () => {
      stdoutEnded = true;
    });
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
 * anything else fails the job. The outputs directory is pinned on an open handle:
 * on Linux the listing and every file open run beneath /proc/self/fd/<dirfd>, so a
 * surviving helper that swaps the directory can never steer the reads; elsewhere
 * the path is rechecked against the pinned dev/ino — after the listing, after
 * every file, and once more before bytes are returned — and any identity the
 * runtime cannot verify fails the job instead of being trusted. Each file's
 * dev/ino/size/mtime/ctime are rechecked on its open handle after a full read, so
 * bytes that shrank or changed mid-read are never published.
 * This is hygiene for an untrusted worker's leftovers, not a security sandbox.
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

  let pinned: { handle: FileHandle; dev: number; ino: number } | undefined;
  try {
    const handle = await open(outputsDir, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    const handleStat = await handle.stat();
    if (!handleStat.isDirectory()) {
      await handle.close();
      throw new Error('worker removed or replaced the outputs directory');
    }
    if (handleStat.dev !== dirStat.dev || handleStat.ino !== dirStat.ino) {
      await handle.close();
      throw new Error('outputs directory changed while it was being read');
    }
    pinned = { handle, dev: handleStat.dev, ino: handleStat.ino };
  } catch (error) {
    // Windows cannot hold a directory handle; path opens plus the same identity
    // rechecks still apply there. Any other failure is already a job failure.
    if ((error as NodeJS.ErrnoException).code === undefined || process.platform !== 'win32')
      throw error;
  }
  try {
    // Fail-closed: whatever the runtime cannot prove is still the pinned
    // directory fails the collection — the result is never published anyway.
    const parentIntact = async () => {
      const now = await stat(outputsDir).catch(() => undefined);
      const want = pinned ?? dirStat;
      if (!now || now.dev !== want.dev || now.ino !== want.ino)
        throw new Error('outputs directory changed while it was being read');
    };
    const dirFdPath =
      pinned !== undefined && process.platform === 'linux'
        ? `/proc/self/fd/${pinned.handle.fd}`
        : undefined;

    const names: string[] = [];
    const dir = await opendir(dirFdPath ?? outputsDir);
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
    await parentIntact();
    names.sort();

    if (stdout.length > 0 && names.includes('result.md'))
      throw new Error(
        'worker produced standard output and also wrote outputs/result.md; refusing to overwrite it',
      );

    const openFlags =
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
    const outputs: JobOutput[] = [];
    let total = 0;
    for (const name of names) {
      const path = join(outputsDir, name);
      const listed = await lstat(path).catch(() => undefined);
      if (!listed?.isFile())
        throw new Error(`output ${JSON.stringify(name)} is not a regular file`);
      if (listed.nlink !== 1)
        throw new Error(`output ${JSON.stringify(name)} has more than one link`);
      if (listed.size > JOB_OUTPUT_FILE_BYTES)
        throw new Error(`output ${JSON.stringify(name)} exceeds the 8 MiB file limit`);
      // O_NOFOLLOW|O_NONBLOCK: a symlink or FIFO swapped in after lstat cannot be followed or block.
      // On Linux the open runs beneath the pinned directory fd, off the raced path entirely.
      const handle = await open(dirFdPath !== undefined ? join(dirFdPath, name) : path, openFlags);
      try {
        const live = await handle.stat();
        if (!live.isFile() || live.nlink !== 1)
          throw new Error(`output ${JSON.stringify(name)} is not a regular file`);
        if (live.ino !== listed.ino || live.dev !== listed.dev || live.size !== listed.size)
          throw new Error(`output ${JSON.stringify(name)} changed while it was being read`);
        const bytes = await readExact(handle, name, live.size);
        const after = await handle.stat();
        if (
          after.ino !== live.ino ||
          after.dev !== live.dev ||
          after.size !== live.size ||
          after.mtimeMs !== live.mtimeMs ||
          after.ctimeMs !== live.ctimeMs
        )
          throw new Error(`output ${JSON.stringify(name)} changed while it was being read`);
        total += bytes.byteLength;
        if (total > JOB_OUTPUT_TOTAL_BYTES)
          throw new Error('worker outputs exceed the 32 MiB total limit');
        outputs.push({ name, bytes });
      } finally {
        await handle.close();
      }
      await parentIntact();
    }
    // The parent must still be the pinned directory before any byte leaves.
    await parentIntact();

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
  } finally {
    await pinned?.handle.close().catch(() => undefined);
  }
}

/**
 * Reads the file to EOF and requires exactly `size` bytes: fewer means it was
 * truncated mid-read, more means it grew — either way the result cannot stand.
 */
async function readExact(handle: FileHandle, name: string, size: number): Promise<Buffer> {
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
  if (total !== size)
    throw new Error(`output ${JSON.stringify(name)} changed while it was being read`);
  return Buffer.concat(chunks, total);
}
