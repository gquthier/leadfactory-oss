// The second brain reads a folder and only that folder: links resolve the
// way Obsidian resolves them, a missing target is a ghost, and a note path
// can never reach outside the vault — reading it OR writing it.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "../src/harness/clock.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import {
  BrainError,
  createFolder,
  createNote,
  extractLinkTargets,
  MAX_NOTE_BYTES,
  openEntry,
  readNote,
  renameEntry,
  resolveLink,
  scanVault,
  trashEntry,
  writeNote,
} from "../src/harness/brain.js";

let scratch: string;
let vault: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "lbz-brain-"));
  vault = join(scratch, "vault");
  mkdirSync(join(vault, "projects"), { recursive: true });
  mkdirSync(join(vault, "empty"), { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  mkdirSync(join(vault, ".trash"), { recursive: true });
  writeFileSync(join(vault, ".obsidian", "app.json"), "{}\n");
  writeFileSync(join(vault, ".trash", "Deleted.md"), "# gone\n");
  mkdirSync(join(vault, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(vault, "Index.md"), "# Home\n\nSee [[Projects/Launch]] and [[Ideas|my ideas]] and [[Nowhere]].\nAlso [the plan](projects/plan.md).\n");
  writeFileSync(join(vault, "Ideas.md"), "---\ntitle: Idea list\n---\nBack to [[Index]].\n");
  writeFileSync(join(vault, "projects", "Launch.md"), "# Launch\n\n[[Index#top]] [[plan]]\n");
  writeFileSync(join(vault, "projects", "plan.md"), "just text\n");
  writeFileSync(join(vault, "notes.txt"), "a text note with [[Index]]\n");
  writeFileSync(join(vault, "image.png"), "not a note");
  writeFileSync(join(vault, "node_modules", "pkg", "README.md"), "# ignored\n");
  writeFileSync(join(scratch, "outside.md"), "# secret\n");
  symlinkSync(join(scratch, "outside.md"), join(vault, "escape.md"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const root = () => ({ id: "v", label: "Vault", path: vault });

describe("links", () => {
  it("extracts wikilinks (alias and heading stripped) and relative markdown links, not web links", () => {
    expect(extractLinkTargets("[[A|alias]] [[B#h]] [c](sub/c.md) [web](https://x.y) [same](#top)")).toEqual(["A", "B", "sub/c.md"]);
  });

  it("resolves like Obsidian: relative first, then the shortest note with that name", () => {
    const index = { ids: new Set(["Index.md", "projects/Launch.md", "projects/plan.md", "deep/x/plan.md"]), byBase: new Map([["index.md", ["Index.md"]], ["launch.md", ["projects/Launch.md"]], ["plan.md", ["projects/plan.md", "deep/x/plan.md"]]]) };
    expect(resolveLink("Index", "projects/Launch.md", index)).toBe("Index.md");
    // Two notes share the name: the shortest path wins, the way Obsidian picks.
    expect(resolveLink("plan", "Index.md", index)).toBe("deep/x/plan.md");
    expect(resolveLink("plan", "projects/Launch.md", index)).toBe("projects/plan.md");
    expect(resolveLink("projects/plan.md", "Index.md", index)).toBe("projects/plan.md");
    expect(resolveLink("plan.md", "deep/x/other.md", index)).toBe("deep/x/plan.md");
    expect(resolveLink("Nowhere", "Index.md", index)).toBeNull();
  });
});

describe("scanVault", () => {
  it("finds the notes, skips the rest, and builds the graph with ghosts and backlinks", () => {
    const scan = scanVault(root(), () => new Date("2026-09-05T10:00:00Z"));
    expect(scan.notes.map((note) => note.id).sort()).toEqual(["Ideas.md", "Index.md", "notes.txt", "projects/Launch.md", "projects/plan.md"]);
    const index = scan.notes.find((note) => note.id === "Index.md")!;
    expect(index.title).toBe("Home");
    expect(index.links).toEqual(["projects/Launch.md", "Ideas.md", "projects/plan.md"]);
    expect(index.unresolved).toEqual(["Nowhere"]);
    expect(index.backlinks).toBe(3);
    expect(scan.notes.find((note) => note.id === "Ideas.md")!.title).toBe("Idea list");
    expect(scan.notes.find((note) => note.id === "projects/plan.md")!.title).toBe("plan");
    const ghost = scan.graph.nodes.find((node) => node.ghost);
    expect(ghost).toMatchObject({ id: "ghost:Nowhere", title: "Nowhere", backlinks: 1 });
    expect(scan.graph.edges).toContainEqual({ source: "Index.md", target: "ghost:Nowhere" });
    expect(scan.graph.edges).toContainEqual({ source: "projects/Launch.md", target: "Index.md" });
    expect(scan.truncated).toBe(false);
    expect(scan.seen).toBe(5);
    expect(scan.scannedAt).toBe("2026-09-05T10:00:00.000Z");
  });

  it("shows the WHOLE folder the way Obsidian does: empty folders, plain files, nothing hidden", () => {
    const scan = scanVault(root(), undefined, { obsidian: false });
    // Folders first, then files, case-insensitive — and `image.png` is a row
    // of its own kind, not something the explorer pretends is not there.
    expect(scan.tree.map((node) => `${node.kind}:${node.name}`)).toEqual([
      "folder:empty", "folder:projects", "note:Ideas.md", "file:image.png", "note:Index.md", "note:notes.txt",
    ]);
    // An empty folder is a folder, not a missing row.
    expect(scan.tree[0]).toMatchObject({ path: "empty", kind: "folder", children: [] });
    expect(scan.tree.find((node) => node.name === "projects")!.children!.map((node) => node.name))
      .toEqual(["Launch.md", "plan.md"]);
    const png = scan.tree.find((node) => node.name === "image.png")!;
    expect(png.bytes).toBeGreaterThan(0);
    expect(typeof png.modifiedAt).toBe("string");
    expect(png.noteId).toBeUndefined();
    // `.obsidian`, `.trash`, `node_modules` and the escaping symlink: none of
    // them is part of the vault the person is shown.
    const names = JSON.stringify(scan.tree);
    for (const hidden of [".obsidian", ".trash", "node_modules", "escape.md"]) expect(names).not.toContain(hidden);
    expect(scan.capabilities).toEqual({ write: true, obsidian: false });
  });

  it("says a read-only vault cannot be written", () => {
    expect(scanVault({ ...root(), writable: false }, undefined, { obsidian: true }).capabilities)
      .toEqual({ write: false, obsidian: true });
  });

  it("refuses a folder that is not one", () => {
    expect(() => scanVault({ id: "x", label: "Nope", path: join(scratch, "missing") })).toThrow(BrainError);
  });
});

describe("seedStarterVault", () => {
  it("writes the starter notes once, and they link to each other without ghosts except the deliberate one", async () => {
    const { seedStarterVault } = await import("../src/harness/brain.js");
    const path = join(scratch, "brain");
    expect(seedStarterVault(path)).toBe(true);
    expect(seedStarterVault(path)).toBe(false);
    const scan = scanVault({ id: "brain", label: "Second brain", path });
    expect(scan.notes.length).toBe(4);
    const ghosts = scan.graph.nodes.filter((node) => node.ghost).map((node) => node.title);
    expect(ghosts).toEqual(["Someday"]);
    expect(scan.notes.find((note) => note.id === "Welcome.md")!.backlinks).toBeGreaterThanOrEqual(3);
  });
});

describe("readNote", () => {
  it("reads a note inside the vault and refuses everything else", () => {
    const note = readNote(root(), "projects/Launch.md");
    expect(note.title).toBe("Launch");
    expect(note.text).toContain("[[plan]]");
    expect(note.truncated).toBe(false);
    expect(() => readNote(root(), "../outside.md")).toThrow(BrainError);
    expect(() => readNote(root(), "escape.md")).toThrow(BrainError);
    expect(() => readNote(root(), "image.png")).toThrow(BrainError);
    expect(() => readNote(root(), "projects")).toThrow(BrainError);
    expect(() => readNote(root(), "")).toThrow(BrainError);
  });
});

/** The code a refusal carries — what the sidecar turns into a status. */
function refusal(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    return error instanceof BrainError ? error.code : `not a BrainError: ${String(error)}`;
  }
  return "no refusal";
}

describe("createNote", () => {
  it("makes Untitled.md, then Untitled 1.md, the way Obsidian numbers them", () => {
    expect(createNote(root(), "")).toEqual({ id: "Untitled.md", title: "Untitled" });
    expect(readFileSync(join(vault, "Untitled.md"), "utf8")).toBe("");
    expect(createNote(root(), "")).toEqual({ id: "Untitled 1.md", title: "Untitled 1" });
    expect(createNote(root(), "")).toEqual({ id: "Untitled 2.md", title: "Untitled 2" });
  });

  it("makes a named note in a sub-folder, adds `.md`, and refuses a name already taken", () => {
    expect(createNote(root(), "projects", "Q4 launch")).toEqual({ id: "projects/Q4 launch.md", title: "Q4 launch" });
    expect(existsSync(join(vault, "projects", "Q4 launch.md"))).toBe(true);
    // An extension the vault already treats as a note is kept as written.
    expect(createNote(root(), "projects", "scratch.txt").id).toBe("projects/scratch.txt");
    // A name the PERSON typed is never silently renumbered.
    expect(refusal(() => createNote(root(), "projects", "Q4 launch"))).toBe("exists");
    // An extension that is not a note's becomes part of the name, plus `.md`.
    expect(createNote(root(), "", "notes.pdf").id).toBe("notes.pdf.md");
  });

  it("never writes outside the vault, into a hidden folder, or through a symlink", () => {
    expect(refusal(() => createNote(root(), ".."))).toBe("invalid_payload");
    expect(refusal(() => createNote(root(), "projects/../.."))).toBe("invalid_payload");
    expect(refusal(() => createNote(root(), "", ".hidden"))).toBe("invalid_payload");
    expect(refusal(() => createNote(root(), "", "sub/note"))).toBe("invalid_payload");
    expect(refusal(() => createNote(root(), "", "a\\b"))).toBe("invalid_payload");
    expect(refusal(() => createNote(root(), "nowhere"))).toBe("not_found");
    expect(refusal(() => createNote(root(), "Index.md"))).toBe("invalid_payload");
    symlinkSync(scratch, join(vault, "out"));
    expect(refusal(() => createNote(root(), "out"))).toBe("not_found");
    expect(existsSync(join(scratch, "Untitled.md"))).toBe(false);
  });
});

describe("createFolder", () => {
  it("makes a folder, and refuses one that is already there", () => {
    expect(createFolder(root(), "", "Areas")).toEqual({ path: "Areas" });
    expect(createFolder(root(), "Areas", "2026")).toEqual({ path: "Areas/2026" });
    expect(refusal(() => createFolder(root(), "", "Areas"))).toBe("exists");
    expect(refusal(() => createFolder(root(), "", ".git"))).toBe("invalid_payload");
    expect(scanVault(root(), undefined, { obsidian: false }).tree.map((node) => node.name)).toContain("Areas");
  });
});

describe("writeNote", () => {
  it("saves a note whole and answers its new size", () => {
    const saved = writeNote(root(), "projects/plan.md", "# Plan\n\nBack to [[Index]].\n");
    expect(saved.id).toBe("projects/plan.md");
    expect(saved.bytes).toBe(27);
    expect(Date.parse(saved.modifiedAt)).toBeGreaterThan(0);
    expect(readNote(root(), "projects/plan.md").title).toBe("Plan");
    // The new link is a real edge on the next scan.
    expect(scanVault(root(), undefined, { obsidian: false }).notes.find((note) => note.id === "projects/plan.md")!.links)
      .toEqual(["Index.md"]);
  });

  it("refuses a note that is too big, a file that is not a note, and a path that leaves", () => {
    expect(refusal(() => writeNote(root(), "Index.md", "x".repeat(MAX_NOTE_BYTES + 1)))).toBe("invalid_payload");
    expect(refusal(() => writeNote(root(), "image.png", "hello"))).toBe("invalid_payload");
    expect(refusal(() => writeNote(root(), "escape.md", "hello"))).toBe("not_found");
    expect(refusal(() => writeNote(root(), "../outside.md", "hello"))).toBe("invalid_payload");
    expect(refusal(() => writeNote(root(), "projects", "hello"))).toBe("invalid_payload");
    // Nothing above touched a byte.
    expect(readFileSync(join(scratch, "outside.md"), "utf8")).toBe("# secret\n");
    expect(readFileSync(join(vault, "image.png"), "utf8")).toBe("not a note");
  });
});

describe("renameEntry", () => {
  it("keeps a note's extension, renames a folder, and refuses a name already taken", () => {
    expect(renameEntry(root(), "Ideas.md", "Idea list")).toEqual({ path: "Idea list.md", id: "Idea list.md" });
    expect(existsSync(join(vault, "Idea list.md"))).toBe(true);
    // A folder has no extension to keep, and no note id to answer.
    expect(renameEntry(root(), "projects", "Projects 2026")).toEqual({ path: "Projects 2026" });
    expect(renameEntry(root(), "Projects 2026/plan.md", "roadmap.txt").path).toBe("Projects 2026/roadmap.txt");
    expect(refusal(() => renameEntry(root(), "Index.md", "notes.txt"))).toBe("exists");
    expect(refusal(() => renameEntry(root(), "Index.md", "../taken"))).toBe("invalid_payload");
    expect(refusal(() => renameEntry(root(), "../outside.md", "mine"))).toBe("invalid_payload");
    expect(refusal(() => renameEntry(root(), "escape.md", "mine"))).toBe("not_found");
    expect(refusal(() => renameEntry(root(), "gone.md", "mine"))).toBe("not_found");
    expect(existsSync(join(scratch, "outside.md"))).toBe(true);
  });
});

describe("trashEntry", () => {
  it("moves the entry into .trash, numbering a name already in there, and drops it from the tree", () => {
    expect(trashEntry(root(), "Index.md")).toEqual({ trashed: ".trash/Index.md" });
    expect(existsSync(join(vault, "Index.md"))).toBe(false);
    expect(readFileSync(join(vault, ".trash", "Index.md"), "utf8")).toContain("# Home");
    // The trash already holds `Deleted.md`, so the second one is numbered.
    writeFileSync(join(vault, "Deleted.md"), "# again\n");
    expect(trashEntry(root(), "Deleted.md")).toEqual({ trashed: ".trash/Deleted 1.md" });
    // A folder goes whole.
    expect(trashEntry(root(), "projects")).toEqual({ trashed: ".trash/projects" });
    const scan = scanVault(root(), undefined, { obsidian: false });
    expect(scan.tree.map((node) => node.name)).not.toContain("Index.md");
    expect(scan.tree.map((node) => node.name)).not.toContain("projects");
    expect(scan.notes.map((note) => note.id)).toEqual(["Ideas.md", "notes.txt"]);
    expect(refusal(() => trashEntry(root(), "escape.md"))).toBe("not_found");
    expect(refusal(() => trashEntry(root(), ""))).toBe("invalid_payload");
    expect(existsSync(join(scratch, "outside.md"))).toBe(true);
  });
});

describe("openEntry", () => {
  it("hands macOS the exact argv, and never a shell", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const spawn = (command: string, args: string[]): void => void calls.push({ command, args });
    const absolute = join(realpathSync(vault), "projects", "Launch.md");
    const options = { spawn, platform: "darwin" as const };
    expect(openEntry(root(), "projects/Launch.md", "reveal", options)).toEqual({ ok: true });
    openEntry(root(), "projects/Launch.md", "default", options);
    openEntry(root(), "projects/Launch.md", "obsidian", options);
    expect(calls).toEqual([
      { command: "/usr/bin/open", args: ["-R", absolute] },
      { command: "/usr/bin/open", args: [absolute] },
      { command: "/usr/bin/open", args: [`obsidian://open?path=${encodeURIComponent(absolute)}`] },
    ]);
    // A vault path is never a command: the space stays a space in argv.
    createNote(root(), "", "Q4 launch");
    openEntry(root(), "Q4 launch.md", "default", options);
    expect(calls.at(-1)!.args).toEqual([join(realpathSync(vault), "Q4 launch.md")]);
  });

  it("refuses an unknown mode, a path that is not there, and a Mac that is not one", () => {
    const spawn = (): void => {
      throw new Error("nothing should be opened");
    };
    const options = { spawn, platform: "darwin" as const };
    expect(refusal(() => openEntry(root(), "Index.md", "shell" as "reveal", options))).toBe("invalid_payload");
    expect(refusal(() => openEntry(root(), "gone.md", "reveal", options))).toBe("not_found");
    expect(refusal(() => openEntry(root(), "escape.md", "reveal", options))).toBe("not_found");
    expect(refusal(() => openEntry(root(), "Index.md", "reveal", { spawn, platform: "linux" }))).toBe("invalid_payload");
  });
});

describe("the vault behind a root id", () => {
  /** The harness as the bridge builds it — no Electron, no CLI, one folder. */
  function harnessFor(): LocalBizosHarness {
    return new LocalBizosHarness({
      rootDir: join(scratch, "state"),
      baseUrl: "https://app.bizos.lol",
      readSessionCookie: async () => "",
      orgName: () => "Local workspace",
      execPath: "/fake/electron",
      packaged: false,
      runAsNodeAvailable: false,
      mcpScriptPath: "/fake/dist/mcp/bizos-mcp.mjs",
      clock: fixedClock(Date.parse("2026-09-06T09:00:00Z")),
      environment: { PATH: "/nowhere" },
      homeDir: scratch,
      pickFolder: async () => vault,
      confirmWriteAccess: async () => true,
    });
  }

  async function share(mode: "read" | "read-write"): Promise<{ harness: LocalBizosHarness; rootId: string }> {
    const harness = harnessFor();
    const picked = (await harness.access.pickFolder())!;
    const granted = await harness.access.grant({ nonce: picked.nonce, mode });
    return { harness, rootId: granted.grants[0]!.id };
  }

  it("writes into a folder shared read-write", async () => {
    const { harness, rootId } = await share("read-write");
    expect((await harness.brain.scan(rootId)).capabilities.write).toBe(true);
    const created = await harness.brain.createNote(rootId, "projects");
    expect(created.id).toBe("projects/Untitled.md");
    await harness.brain.writeNote(rootId, created.id, "# Draft\n");
    expect((await harness.brain.note(rootId, created.id)).title).toBe("Draft");
    expect(await harness.brain.rename(rootId, created.id, "Draft")).toEqual({
      path: "projects/Draft.md",
      id: "projects/Draft.md",
    });
    expect(await harness.brain.trash(rootId, "projects/Draft.md")).toEqual({ trashed: ".trash/Draft.md" });
  });

  it("refuses every write into a folder shared read-only, and still reads it", async () => {
    const { harness, rootId } = await share("read");
    expect((await harness.brain.scan(rootId)).capabilities.write).toBe(false);
    for (const write of [
      () => harness.brain.createNote(rootId, ""),
      () => harness.brain.createFolder(rootId, "", "Areas"),
      () => harness.brain.writeNote(rootId, "Index.md", "changed"),
      () => harness.brain.rename(rootId, "Index.md", "Home"),
      () => harness.brain.trash(rootId, "Index.md"),
    ]) {
      await expect(write()).rejects.toMatchObject({ code: "read_only" });
    }
    // Reading is not writing: the note and its text still answer.
    expect((await harness.brain.note(rootId, "Index.md")).title).toBe("Home");
    expect(readFileSync(join(vault, "Index.md"), "utf8")).toContain("# Home");
    expect(existsSync(join(vault, "Untitled.md"))).toBe(false);
  });

  it("gives the same refusal for a root that is not shared and one that never existed", async () => {
    const harness = harnessFor();
    await expect(harness.brain.scan("acc_nothing")).rejects.toMatchObject({ code: "not_found" });
    await expect(harness.brain.createNote("acc_nothing", "")).rejects.toMatchObject({ code: "not_found" });
    // The two folders this app owns are always writable.
    expect((await harness.brain.roots()).map((root) => `${root.id}:${root.writable}`))
      .toEqual(["workspaces:true"]);
  });
});
