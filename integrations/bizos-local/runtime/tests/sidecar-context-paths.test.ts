// The desktop contract, against a REAL sidecar process: `node dist/sidecar.js
// serve` on a temporary state root, with a temporary HOME so no profile of
// this Mac is read. Only a protocol fixture CLI is on PATH: no inference,
// OAuth, provider credentials or provider API calls. Skipped when `dist/` is not built
// (`npm run build` first).
import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidecarScript = join(runtimeRoot, "dist", "sidecar.js");
const built =
  existsSync(sidecarScript) &&
  existsSync(join(runtimeRoot, "dist", "agency-kit", "lib", "app.mjs"));

interface Descriptor {
  origin: string;
  token: string;
  instanceId: string;
  pid: number;
}

let temp: string;
let child: ChildProcess | null = null;
let descriptor: Descriptor;
let logs = "";

async function waitFor<T>(
  probe: () => T | null | undefined,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = probe();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${what}\n${logs}`);
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = descriptor.token,
): Promise<{ status: number; body: any }> {
  const response = await fetch(new URL(path, descriptor.origin), {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

// This fixture expects a mock Claude CLI run. Windows rejects every CLI run
// until its native secret shield exists; windows-secret-shield.test.ts covers
// that fail-closed contract instead.
describe.skipIf(!built || process.platform === "win32")(
  "Live path context through real sidecar and MCP",
  () => {
    beforeAll(async () => {
      temp = realpathSync(mkdtempSync(join(tmpdir(), "lbz-sidecar-path-")));
      const fixture = join(temp, "claude");
      writeFileSync(
        fixture,
        `#!${process.execPath}\n${readFileSync(join(runtimeRoot, "tests/fixtures/context-cli.cjs"), "utf8")}`,
      );
      chmodSync(fixture, 0o755);
      for (const name of ["codex", "cursor"]) {
        const script = join(temp, name);
        writeFileSync(script, "#!/bin/sh\nexit 1\n");
        chmodSync(script, 0o755);
      }
      const state = join(temp, "state/runtime");
      mkdirSync(state, { recursive: true });
      const configDir = join(temp, "claude-config");
      mkdirSync(configDir);
      writeFileSync(
        join(state, "plans.json"),
        JSON.stringify({
          plans: [
            {
              id: "pln_context_fixture",
              provider: "claude",
              label: "Synthetic protocol fixture",
              authKind: "oauth",
              status: "connected",
              createdAt: "2026-09-27T00:00:00Z",
              priority: 0,
              configDir,
            },
          ],
          routing: {
            pins: {},
            defaultPolicy: "priority",
            activePlanId: "pln_context_fixture",
          },
        }),
      );
      const home = join(temp, "home");
      mkdirSync(home, { recursive: true });
      const descriptorPath = join(temp, "desktop", "local-harness.json");
      child = spawn(process.execPath, [sidecarScript, "serve"], {
        cwd: runtimeRoot,
        env: {
          HOME: home,
          PATH: `${temp}:/usr/bin:/bin`,
          LBZ_CLAUDE_PATH: fixture,
          LBZ_CODEX_PATH: join(temp, "absent-codex"),
          LBZ_CURSOR_PATH: join(temp, "absent-cursor"),
          TMPDIR: temp,
          LOCALBIZOS_SIDECAR_STATE: join(temp, "state"),
          LOCALBIZOS_SIDECAR_DESCRIPTOR: descriptorPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (chunk: Buffer) => {
        logs += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        logs += chunk.toString();
      });
      descriptor = await waitFor(
        () => {
          try {
            return JSON.parse(
              readFileSync(descriptorPath, "utf8"),
            ) as Descriptor;
          } catch {
            return null;
          }
        },
        30_000,
        "the sidecar descriptor",
      );
      // The facade is prepared before the health route answers 200.
      const until = Date.now() + 30_000;
      while (Date.now() < until) {
        const health = await api("GET", "/api/local/health").catch(() => ({
          status: 0,
          body: null,
        }));
        if (health.status === 200) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
    }, 60_000);

    afterAll(async () => {
      if (child && child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise((resolveExit) => child!.once("exit", resolveExit));
      }
      await rm(temp, { recursive: true, force: true });
    }, 60_000);

    it("uses the issued single-use ticket and bounded MCP reads without changing the selected folder", async () => {
      const folder = join(temp, "project é space");
      mkdirSync(folder);
      writeFileSync(
        join(folder, "notes é.txt"),
        "Authorized current text".repeat(50000),
      );
      for (let i = 0; i < 81; i += 1)
        writeFileSync(join(folder, `${i}.txt`), "body");
      writeFileSync(join(temp, "outside.txt"), "UNAUTHORIZED");
      const before = lstatSync(join(folder, "notes é.txt"));
      const st = lstatSync(folder, { bigint: true });
      const context = {
        kind: "reference",
        version: 1,
        sourceKind: "folder",
        sourcePath: folder,
        sourceLabel: "project é space",
        identity: { dev: String(st.dev), ino: String(st.ino) },
      };
      const applied = await api("POST", "/api/local/brain/templates/apply", {
        id: "company-os",
        rootId: "new",
        companyName: "Fixture",
        owner: { name: "Test" },
        language: "en",
        context,
      });
      expect(applied.status).toBe(200);
      expect(
        (
          await api("POST", "/api/local/runtime/inference", {
            source: "plan",
            planId: "pln_context_fixture",
          })
        ).status,
      ).toBe(200);
      const bootstrap = await api("GET", "/api/collaboration/bootstrap");
      const thread = bootstrap.body.threads.find((row: any) =>
        row.agentIds?.some((id: string) => id.endsWith(applied.body.bots.ceo)),
      );
      expect(thread).toBeDefined();
      const sent = await api(
        "POST",
        `/api/collaboration/threads/${encodeURIComponent(thread.id)}/messages`,
        {
          content: "Read the selected context",
          clientMessageId: "019a1551-7642-7000-8123-123456789abc",
        },
      );
      expect(sent.status).toBe(201);
      const proof = await waitFor(
        () => {
          try {
            return JSON.parse(
              readFileSync(join(temp, "context-proof.json"), "utf8"),
            );
          } catch {
            return null;
          }
        },
        10000,
        "real MCP proof",
      ).catch(async (error) => {
        const runs = await api("GET", "/api/collaboration/runs");
        throw new Error(
          `${error.message}; synthetic runs: ${JSON.stringify(runs.body)}`,
        );
      });
      expect(proof.error).toBeUndefined();
      expect(proof.tools.result.tools.map((tool: any) => tool.name)).toContain(
        "read_context_file",
      );
      expect(
        JSON.parse(proof.list.result.content[0].text).entries,
      ).toHaveLength(82);
      const read = JSON.parse(proof.read.result.content[0].text);
      expect(read.bytesRead).toBe(64);
      expect(read.nextOffset).toBe(64);
      expect(read.text).toContain("Authorized current text");
      expect(proof.escape.result.isError).toBe(true);
      expect(JSON.stringify(proof.escape)).not.toContain("UNAUTHORIZED");
      expect(proof.replayStatus).toBe(401);
      expect(proof.cwd).not.toBe(folder);
      expect(proof.cwd).toContain("state/runtime");
      expect(lstatSync(join(folder, "notes é.txt")).mtimeMs).toBe(
        before.mtimeMs,
      );
      expect(
        existsSync(
          join(
            temp,
            "state/runtime/vaults/company-os/Knowledge/Imported Context/files",
          ),
        ),
      ).toBe(false);
      expect(
        (
          await api("POST", "/api/internal/local-team/context", {
            tool: "read_context_file",
            input: { path: "notes é.txt" },
          })
        ).status,
      ).toBe(401);
    }, 30000);
  },
);
