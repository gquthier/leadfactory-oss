import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanVault } from "../src/harness/brain.js";
import { seedTemplateVault, validateTemplate } from "../src/harness/company-os.js";
import { OPS_SCRIPT } from "../src/harness/template-ops-script.js";
import { SOFTWARE } from "../src/harness/template-software.js";

let scratch: string;
let vault: string;
let script: string;
let elsewhere: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "software pack space "));
  vault = join(scratch, "installed software company");
  elsewhere = join(scratch, "other cwd");
  mkdirSync(elsewhere);
  expect(seedTemplateVault(vault, SOFTWARE)).toBe("seeded");
  script = join(vault, "scripts", "ops.mjs");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function cli(args: string[], cwd = elsewhere): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}

function ok(args: string[], cwd = elsewhere): Record<string, unknown> {
  const result = cli(args, cwd);
  expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

function fails(args: string[], pattern: RegExp, cwd = elsewhere): SpawnSyncReturns<string> {
  const result = cli(args, cwd);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(pattern);
  return result;
}

function runConcurrent(args: string[], nodeArgs: string[] = []): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...nodeArgs, script, ...args], { cwd: elsewhere, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error("timed out waiting for test condition");
    await delay(2);
  }
}

function writeVerification(
  name: string,
  outcome: "accepted" | "rejected" | "pending",
  accepted: boolean,
  artifactContents = "observed test output\n",
): { artifact: string; report: string } {
  const artifact = `reports/proofs/${name}.txt`;
  const report = `reports/proofs/${name}.json`;
  writeFileSync(join(vault, artifact), artifactContents);
  writeFileSync(join(vault, report), JSON.stringify({
    version: 1,
    outcome,
    accepted,
    summary: `${name} verification`,
    artifacts: [{
      path: artifact,
      sha256: createHash("sha256").update(artifactContents).digest("hex"),
    }],
  }, null, 2) + "\n");
  return { artifact, report };
}

describe("the Software company template", () => {
  it("ships the eleven executable Ops roles, their portable context, a team and no active routines", () => {
    expect(SOFTWARE).toMatchObject({
      id: "software",
      version: 1,
      name: "Software",
      team: { name: "Software team" },
      routines: [],
    });
    expect(SOFTWARE.bots.map((bot) => [bot.slug, bot.name])).toEqual([
      ["ceo", "CEO"],
      ["cto", "CTO"],
      ["bugwatch", "BugWatch"],
      ["support", "Support"],
      ["customer-success", "Customer Success"],
      ["sre", "SRE"],
      ["product", "Product"],
      ["marketing", "Marketing"],
      ["fundraising", "Fundraising"],
      ["usage", "Usage"],
      ["ux", "UX"],
    ]);
    expect(SOFTWARE.bots.filter((bot) => bot.welcome)).toHaveLength(1);
    expect(SOFTWARE.bots[0]).toMatchObject({ name: "CEO", pinned: true });
    for (const bot of SOFTWARE.bots) {
      expect(bot).not.toHaveProperty("model");
      expect(bot.instructions).toContain("../../AGENTS.md");
      expect(bot.instructions).toContain(`${bot.name}.md`);
      expect(bot.instructions).toContain("runtime capability manifest");
      expect(bot.instructions.length).toBeLessThanOrEqual(6000);
      for (const name of ["AGENTS.md", "CLAUDE.md", `${bot.name}.md`]) {
        expect(SOFTWARE.notes.some((note) => note.path === `Agents/${bot.name}/${name}`)).toBe(true);
      }
    }
    expect(() => validateTemplate(SOFTWARE)).not.toThrow();
  });

  it("contains the complete generic operating map with no ghosts or source-company residue", () => {
    const required = [
      "AGENTS.md", "CLAUDE.md", "Start here.md", "MISSION.md", "Company.md", "RULES.md", "ENVIRONMENT.md",
      "Agents/TEAM.md", "knowledge/KNOWLEDGE-MAP.md", "knowledge/draft/stale-flags.md",
      "policies/autonomy.md", "policies/engineering.md", "policies/support.md", "policies/model-routing.md", "policies/loop-engineering.md",
      "processes/feature.md", "processes/incident.md", "processes/support.md", "processes/handoff.md", "processes/knowledge-promotion.md", "processes/bootstrap.md",
      "routines/README.md", "routines/ceo-sweep.md", "routines/bugwatch.md", "routines/sre.md", "routines/usage.md", "routines/product-radar.md",
      "bus/DECISIONS.md", "bus/claims.md", "state/claims.jsonl", "state/decisions.jsonl", "state/runs.jsonl", "state/bootstrap.json",
      "scripts/README.md", "scripts/ops.mjs", "templates/handoff.md", "templates/pr-faq.md", "templates/roadmap.md", "templates/incident.md",
      "templates/proof.md", "templates/learning.md", "templates/daily-report.md",
    ];
    const notePaths = new Set(SOFTWARE.notes.map((note) => note.path));
    for (const path of required) expect(notePaths.has(path), path).toBe(true);
    for (const path of [
      "knowledge/trusted/product", "knowledge/trusted/architecture", "knowledge/trusted/support", "knowledge/trusted/incidents", "knowledge/trusted/ops",
      "knowledge/draft/product", "knowledge/draft/architecture", "knowledge/draft/support", "knowledge/draft/marketing", "knowledge/draft/learnings",
      "reports/daily", "reports/proofs", "state/goals",
    ]) expect(SOFTWARE.folders).toContain(path);
    for (const slug of SOFTWARE.bots.map((bot) => bot.slug)) expect(SOFTWARE.folders).toContain(`bus/inbox/${slug}/done`);

    const graph = scanVault({ id: "software", label: "Software", path: vault }).graph;
    expect(graph.nodes.filter((node) => node.ghost)).toEqual([]);
    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of [
      { source: "AGENTS.md", target: "MISSION.md" },
      { source: "AGENTS.md", target: "Company.md" },
      { source: "AGENTS.md", target: "Agents/TEAM.md" },
      { source: "AGENTS.md", target: "knowledge/KNOWLEDGE-MAP.md" },
      { source: "processes/feature.md", target: "templates/roadmap.md" },
      { source: "processes/handoff.md", target: "templates/handoff.md" },
    ]) expect(graph.edges).toContainEqual(edge);
    expect(readFileSync(join(vault, "scripts", "ops.mjs"), "utf8")).toBe(OPS_SCRIPT);
    expect(statSync(join(vault, "scripts", "ops.mjs")).mode & 0o111).toBe(0);

    const corpus = SOFTWARE.notes.map((note) => `${note.path}\n${note.text}`).join("\n");
    expect(corpus).not.toMatch(/Alex|gquthier|g-air|\/Users\/|bizos\.lol|Whop|Telegram|launchd|autosyncgit/i);
    expect(corpus).not.toMatch(/GPT-|Claude Opus|Fable|Sonnet|OpenRouter|service_role/i);
    expect(corpus).not.toMatch(/https?:\/\/(?!example\.invalid)/i);
    expect(OPS_SCRIPT).not.toMatch(/\b(fetch|curl|git|https?)\b/i);
    expect(OPS_SCRIPT).not.toContain("bus/inbox/ceo");
    const imports = [...OPS_SCRIPT.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((specifier) => specifier.startsWith("node:"))).toBe(true);
  });

  it("documents real runtime semantics and the end-to-end software workflow without auto-activation", () => {
    const text = (path: string) => SOFTWARE.notes.find((note) => note.path === path)!.text;
    expect(text("Company.md")).toMatch(/authorized repositories/i);
    expect(text("Company.md")).toMatch(/reference branches/i);
    expect(text("Company.md")).toMatch(/test commands/i);
    expect(text("Company.md")).toMatch(/budgets/i);
    expect(text("Company.md")).toMatch(/publication rules/i);
    expect(text("Agents/TEAM.md")).toMatch(/recruitable specialists/i);
    expect(text("Agents/TEAM.md")).toMatch(/recruit_agent/);
    expect(text("Agents/TEAM.md")).toMatch(/manage_agent/);
    expect(text("processes/handoff.md")).toMatch(/@Name/);
    expect(text("processes/handoff.md")).toMatch(/group/i);
    expect(text("processes/handoff.md")).toMatch(/DM.*does not dispatch/is);
    expect(text("processes/handoff.md")).toMatch(/4 hops/i);
    expect(text("processes/handoff.md")).toMatch(/12 turns/i);
    expect(text("processes/handoff.md")).toMatch(/no revisiting/i);
    expect(text("processes/handoff.md")).toMatch(/checkpoint_task/);
    expect(text("processes/handoff.md")).toMatch(/Never invent `send_agent`/);
    expect(text("processes/feature.md")).toMatch(/PR-FAQ/);
    expect(text("processes/feature.md")).toMatch(/GO.*DIG.*SIMPLIFY.*REJECT/s);
    expect(text("processes/incident.md")).toMatch(/red.*green.*independent review.*UI proof/is);
    expect(text("processes/support.md")).toMatch(/customer boundaries/i);
    expect(text("routines/README.md")).toMatch(/manual verified run/i);
    expect(text("routines/README.md")).toMatch(/schedule_routine/);
    expect(text("routines/README.md")).toMatch(/offline|asleep/i);
    expect(text("routines/README.md")).toMatch(/not 24\/7/i);
    expect(text("scripts/README.md")).toMatch(/verification report/i);
    expect(text("scripts/README.md")).toMatch(/--outcome passed/);
    expect(text("scripts/README.md")).toMatch(/knowledge propose.*--expected-revision/is);
    for (const path of ["routines/ceo-sweep.md", "routines/bugwatch.md", "routines/sre.md", "routines/usage.md", "routines/product-radar.md"]) {
      for (const heading of ["GOAL", "ITERATION", "VERIFY", "STATE", "STOP", "COST"]) expect(text(path)).toContain(`## ${heading}`);
    }
  });
});

describe("scripts/ops.mjs", () => {
  it("bootstraps and checks the vault from an unrelated CWD, including a path with spaces", () => {
    const boot = ok(["bootstrap"]);
    expect(boot).toMatchObject({ ok: true, command: "bootstrap" });
    const checked = ok(["check"]);
    expect(checked).toMatchObject({ ok: true, command: "check" });
    expect(checked.root).toBe(realpathSync(vault));
    expect(JSON.parse(readFileSync(join(vault, "state", "bootstrap.json"), "utf8"))).toEqual({ version: 1 });
  });

  it("lets exactly one process claim a normalized open scope and permits reclaim only after release", async () => {
    ok(["bootstrap"]);
    const contenders = await Promise.all(Array.from({ length: 8 }, (_, index) => runConcurrent([
      "claim", "take", "--scope", index % 2 ? "  Billing   API  " : "billing api", "--owner", `worker-${index}`, "--run", `run-${index}`,
    ])));
    const winners = contenders.filter((result) => result.code === 0);
    expect(winners).toHaveLength(1);
    expect(contenders.filter((result) => result.code !== 0)).toHaveLength(7);
    const claim = JSON.parse(winners[0]!.stdout) as { claim: { id: string; scope: string; normalizedScope: string; owner: string; run: string } };
    expect(claim.claim).toMatchObject({ scope: expect.any(String), normalizedScope: "billing api", owner: expect.any(String), run: expect.any(String) });

    ok(["claim", "set", "--id", claim.claim.id, "--status", "RELEASED", "--owner", claim.claim.owner, "--run", claim.claim.run]);
    const reclaimed = ok(["claim", "take", "--scope", "BILLING API", "--owner", "replacement", "--run", "run-new"]);
    expect(reclaimed.claim).toMatchObject({ normalizedScope: "billing api", owner: "replacement", run: "run-new" });
    expect(readFileSync(join(vault, "bus", "claims.md"), "utf8")).toContain("billing api");
    expect(readFileSync(join(vault, "state", "claims.jsonl"), "utf8").trim().split("\n").length).toBe(3);
  });

  it("never steals an old lock and leaves explicit orphan recovery to the operator", () => {
    ok(["bootstrap"]);
    const lock = join(vault, "state", ".ops-lock");
    mkdirSync(lock);
    const owner = join(lock, "owner.json");
    const originalOwner = JSON.stringify({ token: "still-owned", pid: process.pid, at: "2000-01-01T00:00:00.000Z" }) + "\n";
    writeFileSync(owner, originalOwner);
    const old = new Date("2000-01-01T00:00:00.000Z");
    utimesSync(lock, old, old);

    const started = Date.now();
    const result = cli(["claim", "take", "--scope", "locked work", "--owner", "product", "--run", "lock-test"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/timed out.*preserved|orphan.*manual|recovery/i);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(readFileSync(owner, "utf8")).toBe(originalOwner);
  });

  it("does not remove a lock whose ownership token changes before cleanup", async () => {
    ok(["bootstrap"]);
    const claims = join(vault, "state", "claims.jsonl");
    writeFileSync(claims, "not JSON\n");
    const lock = join(vault, "state", ".ops-lock");
    const owner = join(lock, "owner.json");
    const entered = join(scratch, "entered-read");
    const release = join(scratch, "release-read");
    const preload = join(scratch, "pause-claims-read.mjs");
    // Pause at a known point after owner.json is written, instead of hoping
    // a large ledger makes the child slow enough for the parent to race it.
    writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const read = fs.readFileSync;
fs.readFileSync = function(path, ...args) {
  if (String(path).endsWith("/state/claims.jsonl")) {
    fs.writeFileSync(${JSON.stringify(entered)}, "ready");
    const deadline = Date.now() + 7000;
    while (!fs.existsSync(${JSON.stringify(release)})) {
      if (Date.now() > deadline) throw new Error("test gate timed out");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
  }
  return read.call(this, path, ...args);
};
syncBuiltinESMExports();
`);
    const running = runConcurrent(["bootstrap"], ["--import", preload]);
    await waitFor(() => existsSync(entered), 5000);
    const replacement = JSON.stringify({ token: "replacement-owner", pid: 999999, at: new Date().toISOString() }) + "\n";
    try {
      expect(existsSync(owner)).toBe(true);
      writeFileSync(owner, replacement);
    } finally {
      writeFileSync(release, "continue");
    }
    const result = await running;
    expect(result.code).not.toBe(0);
    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(owner, "utf8")).toBe(replacement);
  }, 10000);

  it("uses revision CAS for decisions and fails closed on stale writers", () => {
    ok(["bootstrap"]);
    const first = ok([
      "decision", "set", "--subject", "ship search", "--value", "GO", "--status", "DECIDED", "--by", "owner", "--expected-revision", "0",
    ]);
    expect(first.decision).toMatchObject({ subject: "ship search", value: "GO", status: "DECIDED", revision: 1 });
    fails([
      "decision", "set", "--subject", "ship search", "--value", "STOP", "--status", "DECIDED", "--by", "other", "--expected-revision", "0",
    ], /revision|stale|CAS/i);
    const second = ok([
      "decision", "set", "--subject", "ship search", "--value", "IN-PROGRESS", "--status", "IN-PROGRESS", "--by", "product", "--expected-revision", "1",
    ]);
    expect(second.decision).toMatchObject({ revision: 2, value: "IN-PROGRESS" });
    expect(ok(["decision", "show", "--subject", "ship search"]).decision).toMatchObject({ revision: 2 });
    expect(readFileSync(join(vault, "bus", "DECISIONS.md"), "utf8")).toContain("ship search");
  });

  it("records a structured approval request while expiration remains non-approval", () => {
    ok(["bootstrap"]);
    const asked = ok([
      "approval", "ask", "--agent", "product", "--priority", "P2", "--title", "Choose launch shape",
      "--context", "Two reversible launch shapes are ready.", "--proposal", "Use the smaller shape.",
      "--option", "small", "--option", "large", "--default", "small", "--recipient", "owner",
      "--expires-at", "2000-01-01T00:00:00.000Z", "--run", "approval-run",
    ]);
    const request = asked.approval as { subject: string; status: string; expired: boolean; value: Record<string, unknown> };
    expect(request).toMatchObject({ status: "PENDING", expired: true });
    expect(request.value).toMatchObject({ priority: "P2", proposal: "Use the smaller shape.", default: "small", recipient: "owner" });
    const shown = ok(["decision", "show", "--subject", request.subject]).decision;
    expect(shown).toMatchObject({ status: "PENDING", expired: true });
  });

  it("persists unique inbox messages, archives acknowledgements, and refuses traversal or symlink targets", () => {
    ok(["bootstrap"]);
    const sent = ok([
      "inbox", "send", "--id", "msg-fixed", "--to", "cto", "--from", "product", "--subject", "Review plan", "--body", "Please render a verdict.", "--run", "r-1",
    ]);
    expect(sent.message).toMatchObject({ id: "msg-fixed", to: "cto", from: "product", delivery: "awaiting-next-sweep" });
    expect(existsSync(join(vault, "bus", "inbox", "cto", "msg-fixed.json"))).toBe(true);
    fails([
      "inbox", "send", "--id", "msg-fixed", "--to", "cto", "--from", "product", "--subject", "Again", "--body", "Duplicate", "--run", "r-2",
    ], /duplicate|exists/i);
    ok(["inbox", "ack", "--to", "cto", "--id", "msg-fixed", "--by", "cto"]);
    expect(existsSync(join(vault, "bus", "inbox", "cto", "done", "msg-fixed.json"))).toBe(true);
    expect(ok(["inbox", "list", "--to", "cto"]).messages).toEqual([]);
    fails(["inbox", "send", "--to", "../outside", "--from", "product", "--subject", "x", "--body", "x", "--run", "r"], /safe name|path|invalid/i);

    const external = join(scratch, "external");
    mkdirSync(external);
    rmSync(join(vault, "bus", "inbox", "sre"), { recursive: true });
    symlinkSync(external, join(vault, "bus", "inbox", "sre"));
    fails(["inbox", "send", "--to", "sre", "--from", "ceo", "--subject", "health", "--body", "check", "--run", "r"], /symbolic link|symlink|link/i);
    expect(readdirSync(external)).toEqual([]);

    const dynamic = ok([
      "inbox", "send", "--id", "msg-dynamic", "--to", "reviewer", "--from", "product", "--subject", "Review", "--body", "Please inspect.", "--run", "r-3",
    ]);
    expect(dynamic.message).toMatchObject({ id: "msg-dynamic", to: "reviewer" });
    expect(existsSync(join(vault, "bus", "inbox", "reviewer", "done"))).toBe(true);
  });

  it("requires coherent verification reports and a latest passed run before DONE", () => {
    ok(["bootstrap"]);
    const taken = ok(["claim", "take", "--scope", "repair signup", "--owner", "bugwatch", "--run", "incident-1"]).claim as { id: string };
    ok(["claim", "set", "--id", taken.id, "--status", "IN-PROGRESS", "--owner", "bugwatch", "--run", "incident-1"]);
    fails([
      "claim", "set", "--id", taken.id, "--status", "DONE", "--owner", "bugwatch", "--run", "incident-1", "--passed", "true",
    ], /proof|unknown option/i);
    const incomplete = join(vault, "reports", "proofs", "incomplete.json");
    writeFileSync(incomplete, JSON.stringify({ passed: false }) + "\n");
    fails(["proof", "check", "--path", "reports/proofs/incomplete.json"], /verification|schema|version|outcome/i);

    const rejected = writeVerification("signup-rejected", "rejected", false, "tests failed\n");
    const rejectedCheck = ok(["proof", "check", "--path", rejected.report]);
    expect(rejectedCheck.verification).toMatchObject({ outcome: "rejected", accepted: false });

    const incoherent = writeVerification("signup-incoherent", "rejected", true, "tests failed\n");
    fails(["proof", "check", "--path", incoherent.report], /incoherent|accepted|outcome/i);

    const pending = writeVerification("signup-pending", "pending", false, "tests not run\n");
    expect(ok(["proof", "check", "--path", pending.report]).verification).toMatchObject({ outcome: "pending", accepted: false });

    ok([
      "run", "log", "--claim", taken.id, "--agent", "bugwatch", "--run", "incident-1", "--trigger", "reported failure",
      "--actions", "reproduced; tested", "--outcome", "failed", "--result", "FAILED", "--evidence", rejected.report,
      "--cost", "unknown", "--next", "close claim",
    ]);
    fails([
      "claim", "set", "--id", taken.id, "--status", "DONE", "--owner", "bugwatch", "--run", "incident-1", "--proof", rejected.report,
    ], /accepted|passed|negative|DONE/i);

    const accepted = writeVerification("signup-accepted", "accepted", true, "red failed; green passed\n");
    const checked = ok(["proof", "check", "--path", accepted.report]);
    expect(checked.proof).toMatchObject({ path: accepted.report, bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(checked.verification).toMatchObject({ outcome: "accepted", accepted: true });
    ok([
      "run", "log", "--claim", taken.id, "--agent", "bugwatch", "--run", "incident-1", "--trigger", "repair verified",
      "--actions", "changed; tested", "--outcome", "passed", "--result", "green", "--evidence", accepted.report,
      "--cost", "unknown", "--next", "close claim",
    ]);
    writeFileSync(join(vault, accepted.artifact), "changed after verification\n");
    fails([
      "claim", "set", "--id", taken.id, "--status", "DONE", "--owner", "bugwatch", "--run", "incident-1", "--proof", accepted.report,
    ], /artifact hash mismatch|fingerprint/i);
    writeFileSync(join(vault, accepted.artifact), "red failed; green passed\n");
    ok([
      "run", "log", "--claim", taken.id, "--agent", "bugwatch", "--run", "incident-1", "--trigger", "regression rerun",
      "--actions", "reran tests", "--outcome", "failed", "--result", "FAILED", "--evidence", rejected.report,
      "--cost", "unknown", "--next", "repair regression",
    ]);
    fails([
      "claim", "set", "--id", taken.id, "--status", "DONE", "--owner", "bugwatch", "--run", "incident-1", "--proof", accepted.report,
    ], /latest run|passed|DONE/i);
    ok([
      "run", "log", "--claim", taken.id, "--agent", "bugwatch", "--run", "incident-1", "--trigger", "regression repaired",
      "--actions", "fixed regression; reran tests", "--outcome", "passed", "--result", "green", "--evidence", accepted.report,
      "--cost", "unknown", "--next", "close claim",
    ]);
    const closed = ok([
      "claim", "set", "--id", taken.id, "--status", "DONE", "--owner", "bugwatch", "--run", "incident-1", "--proof", accepted.report,
    ]);
    expect(closed.claim).toMatchObject({ id: taken.id, status: "DONE", scope: "repair signup" });
    fails(["proof", "check", "--path", "../outside.md"], /path|escape|relative/i);
  });

  it("reproposes edited knowledge with revision CAS and promotes only the latest approved proposal", () => {
    ok(["bootstrap"]);
    const draft = join(vault, "knowledge", "draft", "product", "search.md");
    writeFileSync(draft, "# Search v1\n\nInitial observation.\n");
    const initial = ok([
      "knowledge", "propose", "--draft", "knowledge/draft/product/search.md", "--target", "knowledge/trusted/product/search.md",
      "--owner", "product", "--last-reviewed", "2026-09-21", "--by", "product",
    ]).proposal as { decisionSubject: string; decisionRevision: number };
    expect(initial.decisionRevision).toBe(1);
    ok([
      "decision", "set", "--subject", initial.decisionSubject, "--value", "REJECT", "--status", "REJECTED", "--by", "owner", "--expected-revision", "1",
    ]);
    writeFileSync(draft, "# Search v2\n\nCorrected observation and sources.\n");
    const reproposed = ok([
      "knowledge", "propose", "--draft", "knowledge/draft/product/search.md", "--target", "knowledge/trusted/product/search.md",
      "--owner", "product", "--last-reviewed", "2026-09-21", "--by", "product", "--expected-revision", "2",
    ]).proposal as { decisionSubject: string; decisionRevision: number };
    expect(reproposed).toMatchObject({ decisionSubject: initial.decisionSubject, decisionRevision: 3 });
    ok([
      "decision", "set", "--subject", reproposed.decisionSubject, "--value", "APPROVE", "--status", "DECIDED", "--by", "owner", "--expected-revision", "3",
    ]);
    fails([
      "knowledge", "promote", "--draft", "knowledge/draft/product/search.md", "--target", "knowledge/trusted/product/search.md",
      "--owner", "product", "--last-reviewed", "2026-09-21", "--decision-subject", reproposed.decisionSubject, "--decision-revision", "2",
    ], /current|revision|approve/i);
    const promoted = ok([
      "knowledge", "promote", "--draft", "knowledge/draft/product/search.md", "--target", "knowledge/trusted/product/search.md",
      "--owner", "product", "--last-reviewed", "2026-09-21", "--decision-subject", reproposed.decisionSubject, "--decision-revision", "4",
    ]);
    expect(promoted).toMatchObject({ ok: true, command: "knowledge promote" });
    expect(readFileSync(join(vault, "knowledge", "trusted", "product", "search.md"), "utf8")).toMatch(/^---\nowner: product\nlast-reviewed: 2026-09-21\n---\n/);
    expect(readFileSync(join(vault, "knowledge", "trusted", "product", "search.md"), "utf8")).toContain("Search v2");
  });

  it("reads and fingerprints one draft buffer only after acquiring the promotion lock", async () => {
    ok(["bootstrap"]);
    const draft = join(vault, "knowledge", "draft", "product", "locked.md");
    writeFileSync(draft, "# Approved bytes\n");
    const proposed = ok([
      "knowledge", "propose", "--draft", "knowledge/draft/product/locked.md", "--target", "knowledge/trusted/product/locked.md",
      "--owner", "product", "--last-reviewed", "2026-09-21", "--by", "product",
    ]).proposal as { decisionSubject: string };
    ok([
      "decision", "set", "--subject", proposed.decisionSubject, "--value", "APPROVE", "--status", "DECIDED", "--by", "owner", "--expected-revision", "1",
    ]);

    const lock = join(vault, "state", ".ops-lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ token: "blocker", pid: process.pid, at: new Date().toISOString() }) + "\n");
    const running = runConcurrent([
      "knowledge", "promote", "--draft", "knowledge/draft/product/locked.md", "--target", "knowledge/trusted/product/locked.md",
      "--owner", "product", "--last-reviewed", "2026-09-21", "--decision-subject", proposed.decisionSubject, "--decision-revision", "2",
    ]);
    await delay(150);
    writeFileSync(draft, "# Concurrent unapproved bytes\n");
    rmSync(lock, { recursive: true });
    const result = await running;

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/draft changed|hash|proposal/i);
    expect(existsSync(join(vault, "knowledge", "trusted", "product", "locked.md"))).toBe(false);
  });

  it("fails closed on corrupt canonical state without replacing it", () => {
    ok(["bootstrap"]);
    const claims = join(vault, "state", "claims.jsonl");
    writeFileSync(claims, "{not-json}\n");
    fails(["claim", "list"], /corrupt|JSON/i);
    expect(readFileSync(claims, "utf8")).toBe("{not-json}\n");
  });

  it("refuses a proof symlink instead of following it", () => {
    ok(["bootstrap"]);
    const outside = join(scratch, "outside-proof.md");
    writeFileSync(outside, "not vault evidence\n");
    const link = join(vault, "reports", "proofs", "outside.md");
    symlinkSync(outside, link);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    fails(["proof", "check", "--path", "reports/proofs/outside.md"], /symbolic link|symlink|link/i);
  });
});
