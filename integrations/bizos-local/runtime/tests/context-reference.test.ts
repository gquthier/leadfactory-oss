import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAccessPolicy } from "../src/harness/access.js";
import {
  listContextDirectory,
  readContextFile,
} from "../src/harness/context-reference.js";
import { parseCreationContext } from "../src/harness/onboarding.js";

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lbz-context-ref-")));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
function reference(path: string, sourceKind: "file" | "folder") {
  const stat = lstatSync(path);
  return {
    kind: "reference" as const,
    version: 1 as const,
    sourceKind,
    sourcePath: path,
    sourceLabel: path.split("/").at(-1)!,
    identity: { dev: String(stat.dev), ino: String(stat.ino) },
  };
}

describe("local context reference tools", () => {
  it("preserves old snapshot parsing and accepts versioned metadata without bodies", () => {
    const old = {
      sourceLabel: "Old",
      files: [{ path: "a.md", text: "old body" }],
    };
    expect(parseCreationContext(old)).toEqual(old);
    const folder = join(root, "projet é space");
    mkdirSync(folder);
    expect(parseCreationContext(reference(folder, "folder"))).toEqual(
      reference(folder, "folder"),
    );
  });
  it("pages a large folder without copying bodies and reads bounded UTF-8 pages", async () => {
    const folder = join(root, "docs");
    mkdirSync(folder);
    for (let i = 0; i < 81; i += 1)
      writeFileSync(join(folder, `${i}.md`), "é".repeat(8000));
    const context = reference(folder, "folder");
    const policy = defaultAccessPolicy(root);
    const page = await listContextDirectory(
      context,
      { path: "", limit: 10 },
      policy,
    );
    expect(page.entries).toHaveLength(10);
    const read = await readContextFile(
      context,
      { path: "0.md", offset: 0, maxBytes: 100 },
      policy,
    );
    expect(read.bytesRead).toBeLessThanOrEqual(100);
    expect(read.text).toBeDefined();
    expect(readFileSync(join(folder, "0.md"), "utf8")).toBe("é".repeat(8000));
  });
  it("reads exact file only, including PDF and binary byte pages, without parent access", async () => {
    const file = join(root, "source.pdf");
    writeFileSync(file, Buffer.from([0, 255, 1, 2]));
    const sibling = join(root, "sibling.txt");
    writeFileSync(sibling, "private sibling");
    const context = reference(file, "file");
    const policy = defaultAccessPolicy(root);
    const page = await readContextFile(
      context,
      { path: "source.pdf", offset: 0, maxBytes: 4 },
      policy,
    );
    expect(page.base64).toBe(Buffer.from([0, 255, 1, 2]).toString("base64"));
    await expect(
      readContextFile(context, { path: "sibling.txt" }, policy),
    ).rejects.toThrow();
    await expect(
      readContextFile(context, { path: "../sibling.txt" }, policy),
    ).rejects.toThrow();
  });
  it("keeps UTF-8 page offsets on character boundaries", async () => {
    const file = join(root, "unicode.txt");
    writeFileSync(file, "漢".repeat(5000));
    const context = reference(file, "file");
    const policy = defaultAccessPolicy(root);
    const first = await readContextFile(
      context,
      { path: "unicode.txt", maxBytes: 8192 },
      policy,
    );
    expect(first.format).toBe("utf8");
    expect(first.bytesRead).toBe(8190);
    const second = await readContextFile(
      context,
      { path: "unicode.txt", offset: first.nextOffset!, maxBytes: 8192 },
      policy,
    );
    expect(second.format).toBe("utf8");
    expect(second.text?.startsWith("漢")).toBe(true);
  });
  it("refuses traversal, symlink escape, denied paths and moved originals", async () => {
    const folder = join(root, "docs");
    mkdirSync(folder);
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "private");
    symlinkSync(outside, join(folder, "link.txt"));
    const context = reference(folder, "folder");
    const policy = defaultAccessPolicy(root);
    await expect(
      readContextFile(context, { path: "link.txt" }, policy),
    ).rejects.toThrow();
    await expect(
      readContextFile(context, { path: "../outside.txt" }, policy),
    ).rejects.toThrow();
    await expect(
      listContextDirectory(context, { path: "../" }, policy),
    ).rejects.toThrow();
    await expect(
      listContextDirectory(
        context,
        { path: "" },
        defaultAccessPolicy(root, [folder]),
      ),
    ).rejects.toThrow();
    const otherDir = join(root, "other");
    mkdirSync(otherDir);
    symlinkSync(otherDir, join(folder, "linked-folder"));
    await expect(
      listContextDirectory(context, { path: "linked-folder" }, policy),
    ).rejects.toThrow();
    renameSync(folder, join(root, "moved"));
    await expect(
      listContextDirectory(context, { path: "" }, policy),
    ).rejects.toThrow(/Restore.*original/i);
  });
});
