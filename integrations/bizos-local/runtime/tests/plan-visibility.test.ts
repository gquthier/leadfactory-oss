import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlanRegistry } from "../src/harness/plan-registry.js";
import { Storage } from "../src/harness/storage.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("plans shown in Simple Settings", () => {
  // Gauthier, 2026-09-30 (.54): the accounts this Mac is signed in to are
  // shown at once, with their status; "Add Provider" is no longer needed.
  it("shows a machine-discovered account at once, across restarts", () => {
    const root = mkdtempSync(join(tmpdir(), "bizos-plan-visibility-"));
    roots.push(root);
    const storage = new Storage(root);
    const plans = new PlanRegistry(storage);
    const seeded = plans.seedFromMachine({
      nowIso: "2026-09-26T00:00:00Z",
      homeDir: join(root, "home"),
      codexAuthenticated: true,
    });
    expect(seeded).toHaveLength(1);
    expect(plans.publicList()[0]?.settingsVisible).not.toBe(false);
    expect(new PlanRegistry(storage).publicList()[0]?.settingsVisible).not.toBe(false);

    plans.update(seeded[0]!.id, { settingsVisible: true });
    expect(new PlanRegistry(storage).publicList()[0]?.settingsVisible).toBe(true);
  });

  it("keeps manually added and legacy accounts visible", () => {
    const root = mkdtempSync(join(tmpdir(), "bizos-plan-visibility-"));
    roots.push(root);
    const plans = new PlanRegistry(new Storage(root));
    const added = plans.create({ provider: "claude" });
    expect(added.settingsVisible).not.toBe(false);
    expect(plans.publicList()[0]?.settingsVisible).not.toBe(false);
  });
});
