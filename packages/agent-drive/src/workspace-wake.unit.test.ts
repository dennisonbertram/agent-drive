import { describe, expect, it, vi } from "vitest";
import {
  createInstaboxWorkspaceWaker,
  type InstaboxCommandRunner,
} from "./workspace-wake.js";

const machineId = "sbx_01HZY6Y5JQKCN1W9F2NR4T7V8A";

describe("Instabox workspace wake", () => {
  it("starts only a registered, verified stopped machine and deduplicates concurrent wakes", async () => {
    const run = vi.fn(async (args: readonly string[]) => {
      if (
        args[0] === "get" &&
        run.mock.calls.filter(([call]) => call[0] === "get").length === 1
      )
        return JSON.stringify({ id: machineId, status: "stopped" });
      return JSON.stringify({ id: machineId, status: "running" });
    });
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });

    await expect(
      Promise.all([wake.wake(machineId), wake.wake(machineId)]),
    ).resolves.toEqual(["started", "started"]);
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ["get", machineId, "--json"],
      ["start", machineId, "--json"],
      ["get", machineId, "--json"],
    ]);
  });

  it("does not issue a command for an unregistered machine", async () => {
    const run = vi.fn();
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [],
      run,
    });

    await expect(wake.wake(machineId)).rejects.toThrow(/not registered/u);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a response for a different machine without starting it", async () => {
    const run = vi.fn(async () =>
      JSON.stringify({ id: "another-machine", status: "stopped" }),
    );
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });

    await expect(wake.wake(machineId)).rejects.toThrow(/machine ID/u);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("resumes paused machines and leaves running machines alone", async () => {
    let getCount = 0;
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "get" && getCount++ === 0)
        return JSON.stringify({ id: machineId, status: "paused" });
      return JSON.stringify({ id: machineId, status: "running" });
    });
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });

    await expect(wake.wake(machineId)).resolves.toBe("resumed");
    expect(run.mock.calls.map(([args]) => args[0])).toEqual([
      "get",
      "resume",
      "get",
    ]);

    run.mockClear();
    run.mockImplementation(async () =>
      JSON.stringify({ id: machineId, status: "running" }),
    );
    await expect(wake.wake(machineId)).resolves.toBe("already-running");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable CLI response and does not act on unsupported states", async () => {
    const unavailable = Object.assign(new Error("temporary capacity"), {
      code: 75,
    });
    const run = vi
      .fn<InstaboxCommandRunner>()
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce(
        JSON.stringify({ id: machineId, status: "running" }),
      );
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });
    await expect(wake.wake(machineId)).resolves.toBe("already-running");
    expect(run).toHaveBeenCalledTimes(2);

    run
      .mockReset()
      .mockResolvedValue(JSON.stringify({ id: machineId, status: "creating" }));
    await expect(wake.wake(machineId)).rejects.toThrow(/unsupported state/u);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("honors an already-aborted signal without making a CLI call", async () => {
    const run = vi.fn();
    const wake = createInstaboxWorkspaceWaker({
      registeredMachineIds: [machineId],
      run,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(wake.wake(machineId, controller.signal)).rejects.toMatchObject(
      {
        name: "AbortError",
      },
    );
    expect(run).not.toHaveBeenCalled();
  });
});
