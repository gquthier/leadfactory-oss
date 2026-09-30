import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { desktopContinuityTransport } from "../src/continuity-bridge.js";

it("preserves only bounded bilingual usage-limit messages from the Desktop bridge", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bizos-usage-bridge-"));
  try {
    const descriptor = join(dir, "bridge.json");
    writeFileSync(descriptor, JSON.stringify({ version: 1, origin: "http://127.0.0.1:12345",
      workspaceId: "workspace-fixture", secret: "a".repeat(64) }));
    const response = (message: unknown) => desktopContinuityTransport(descriptor, (async () =>
      Response.json({ ok: false, code: "usage_limit_reached", error: "server detail", requestRejected: true, message }, { status: 429 })) as typeof fetch);

    await expect(response({ fr: "Limite de 4 h atteinte", en: "4-hour limit reached" })("inference/chat", {}))
      .rejects.toMatchObject({ code: "usage_limit_reached", status: 429, requestRejected: true,
        localizedMessage: { fr: "Limite de 4 h atteinte", en: "4-hour limit reached" } });
    await expect(response({ fr: "x".repeat(201), en: "4-hour limit reached" })("inference/chat", {}))
      .rejects.toMatchObject({ code: "usage_limit_reached", localizedMessage: undefined });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
