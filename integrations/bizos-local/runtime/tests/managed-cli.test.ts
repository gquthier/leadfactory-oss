import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, realpathSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { downloadOfficial, installManagedCli, installedManagedBinary, resolveOfficialCliRedirect, validateOfficialCliUrl, type ManagedCliDependencies } from "../src/harness/managed-cli.js";
import { PassThrough } from "node:stream";
import { openCliLogin } from "../src/harness/login-launcher.js";
import { cleanChildEnvironment } from "../src/harness/child-env.js";
import { loginCommandFor } from "../src/harness/apps.js";
import { codexCandidatePaths } from "../src/harness/codex-status.js";
import { claudeCandidatePaths } from "../src/harness/claude-status.js";
import { resetPathCacheForTests } from "../src/harness/env-path.js";

const roots: string[] = [];
afterEach(() => { resetPathCacheForTests(); for (const root of roots.splice(0)) { for (const name of ["managed-cli", "cache"]) { const version = join(root, name, "codex", "0.155.1"); if (existsSync(version)) chmodSync(version, 0o700); } rmSync(root, { recursive: true, force: true }); } });
function root() { const value = realpathSync(mkdtempSync(join(tmpdir(), "managed-cli-test-"))); roots.push(value); return join(value, "managed-cli"); }
function tar(name: string, body = Buffer.from("fixture binary"), type = 48): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000500\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.fill(32, 148, 156);
  header[156] = type;
  header.write("ustar\0", 257, "ascii");
  let sum = 0; for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512), Buffer.alloc(1024)]));
}
function fixture(bytes = tar("codex-aarch64-apple-darwin"), changes: Record<string, unknown> = {}): ManagedCliDependencies {
  const pin = { version: "0.155.1", filename: "codex", url: "https://github.com/openai/codex/test", size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), executableSize: 14, executableSha256: createHash("sha256").update("fixture binary").digest("hex"), team: "TEAM", identifier: "codex", versionLine: "codex-cli 0.155.1", member: "codex-aarch64-apple-darwin", ...changes };
  return { platform: "darwin", arch: "arm64", pin,
    download: async (_url, destination) => { writeFileSync(destination, bytes, { mode: 0o600 }); },
    execute: async (file, args) => {
      if (file.endsWith("codesign") && args[0] === "-dv") return { stdout: "", stderr: "TeamIdentifier=TEAM\nIdentifier=codex\n" };
      if (file.endsWith("lipo")) return { stdout: "arm64\n", stderr: "" };
      if (args[0] === "--version") return { stdout: "codex-cli 0.155.1\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  };
}

describe("managed official CLI install", () => {
  it("verifies a one-member archive and atomically publishes a private version", async () => {
    const base = root();
    const path = await installManagedCli(base, "codex", fixture());
    expect(path).toBe(join(base, "codex", "0.155.1", "codex"));
    expect(readFileSync(path, "utf8")).toBe("fixture binary");
    expect(readdirSync(join(base, "codex"))).toEqual(["0.155.1"]);
    expect(installedManagedBinary(base, "codex", fixture().pin)).toBe(path);
  });
  it("rejects size, checksum, signature, architecture and version before publish", async () => {
    for (const change of [{ size: 1 }, { sha256: "0".repeat(64) }, { executableSize: 15 }, { executableSha256: "0".repeat(64) }]) {
      const base = root();
      await expect(installManagedCli(base, "codex", fixture(undefined, change))).rejects.toThrow();
      expect(readdirSync(join(base, "codex"))).toEqual([]);
    }
    for (const failure of ["signature", "arch", "version"] as const) {
      const base = root(); const deps = fixture(); const execute = deps.execute!;
      deps.execute = async (file, args, timeout) => {
        const result = await execute(file, args, timeout);
        if (failure === "signature" && args[0] === "-dv") return { stdout: "", stderr: "TeamIdentifier=WRONG\nIdentifier=codex\n" };
        if (failure === "arch" && file.endsWith("lipo")) return { stdout: "x86_64", stderr: "" };
        if (failure === "version" && args[0] === "--version") return { stdout: "codex-cli 0.1.0", stderr: "" };
        return result;
      };
      await expect(installManagedCli(base, "codex", deps)).rejects.toThrow("verification failed");
      expect(readdirSync(join(base, "codex"))).toEqual([]);
    }
  });
  it("rejects extra, traversal and symlink archive members", async () => {
    for (const bytes of [tar("../codex"), tar("codex-aarch64-apple-darwin", undefined, 50),
      gzipSync(Buffer.concat([Buffer.from(requireTarBody()), Buffer.from("garbage")]))]) {
      const base = root();
      await expect(installManagedCli(base, "codex", fixture(bytes))).rejects.toThrow();
    }
  });
  it("rejects a symlinked managed path", async () => {
    const outside = root(); const base = root();
    symlinkSync(outside, base);
    await expect(installManagedCli(base, "codex", fixture())).rejects.toThrow();
  });
  it("rejects altered installed bytes even with a matching adjacent marker", async () => {
    const base = root(); const deps = fixture();
    const path = await installManagedCli(base, "codex", deps);
    chmodSync(join(base, "codex", "0.155.1"), 0o700);
    chmodSync(path, 0o700);
    writeFileSync(path, "tamperd binary");
    writeFileSync(join(base, "codex", "0.155.1", "sha256"), createHash("sha256").update("tamperd binary").digest("hex"));
    expect(installedManagedBinary(base, "codex", deps.pin)).toBeNull();
    await expect(installManagedCli(base, "codex", deps)).rejects.toThrow("failed verification");
  });
  it("cannot rediscover an unverified managed binary through PATH", () => {
    const base = root();
    for (const [provider, version, candidates] of [["codex", "0.155.1", codexCandidatePaths], ["claude", "2.1.283", claudeCandidatePaths]] as const) {
      const directory = join(base, provider, version);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, provider);
      writeFileSync(path, "not the pinned binary", { mode: 0o700 });
      resetPathCacheForTests();
      expect(candidates({ PATH: directory }, base)).not.toContain(path);
    }
  });
  it("checks private roots regardless of their name and rejects symlink ancestors", async () => {
    const base = root().replace(/managed-cli$/, "cache");
    expect(await installManagedCli(base, "codex", fixture())).toContain("cache/codex/");
    const unsafe = root(); mkdirSync(unsafe, { mode: 0o755 });
    await expect(installManagedCli(unsafe, "codex", fixture())).rejects.toThrow("not private");
    const parent = root(); mkdirSync(parent, { mode: 0o700 }); const alias = join(parent, "alias");
    symlinkSync(base, alias);
    await expect(installManagedCli(join(alias, "cache"), "codex", fixture())).rejects.toThrow();
  });
  it("waits on another provider lock and cleans its own lock after failure", async () => {
    const base = root(); mkdirSync(join(base, "codex"), { recursive: true, mode: 0o700 });
    const lock = join(base, "codex", ".install-lock"); mkdirSync(lock, { mode: 0o700 });
    const deps = fixture(); deps.lockWaitMs = 100;
    await expect(installManagedCli(base, "codex", deps)).rejects.toThrow("another codex installation");
    rmSync(lock, { recursive: true });
    const failed = fixture(); failed.download = async () => { throw new Error("failed"); };
    await expect(installManagedCli(base, "codex", failed)).rejects.toThrow("failed");
    expect(existsSync(lock)).toBe(false);
    expect(await installManagedCli(base, "codex", fixture())).toContain("codex/0.155.1");
    const other = root(); mkdirSync(join(other, "codex"), { recursive: true, mode: 0o700 });
    const otherLock = join(other, "codex", ".install-lock"); mkdirSync(otherLock, { mode: 0o700 });
    setTimeout(() => rmSync(otherLock, { recursive: true }), 30);
    expect(await installManagedCli(other, "codex", { ...fixture(), lockWaitMs: 500 })).toContain("codex/0.155.1");
  });
  it("cleans an interrupted download, retries, and coalesces concurrent callers", async () => {
    const base = root(); const deps = fixture();
    deps.download = async (_url, destination) => { writeFileSync(destination, "partial", { mode: 0o600 }); throw new Error("interrupted"); };
    await expect(installManagedCli(base, "codex", deps)).rejects.toThrow("interrupted");
    expect(readdirSync(join(base, "codex"))).toEqual([]);
    const retry = fixture(); let calls = 0; const download = retry.download!;
    retry.download = async (...args) => { calls++; await new Promise(resolve => setTimeout(resolve, 15)); await download(...args); };
    const [first, second] = await Promise.all([installManagedCli(base, "codex", retry), installManagedCli(base, "codex", retry)]);
    expect(first).toBe(second); expect(calls).toBe(1);
  });
});

function requireTarBody(): Buffer { const body = Buffer.from("fixture binary"); const header = Buffer.alloc(512); header.write("codex-aarch64-apple-darwin"); header.write("0000016\0", 124); header.fill(32, 148, 156); header[156] = 48; let sum=0; for(const byte of header) sum+=byte; header.write(sum.toString(8).padStart(6,"0")+"\0 ",148); return Buffer.concat([header,body,Buffer.alloc(512-body.length),Buffer.alloc(512),Buffer.alloc(512),header]); }

describe("download and child boundaries", () => {
  it("enforces the whole redirect and stream deadline, removes partial files, and allows retry", async () => {
    const base = root(); mkdirSync(base, { mode: 0o700 });
    const destination = join(base, "download");
    let requests = 0;
    const transport = (_url: URL, _options: unknown, callback: (response: any) => void) => {
      const request = new EventEmitter() as any;
      request.destroy = (error: Error) => { request.emit("error", error); };
      queueMicrotask(() => {
        const response = new PassThrough() as any;
        if (++requests === 1) { response.statusCode = 302; response.headers = { location: "https://release-assets.githubusercontent.com/file" }; }
        else { response.statusCode = 200; response.headers = {}; }
        callback(response);
        response.end(requests === 1 ? undefined : "123456");
      });
      return request;
    };
    await expect(downloadOfficial("https://github.com/openai/codex/file", destination, 4, { transport: transport as any, deadlineMs: 1000 })).rejects.toThrow("exceeds pinned size");
    expect(requests).toBe(2);
    expect(existsSync(destination)).toBe(false);
    requests = 0;
    await downloadOfficial("https://github.com/openai/codex/file", destination, 6, { transport: transport as any, deadlineMs: 1000 });
    expect(readFileSync(destination, "utf8")).toBe("123456");
    rmSync(destination);
    const stalled = () => {
      const request = new EventEmitter() as any;
      request.destroy = (error: Error) => { request.emit("error", error); };
      return request;
    };
    await expect(downloadOfficial("https://github.com/openai/codex/file", destination, 6, { transport: stalled as any, deadlineMs: 5 })).rejects.toThrow("timed out");
    expect(existsSync(destination)).toBe(false);
    let hops = 0;
    const redirectThenStall = (_url: URL, _options: unknown, callback: (response: any) => void) => {
      const request = stalled() as any;
      if (++hops === 1) queueMicrotask(() => {
        const response = new PassThrough() as any;
        response.statusCode = 302; response.headers = { location: "https://release-assets.githubusercontent.com/file" };
        callback(response); response.end();
      });
      return request;
    };
    await expect(downloadOfficial("https://github.com/openai/codex/file", destination, 6, { transport: redirectThenStall as any, deadlineMs: 5 })).rejects.toThrow("timed out");
    expect(hops).toBe(2);
    const aborted = (_url: URL, _options: unknown, callback: (response: any) => void) => {
      const request = new EventEmitter() as any;
      request.destroy = (error: Error) => { request.emit("error", error); };
      queueMicrotask(() => {
        const response = new PassThrough() as any;
        response.statusCode = 200; response.headers = {};
        callback(response);
        response.write("part");
        response.destroy(new Error("connection aborted"));
      });
      return request;
    };
    await expect(downloadOfficial("https://github.com/openai/codex/file", destination, 6, { transport: aborted as any, deadlineMs: 1000 })).rejects.toThrow("connection aborted");
    expect(existsSync(destination)).toBe(false);
  });
  it("refuses non-HTTPS and unsafe redirects", () => {
    expect(() => validateOfficialCliUrl("http://github.com/file")).toThrow();
    expect(() => resolveOfficialCliRedirect("https://github.com/file", "http://example.com/file")).toThrow();
    expect(() => resolveOfficialCliRedirect("https://github.com/file", "https://127.0.0.1/file")).toThrow();
    expect(() => resolveOfficialCliRedirect("https://github.com/file", "https://attacker.example/file")).toThrow();
    expect(() => resolveOfficialCliRedirect("https://downloads.claude.ai/file", "https://github.com/file")).toThrow();
    expect(() => validateOfficialCliUrl("https://github.com:443/file")).toThrow();
    expect(() => validateOfficialCliUrl("https://user:password@github.com/file")).toThrow();
    expect(() => resolveOfficialCliRedirect("https://github.com/file", "//release-assets.githubusercontent.com:443/file")).toThrow();
    expect(resolveOfficialCliRedirect("https://github.com/openai/codex/file", "https://release-assets.githubusercontent.com/file")).toContain("release-assets.githubusercontent.com");
  });
  it("uses the absolute system env in both app login commands", () => {
    for (const provider of ["codex", "claude"] as const) {
      const command = loginCommandFor({ provider, cli: "/private/cli", homeDir: "/private/home", pathValue: "/usr/bin:/bin", home: "/private/plan", serverName: "demo", url: "https://example.com/mcp" });
      expect(command).toMatch(/^\/usr\/bin\/env -i /);
      expect(command).toContain("'\/private\/cli'");
      expect(command).toContain(provider === "codex" ? "CODEX_HOME=" : "CLAUDE_CONFIG_DIR=");
    }
  });
  it("passes only safe system, locale and plan variables to a child", () => {
    const env = cleanChildEnvironment({ HOME: "/fake", LANG: "fr_FR.UTF-8", CODEX_HOME: "/plan", OPENAI_API_KEY: "key", ANTHROPIC_API_KEY: "key", OPENAI_BASE_URL: "https://evil", ANTHROPIC_BASE_URL: "https://evil", NODE_OPTIONS: "--require /evil", DYLD_INSERT_LIBRARIES: "/evil", HTTPS_PROXY: "https://evil" }, "/usr/bin");
    expect(env).toMatchObject({ HOME: "/fake", LANG: "fr_FR.UTF-8", CODEX_HOME: "/plan", PATH: "/usr/bin", DISABLE_AUTOUPDATER: "1" });
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_BASE_URL", "NODE_OPTIONS", "DYLD_INSERT_LIBRARIES", "HTTPS_PROXY"]) expect(env[key]).toBeUndefined();
  });
});

describe("Terminal launch result", () => {
  function child(code?: number, error?: string, never = false) {
    const process = new EventEmitter() as any;
    process.stderr = new EventEmitter(); process.kill = vi.fn();
    if (!never) queueMicrotask(() => { if (error) process.stderr.emit("data", error); process.emit("exit", code); });
    return process;
  }
  it("waits for success, reports Automation denial and nonzero exit", async () => {
    expect(await openCliLogin({ shellCommand: "echo ok" }, { platform: "darwin", spawnProcess: (() => child(0)) as any })).toEqual({ started: true });
    expect(await openCliLogin({ shellCommand: "echo ok" }, { platform: "darwin", spawnProcess: (() => child(1, "Not authorized to send Apple events (-1743)")) as any })).toEqual({ started: false, reason: "denied" });
    expect(await openCliLogin({ shellCommand: "echo ok" }, { platform: "darwin", spawnProcess: (() => child(1)) as any })).toEqual({ started: false, reason: "launch_error" });
  });
  it("reports timeout without claiming login started", async () => {
    expect(await openCliLogin({ shellCommand: "echo ok" }, { platform: "darwin", timeoutMs: 5, spawnProcess: (() => child(undefined, undefined, true)) as any })).toEqual({ started: false, reason: "timeout" });
  });
});
