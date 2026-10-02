// Vault-local operational state helper shipped as a static template note.
// Keep this payload dependency-free: installed vaults run it with Node.js 22.
export const OPS_SCRIPT = String.raw`import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
if (lstatSync(SCRIPT_FILE).isSymbolicLink()) throw new Error("the operations script cannot be a symbolic link");
const ROOT = realpathSync(resolve(dirname(SCRIPT_FILE), ".."));
const LOCK_RELATIVE = "state/.ops-lock";
const LOCK_TIMEOUT_MS = 2000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CLAIM_STATUSES = new Set(["CLAIMED", "IN-PROGRESS", "PR-REVIEW", "PUSHED-PROD", "DONE", "RELEASED"]);
const DECISION_STATUSES = new Set(["PENDING", "DECIDED", "IN-PROGRESS", "DONE", "WAITING", "REJECTED"]);
const VERIFICATION_OUTCOMES = new Set(["accepted", "rejected", "pending"]);
const RUN_OUTCOMES = new Set(["PASSED", "FAILED", "INCOMPLETE"]);
const TRANSITIONS = new Map([
  ["CLAIMED", new Set(["IN-PROGRESS", "RELEASED"])],
  ["IN-PROGRESS", new Set(["PR-REVIEW", "PUSHED-PROD", "DONE", "RELEASED"])],
  ["PR-REVIEW", new Set(["IN-PROGRESS", "PUSHED-PROD", "DONE", "RELEASED"])],
  ["PUSHED-PROD", new Set(["DONE", "RELEASED"])],
  ["DONE", new Set()],
  ["RELEASED", new Set()],
]);

function fail(message) {
  throw new Error(message);
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return prefix + "-" + Date.now().toString(36) + "-" + randomBytes(6).toString("hex");
}

function output(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

function text(value, label, maximum = 4000) {
  if (typeof value !== "string") fail(label + " is required");
  const clean = value.trim();
  if (!clean) fail(label + " is required");
  if (clean.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) fail(label + " is invalid");
  return clean;
}

function safeName(value, label) {
  const clean = text(value, label, 64);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(clean)) fail(label + " must be a safe name");
  return clean;
}

function dateOnly(value, label) {
  const clean = text(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || Number.isNaN(Date.parse(clean + "T00:00:00.000Z"))) fail(label + " must be YYYY-MM-DD");
  return clean;
}

function timestamp(value, label) {
  const clean = text(value, label, 64);
  if (Number.isNaN(Date.parse(clean))) fail(label + " must be an ISO timestamp");
  return new Date(clean).toISOString();
}

function relativeSegments(value, label) {
  const clean = text(value, label, 1000);
  if (isAbsolute(clean) || clean.includes("\\") || clean.includes("\0")) fail(label + " must be a vault-relative path");
  const segments = clean.split("/");
  if (!segments.length || segments.some((part) => !part || part === "." || part === "..")) fail(label + " contains an unsafe path segment");
  return { clean: segments.join("/"), segments };
}

function vaultPath(value, label, options = {}) {
  const parsed = relativeSegments(value, label);
  const absolute = resolve(ROOT, ...parsed.segments);
  const back = relative(ROOT, absolute);
  if (!back || back === ".." || back.startsWith(".." + sep) || isAbsolute(back)) fail(label + " escapes the vault");
  let current = ROOT;
  for (let index = 0; index < parsed.segments.length; index += 1) {
    current = join(current, parsed.segments[index]);
    try {
      const stats = lstatSync(current);
      if (stats.isSymbolicLink()) fail(label + " crosses a symbolic link");
      if (index < parsed.segments.length - 1 && !stats.isDirectory()) fail(label + " crosses a non-directory");
    } catch (error) {
      if (error && error.code === "ENOENT") break;
      throw error;
    }
  }
  if (options.mustExist && !existsSync(absolute)) fail(label + " does not exist");
  return { relative: parsed.clean, absolute };
}

function assertPrefix(path, prefix, label) {
  if (path !== prefix && !path.startsWith(prefix + "/")) fail(label + " must stay under " + prefix + "/");
}

function regularFile(relativePath, label, prefix) {
  const path = vaultPath(relativePath, label, { mustExist: true });
  if (prefix) assertPrefix(path.relative, prefix, label);
  const stats = lstatSync(path.absolute);
  if (!stats.isFile()) fail(label + " must be a regular file");
  if (stats.size <= 0) fail(label + " is empty");
  if (stats.size > MAX_FILE_BYTES) fail(label + " is too large");
  return { ...path, bytes: stats.size };
}

function fingerprint(relativePath, label, prefix) {
  return readRegularFile(relativePath, label, prefix).fingerprint;
}

function readRegularFile(relativePath, label, prefix) {
  const file = regularFile(relativePath, label, prefix);
  const content = readFileSync(file.absolute);
  if (content.byteLength <= 0) fail(label + " is empty");
  if (content.byteLength > MAX_FILE_BYTES) fail(label + " is too large");
  const fingerprint = {
    path: file.relative,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
  return { fingerprint, content };
}

function ensureDirectory(relativePath) {
  const path = vaultPath(relativePath, "directory");
  if (existsSync(path.absolute)) {
    if (!lstatSync(path.absolute).isDirectory()) fail(path.relative + " is not a directory");
    return;
  }
  mkdirSync(path.absolute, { recursive: true, mode: 0o700 });
}

function atomicWrite(relativePath, content) {
  const target = vaultPath(relativePath, "write target");
  const parent = dirname(target.relative).split(sep).join("/");
  if (parent !== ".") ensureDirectory(parent);
  const temporary = join(dirname(target.absolute), "." + basename(target.absolute) + ".tmp-" + process.pid + "-" + randomBytes(5).toString("hex"));
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    renameSync(temporary, target.absolute);
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

function readJson(relativePath, fallback) {
  const path = vaultPath(relativePath, "JSON state");
  if (!existsSync(path.absolute)) return fallback;
  if (!lstatSync(path.absolute).isFile()) fail(relativePath + " is not a regular state file");
  try {
    const value = JSON.parse(readFileSync(path.absolute, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(relativePath + " is corrupt JSON state");
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.includes("corrupt")) throw error;
    fail(relativePath + " is corrupt JSON state");
  }
}

function readJsonl(relativePath) {
  const path = vaultPath(relativePath, "JSONL state");
  if (!existsSync(path.absolute)) return [];
  if (!lstatSync(path.absolute).isFile()) fail(relativePath + " is not a regular state file");
  const raw = readFileSync(path.absolute, "utf8");
  const rows = [];
  for (const [index, line] of raw.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid row");
      rows.push(value);
    } catch {
      fail(relativePath + " is corrupt JSONL at line " + (index + 1));
    }
  }
  return rows;
}

function writeJsonl(relativePath, rows) {
  const raw = rows.length ? rows.map((row) => JSON.stringify(row)).join("\n") + "\n" : "";
  atomicWrite(relativePath, raw);
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withLock(callback) {
  ensureDirectory("state");
  const lock = vaultPath(LOCK_RELATIVE, "state lock");
  const token = randomBytes(24).toString("hex");
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(lock.absolute, { mode: 0o700 });
      break;
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      let stats;
      try {
        stats = lstatSync(lock.absolute);
      } catch (inspectionError) {
        if (inspectionError && inspectionError.code === "ENOENT") continue;
        throw inspectionError;
      }
      if (stats.isSymbolicLink() || !stats.isDirectory()) fail("state lock is not a safe directory");
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        fail("state lock timed out and was preserved; inspect state/.ops-lock/owner.json and remove an orphan lock manually only after verifying no owner is active");
      }
      sleep(20);
    }
  }
  try {
    const owner = vaultPath(LOCK_RELATIVE + "/owner.json", "state lock owner");
    writeFileSync(owner.absolute, JSON.stringify({ token, pid: process.pid, at: now() }) + "\n", { mode: 0o600, flag: "wx" });
    return callback();
  } finally {
    try {
      const currentLock = vaultPath(LOCK_RELATIVE, "state lock cleanup", { mustExist: true });
      const currentOwner = vaultPath(LOCK_RELATIVE + "/owner.json", "state lock owner cleanup", { mustExist: true });
      const lockStats = lstatSync(currentLock.absolute);
      const ownerStats = lstatSync(currentOwner.absolute);
      if (lockStats.isDirectory() && !lockStats.isSymbolicLink() && ownerStats.isFile() && !ownerStats.isSymbolicLink()) {
        let ownerRecord;
        try { ownerRecord = JSON.parse(readFileSync(currentOwner.absolute, "utf8")); } catch { ownerRecord = null; }
        if (ownerRecord && ownerRecord.token === token) {
          unlinkSync(currentOwner.absolute);
          rmdirSync(currentLock.absolute);
        }
      }
    } catch {
      // Preserve an unsafe, changed or concurrently disturbed lock for explicit recovery.
    }
  }
}

function parseArguments(argv) {
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    if (!key || index + 1 >= argv.length || argv[index + 1].startsWith("--")) fail("option --" + key + " needs a value");
    const values = options.get(key) || [];
    values.push(argv[index + 1]);
    options.set(key, values);
    index += 1;
  }
  return { positionals, options };
}

function allowOptions(parsed, allowed) {
  for (const key of parsed.options.keys()) if (!allowed.includes(key)) fail("unknown option --" + key);
}

function option(parsed, key, required = true) {
  const values = parsed.options.get(key) || [];
  if (values.length > 1) fail("option --" + key + " may appear once");
  if (!values.length) {
    if (required) fail("option --" + key + " is required");
    return undefined;
  }
  return values[0];
}

function options(parsed, key) {
  return parsed.options.get(key) || [];
}

function command(parsed, count) {
  if (parsed.positionals.length !== count) fail("invalid command syntax");
  return parsed.positionals;
}

function normalizeScope(value) {
  const scope = text(value, "scope", 300);
  const normalized = scope.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) fail("scope is invalid");
  return { scope, normalized };
}

function normalizeSubject(value) {
  return text(value, "subject", 500).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function validateClaim(row) {
  if (row.kind !== "claim" || typeof row.id !== "string" || !Number.isInteger(row.revision) || row.revision < 1 ||
      typeof row.at !== "string" || typeof row.scope !== "string" || typeof row.normalizedScope !== "string" ||
      typeof row.owner !== "string" || typeof row.run !== "string" || !CLAIM_STATUSES.has(row.status)) fail("state/claims.jsonl contains an invalid claim event");
  return row;
}

function claimEvents() {
  return readJsonl("state/claims.jsonl").map(validateClaim);
}

function latestBy(rows, key) {
  const latest = new Map();
  for (const row of rows) {
    const existing = latest.get(row[key]);
    if (!existing || row.revision > existing.revision) latest.set(row[key], row);
  }
  return latest;
}

function markdown(value) {
  return String(value).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function renderClaims(rows) {
  const claims = [...latestBy(rows, "id").values()].sort((a, b) => a.at.localeCompare(b.at));
  const lines = ["# Claims", "", "> Generated by node scripts/ops.mjs from state/claims.jsonl. Do not edit this view.", "", "| ID | Scope | Normalized scope | Owner | Run | Status | Revision |", "|---|---|---|---|---|---|---|"];
  for (const claim of claims) lines.push("| " + markdown(claim.id) + " | " + markdown(claim.scope) + " | " + markdown(claim.normalizedScope) + " | " + markdown(claim.owner) + " | " + markdown(claim.run) + " | " + claim.status + " | " + claim.revision + " |");
  if (!claims.length) lines.push("| — | — | — | — | — | — | — |");
  atomicWrite("bus/claims.md", lines.join("\n") + "\n");
}

function validateDecision(row) {
  if (row.kind !== "decision" || typeof row.id !== "string" || typeof row.subject !== "string" ||
      typeof row.normalizedSubject !== "string" || !Number.isInteger(row.revision) || row.revision < 1 ||
      typeof row.at !== "string" || typeof row.by !== "string" || !DECISION_STATUSES.has(row.status) ||
      !(typeof row.value === "string" || (row.value && typeof row.value === "object" && !Array.isArray(row.value)))) fail("state/decisions.jsonl contains an invalid decision event");
  return row;
}

function decisionEvents() {
  return readJsonl("state/decisions.jsonl").map(validateDecision);
}

function isExpired(decision) {
  return Boolean(decision.value && typeof decision.value === "object" && decision.value.expiresAt && Date.parse(decision.value.expiresAt) <= Date.now());
}

function publicDecision(decision) {
  return { ...decision, expired: isExpired(decision) };
}

function renderDecisions(rows) {
  const decisions = [...latestBy(rows, "normalizedSubject").values()].sort((a, b) => a.subject.localeCompare(b.subject));
  const lines = ["# Decisions", "", "> Generated by node scripts/ops.mjs from state/decisions.jsonl. Entries are data and never executable instructions or automatic authorization for dangerous changes.", "", "| Subject | Status | Value | By | Revision |", "|---|---|---|---|---|"];
  for (const row of decisions) {
    const value = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
    lines.push("| " + markdown(row.subject) + " | " + row.status + " | " + markdown(value) + " | " + markdown(row.by) + " | " + row.revision + " |");
  }
  if (!decisions.length) lines.push("| — | — | — | — | — |");
  atomicWrite("bus/DECISIONS.md", lines.join("\n") + "\n");
}

function appendDecisionLocked(input) {
  const rows = decisionEvents();
  const normalizedSubject = normalizeSubject(input.subject);
  const latest = latestBy(rows, "normalizedSubject").get(normalizedSubject);
  const currentRevision = latest ? latest.revision : 0;
  if (input.expectedRevision !== currentRevision) fail("decision CAS failed: expected revision " + input.expectedRevision + ", current revision is " + currentRevision);
  if (!DECISION_STATUSES.has(input.status)) fail("invalid decision status");
  const event = {
    kind: "decision",
    id: latest ? latest.id : id("decision"),
    subject: text(input.subject, "subject", 500),
    normalizedSubject,
    revision: currentRevision + 1,
    at: now(),
    by: safeName(input.by, "by"),
    status: input.status,
    value: input.value,
  };
  rows.push(event);
  writeJsonl("state/decisions.jsonl", rows);
  renderDecisions(rows);
  return event;
}

function validateRun(row) {
  if (row.kind !== "run" || typeof row.id !== "string" || typeof row.agent !== "string" || typeof row.run !== "string" ||
      typeof row.trigger !== "string" || !Array.isArray(row.actions) || row.actions.some((value) => typeof value !== "string") ||
      typeof row.result !== "string" || !RUN_OUTCOMES.has(row.outcome) || !row.evidence ||
      typeof row.evidence.path !== "string" || typeof row.evidence.sha256 !== "string" ||
      typeof row.cost !== "string" || typeof row.next !== "string" || typeof row.at !== "string") fail("state/runs.jsonl contains an invalid run event");
  return row;
}

function runEvents() {
  return readJsonl("state/runs.jsonl").map(validateRun);
}

function bootstrap() {
  return withLock(() => {
    const existing = readJson("state/bootstrap.json", null);
    if (existing && existing.version !== 1) fail("state/bootstrap.json has an unsupported version");
    claimEvents();
    decisionEvents();
    runEvents();
    const directories = [
      "state", "state/goals", "bus", "bus/inbox", "reports/daily", "reports/proofs",
      "knowledge/draft", "knowledge/trusted",
    ];
    for (const directory of directories) ensureDirectory(directory);
    if (!existing) atomicWrite("state/bootstrap.json", JSON.stringify({ version: 1 }, null, 2) + "\n");
    for (const path of ["state/claims.jsonl", "state/decisions.jsonl", "state/runs.jsonl"]) {
      const file = vaultPath(path, "state file");
      if (!existsSync(file.absolute)) atomicWrite(path, "");
    }
    renderClaims(claimEvents());
    renderDecisions(decisionEvents());
    return { ok: true, command: "bootstrap", root: ROOT };
  });
}

function check() {
  const boot = readJson("state/bootstrap.json", null);
  if (!boot || boot.version !== 1) fail("run bootstrap first or repair state/bootstrap.json");
  const claims = claimEvents();
  const decisions = decisionEvents();
  const runs = runEvents();
  for (const directory of ["state", "bus", "bus/inbox", "reports/proofs", "knowledge/draft", "knowledge/trusted"]) {
    const path = vaultPath(directory, "required directory", { mustExist: true });
    if (!lstatSync(path.absolute).isDirectory()) fail(directory + " is not a directory");
  }
  return { ok: true, command: "check", root: ROOT, claims: claims.length, decisions: decisions.length, runs: runs.length };
}

function claimTake(parsed) {
  allowOptions(parsed, ["scope", "owner", "run"]);
  const scope = normalizeScope(option(parsed, "scope"));
  const owner = safeName(option(parsed, "owner"), "owner");
  const run = safeName(option(parsed, "run"), "run");
  return withLock(() => {
    const rows = claimEvents();
    const latest = [...latestBy(rows, "id").values()].filter((row) => row.normalizedScope === scope.normalized).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (latest && latest.status !== "RELEASED") fail("scope already exists and is not released: " + latest.id + " (" + latest.status + ")");
    const event = {
      kind: "claim", id: id("claim"), revision: 1, at: now(), scope: scope.scope,
      normalizedScope: scope.normalized, owner, run, status: "CLAIMED",
    };
    rows.push(event);
    writeJsonl("state/claims.jsonl", rows);
    renderClaims(rows);
    return { ok: true, command: "claim take", claim: event };
  });
}

function claimSet(parsed) {
  allowOptions(parsed, ["id", "status", "owner", "run", "proof"]);
  const claimId = safeName(option(parsed, "id"), "id");
  const status = text(option(parsed, "status"), "status", 40).toUpperCase();
  const owner = safeName(option(parsed, "owner"), "owner");
  const run = safeName(option(parsed, "run"), "run");
  const proofPath = option(parsed, "proof", false);
  if (!CLAIM_STATUSES.has(status)) fail("invalid claim status");
  return withLock(() => {
    const rows = claimEvents();
    const previous = latestBy(rows, "id").get(claimId);
    if (!previous) fail("claim not found");
    if (previous.owner !== owner || previous.run !== run) fail("claim owner and run must match the taker");
    if (!TRANSITIONS.get(previous.status).has(status)) fail("invalid claim transition: " + previous.status + " to " + status);
    let proof;
    if (status === "DONE") {
      if (!proofPath) fail("DONE requires --proof with an accepted verification report");
      const checked = verificationReport(proofPath, "proof");
      proof = checked.proof;
      if (!checked.verification.accepted || checked.verification.outcome !== "accepted") fail("DONE requires an accepted verification report");
      const logs = runEvents().filter((entry) => entry.claim === claimId && entry.agent === owner && entry.run === run);
      const latestRun = logs[logs.length - 1];
      if (!latestRun || latestRun.outcome !== "PASSED") fail("DONE requires the latest run for this claim, owner and run to be PASSED");
      if (latestRun.evidence.path !== proof.path || latestRun.evidence.sha256 !== proof.sha256 || latestRun.evidence.bytes !== proof.bytes) {
        fail("DONE requires the latest passed run to match the current verification report fingerprint");
      }
    } else if (proofPath) {
      fail("--proof is accepted only when closing DONE");
    }
    const event = {
      kind: "claim", id: previous.id, revision: previous.revision + 1, at: now(), scope: previous.scope,
      normalizedScope: previous.normalizedScope, owner: previous.owner, run: previous.run, status,
      ...(proof ? { proof } : {}),
    };
    rows.push(event);
    writeJsonl("state/claims.jsonl", rows);
    renderClaims(rows);
    return { ok: true, command: "claim set", claim: event };
  });
}

function claimList(parsed) {
  allowOptions(parsed, []);
  const claims = [...latestBy(claimEvents(), "id").values()].sort((a, b) => a.at.localeCompare(b.at));
  return { ok: true, command: "claim list", claims };
}

function decisionSet(parsed) {
  allowOptions(parsed, ["subject", "value", "status", "by", "expected-revision"]);
  const expected = Number(option(parsed, "expected-revision"));
  if (!Number.isInteger(expected) || expected < 0) fail("expected revision must be a non-negative integer");
  const status = text(option(parsed, "status"), "status", 40).toUpperCase();
  return withLock(() => {
    const decision = appendDecisionLocked({
      subject: option(parsed, "subject"), value: text(option(parsed, "value"), "value", 4000), status,
      by: option(parsed, "by"), expectedRevision: expected,
    });
    return { ok: true, command: "decision set", decision: publicDecision(decision) };
  });
}

function decisionShow(parsed) {
  allowOptions(parsed, ["subject"]);
  const normalized = normalizeSubject(option(parsed, "subject"));
  const decision = latestBy(decisionEvents(), "normalizedSubject").get(normalized);
  if (!decision) fail("decision not found");
  return { ok: true, command: "decision show", decision: publicDecision(decision) };
}

function decisionList(parsed) {
  allowOptions(parsed, []);
  const decisions = [...latestBy(decisionEvents(), "normalizedSubject").values()].sort((a, b) => a.subject.localeCompare(b.subject)).map(publicDecision);
  return { ok: true, command: "decision list", decisions };
}

function approvalAsk(parsed) {
  allowOptions(parsed, ["agent", "priority", "title", "context", "proposal", "option", "default", "recipient", "expires-at", "run"]);
  const agent = safeName(option(parsed, "agent"), "agent");
  const priority = text(option(parsed, "priority"), "priority", 2).toUpperCase();
  if (!new Set(["P1", "P2", "P3"]).has(priority)) fail("priority must be P1, P2 or P3");
  const choices = options(parsed, "option").map((value) => text(value, "option", 300));
  if (choices.length < 2 || new Set(choices).size !== choices.length) fail("approval needs at least two unique options");
  const defaultChoice = text(option(parsed, "default"), "default", 300);
  if (!choices.includes(defaultChoice)) fail("default must be one of the options");
  const expiresAt = timestamp(option(parsed, "expires-at"), "expires-at");
  const requestId = id("approval");
  const subject = "approval:" + requestId;
  const value = {
    type: "approval-request", priority, title: text(option(parsed, "title"), "title", 300),
    context: text(option(parsed, "context"), "context", 4000), proposal: text(option(parsed, "proposal"), "proposal", 2000),
    options: choices, default: defaultChoice, recipient: safeName(option(parsed, "recipient"), "recipient"),
    expiresAt, run: safeName(option(parsed, "run"), "run"),
  };
  return withLock(() => {
    const decision = appendDecisionLocked({ subject, value, status: "PENDING", by: agent, expectedRevision: 0 });
    return { ok: true, command: "approval ask", approval: publicDecision(decision) };
  });
}

function inboxFile(recipient, messageId, archived) {
  const suffix = archived ? "/done/" : "/";
  return "bus/inbox/" + recipient + suffix + messageId + ".json";
}

function inboxSend(parsed) {
  allowOptions(parsed, ["id", "to", "from", "subject", "body", "run"]);
  const recipient = safeName(option(parsed, "to"), "to");
  const sender = safeName(option(parsed, "from"), "from");
  const messageId = safeName(option(parsed, "id", false) || id("message"), "id");
  const run = safeName(option(parsed, "run"), "run");
  return withLock(() => {
    ensureDirectory("bus/inbox/" + recipient + "/done");
    const inbox = vaultPath("bus/inbox/" + recipient, "recipient inbox", { mustExist: true });
    const done = vaultPath("bus/inbox/" + recipient + "/done", "recipient archive", { mustExist: true });
    if (!lstatSync(inbox.absolute).isDirectory() || !lstatSync(done.absolute).isDirectory()) fail("recipient inbox is invalid");
    const active = vaultPath(inboxFile(recipient, messageId, false), "message target");
    const archived = vaultPath(inboxFile(recipient, messageId, true), "message archive");
    if (existsSync(active.absolute) || existsSync(archived.absolute)) fail("duplicate message id already exists");
    const message = {
      version: 1, id: messageId, to: recipient, from: sender,
      subject: text(option(parsed, "subject"), "subject", 300), body: text(option(parsed, "body"), "body", 10000),
      run, createdAt: now(), delivery: "awaiting-next-sweep",
      note: "This memo does not wake or execute a model. Use a real @Name handoff in the persisted Software team group when delivery is required now.",
    };
    atomicWrite(active.relative, JSON.stringify(message, null, 2) + "\n");
    return { ok: true, command: "inbox send", message };
  });
}

function inboxAck(parsed) {
  allowOptions(parsed, ["to", "id", "by"]);
  const recipient = safeName(option(parsed, "to"), "to");
  const messageId = safeName(option(parsed, "id"), "id");
  const by = safeName(option(parsed, "by"), "by");
  return withLock(() => {
    const active = vaultPath(inboxFile(recipient, messageId, false), "message", { mustExist: true });
    const archived = vaultPath(inboxFile(recipient, messageId, true), "message archive");
    if (!lstatSync(active.absolute).isFile()) fail("message is not a regular file");
    if (existsSync(archived.absolute)) fail("message is already archived");
    let message;
    try { message = JSON.parse(readFileSync(active.absolute, "utf8")); } catch { fail("message is corrupt JSON"); }
    if (!message || message.id !== messageId || message.to !== recipient) fail("message identity does not match its path");
    const acknowledged = { ...message, delivery: "acknowledged", acknowledgedAt: now(), acknowledgedBy: by };
    atomicWrite(active.relative, JSON.stringify(acknowledged, null, 2) + "\n");
    renameSync(active.absolute, archived.absolute);
    return { ok: true, command: "inbox ack", message: acknowledged };
  });
}

function inboxList(parsed) {
  allowOptions(parsed, ["to"]);
  const recipient = safeName(option(parsed, "to"), "to");
  const inbox = vaultPath("bus/inbox/" + recipient, "recipient inbox", { mustExist: true });
  if (!lstatSync(inbox.absolute).isDirectory()) fail("recipient inbox is invalid");
  const messages = [];
  for (const name of readdirSync(inbox.absolute).sort()) {
    if (!name.endsWith(".json")) continue;
    const messageId = safeName(name.slice(0, -5), "message id");
    const path = vaultPath(inboxFile(recipient, messageId, false), "message", { mustExist: true });
    if (!lstatSync(path.absolute).isFile()) fail("inbox contains a non-file message");
    try {
      const message = JSON.parse(readFileSync(path.absolute, "utf8"));
      if (!message || message.id !== messageId || message.to !== recipient) fail("inbox message identity mismatch");
      messages.push(message);
    } catch (error) {
      if (error instanceof Error && error.message.includes("mismatch")) throw error;
      fail("inbox contains corrupt JSON");
    }
  }
  return { ok: true, command: "inbox list", messages };
}

function verificationReport(relativePath, label) {
  const reportFile = readRegularFile(relativePath, label, "reports/proofs");
  if (!reportFile.fingerprint.path.endsWith(".json")) fail(label + " must be a JSON verification report");
  let report;
  try { report = JSON.parse(reportFile.content.toString("utf8")); } catch { fail(label + " is not valid JSON"); }
  if (!report || typeof report !== "object" || Array.isArray(report) || report.version !== 1 ||
      !VERIFICATION_OUTCOMES.has(report.outcome) || typeof report.accepted !== "boolean" ||
      typeof report.summary !== "string" || !Array.isArray(report.artifacts) || report.artifacts.length < 1 || report.artifacts.length > 100) {
    fail(label + " does not match verification report schema version 1");
  }
  if (Object.keys(report).sort().join(",") !== "accepted,artifacts,outcome,summary,version") {
    fail(label + " contains fields outside verification report schema version 1");
  }
  if (report.accepted !== (report.outcome === "accepted")) fail(label + " has an incoherent accepted flag and outcome");
  const summary = text(report.summary, "verification summary", 4000);
  const seen = new Set();
  const artifacts = report.artifacts.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "path,sha256" || typeof entry.path !== "string" ||
        typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      fail("verification artifact " + (index + 1) + " is invalid");
    }
    const expectedPath = text(entry.path, "verification artifact path", 1000);
    if (expectedPath === reportFile.fingerprint.path) fail("verification report cannot reference itself as an artifact");
    if (seen.has(expectedPath)) fail("verification report contains a duplicate artifact path");
    seen.add(expectedPath);
    const actual = fingerprint(expectedPath, "verification artifact", "reports/proofs");
    if (actual.sha256 !== entry.sha256) fail("verification artifact hash mismatch: " + actual.path);
    return actual;
  });
  return {
    proof: reportFile.fingerprint,
    verification: { version: 1, outcome: report.outcome, accepted: report.accepted, summary, artifacts },
  };
}

function proofCheck(parsed) {
  allowOptions(parsed, ["path"]);
  const checked = verificationReport(option(parsed, "path"), "proof");
  return { ok: true, command: "proof check", ...checked };
}

function runLog(parsed) {
  allowOptions(parsed, ["claim", "agent", "run", "trigger", "actions", "outcome", "result", "evidence", "cost", "next"]);
  const cost = text(option(parsed, "cost"), "cost", 500);
  if (cost !== "unknown" && !cost.startsWith("known:")) fail("cost must be unknown or start with known:");
  const actions = text(option(parsed, "actions"), "actions", 4000).split(";").map((value) => value.trim()).filter(Boolean);
  if (!actions.length) fail("actions must contain an observed action");
  const outcome = text(option(parsed, "outcome"), "outcome", 20).toUpperCase();
  if (!RUN_OUTCOMES.has(outcome)) fail("outcome must be passed, failed or incomplete");
  const base = {
    claim: safeName(option(parsed, "claim"), "claim"), agent: safeName(option(parsed, "agent"), "agent"),
    run: safeName(option(parsed, "run"), "run"), trigger: text(option(parsed, "trigger"), "trigger", 2000), actions,
    outcome, result: text(option(parsed, "result"), "result", 4000), evidencePath: option(parsed, "evidence"),
    cost, next: text(option(parsed, "next"), "next", 2000),
  };
  return withLock(() => {
    const claims = latestBy(claimEvents(), "id");
    const claim = claims.get(base.claim);
    if (!claim || claim.owner !== base.agent || claim.run !== base.run) fail("run log must match an existing claim owner and run");
    const checked = verificationReport(base.evidencePath, "evidence");
    const expectedVerification = outcome === "PASSED" ? "accepted" : outcome === "FAILED" ? "rejected" : "pending";
    if (checked.verification.outcome !== expectedVerification) {
      fail("run outcome " + outcome.toLowerCase() + " requires a " + expectedVerification + " verification report");
    }
    const event = {
      kind: "run", id: id("runlog"), at: now(), claim: base.claim, agent: base.agent, run: base.run,
      trigger: base.trigger, actions: base.actions, outcome, result: base.result, evidence: checked.proof,
      cost: base.cost, next: base.next,
    };
    const rows = runEvents();
    rows.push(event);
    writeJsonl("state/runs.jsonl", rows);
    return { ok: true, command: "run log", run: event };
  });
}

function knowledgePropose(parsed) {
  allowOptions(parsed, ["draft", "target", "owner", "last-reviewed", "by", "expected-revision"]);
  const draftPath = vaultPath(option(parsed, "draft"), "draft");
  assertPrefix(draftPath.relative, "knowledge/draft", "draft");
  const target = vaultPath(option(parsed, "target"), "target");
  assertPrefix(target.relative, "knowledge/trusted", "target");
  const owner = safeName(option(parsed, "owner"), "owner");
  const lastReviewed = dateOnly(option(parsed, "last-reviewed"), "last-reviewed");
  const expectedValue = option(parsed, "expected-revision", false);
  const expectedRevision = expectedValue === undefined ? 0 : Number(expectedValue);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) fail("expected revision must be a non-negative integer");
  const subject = "knowledge-promotion:" + draftPath.relative + "=>" + target.relative;
  return withLock(() => {
    if (existsSync(target.absolute)) fail("promotion target already exists");
    const draft = readRegularFile(draftPath.relative, "draft", "knowledge/draft").fingerprint;
    const value = { type: "knowledge-promotion", draft: draft.path, target: target.relative, owner, lastReviewed, draftSha256: draft.sha256 };
    const decision = appendDecisionLocked({ subject, value, status: "PENDING", by: option(parsed, "by"), expectedRevision });
    return { ok: true, command: "knowledge propose", proposal: { decisionSubject: subject, decisionRevision: decision.revision, ...value } };
  });
}

function knowledgePromote(parsed) {
  allowOptions(parsed, ["draft", "target", "owner", "last-reviewed", "decision-subject", "decision-revision"]);
  const draftPath = vaultPath(option(parsed, "draft"), "draft");
  assertPrefix(draftPath.relative, "knowledge/draft", "draft");
  const target = vaultPath(option(parsed, "target"), "target");
  assertPrefix(target.relative, "knowledge/trusted", "target");
  const owner = safeName(option(parsed, "owner"), "owner");
  const lastReviewed = dateOnly(option(parsed, "last-reviewed"), "last-reviewed");
  const decisionSubject = text(option(parsed, "decision-subject"), "decision-subject", 500);
  const decisionRevision = Number(option(parsed, "decision-revision"));
  if (!Number.isInteger(decisionRevision) || decisionRevision < 1) fail("decision revision must be a positive integer");
  return withLock(() => {
    const rows = decisionEvents();
    const normalized = normalizeSubject(decisionSubject);
    const history = rows.filter((row) => row.normalizedSubject === normalized).sort((a, b) => a.revision - b.revision);
    const latest = history[history.length - 1];
    if (!latest || latest.revision !== decisionRevision || latest.status !== "DECIDED" || latest.value !== "APPROVE") fail("promotion needs the explicit current APPROVE decision");
    const proposal = [...history].reverse().find((row) => row.revision < latest.revision && row.value &&
      typeof row.value === "object" && row.value.type === "knowledge-promotion");
    const draftRead = readRegularFile(draftPath.relative, "draft", "knowledge/draft");
    const draft = draftRead.fingerprint;
    if (!proposal || proposal.value.draft !== draft.path || proposal.value.target !== target.relative || proposal.value.owner !== owner ||
        proposal.value.lastReviewed !== lastReviewed || proposal.value.draftSha256 !== draft.sha256) fail("promotion does not match its recorded proposal or the draft changed");
    if (existsSync(target.absolute)) fail("promotion target already exists");
    const header = Buffer.from("---\nowner: " + owner + "\nlast-reviewed: " + lastReviewed + "\n---\n", "utf8");
    const promoted = Buffer.concat([header, draftRead.content]);
    atomicWrite(target.relative, promoted);
    return { ok: true, command: "knowledge promote", target: target.relative, decisionRevision };
  });
}

function dispatch(parsed) {
  const parts = parsed.positionals;
  if (parts[0] === "bootstrap") { command(parsed, 1); allowOptions(parsed, []); return bootstrap(); }
  if (parts[0] === "check") { command(parsed, 1); allowOptions(parsed, []); return check(); }
  if (parts[0] === "claim" && parts[1] === "take") { command(parsed, 2); return claimTake(parsed); }
  if (parts[0] === "claim" && parts[1] === "set") { command(parsed, 2); return claimSet(parsed); }
  if (parts[0] === "claim" && parts[1] === "list") { command(parsed, 2); return claimList(parsed); }
  if (parts[0] === "decision" && parts[1] === "set") { command(parsed, 2); return decisionSet(parsed); }
  if (parts[0] === "decision" && parts[1] === "show") { command(parsed, 2); return decisionShow(parsed); }
  if (parts[0] === "decision" && parts[1] === "list") { command(parsed, 2); return decisionList(parsed); }
  if (parts[0] === "approval" && parts[1] === "ask") { command(parsed, 2); return approvalAsk(parsed); }
  if (parts[0] === "inbox" && parts[1] === "send") { command(parsed, 2); return inboxSend(parsed); }
  if (parts[0] === "inbox" && parts[1] === "ack") { command(parsed, 2); return inboxAck(parsed); }
  if (parts[0] === "inbox" && parts[1] === "list") { command(parsed, 2); return inboxList(parsed); }
  if (parts[0] === "run" && parts[1] === "log") { command(parsed, 2); return runLog(parsed); }
  if (parts[0] === "proof" && parts[1] === "check") { command(parsed, 2); return proofCheck(parsed); }
  if (parts[0] === "knowledge" && parts[1] === "propose") { command(parsed, 2); return knowledgePropose(parsed); }
  if (parts[0] === "knowledge" && parts[1] === "promote") { command(parsed, 2); return knowledgePromote(parsed); }
  fail("unknown command; read scripts/README.md");
}

try {
  output(dispatch(parseArguments(process.argv.slice(2))));
} catch (error) {
  process.stderr.write("ops: " + (error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
}
`;
