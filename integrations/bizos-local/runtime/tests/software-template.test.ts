import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function runConcurrent(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: elsewhere, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
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
    expect(readFileSync(join(vault, "scripts", "ops.mjs"), "utf8")).toBe(OPS_SCRIPT);
    expect(statSync(join(vault, "scripts", "ops.mjs")).mode & 0o111).toBe(0);

    const corpus = SOFTWARE.notes.map((note) => `${note.path}\n${note.text}`).join("\n");
    expect(corpus).not.toMatch(/Gauthier|gquthier|g-air|\/Users\/|bizos\.lol|Whop|Telegram|launchd|autosyncgit/i);
    expect(corpus).not.toMatch(/GPT-|Claude Opus|Fable|Sonnet|OpenRouter|service_role/i);
    expect(corpus).not.toMatch(/https?:\/\/(?!example\.invalid)/i);
    expect(OPS_SCRIPT).not.toMatch(/\b(fetch|curl|git|https?)\b/i);
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
  });

  it("will not close work from a passed flag or empty file, but accepts verified proof tied to a run log", () => {
    ok(["bootstrap"]);
    const taken = ok(["claim", "take", "--scope", "repair signup", "--owner", "bugwatch", "--run", "incident-1"]).claim as { id: string };
    ok(["claim", "set", "--id", taken.id, "--status", "IN-PROGRESS", "--owner", "bugwatch", "--run", "incident-1"]);
    fails([
      "claim", "set", "--id", taken.id, "--status", "DONE", "--owner", "bugwatch", "--run", "incident-1", "--passed", "true",
    ], /proof|unknown option/i);
    const proof = join(vault, "reports", "proofs", "signup-fix.md");
    writeFileSync(proof, "");
    fails(["proof", "check", "--path", "reports/proofs/signup-fix.md"], /empty/i);
    writeFileSync(proof, "# Proof\n\nRed failed. Green passed. UI replay: not applicable, backend-only.\n");
    const checked = ok(["proof", "check", "--path", "reports/proofs/signup-fix.md"]);
    expect(checked.proof).toMatchObject({ path: "reports/proofs/signup-fix.md", bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    ok([
      "run", "log", "--claim", taken.id, "--agent", "bugwatch", "--run", "incident-1", "--trigger", "reported failure",
      "--actions", "reproduced; changed; tested", "--result", "green", "--evidence", "reports/proofs/signup-fix.md",
      "--cost", "unknown", "--next", "close claim",
    ]);
    const closed = ok([
      "claim", "set", "--id", taken.id, "--status", "DONE", "--owner", "bugwatch", "--run", "incident-1", "--proof", "reports/proofs/signup-fix.md",
    ]);
    expect(closed.claim).toMatchObject({ id: taken.id, status: "DONE", scope: "repair signup" });
    fails(["proof", "check", "--path", "../outside.md"], /path|escape|relative/i);
  });

  it("promotes knowledge only after an explicit matching decision and adds review metadata", () => {
    ok(["bootstrap"]);
    const draft = join(vault, "knowledge", "draft", "product", "search.md");
    writeFileSync(draft, "# Search\n\nObserved behavior and sources.\n");
    const proposed = ok([
      "knowledge", "propose", "--draft", "knowledge/draft/product/search.md", "--target", "knowledge/trusted/product/search.md",
      "--owner", "product", "--last-reviewed", "2026-09-21", "--by", "product",
    ]).proposal as { decisionSubject: string; decisionRevision: number };
    expect(proposed.decisionRevision).toBe(1);
    fails([
      "knowledge", "promote", "--draft", "knowledge/draft/product/search.md", "--target", "knowledge/trusted/product/search.md",
      "--owner", "product", "--last-reviewed", "2026-09-21", "--decision-subject", proposed.decisionSubject, "--decision-revision", "1",
    ], /explicit|approve|decision/i);
    ok([
      "decision", "set", "--subject", proposed.decisionSubject, "--value", "APPROVE", "--status", "DECIDED", "--by", "owner", "--expected-revision", "1",
    ]);
    const promoted = ok([
      "knowledge", "promote", "--draft", "knowledge/draft/product/search.md", "--target", "knowledge/trusted/product/search.md",
      "--owner", "product", "--last-reviewed", "2026-09-21", "--decision-subject", proposed.decisionSubject, "--decision-revision", "2",
    ]);
    expect(promoted).toMatchObject({ ok: true, command: "knowledge promote" });
    expect(readFileSync(join(vault, "knowledge", "trusted", "product", "search.md"), "utf8")).toMatch(/^---\nowner: product\nlast-reviewed: 2026-09-21\n---\n/);
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
