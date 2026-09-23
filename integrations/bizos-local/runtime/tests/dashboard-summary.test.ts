import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalDashboardSummary } from "../src/dashboard-summary.js";

const roots: string[] = [];
function vault() { const root = mkdtempSync(join(tmpdir(), "bizos-dashboard-")); roots.push(root); return root; }
function fixture(templateId: string, path: string) {
  const binding = { templateId, rootId: "vault:" + templateId, path };
  return { workspaceId: "local:test:workspace", binding: () => binding,
    bots: async () => [{ id: "a", name: "CEO", archived: false, status: "idle" }, { id: "b", name: "Old", archived: true, status: "working" }],
    routines: async () => [{ id: "r", name: "Review", status: "active", next_run_at: null }] };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("local dashboard summary", () => {
  it("does not turn absent sources into zero or include private bot fields", async () => {
    const result = await readLocalDashboardSummary(fixture("lead-gen-agency", vault()));
    expect(result.business.state).toBe("unavailable");
    expect(result.business.metrics).toEqual([]);
    expect(result.finance.revenue).toBeNull();
    expect(result.agents.total).toBe(1);
    expect(JSON.stringify(result)).not.toContain("workspacePath");
  });

  it("projects Agency counts and bounded open tasks from the fixed local store", async () => {
    const root = vault();
    mkdirSync(join(root, "Apps/LeadFactory/data"), { recursive: true });
    const db = { version: 1, clients: [{ id: "c", company: "Client", status: "actif" }], campaigns: [{ id: "x", clientId: "c", name: "Launch", status: "active", budget: 10000 }],
      tasks: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, clientId: "c", title: `Task ${i}`, done: i === 0, updatedAt: "2026-09-20T00:00:00.000Z" })), deliverables: [] };
    writeFileSync(join(root, "Apps/LeadFactory/data/db.json"), JSON.stringify(db));
    const before = readFileSync(join(root, "Apps/LeadFactory/data/db.json"), "utf8");
    const result = await readLocalDashboardSummary(fixture("lead-gen-agency", root));
    expect(result.business.state).toBe("ready");
    expect(result.business.metrics.find((m) => m.key === "openTasks")?.value).toBe(11);
    expect(result.business.items).toHaveLength(8);
    expect(result.finance.state).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("10000");
    expect(readFileSync(join(root, "Apps/LeadFactory/data/db.json"), "utf8")).toBe(before);
  });

  it("uses latest ops revisions and refuses corrupt rows without false zeroes", async () => {
    const root = vault(); mkdirSync(join(root, "state"));
    writeFileSync(join(root, "state/claims.jsonl"), [
      { kind: "claim", id: "one", revision: 1, at: "2026-09-20", scope: "A", normalizedScope: "a", owner: "CEO", run: "r", status: "CLAIMED" },
      { kind: "claim", id: "one", revision: 2, at: "2026-09-21", scope: "A", normalizedScope: "a", owner: "CEO", run: "r", status: "DONE" },
    ].map(JSON.stringify).join("\n") + "\n");
    writeFileSync(join(root, "state/decisions.jsonl"), JSON.stringify({ kind: "decision", id: "d", normalizedSubject: "pricing", subject: "Pricing", revision: 1, at: "2026-09-21", by: "CEO", status: "WAITING", value: "private" }) + "\n");
    writeFileSync(join(root, "state/runs.jsonl"), "");
    const input = fixture("software", root);
    const result = await readLocalDashboardSummary(input);
    expect(result.business.metrics.find((m) => m.key === "completedClaims")?.value).toBe(1);
    expect(result.business.metrics.find((m) => m.key === "pendingDecisions")?.value).toBe(1);
    expect(result.business.items.map((row) => row.status)).toEqual(["WAITING", "DONE"]);
    expect(JSON.stringify(result)).not.toContain("private");
    writeFileSync(join(root, "state/claims.jsonl"), "broken\n");
    const broken = await readLocalDashboardSummary(input);
    expect(broken.business.state).toBe("error");
    expect(broken.business.metrics).toEqual([]);
  });

  it("distinguishes absent ops logs from initialized empty logs", async () => {
    const root = vault(); mkdirSync(join(root, "state"));
    const input = fixture("service-based-business", root);
    expect((await readLocalDashboardSummary(input)).business.state).toBe("unavailable");
    for (const name of ["claims", "decisions", "runs"]) writeFileSync(join(root, "state", `${name}.jsonl`), "");
    const initialized = await readLocalDashboardSummary(input);
    expect(initialized.business.state).toBe("empty");
    expect(initialized.business.metrics.find((m) => m.key === "activeClaims")?.value).toBe(0);
  });

  it("labels e-commerce finance as manual, keeps empty distinct, and uses its currency", async () => {
    const root = vault(); mkdirSync(join(root, "Apps/Ecommerce/data"), { recursive: true });
    const file = join(root, "Apps/Ecommerce/data/db.json");
    writeFileSync(file, JSON.stringify({ version: 1, profile: { currency: "USD" }, products: [], campaigns: [], tasks: [], metrics: [] }));
    const input = fixture("ecommerce", root);
    expect((await readLocalDashboardSummary(input)).finance).toMatchObject({ state: "empty", revenue: null, currency: "USD" });
    writeFileSync(file, JSON.stringify({ version: 1, profile: { currency: "USD" }, products: [], campaigns: [], tasks: [],
      metrics: [{ id: "m", source: "manual", date: "2026-09-21", revenue: 120, spend: 25, orders: 2, returns: 0 }] }));
    expect((await readLocalDashboardSummary(input)).finance).toMatchObject({ state: "ready", source: "manual-ecommerce", currency: "USD", revenue: 120, adSpend: 25, orders: 2 });
    writeFileSync(file, JSON.stringify({ version: 1, profile: { currency: "USD" }, products: [{ id: "p", name: "Product", status: "idea" }], campaigns: [], tasks: [], metrics: [{ id: "m", source: "external", date: "2026-09-21", revenue: 120, spend: 25, orders: 2, returns: 0 }] }));
    const malformed = await readLocalDashboardSummary(input);
    expect(malformed.business.state).toBe("ready");
    expect(malformed.finance.state).toBe("error");
    for (const [date, revenue] of [["2026-02-31", 120], ["2026-09-21", 500_000_000]] as const) {
      writeFileSync(file, JSON.stringify({ version: 1, profile: { currency: "USD" }, products: [], campaigns: [], tasks: [],
        metrics: [{ id: "m", source: "manual", date, revenue, spend: 25, orders: 2, returns: 0 }] }));
      expect((await readLocalDashboardSummary(input)).finance.state).toBe("error");
    }
  });

  it("rejects source symlinks and a binding changed during an await", async () => {
    const root = vault(); const outside = vault(); mkdirSync(join(root, "Apps/LeadFactory/data"), { recursive: true });
    writeFileSync(join(outside, "db.json"), JSON.stringify({ version: 1, clients: [], campaigns: [], tasks: [], deliverables: [] }));
    symlinkSync(join(outside, "db.json"), join(root, "Apps/LeadFactory/data/db.json"));
    expect((await readLocalDashboardSummary(fixture("lead-gen-agency", root))).business.state).toBe("error");
    const pending = fixture("software", root);
    const initialBinding = pending.binding();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const changed = { ...pending, binding: () => initialBinding, bots: async () => { await gate; return []; } };
    const request = readLocalDashboardSummary(changed);
    initialBinding.path = outside;
    release();
    await expect(request).rejects.toThrow(/binding changed/i);
  });

  it("rejects linked parent directories and reports malformed roster sections independently", async () => {
    const root = vault(), outside = vault();
    mkdirSync(join(outside, "LeadFactory/data"), { recursive: true });
    writeFileSync(join(outside, "LeadFactory/data/db.json"), JSON.stringify({ version: 1, clients: [], campaigns: [], tasks: [], deliverables: [] }));
    symlinkSync(outside, join(root, "Apps"));
    const input = fixture("lead-gen-agency", root);
    const result = await readLocalDashboardSummary({ ...input, bots: async () => [{ id: "bad", name: "Bad", archived: false, status: "unknown" }] });
    expect(result.business.state).toBe("error");
    expect(result.agents.state).toBe("error");
    expect(result.routines.state).toBe("ready");
  });

  it("rejects invalid canonical statuses and a FIFO without blocking", async () => {
    const root = vault(); mkdirSync(join(root, "Apps/LeadFactory/data"), { recursive: true });
    writeFileSync(join(root, "Apps/LeadFactory/data/db.json"), JSON.stringify({ version: 1,
      clients: [{ id: "c", company: "Client", status: "not-a-real-status" }], campaigns: [], tasks: [], deliverables: [] }));
    expect((await readLocalDashboardSummary(fixture("lead-gen-agency", root))).business.state).toBe("error");
    mkdirSync(join(root, "state"));
    expect(spawnSync("mkfifo", [join(root, "state/claims.jsonl")]).status).toBe(0);
    writeFileSync(join(root, "state/decisions.jsonl"), ""); writeFileSync(join(root, "state/runs.jsonl"), "");
    expect((await readLocalDashboardSummary(fixture("software", root))).business.state).toBe("error");
  });

  describe("activity, plan, mode and setup", () => {
    const now = new Date(2026, 8, 23, 12, 0, 0); // local time
    const at = (d: number, h: number) => new Date(2026, 8, d, h, 0, 0).toISOString();
    const run = (over: Record<string, unknown>) => ({ threadId: "bot:a", botId: "a", state: "completed", startedAt: at(23, 9), ...over });
    const rich = (over: Record<string, unknown> = {}) => ({ ...fixture("lead-gen-agency", vault()), now: () => now, runLimit: 200,
      publicThreadId: (id: string) => `local:inst:thread:${id}`,
      runs: async () => [
        run({ state: "working", startedAt: at(23, 11), task: { objective: "Write the brief" } }),
        run({ state: "queued", startedAt: at(23, 11) }),
        run({ state: "failed", startedAt: at(23, 8), endedAt: at(23, 8), threadId: "chat:q1" }),
        run({ usage: { inputTokens: 100, outputTokens: 20 } }),
        run({ startedAt: at(22, 23), usage: { inputTokens: 1000, outputTokens: 1 } }),
        run({ startedAt: at(31 - 30, 0), usage: { inputTokens: 5, outputTokens: 5 } }),
        run({ startedAt: new Date(2026, 7, 31, 23).toISOString(), usage: { inputTokens: 999999, outputTokens: 0 } }),
      ],
      plans: async () => [{ id: "p1", provider: "codex", label: "me@example.com", status: "connected",
        usage: { windows: [{ label: "5h", usedPct: 12.4, resetsAt: at(23, 15) }, { label: "weekly", usedPct: 41.6, resetsAt: null }] } }],
      providers: async () => [],
      settings: async () => ({ permissions: "ask", activePlanId: "p1", inferenceProviderId: null }),
      ...over });

    it("counts tokens and runs on local day and month boundaries with public thread ids", async () => {
      const result = await readLocalDashboardSummary(rich());
      expect(result.activity).toEqual({ state: "ready", tokensToday: 120, tokensMonth: 1131, monthComplete: true, runsToday: 4,
        running: 1, queued: 1, current: { title: "Write the brief", threadId: "local:inst:thread:bot:a" },
        lastFailure: { title: "CEO", at: at(23, 8), threadId: "local:inst:thread:chat:q1" } });
      expect(result.agents.waiting).toBe(0);
    });

    it("flags a truncated history instead of claiming a full month", async () => {
      const result = await readLocalDashboardSummary(rich({ runLimit: 2,
        runs: async () => [run({ usage: { inputTokens: 3, outputTokens: 4 } }), run({ startedAt: at(23, 10) })] }));
      expect(result.activity.monthComplete).toBe(false);
      expect(result.activity.tokensToday).toBeNull();
      expect(result.activity.runsToday).toBeNull();
      expect(result.activity.tokensMonth).toBe(7);
    });

    it("reports the busiest plan window without leaking an e-mail label", async () => {
      const result = await readLocalDashboardSummary(rich());
      expect(result.plan).toEqual({ state: "ready", label: null, provider: "codex", status: "connected", usedPct: 42, window: "weekly", resetsAt: null });
      expect(JSON.stringify(result)).not.toContain("example.com");
      expect(result.mode).toEqual({ permissions: "ask", inference: "plan" });
      expect(result.setup.steps).toEqual([{ key: "plan", done: true }, { key: "company", done: true }, { key: "team", done: false },
        { key: "routines", done: true }, { key: "firstTask", done: true }]);
    });

    it("describes an active local provider and an empty setup honestly", async () => {
      const result = await readLocalDashboardSummary(rich({ plans: async () => [],
        providers: async () => [{ id: "o", kind: "ollama", label: "Ollama" }],
        settings: async () => ({ permissions: "skip-all", inferenceProviderId: "o" }) }));
      expect(result.plan).toMatchObject({ state: "ready", provider: "ollama", label: "Ollama", usedPct: null });
      expect(result.mode).toEqual({ permissions: "skip-all", inference: "ollama" });
      const empty = await readLocalDashboardSummary(rich({ plans: async () => [], providers: async () => [], runs: async () => [] }));
      expect(empty.plan.state).toBe("empty");
      expect(empty.activity).toMatchObject({ state: "empty", tokensToday: 0, running: 0, current: null, lastFailure: null });
      expect(empty.setup.steps.find((step) => step.key === "plan")?.done).toBe(false);
    });

    it("isolates failing or unwired sources without false zeroes", async () => {
      const result = await readLocalDashboardSummary(rich({ runs: async () => { throw new Error("down"); },
        plans: async () => [{ id: 1 }], settings: async () => { throw new Error("down"); } }));
      expect(result.activity).toMatchObject({ state: "error", tokensToday: null, runsToday: null, running: null });
      expect(result.plan.state).toBe("error");
      expect(result.mode).toEqual({ permissions: null, inference: null });
      expect(result.agents.state).toBe("ready");
      expect(result.routines.state).toBe("ready");
      const legacy = await readLocalDashboardSummary(fixture("lead-gen-agency", vault()));
      expect(legacy.activity.state).toBe("error");
      expect(legacy.plan.state).toBe("error");
      expect(legacy.setup.steps.find((step) => step.key === "firstTask")?.done).toBe(false);
    });

    it("counts waiting agents", async () => {
      const result = await readLocalDashboardSummary(rich({ bots: async () => [{ id: "a", name: "CEO", archived: false, status: "waiting" }] }));
      expect(result.agents.waiting).toBe(1);
    });
  });
});
