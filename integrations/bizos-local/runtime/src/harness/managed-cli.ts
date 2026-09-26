// Official, immutable native CLI pins. Claude is downloaded from Anthropic on
// the person's connect action; neither executable is included in the app.
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync, createWriteStream, openSync, readSync, closeSync, rmdirSync } from "node:fs";
import { get } from "node:https";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { dirname, isAbsolute, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import type { PlanProvider } from "./plan-types.js";

export type ManagedProvider = Extract<PlanProvider, "codex" | "claude">;
export const MANAGED_PINS = {
  codex: { version: "0.155.1", url: "https://github.com/openai/codex/releases/download/rust-v0.155.1/codex-aarch64-apple-darwin.tar.gz", size: 90600719, sha256: "5e5a51470dce2423f9d96bd191d0bbc4cc0e2848a6833df5178eaf47a07a3768", executableSize: 228803200, executableSha256: "8eaf1ad12fe6bf89b1710330f58900014322c7c5af677e43be116d8ac5fc0a9e", team: "2DC432GLL2", identifier: "codex", versionLine: "codex-cli 0.155.1", member: "codex-aarch64-apple-darwin", license: "Apache-2.0", licenseUrl: "https://github.com/openai/codex/blob/rust-v0.155.1/LICENSE", filename: "codex" },
  claude: { version: "2.1.283", url: "https://downloads.claude.ai/claude-code-releases/2.1.283/darwin-arm64/claude", size: 225036032, sha256: "d8cb1e5c79684cc12a8bfc813e3a2073406921b6245744b3009be3ab5651d21e", executableSize: 225036032, executableSha256: "d8cb1e5c79684cc12a8bfc813e3a2073406921b6245744b3009be3ab5651d21e", team: "Q6L2SF6YDW", identifier: "com.anthropic.claude-code", versionLine: "2.1.283 (Claude Code)", member: null, license: "Anthropic proprietary terms", licenseUrl: "https://www.anthropic.com/legal/consumer-terms", filename: "claude" },
} as const;

export class ManagedCliError extends Error {
  constructor(message: string, readonly kind: "unsupported" | "network" | "integrity" | "unsafe_path" | "verification") {
    super(message);
    this.name = "managed_cli_" + kind;
  }
}

export interface ManagedCliDependencies {
  download?(url: string, destination: string, maximumBytes: number): Promise<void>;
  execute?(file: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }>;
  platform?: string;
  arch?: string;
  /** Trusted test-only fixture pin; never supplied by IPC or settings. */
  pin?: { version: string; url: string; size: number; sha256: string; executableSize: number; executableSha256: string; team: string; identifier: string; versionLine: string; member: string | null; filename: string };
  /** Shorter wait for deterministic lock tests. */
  lockWaitMs?: number;
}

const execFile = promisify(execFileCallback);
const defaultExecute: NonNullable<ManagedCliDependencies["execute"]> = async (file, args, timeoutMs) => {
  const result = await execFile(file, args, { timeout: timeoutMs, maxBuffer: 256 * 1024, env: { PATH: "/usr/bin:/bin", LANG: "C" } });
  return { stdout: result.stdout, stderr: result.stderr };
};

function safeDirectory(path: string, root: string, create: boolean): void {
  if (!isAbsolute(path) || !isAbsolute(root) || (path !== root && !path.startsWith(root + "/"))) throw new ManagedCliError("managed CLI directory must be absolute and beneath its root", "unsafe_path");
  // Walk every existing component. A symlink anywhere in userData could
  // redirect installation to an unrelated profile or another volume.
  const parts = path.split("/").filter(Boolean);
  let current = "/";
  for (const part of parts) {
    current = join(current, part);
    if (!existsSync(current) && create) {
      try { mkdirSync(current, { mode: 0o700 }); }
      catch (error) {
        // A second installer may create this ancestor before either holds the
        // provider lock. The lstat checks below still verify the winner.
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    const managedComponent = current === root || current.startsWith(root + "/");
    if (!stat.isDirectory() || stat.isSymbolicLink() || (managedComponent && typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
        (!managedComponent && stat.uid !== 0 && (stat.mode & 0o022))) {
      throw new ManagedCliError("managed CLI path has an unsafe directory", "unsafe_path");
    }
    if (managedComponent) {
      if (stat.mode & 0o077) throw new ManagedCliError("managed CLI directory is not private", "unsafe_path");
    }
  }
}

export function managedBinaryPath(root: string, provider: ManagedProvider): string {
  const pin = MANAGED_PINS[provider];
  return join(root, provider, pin.version, pin.filename);
}

function fileSha256(path: string): string {
  const hash = createHash("sha256");
  const handle = openSync(path, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count: number;
    while ((count = readSync(handle, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, count));
    return hash.digest("hex");
  } finally { closeSync(handle); }
}

/** Exact versioned path, verified again before every spawn. */
export function installedManagedBinary(root: string | undefined, provider: ManagedProvider, fixturePin?: ManagedCliDependencies["pin"]): string | null {
  if (!root) return null;
  const path = managedBinaryPath(root, provider);
  try {
    safeDirectory(dirname(path), root, false);
    const stat = lstatSync(path);
    const pin = fixturePin ?? MANAGED_PINS[provider];
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== pin.executableSize ||
        (typeof process.getuid === "function" && stat.uid !== process.getuid()) || (stat.mode & 0o077) || !(stat.mode & 0o100)) return null;
    if (fileSha256(path) !== pin.executableSha256) return null;
    return path;
  } catch { return null; }
}

function checkArchive(buffer: Buffer, member: string): Buffer {
  let data: Buffer;
  try { data = gunzipSync(buffer, { maxOutputLength: 512 * 1024 * 1024 }); }
  catch { throw new ManagedCliError("Codex archive is invalid or too large", "integrity"); }
  if (data.length < 1024) throw new ManagedCliError("Codex archive is truncated", "integrity");
  const header = data.subarray(0, 512);
  const name = header.subarray(0, 100).toString("utf8").split("\0")[0];
  const prefix = header.subarray(345, 500).toString("utf8").split("\0")[0];
  const type = header[156];
  const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
  const size = Number.parseInt(sizeText, 8);
  const checksumText = header.subarray(148, 156).toString("ascii").replace(/\0.*$/, "").trim();
  const checksum = Number.parseInt(checksumText, 8);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
  if (name !== member || prefix || (type !== 0 && type !== 48) || !Number.isSafeInteger(size) || size <= 0 || checksum !== sum) {
    throw new ManagedCliError("Codex archive contains an unexpected member", "integrity");
  }
  const end = 512 + Math.ceil(size / 512) * 512;
  if (end + 1024 > data.length || data.subarray(end).some((byte) => byte !== 0)) {
    throw new ManagedCliError("Codex archive contains extra members or trailing data", "integrity");
  }
  return data.subarray(512, 512 + size);
}

export function validateOfficialCliUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ManagedCliError("invalid CLI download URL", "network"); }
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1] ?? "";
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname ||
      authority.includes(":") ||
      !["github.com", "release-assets.githubusercontent.com", "downloads.claude.ai"].includes(url.hostname)) {
    throw new ManagedCliError("CLI download host is not an official release host", "network");
  }
  return url;
}

export function resolveOfficialCliRedirect(current: string, location: string): string {
  let next: string;
  try {
    if (/^https?:\/\//i.test(location)) validateOfficialCliUrl(location);
    if (location.startsWith("//")) validateOfficialCliUrl("https:" + location);
    next = new URL(location, validateOfficialCliUrl(current)).toString();
  }
  catch { throw new ManagedCliError("unsafe CLI download redirect", "network"); }
  const destination = validateOfficialCliUrl(next);
  const source = validateOfficialCliUrl(current);
  if (source.hostname === "downloads.claude.ai" && destination.hostname !== source.hostname ||
      source.hostname === "release-assets.githubusercontent.com" && destination.hostname !== source.hostname ||
      source.hostname === "github.com" && !["github.com", "release-assets.githubusercontent.com"].includes(destination.hostname)) {
    throw new ManagedCliError("unsafe CLI download redirect chain", "network");
  }
  return next;
}

type CliTransport = (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

export async function downloadOfficial(url: string, destination: string, maximumBytes: number, options: { transport?: CliTransport; deadlineMs?: number } = {}): Promise<void> {
  const transport = options.transport ?? get;
  const deadlineAt = Date.now() + (options.deadlineMs ?? 600_000);
  let active: ClientRequest | undefined;
  let activeResponse: IncomingMessage | undefined;
  let activeOutput: ReturnType<typeof createWriteStream> | undefined;
  const deadline = setTimeout(() => {
    const error = new ManagedCliError("CLI download timed out", "network");
    activeResponse?.destroy(error);
    activeOutput?.destroy(error);
    active?.destroy(error);
  }, options.deadlineMs ?? 600_000);
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      if (Date.now() >= deadlineAt) throw new ManagedCliError("CLI download timed out", "network");
      const current = validateOfficialCliUrl(url);
      const result = await new Promise<string | null>((resolve, reject) => {
        const request = transport(current, { timeout: Math.min(30_000, Math.max(1, deadlineAt - Date.now())), headers: { "User-Agent": "BizOS-managed-cli/1" } }, response => {
          activeResponse = response;
          const code = response.statusCode ?? 0;
          if (code >= 300 && code < 400) {
            response.destroy();
            try {
              if (!response.headers.location) throw new ManagedCliError("CLI redirect lacks a location", "network");
              resolve(resolveOfficialCliRedirect(url, response.headers.location));
            } catch (error) { reject(error); }
            return;
          }
          if (code !== 200) { response.destroy(); reject(new ManagedCliError(`CLI download HTTP ${code}`, "network")); return; }
          const declared = Number(response.headers["content-length"]);
          if (response.headers["content-length"] !== undefined && (!Number.isSafeInteger(declared) || declared > maximumBytes)) {
            response.destroy(); reject(new ManagedCliError("CLI download exceeds pinned size", "network")); return;
          }
          let received = 0;
          const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length;
            callback(received > maximumBytes ? new ManagedCliError("CLI download exceeds pinned size", "network") : null, received > maximumBytes ? undefined : chunk);
          } });
          const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
          activeOutput = output;
          pipeline(response, limit, output).then(() => resolve(null), reject);
        });
        active = request;
        request.on("timeout", () => request.destroy(new ManagedCliError("CLI download timed out", "network")));
        request.on("error", reject);
      });
      active = undefined;
      activeResponse = undefined;
      activeOutput = undefined;
      if (result === null) return;
      url = result;
    }
    throw new ManagedCliError("too many CLI download redirects", "network");
  } catch (error) {
    rmSync(destination, { force: true });
    throw error;
  } finally { clearTimeout(deadline); }
}

const pending = new Map<string, Promise<string>>();

export function installManagedCli(root: string, provider: ManagedProvider, dependencies: ManagedCliDependencies = {}): Promise<string> {
  const key = `${root}:${provider}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const work = install(root, provider, dependencies).finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}

async function install(root: string, provider: ManagedProvider, dependencies: ManagedCliDependencies): Promise<string> {
  if ((dependencies.platform ?? process.platform) !== "darwin" || (dependencies.arch ?? process.arch) !== "arm64") {
    throw new ManagedCliError("managed CLI requires macOS Apple Silicon", "unsupported");
  }
  const pin = dependencies.pin ?? MANAGED_PINS[provider];
  const final = managedBinaryPath(root, provider);
  safeDirectory(join(root, provider), root, true);
  const lock = join(root, provider, ".install-lock");
  const waitUntil = Date.now() + (dependencies.lockWaitMs ?? 10_000);
  let ownLock: { dev: number; ino: number } | undefined;
  while (!ownLock) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      const stat = lstatSync(lock);
      ownLock = { dev: stat.dev, ino: stat.ino };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      safeDirectory(lock, root, false);
      if (Date.now() >= waitUntil) throw new ManagedCliError(`another ${provider} installation holds ${lock}; retry later or inspect a stale lock`, "unsafe_path");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try {
  const ready = installedManagedBinary(root, provider, dependencies.pin);
  if (ready) return ready;
  if (existsSync(dirname(final))) throw new ManagedCliError("managed CLI version directory exists but failed verification", "unsafe_path");
  const stage = mkdtempSync(join(root, provider, ".install-"));
  const archive = join(stage, "download");
  try {
    await (dependencies.download ?? downloadOfficial)(pin.url, archive, pin.size);
    const stat = lstatSync(archive);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== pin.size || (stat.mode & 0o077)) throw new ManagedCliError("CLI download has wrong size or permissions", "integrity");
    const bytes = readFileSync(archive);
    if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256) throw new ManagedCliError("CLI download checksum mismatch", "integrity");
    const executable = provider === "codex" ? checkArchive(bytes, pin.member!) : bytes;
    if (executable.length !== pin.executableSize || createHash("sha256").update(executable).digest("hex") !== pin.executableSha256) {
      throw new ManagedCliError("CLI executable does not match pinned identity", "integrity");
    }
    const stagedBinary = join(stage, pin.filename);
    writeFileSync(stagedBinary, executable, { mode: 0o500, flag: "wx" });
    rmSync(archive);
    const run = dependencies.execute ?? defaultExecute;
    try {
      await run("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", stagedBinary], 20_000);
      const signature = await run("/usr/bin/codesign", ["-dv", "--verbose=4", stagedBinary], 20_000);
      const details = signature.stdout + "\n" + signature.stderr;
      if (!details.split(/\r?\n/).includes(`TeamIdentifier=${pin.team}`) || !details.split(/\r?\n/).includes(`Identifier=${pin.identifier}`)) throw new Error("signature identity mismatch");
      const architectures = await run("/usr/bin/lipo", ["-archs", stagedBinary], 20_000);
      if (!architectures.stdout.trim().split(/\s+/).includes("arm64")) throw new Error("arm64 architecture missing");
      const version = await run(stagedBinary, ["--version"], 20_000);
      if (version.stdout.trim() !== pin.versionLine) throw new Error("version mismatch");
    } catch (error) {
      throw new ManagedCliError(`CLI signature, architecture or version verification failed: ${error instanceof Error ? error.message : String(error)}`, "verification");
    }
    renameSync(stage, dirname(final));
    chmodSync(dirname(final), 0o500);
    return final;
  } finally {
    if (existsSync(stage)) { chmodSync(stage, 0o700); rmSync(stage, { recursive: true, force: true }); }
  }
  } finally {
    try {
      const stat = lstatSync(lock);
      if (stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === ownLock.dev && stat.ino === ownLock.ino) rmdirSync(lock);
    } catch { /* Never remove another process's lock or arbitrary contents. */ }
  }
}
