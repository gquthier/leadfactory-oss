#!/usr/bin/env node
// Mirrors `src/agency-kit/` into `dist/agency-kit/` after `tsc`.
//
// The compiled `dist/harness/agency.js` imports `../agency-kit/lib/app.mjs`
// with a literal relative specifier, so the kit has to sit at the same
// relative place in `dist` as in `src`. tsc copies no assets; this does.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(RUNTIME_ROOT, "src", "agency-kit");
const TARGET = join(RUNTIME_ROOT, "dist", "agency-kit");

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const destination = join(to, entry.name);
    if (lstatSync(source).isSymbolicLink()) throw new Error(`refusing symlink ${source}`);
    if (entry.isDirectory()) {
      count += copyTree(source, destination);
    } else if (entry.isFile()) {
      copyFileSync(source, destination);
      count += 1;
    }
  }
  return count;
}

try {
  lstatSync(SOURCE);
} catch {
  process.stderr.write("copy-agency-kit: src/agency-kit is missing; run `npm run kit:sync -- --source <leadfactory-oss>` first\n");
  process.exit(1);
}
rmSync(TARGET, { recursive: true, force: true });
const files = copyTree(SOURCE, TARGET);
process.stdout.write(`agency-kit: ${files} files copied to dist/agency-kit\n`);
