import type { ChildProcess } from "node:child_process";
import { expect, it, vi } from "vitest";
import { killCliTree, waitForCliShutdown } from "../src/harness/procs.js";

const ps = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("node:child_process", async original => ({ ...await original<object>(), execFileSync: ps.read }));

it.skipIf(process.platform === "win32")("retries verification of a failed CLI stop without signalling a reused PID", async () => {
  vi.useFakeTimers();
  // Entirely synthetic metadata. process.kill is mocked before any STOP.
  const signal = vi.spyOn(process, "kill").mockReturnValue(true);
  const child = { pid: 910001, exitCode: null as number | null, signalCode: null, kill: vi.fn() };
  const unrelated = "920001 1 920001 Mon Sep 28 01:00:00 2026 S";
  ps.read.mockReturnValue(`910001 1 910001 Mon Sep 28 00:00:00 2026 S\n${unrelated}`);
  try {
    killCliTree(child as unknown as ChildProcess, 1);
    const stopped = waitForCliShutdown();
    await vi.advanceTimersByTimeAsync(2100);
    await expect(stopped).resolves.toBe(false);
    await expect(waitForCliShutdown()).resolves.toBe(false);
    signal.mockClear();
    child.exitCode = 0;
    // The old process is gone; its number now belongs to a different birth.
    ps.read.mockReturnValue(`910001 1 910001 Mon Sep 28 02:00:00 2026 S\n${unrelated}`);
    const retried = waitForCliShutdown({ retryFailed: true });
    await vi.advanceTimersByTimeAsync(0);
    await expect(retried).resolves.toBe(true);
    expect(signal).not.toHaveBeenCalled();
  } finally {
    signal.mockRestore();
    vi.useRealTimers();
  }
});
