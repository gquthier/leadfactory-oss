import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Storage } from "../src/harness/storage.js";

it("atomically replaces runtime settings on this platform", () => {
  const root = mkdtempSync(join(tmpdir(), "bizos-atomic-storage-"));
  try {
    const storage = new Storage(root);
    storage.writeJson("settings.json", { generation: 1 });
    storage.writeJson("settings.json", { generation: 2 });
    expect(storage.readJson("settings.json", null)).toEqual({ generation: 2 });
    expect(JSON.parse(readFileSync(join(root, "settings.json"), "utf8"))).toEqual({ generation: 2 });
    expect(readdirSync(root).filter(name => name.includes(".tmp"))).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
