#!/usr/bin/env node
// Copies the PUBLIC part of the LeadFactory OSS kit into `src/agency-kit/`.
//
// The kit is a build-time input: this script is the only door through which
// its files enter the runtime, and it takes a whitelist, not a folder. Nothing
// private (data/, .git, .env*, reports, tests, scripts) is copied, symlinks
// are refused, and every staged file is hashed into `kit-manifest.json` so the
// packaged artifact can be compared with what was reviewed.
//
// Usage:
//   node scripts/sync-agency-kit.mjs --source <leadfactory-oss checkout> [--dry-run]
//
// The source path is a build argument only: it is never written into the
// staged files, and the runtime never reads it.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const KIT_TARGET = join(RUNTIME_ROOT, "src", "agency-kit");

/** Files copied verbatim, relative to the kit root. */
const FILES = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "UPSTREAM-LICENSE.txt",
  "templates/lead-gen-agency.company-template.json",
];

/** Folders copied recursively, restricted to the listed extensions. */
const TREES = [
  { dir: "lib", extensions: [".mjs"] },
  { dir: "public", extensions: [".html", ".js", ".css", ".svg", ".ico", ".json"] },
  { dir: "vault", extensions: [".md"] },
  { dir: "skills", extensions: [".md", ".json"] },
];

/** Names refused wherever they appear, even inside a whitelisted tree. */
const FORBIDDEN = /(^\.env($|\.)|^\.git$|^node_modules$|^data$|\.key$|\.pem$|\.log$|^\.DS_Store$|\.local\.json$)/i;

export function parseArgs(argv) {
  const args = { source: undefined, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (flag === "--source") {
      args.source = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${flag}`);
  }
  if (!args.source) throw new Error("--source <leadfactory-oss checkout> is required");
  return args;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function insideRoot(root, path) {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep);
}

/** Lists the whitelisted files of one kit checkout, relative `/`-separated. */
export function collectKitFiles(source) {
  const root = resolve(source);
  const files = [];
  const accept = (relativePath) => {
    const absolute = join(root, relativePath);
    if (!insideRoot(root, absolute)) throw new Error(`${relativePath} escapes the kit`);
    const stats = lstatSync(absolute);
    if (stats.isSymbolicLink()) throw new Error(`refusing symlink ${relativePath}`);
    if (!stats.isFile()) throw new Error(`${relativePath} is not a file`);
    for (const segment of relativePath.split("/")) {
      if (FORBIDDEN.test(segment)) throw new Error(`refusing ${relativePath}`);
    }
    files.push(relativePath);
  };
  for (const file of FILES) {
    if (!existsSync(join(root, file))) throw new Error(`kit file missing: ${file}`);
    accept(file);
  }
  const walk = (relativeDir, extensions) => {
    const absolute = join(root, relativeDir);
    if (lstatSync(absolute).isSymbolicLink()) throw new Error(`refusing symlink ${relativeDir}`);
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (FORBIDDEN.test(entry.name) || entry.name.startsWith(".")) continue;
      const child = `${relativeDir}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`refusing symlink ${child}`);
      if (entry.isDirectory()) {
        walk(child, extensions);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!extensions.some((extension) => entry.name.toLowerCase().endsWith(extension))) continue;
      accept(child);
    }
  };
  for (const tree of TREES) {
    if (!existsSync(join(root, tree.dir))) throw new Error(`kit folder missing: ${tree.dir}`);
    walk(tree.dir, tree.extensions);
  }
  return files.sort();
}

/** The kit's own commit, read from `.git` without running git (no hooks). */
function sourceCommit(source) {
  try {
    const head = readFileSync(join(source, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5);
    const direct = join(source, ".git", ref);
    if (existsSync(direct)) return readFileSync(direct, "utf8").trim();
    const packed = readFileSync(join(source, ".git", "packed-refs"), "utf8");
    const line = packed.split("\n").find((row) => row.endsWith(` ${ref}`));
    return line ? line.split(" ")[0] : null;
  } catch {
    return null;
  }
}

export function sync({ source, dryRun = false, target = KIT_TARGET }) {
  const root = resolve(source);
  const files = collectKitFiles(root);
  // Guard: no file may carry this machine's absolute paths into the runtime.
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    if (/\/Users\/[A-Za-z0-9_-]+\//.test(text)) {
      throw new Error(`${file} contains a machine-specific absolute path`);
    }
  }
  const template = JSON.parse(readFileSync(join(root, "templates/lead-gen-agency.company-template.json"), "utf8"));
  const manifest = {
    kit: "leadfactory-oss",
    template: { id: template.id, version: template.version, name: template.name },
    sourceCommit: sourceCommit(root),
    syncedAt: new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000).toISOString(),
    files: {},
  };
  if (dryRun) return { files, manifest, target };
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const file of files) {
    const destination = join(target, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, file), destination);
    manifest.files[file] = sha256(destination);
  }
  writeFileSync(join(target, "kit-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { files, manifest, target };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = sync(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ target: relative(RUNTIME_ROOT, result.target), files: result.files.length, template: result.manifest.template, sourceCommit: result.manifest.sourceCommit }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`sync-agency-kit: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
