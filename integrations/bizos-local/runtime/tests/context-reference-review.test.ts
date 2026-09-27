import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { expect, it, vi } from "vitest";
import { handleLocalTeamMessage } from "../src/local-team-mcp.js";
import {
  canonicalizeContextPath,
  defaultAccessPolicy,
} from "../src/harness/access.js";
import {
  listContextDirectory,
  readContextFile,
} from "../src/harness/context-reference.js";
const opened = vi.hoisted(() => ({
  afterOpen: undefined as undefined | (() => void),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      opened.afterOpen?.();
      return handle;
    },
  };
});
const noop = async () => ({});
it("keeps a bounded context page valid JSON including its pagination cursor over MCP", async () => {
  const payload = {
    path: "",
    entries: Array.from({ length: 100 }, (_, i) => ({
      name: "x".repeat(240) + i + ".txt",
      kind: "file",
    })),
    nextCursor: 100,
  };
  const answer = await handleLocalTeamMessage(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "list_context_directory",
        arguments: { path: "", limit: 100 },
      },
    },
    noop,
    noop,
    noop,
    noop,
    { toolsets: new Set(["team", "context"]), context: async () => payload },
  );
  const result = answer!.result as { content: Array<{ text: string }> };
  expect(JSON.parse(result.content[0]!.text)).toEqual(payload);
});
it("preserves an explicitly chosen canonical filename ending in a space", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "context-review-")));
  try {
    const file = join(root, "plan é space.txt ");
    writeFileSync(file, "current body");
    const policy = defaultAccessPolicy(root);
    expect(canonicalizeContextPath(file, "file", policy)).toBe(file);
    const stat = lstatSync(file, { bigint: true });
    const page = await readContextFile(
      {
        kind: "reference",
        version: 1,
        sourceKind: "file",
        sourcePath: file,
        sourceLabel: basename(file),
        identity: { dev: String(stat.dev), ino: String(stat.ino) },
      },
      { path: basename(file) },
      policy,
    );
    expect(page.text).toBe("current body");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("follows an atomic regular-file save at the consented canonical path", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "context-atomic-")));
  try {
    const file = join(root, "notes.md");
    writeFileSync(file, "old");
    const stat = lstatSync(file, { bigint: true });
    const ref = {
      kind: "reference" as const,
      version: 1 as const,
      sourceKind: "file" as const,
      sourcePath: file,
      sourceLabel: basename(file),
      identity: { dev: String(stat.dev), ino: String(stat.ino) },
    };
    const replacement = join(root, "temporary-save.md");
    writeFileSync(replacement, "new current body");
    renameSync(replacement, file);
    expect(
      (
        await readContextFile(
          ref,
          { path: "notes.md" },
          defaultAccessPolicy(root),
        )
      ).text,
    ).toBe("new current body");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("refuses replacing a selected file's parent with a symlink to another directory", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "context-parent-")));
  try {
    const selected = join(root, "selected");
    const outside = join(root, "outside");
    mkdirSync(selected);
    mkdirSync(outside);
    const file = join(selected, "notes.md");
    writeFileSync(file, "authorized");
    writeFileSync(join(outside, "notes.md"), "outside");
    const stat = lstatSync(file, { bigint: true });
    const ref = {
      kind: "reference" as const,
      version: 1 as const,
      sourceKind: "file" as const,
      sourcePath: file,
      sourceLabel: basename(file),
      identity: { dev: String(stat.dev), ino: String(stat.ino) },
    };
    renameSync(selected, join(root, "preserved"));
    symlinkSync(outside, selected);
    await expect(
      readContextFile(ref, { path: "notes.md" }, defaultAccessPolicy(root)),
    ).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("discards a page if the selected parent is swapped after the file opens", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "context-open-race-")));
  try {
    const selected = join(root, "selected");
    const outside = join(root, "outside");
    mkdirSync(selected);
    mkdirSync(outside);
    const file = join(selected, "notes.md");
    writeFileSync(file, "authorized page");
    writeFileSync(join(outside, "notes.md"), "outside page");
    const stat = lstatSync(file, { bigint: true });
    const ref = {
      kind: "reference" as const,
      version: 1 as const,
      sourceKind: "file" as const,
      sourcePath: file,
      sourceLabel: basename(file),
      identity: { dev: String(stat.dev), ino: String(stat.ino) },
    };
    opened.afterOpen = () => {
      opened.afterOpen = undefined;
      renameSync(selected, join(root, "preserved"));
      symlinkSync(outside, selected);
    };
    await expect(
      readContextFile(ref, { path: "notes.md" }, defaultAccessPolicy(root)),
    ).rejects.toThrow();
  } finally {
    opened.afterOpen = undefined;
    rmSync(root, { recursive: true, force: true });
  }
});

it("bounds directory work per page even when every entry is excluded", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "context-excluded-")));
  try {
    const folder = join(root, "project");
    mkdirSync(folder);
    for (let i = 0; i < 1500; i += 1)
      writeFileSync(join(folder, `.ignored-${i}`), "");
    const st = lstatSync(folder, { bigint: true });
    const ref = {
      kind: "reference" as const,
      version: 1 as const,
      sourceKind: "folder" as const,
      sourcePath: folder,
      sourceLabel: basename(folder),
      identity: { dev: String(st.dev), ino: String(st.ino) },
    };
    const page = await listContextDirectory(
      ref,
      { limit: 100 },
      defaultAccessPolicy(root),
    );
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).not.toBeNull();
    expect(page.nextCursor!).toBeGreaterThan(0);
    const next = await listContextDirectory(
      ref,
      { limit: 100, cursor: page.nextCursor! },
      defaultAccessPolicy(root),
    );
    expect(next.entries).toEqual([]);
    expect(next.nextCursor).toBeNull();
    await expect(
      listContextDirectory(
        ref,
        { cursor: page.nextCursor! },
        defaultAccessPolicy(root),
      ),
    ).rejects.toThrow(/expired/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("binds a continuation to its workspace/agent and directory, then consumes it on errors", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "context-scope-")));
  try {
    const folder = join(root, "project");
    mkdirSync(folder);
    mkdirSync(join(folder, "child"));
    writeFileSync(join(folder, "a.txt"), "a");
    const st = lstatSync(folder, { bigint: true });
    const ref = {
      kind: "reference" as const,
      version: 1 as const,
      sourceKind: "folder" as const,
      sourcePath: folder,
      sourceLabel: "project",
      identity: { dev: String(st.dev), ino: String(st.ino) },
    };
    const policy = defaultAccessPolicy(root);
    const first = await listContextDirectory(
      ref,
      { limit: 1 },
      policy,
      "workspaceA:agentA",
    );
    await expect(
      listContextDirectory(
        ref,
        { cursor: first.nextCursor! },
        policy,
        "workspaceB:agentA",
      ),
    ).rejects.toThrow();
    await expect(
      listContextDirectory(
        ref,
        { cursor: first.nextCursor! },
        policy,
        "workspaceA:agentA",
      ),
    ).rejects.toThrow(/expired/);
    const second = await listContextDirectory(
      ref,
      { limit: 1 },
      policy,
      "workspaceA:agentA",
    );
    await expect(
      listContextDirectory(
        ref,
        { cursor: second.nextCursor!, path: "child" },
        policy,
        "workspaceA:agentA",
      ),
    ).rejects.toThrow();
    const third = await listContextDirectory(
      ref,
      { limit: 1 },
      policy,
      "workspaceA:agentA",
    );
    renameSync(folder, join(root, "moved"));
    await expect(
      listContextDirectory(
        ref,
        { cursor: third.nextCursor! },
        policy,
        "workspaceA:agentA",
      ),
    ).rejects.toThrow();
    await expect(
      listContextDirectory(
        ref,
        { cursor: third.nextCursor! },
        policy,
        "workspaceA:agentA",
      ),
    ).rejects.toThrow(/expired/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("expires and caps open directory continuations", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "context-cursors-")));
  vi.useFakeTimers();
  try {
    const folder = join(root, "project");
    mkdirSync(folder);
    writeFileSync(join(folder, "a.txt"), "a");
    const st = lstatSync(folder, { bigint: true });
    const ref = {
      kind: "reference" as const,
      version: 1 as const,
      sourceKind: "folder" as const,
      sourcePath: folder,
      sourceLabel: "context",
      identity: { dev: String(st.dev), ino: String(st.ino) },
    };
    const policy = defaultAccessPolicy(root);
    const first = await listContextDirectory(
      ref,
      { limit: 1 },
      policy,
      "workspaceA:agentA",
    );
    let latest = first;
    for (let i = 0; i < 32; i += 1)
      latest = await listContextDirectory(
        ref,
        { limit: 1 },
        policy,
        "workspaceA:agentA",
      );
    await expect(
      listContextDirectory(
        ref,
        { cursor: first.nextCursor! },
        policy,
        "workspaceA:agentA",
      ),
    ).rejects.toThrow(/expired/);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await expect(
      listContextDirectory(
        ref,
        { cursor: latest.nextCursor! },
        policy,
        "workspaceA:agentA",
      ),
    ).rejects.toThrow(/expired/);
  } finally {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  }
});
