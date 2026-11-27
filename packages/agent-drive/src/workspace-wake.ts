import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRIES = 2;
const STATE_POLL_MS = 500;
const MACHINE_ID_PATTERN = /^m_[A-Za-z0-9_-]{1,126}$/u;

export type WorkspaceWakeOutcome = "already-running" | "started" | "resumed";

export interface InstaboxMachineState {
  machineId: string;
  state: string;
}

export type InstaboxCommandRunner = (
  args: readonly string[],
  options: { signal: AbortSignal; timeoutMs: number },
) => Promise<string>;

export interface InstaboxWorkspaceWakerOptions {
  /** Exact, stable Instabox IDs from saved live workspace definitions. */
  registeredMachineIds: readonly string[];
  cliPath?: string;
  timeoutMs?: number;
  retries?: number;
  /** Test seam; production uses execFile and never invokes a shell. */
  run?: InstaboxCommandRunner;
}

export interface InstaboxWorkspaceWaker {
  /** Read the exact machine ID and current state. `get` never wakes a machine. */
  inspect(
    machineId: string,
    signal?: AbortSignal,
  ): Promise<InstaboxMachineState>;
  /** Verify a machine before I/O, optionally starting or resuming it by policy. */
  ensureAvailable(
    machineId: string,
    options: { wakeOnAccess: boolean; signal?: AbortSignal },
  ): Promise<WorkspaceWakeOutcome>;
  /** Compatibility shorthand for `ensureAvailable(machineId, { wakeOnAccess: true })`. */
  wake(machineId: string, signal?: AbortSignal): Promise<WorkspaceWakeOutcome>;
}

interface InstaboxMachine {
  id?: unknown;
  machineId?: unknown;
  status?: unknown;
  state?: unknown;
}

/** Remove Agent Drive credentials from the environment inherited by Instabox. */
export function workspaceWakeInstaboxEnvironment(
  environment: Record<string, string | undefined> = process.env,
): NodeJS.ProcessEnv {
  const filtered: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(environment))
    if (!name.startsWith("AGENT_DRIVE_")) filtered[name] = value;
  filtered.INSTABOX_NO_TELEMETRY = "1";
  return filtered as NodeJS.ProcessEnv;
}

function defaultRunner(cliPath: string): InstaboxCommandRunner {
  return async (args, { signal, timeoutMs }) => {
    const { stdout } = await execFileAsync(cliPath, [...args], {
      encoding: "utf8",
      env: workspaceWakeInstaboxEnvironment(),
      maxBuffer: 1024 * 1024,
      signal,
      timeout: timeoutMs,
      windowsHide: true,
    });
    return stdout;
  };
}

function assertMachineId(machineId: string): void {
  if (!MACHINE_ID_PATTERN.test(machineId))
    throw new Error("Expected a stable Instabox machine ID beginning with m_.");
}

function machineFromJson(output: string, expectedId: string): InstaboxMachine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Instabox returned invalid machine JSON.");
  }
  const value =
    parsed && typeof parsed === "object" && "machine" in parsed
      ? (parsed as { machine: unknown }).machine
      : parsed;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Instabox returned an invalid machine response.");
  const machine = value as InstaboxMachine;
  const returnedId =
    typeof machine.id === "string" ? machine.id : machine.machineId;
  if (returnedId !== expectedId)
    throw new Error("Instabox returned a different machine ID.");
  return machine;
}

function machineState(machine: InstaboxMachine): string {
  const state =
    typeof machine.status === "string" ? machine.status : machine.state;
  if (typeof state !== "string")
    throw new Error("Instabox machine response has no state.");
  return state.toLowerCase();
}

function retryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const details = error as {
    code?: unknown;
    stderr?: unknown;
    stdout?: unknown;
  };
  if (details.code === 75 || details.code === "75") return true;
  const output = `${String(details.stdout ?? "")}\n${String(details.stderr ?? "")}`;
  return /"retryable"\s*:\s*true/u.test(output);
}

function abortError() {
  return new DOMException("Workspace wake was aborted.", "AbortError");
}

/** Creates a lazy, deduplicating waker for explicitly registered stable IDs. */
export function createInstaboxWorkspaceWaker(
  options: InstaboxWorkspaceWakerOptions,
): InstaboxWorkspaceWaker {
  const registered = new Set(options.registeredMachineIds);
  for (const machineId of registered) assertMachineId(machineId);
  const inFlight = new Map<string, Promise<WorkspaceWakeOutcome>>();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const run = options.run ?? defaultRunner(options.cliPath ?? "instabox");

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new RangeError("timeoutMs must be a positive integer.");
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 5)
    throw new RangeError("retries must be an integer from 0 through 5.");

  const inspect = (machineId: string, signal?: AbortSignal) => {
    assertRegistered(machineId, registered);
    return inspectMachine(machineId, signal, run, timeoutMs, retries);
  };

  const ensureAvailable = (
    machineId: string,
    request: { wakeOnAccess: boolean; signal?: AbortSignal },
  ) => {
    assertRegistered(machineId, registered);
    if (typeof request.wakeOnAccess !== "boolean")
      return Promise.reject(
        new Error("A current wake-on-access policy is required."),
      );
    if (request.signal?.aborted) return Promise.reject(abortError());
    const key = `${machineId}\0${request.wakeOnAccess ? "wake" : "no-wake"}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const pending = ensureMachineAvailable(
      machineId,
      request.wakeOnAccess,
      request.signal,
      run,
      timeoutMs,
      retries,
    );
    inFlight.set(key, pending);
    void pending
      .finally(() => {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      })
      .catch(() => undefined);
    return pending;
  };

  return {
    inspect,
    ensureAvailable,
    wake: (machineId, signal) =>
      ensureAvailable(machineId, {
        wakeOnAccess: true,
        ...(signal ? { signal } : {}),
      }),
  };
}

function assertRegistered(machineId: string, registered: Set<string>): void {
  assertMachineId(machineId);
  if (!registered.has(machineId))
    throw new Error(
      "The Instabox machine is not registered for this workspace.",
    );
}

async function inspectMachine(
  machineId: string,
  signal: AbortSignal | undefined,
  run: InstaboxCommandRunner,
  timeoutMs: number,
  retries: number,
): Promise<InstaboxMachineState> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw abortError();
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
      throw new Error("Instabox machine inspection timed out.");
    try {
      const output = await run(["get", machineId, "--json"], {
        signal: signal ?? AbortSignal.timeout(remainingMs),
        timeoutMs: remainingMs,
      });
      const state = machineState(machineFromJson(output, machineId));
      return { machineId, state };
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw abortError();
      if (attempt >= retries || !retryable(error)) throw error;
    }
  }
  throw lastError;
}

async function ensureMachineAvailable(
  machineId: string,
  wakeOnAccess: boolean,
  signal: AbortSignal | undefined,
  run: InstaboxCommandRunner,
  timeoutMs: number,
  retries: number,
): Promise<WorkspaceWakeOutcome> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw abortError();
    try {
      const state = await inspectMachine(
        machineId,
        signal,
        run,
        Math.max(1, deadline - Date.now()),
        retries,
      );
      if (state.state === "running") return "already-running";
      if (!wakeOnAccess)
        throw new Error(
          `Instabox machine is ${state.state}; wake-on-access is disabled.`,
        );

      if (isStartingState(state.state)) {
        const ready = await waitForRunning(
          machineId,
          signal,
          run,
          deadline,
          retries,
        );
        if (ready) return "already-running";
        continue;
      }

      let command: "start" | "resume";
      let outcome: Exclude<WorkspaceWakeOutcome, "already-running">;
      if (state.state === "stopped") {
        command = "start";
        outcome = "started";
      } else if (state.state === "paused" || state.state === "suspended") {
        command = "resume";
        outcome = "resumed";
      } else {
        throw new Error(
          `Instabox machine is in unsupported state: ${state.state}.`,
        );
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0)
        throw new Error("Instabox workspace wake timed out.");
      const operationOutput = await run([command, machineId, "--json"], {
        signal: signal ?? AbortSignal.timeout(remainingMs),
        timeoutMs: remainingMs,
      });
      const operationState = machineState(
        machineFromJson(operationOutput, machineId),
      );
      if (
        operationState !== "running" &&
        (!isStartingState(operationState) ||
          !(await waitForRunning(machineId, signal, run, deadline, retries)))
      )
        throw new Error("Instabox machine did not reach the running state.");
      return outcome;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw abortError();
      if (attempt >= retries || !retryable(error)) throw error;
    }
  }
  throw lastError;
}

function isStartingState(state: string): boolean {
  return ["starting", "resuming", "restarting"].includes(state);
}

async function waitForRunning(
  machineId: string,
  signal: AbortSignal | undefined,
  run: InstaboxCommandRunner,
  deadline: number,
  retries: number,
): Promise<boolean> {
  while (Date.now() < deadline) {
    if (signal?.aborted) throw abortError();
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(abortError());
      };
      const timer = setTimeout(
        finish,
        Math.min(STATE_POLL_MS, deadline - Date.now()),
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    if (signal?.aborted) throw abortError();
    const state = await inspectMachine(
      machineId,
      signal,
      run,
      Math.max(1, deadline - Date.now()),
      retries,
    );
    if (state.state === "running") return true;
    if (!isStartingState(state.state)) return false;
  }
  return false;
}
