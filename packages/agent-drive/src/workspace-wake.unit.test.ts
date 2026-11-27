import { describe, expect, it, vi } from "vitest";
import {
  createInstaboxWorkspaceWaker,
  type InstaboxCommandRunner,
  workspaceWakeInstaboxEnvironment,
} from "./workspace-wake.js";

const machineId = "m_01HZY6Y5JQKCN1W9F2NR4T7V8A";

function machine(state: string, id = machineId) {
  return JSON.stringify({ id, status: state });
}

describe("Instabox workspace wake", () => {
  it("requires a stable machine ID and never accepts a saved display name", async () => {
    const run = vi.fn();
    expect(() =>
      createInstaboxWorkspaceWaker({ registeredMachineIds: ["dev"], run }),
    ).toThrow(/stable Instabox machine ID/u);
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });
    expect(() => wake.inspect("dev")).toThrow(/stable Instabox machine ID/u);
    expect(run).not.toHaveBeenCalled();
  });

  it("inspects the exact ID with get and never wakes the machine", async () => {
    const run = vi.fn(async (_args: readonly string[]) => machine("paused"));
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });

    await expect(wake.inspect(machineId)).resolves.toEqual({
      machineId,
      state: "paused",
    });
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ["get", machineId, "--json"],
    ]);
  });

  it.each(["stopped", "paused", "suspended", "starting"])(
    "blocks %s before remote I/O when wake-on-access is disabled",
    async (state) => {
      const run = vi.fn(async (_args: readonly string[]) => machine(state));
      const wake = createInstaboxWorkspaceWaker({
        registeredMachineIds: [machineId],
        run,
      });

      await expect(
        wake.ensureAvailable(machineId, { wakeOnAccess: false }),
      ).rejects.toThrow(/wake-on-access is disabled/u);
      expect(run.mock.calls.map(([args]) => args)).toEqual([
        ["get", machineId, "--json"],
      ]);
    },
  );

  it("allows a verified running machine with wake disabled", async () => {
    const run = vi.fn(async () => machine("running"));
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });

    await expect(
      wake.ensureAvailable(machineId, { wakeOnAccess: false }),
    ).resolves.toBe("already-running");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("starts only a verified stopped machine and deduplicates same-policy requests", async () => {
    let gets = 0;
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "get" && gets++ === 0) return machine("stopped");
      if (args[0] === "start") return machine("running");
      return machine("running");
    });
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });

    await expect(
      Promise.all([
        wake.ensureAvailable(machineId, { wakeOnAccess: true }),
        wake.ensureAvailable(machineId, { wakeOnAccess: true }),
      ]),
    ).resolves.toEqual(["started", "started"]);
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ["get", machineId, "--json"],
      ["start", machineId, "--json"],
    ]);
  });

  it("resumes a paused machine and waits through a transitional state by inspecting only", async () => {
    let getCount = 0;
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "get") {
        getCount += 1;
        if (getCount === 1) return machine("paused");
        return machine("running");
      }
      return machine("starting");
    });
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
      timeoutMs: 2_000,
    });

    await expect(wake.wake(machineId)).resolves.toBe("resumed");
    expect(run.mock.calls.map(([args]) => args[0])).toEqual([
      "get",
      "resume",
      "get",
    ]);
  });

  it("rejects mismatched machine responses before a mutating CLI command", async () => {
    const run = vi.fn(async () => machine("stopped", "m_another-machine"));
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });

    await expect(
      wake.ensureAvailable(machineId, { wakeOnAccess: true }),
    ).rejects.toThrow(/different machine ID/u);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("re-reads state after a retryable CLI error before deciding to mutate", async () => {
    const retryableError = Object.assign(new Error("temporary capacity"), {
      code: 75,
    });
    const run = vi
      .fn<InstaboxCommandRunner>()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce(machine("running"));
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });

    await expect(wake.wake(machineId)).resolves.toBe("already-running");
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ["get", machineId, "--json"],
      ["get", machineId, "--json"],
    ]);
  });

  it("removes all Agent Drive variables from the Instabox environment", () => {
    expect(
      workspaceWakeInstaboxEnvironment({
        AGENT_DRIVE_API_KEY: "synthetic-api-secret",
        AGENT_DRIVE_KEY: "synthetic-drive-secret",
        AGENT_DRIVE_CREDENTIALS: "synthetic-bundle",
        PATH: "/usr/bin",
        INSTABOX_API_KEY: "instabox-test-key",
        INSTABOX_NO_TELEMETRY: "0",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      INSTABOX_API_KEY: "instabox-test-key",
      INSTABOX_NO_TELEMETRY: "1",
    });
  });

  it("honors an already-aborted signal without invoking the CLI", async () => {
    const run = vi.fn();
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      wake.ensureAvailable(machineId, {
        wakeOnAccess: true,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(run).not.toHaveBeenCalled();
  });
});
