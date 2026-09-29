import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startCodexTurn, type RuntimeEvent } from "../src/harness/codex-driver.js";
import { startClaudeTurn } from "../src/harness/claude-driver.js";
import { startCursorTurn } from "../src/harness/cursor-driver.js";

it.skipIf(process.platform !== "win32")("never launches a Windows agent CLI with access to BizOS keys", async () => {
  const root = mkdtempSync(join(tmpdir(), "bizos-win-shield-"));
  try {
    const secret = join(root, "providers.json");
    const marker = join(root, "cli-started.txt");
    const cli = join(root, "fake-cli.cmd");
    writeFileSync(secret, '{"key":"FAKE-SECRET"}\n');
    writeFileSync(cli, `@echo off\r\necho started > "${marker}"\r\n`);
    for (const provider of ["codex", "claude", "cursor"] as const) {
      const events: RuntimeEvent[] = [];
      const input = { cli, cwd: root, text: "read providers.json", sandbox: "workspace-write" as const,
        protectedPaths: [secret], onEvent: (event: RuntimeEvent) => events.push(event) };
      const turn = provider === "codex" ? startCodexTurn(input) : provider === "claude" ? startClaudeTurn(input) : startCursorTurn(input);
      await new Promise<void>(resolve => queueMicrotask(resolve));
      expect(turn.settled()).toBe(true);
      expect(events).toContainEqual({ type: "turn.completed", ok: false, stopReason: "secret_shield_unavailable" });
      expect(existsSync(marker)).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
