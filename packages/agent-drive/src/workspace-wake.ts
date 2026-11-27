import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRIES = 2;

export type WorkspaceWakeOutcome = "already-running" | "started" | "resumed";

export type InstaboxCommandRunner = (
  args: readonly string[],
  options: { signal: AbortSignal; timeoutMs: number },
) => Promise<string>;

export interface InstaboxWorkspaceWakerOptions {
  /** Exact IDs from explicitly registered, saved live workspace definitions. */
  registeredMachineIds: readonly string[];
  cliPath?: string;
  timeoutMs?: number;
  retries?: number;
  /** Test seam; production uses execFile and never invokes a shell. */
  run?: InstaboxCommandRunner;
}

export interface InstaboxWorkspaceWaker {
  wake(machineId: string, signal?: AbortSignal): Promise<WorkspaceWakeOutcome>;
}

interface InstaboxMachine {
  id?: unknown;
  machineId?: unknown;
  status?: unknown;
  state?: unknown;
}

function defaultRunner(cliPath: string): InstaboxCommandRunner {
  return async (args, { signal, timeoutMs }) => {
    const { stdout } = await execFileAsync(cliPath, [...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      signal,
      timeout: timeoutMs,
      windowsHide: true,
    });
    return stdout;
  };
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

/** Creates a lazy, deduplicating waker for explicitly registered machine IDs. */
export function createInstaboxWorkspaceWaker(
  options: InstaboxWorkspaceWakerOptions,
): InstaboxWorkspaceWaker {
  const registered = new Set(options.registeredMachineIds);
  const inFlight = new Map<string, Promise<WorkspaceWakeOutcome>>();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const run = options.run ?? defaultRunner(options.cliPath ?? "instabox");

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new RangeError("timeoutMs must be a positive integer.");
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 5)
    throw new RangeError("retries must be an integer from 0 through 5.");

  return {
    wake(machineId, signal) {
      if (!registered.has(machineId))
        return Promise.reject(
          new Error(
            "The Instabox machine is not registered for this workspace.",
          ),
        );
      if (signal?.aborted) return Promise.reject(abortError());
      const existing = inFlight.get(machineId);
      if (existing) return existing;
      const pending = wakeRegisteredMachine(
        machineId,
        signal,
        run,
        timeoutMs,
        retries,
      );
      inFlight.set(machineId, pending);
      void pending
        .finally(() => {
          if (inFlight.get(machineId) === pending) inFlight.delete(machineId);
        })
        .catch(() => undefined);
      return pending;
    },
  };
}

async function wakeRegisteredMachine(
  machineId: string,
  signal: AbortSignal | undefined,
  run: InstaboxCommandRunner,
  timeoutMs: number,
  retries: number,
): Promise<WorkspaceWakeOutcome> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw abortError();
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("Instabox workspace wake timed out.");
    try {
      const getJson = await run(["get", machineId, "--json"], {
        signal: signal ?? AbortSignal.timeout(remainingMs),
        timeoutMs: remainingMs,
      });
      const state = machineState(machineFromJson(getJson, machineId));
      if (state === "running") return "already-running";

      let command: "start" | "resume";
      let outcome: Exclude<WorkspaceWakeOutcome, "already-running">;
      if (state === "stopped") {
        command = "start";
        outcome = "started";
      } else if (state === "paused" || state === "suspended") {
        command = "resume";
        outcome = "resumed";
      } else {
        throw new Error(`Instabox machine is in unsupported state: ${state}.`);
      }

      const opRemainingMs = deadline - Date.now();
      if (opRemainingMs <= 0)
        throw new Error("Instabox workspace wake timed out.");
      await run([command, machineId, "--json"], {
        signal: signal ?? AbortSignal.timeout(opRemainingMs),
        timeoutMs: opRemainingMs,
      });
      const verifyRemainingMs = deadline - Date.now();
      if (verifyRemainingMs <= 0)
        throw new Error("Instabox workspace wake timed out.");
      const verifyJson = await run(["get", machineId, "--json"], {
        signal: signal ?? AbortSignal.timeout(verifyRemainingMs),
        timeoutMs: verifyRemainingMs,
      });
      if (machineState(machineFromJson(verifyJson, machineId)) !== "running")
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
