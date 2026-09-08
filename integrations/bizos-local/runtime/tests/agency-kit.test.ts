// The kit that ships: what the sync script lets in, and what is on disk.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error -- the build script is plain ESM without a declaration file.
import { collectKitFiles, sync } from "../scripts/sync-agency-kit.mjs";
import { DEFAULT_KIT_ROOT, loadKit } from "../src/harness/agency.js";

let source: string;
let target: string;

function write(path: string, text: string): void {
  mkdirSync(join(source, path, ".."), { recursive: true });
  writeFileSync(join(source, path), text);
}

function fakeKit(): void {
  write("LICENSE", "MIT");
  write("THIRD_PARTY_NOTICES.md", "# notices");
  write("UPSTREAM-LICENSE.txt", "MIT upstream");
  write("templates/lead-gen-agency.company-template.json", JSON.stringify({ id: "lead-gen-agency", version: 1, name: "Lead Gen Agency", folders: [], notes: [], bots: [], routines: [] }));
  write("lib/app.mjs", "export const createApp = () => {};");
  write("lib/notes.txt", "not a module");
  write("public/index.html", "<html></html>");
  write("public/app.js", "console.log(1)");
  write("vault/Start here.md", "# Start");
  write("vault/Agents/Creative/Creative.md", "# Creative");
  write("skills/deep-search/SKILL.md", "---\nname: deep-search\n---");
  write("skills/deep-search/references/prompts.md", "# prompts");
  // Private, never staged:
  write("data/db.json", "{}");
  write(".env", "SECRET=1");
  write(".git/HEAD", "ref: refs/heads/main");
  write(".git/refs/heads/main", "abc123");
  write("server.mjs", "// entry");
  write("README.md", "# readme");
  write("test/api.test.mjs", "// tests");
  write("skills/deep-search/secret.key", "nope");
  write("docs/SKILLS.md", "# skills");
}

beforeEach(() => {
  source = mkdtempSync(join(tmpdir(), "lbz-kit-src-"));
  target = mkdtempSync(join(tmpdir(), "lbz-kit-dst-"));
  fakeKit();
});

afterEach(async () => {
  await rm(source, { recursive: true, force: true });
  await rm(target, { recursive: true, force: true });
});

describe("sync-agency-kit", () => {
  it("stages the whitelist only: no data, git, env, tests, scripts or stray extensions", () => {
    const files = collectKitFiles(source) as string[];
    expect(files).toEqual([
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "UPSTREAM-LICENSE.txt",
      "lib/app.mjs",
      "public/app.js",
      "public/index.html",
      "skills/deep-search/SKILL.md",
      "skills/deep-search/references/prompts.md",
      "templates/lead-gen-agency.company-template.json",
      "vault/Agents/Creative/Creative.md",
      "vault/Start here.md",
    ]);
  });

  it("writes the files, the manifest with hashes and the source commit, and nothing else", () => {
    const result = sync({ source, target }) as { files: string[]; manifest: { files: Record<string, string>; sourceCommit: string | null; template: { id: string } } };
    expect(result.manifest.sourceCommit).toBe("abc123");
    expect(result.manifest.template.id).toBe("lead-gen-agency");
    expect(existsSync(join(target, "data"))).toBe(false);
    expect(existsSync(join(target, ".env"))).toBe(false);
    expect(existsSync(join(target, "server.mjs"))).toBe(false);
    expect(existsSync(join(target, "lib", "app.mjs"))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(target, "kit-manifest.json"), "utf8")) as { files: Record<string, string> };
    expect(Object.keys(manifest.files)).toEqual(result.files);
    for (const [file, hash] of Object.entries(manifest.files)) {
      expect(createHash("sha256").update(readFileSync(join(target, file))).digest("hex")).toBe(hash);
    }
  });

  it("refuses a symlink and a machine-specific absolute path", () => {
    symlinkSync(join(source, "lib", "app.mjs"), join(source, "vault", "link.md"));
    expect(() => collectKitFiles(source)).toThrow(/symlink/);
    // `rmSync` removes the link itself, never its target.
    rmSync(join(source, "vault", "link.md"));
    write("vault/Paths.md", "See /Users/someone/dev/private");
    expect(() => sync({ source, target, dryRun: true })).toThrow(/machine-specific absolute path/);
  });
});

describe("the embedded kit on disk", () => {
  it("matches its manifest and carries no private file", () => {
    const manifest = JSON.parse(readFileSync(join(DEFAULT_KIT_ROOT, "kit-manifest.json"), "utf8")) as { files: Record<string, string>; template: { id: string; version: number } };
    expect(manifest.template).toEqual({ id: "lead-gen-agency", version: 1, name: "Lead Gen Agency" });
    expect(Object.keys(manifest.files).length).toBeGreaterThan(100);
    for (const [file, hash] of Object.entries(manifest.files)) {
      expect(file).not.toMatch(/(^|\/)(data|\.git|node_modules|test|scripts|docs)\//);
      expect(file).not.toMatch(/\.env|\.key$|\.pem$/);
      expect(createHash("sha256").update(readFileSync(join(DEFAULT_KIT_ROOT, file))).digest("hex")).toBe(hash);
      expect(readFileSync(join(DEFAULT_KIT_ROOT, file), "utf8")).not.toMatch(/\/Users\/[A-Za-z0-9_-]+\//);
    }
    expect(existsSync(join(DEFAULT_KIT_ROOT, "data"))).toBe(false);
    expect(existsSync(join(DEFAULT_KIT_ROOT, "server.mjs"))).toBe(false);
    for (const licence of ["LICENSE", "THIRD_PARTY_NOTICES.md", "UPSTREAM-LICENSE.txt"]) {
      expect(existsSync(join(DEFAULT_KIT_ROOT, licence))).toBe(true);
    }
    const kit = loadKit(DEFAULT_KIT_ROOT);
    expect(kit.template.bots).toHaveLength(6);
    expect(kit.skills).toHaveLength(23);
  });
});
