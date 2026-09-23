import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixedClock } from "../src/harness/clock.js";
import { LocalBizosHarness } from "../src/harness/harness.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n8sAAAAASUVORK5CYII=";
const roots: string[] = [];

function fixture(start = Date.parse("2026-09-23T00:00:00Z")) {
  const root = mkdtempSync(join(tmpdir(), "lbz-avatar-generation-"));
  roots.push(root);
  const clock = fixedClock(start);
  const harness = new LocalBizosHarness({
    rootDir: root,
    homeDir: root,
    baseUrl: "",
    readSessionCookie: async () => "",
    orgName: () => "Fixture",
    execPath: "/fake/node",
    packaged: false,
    runAsNodeAvailable: false,
    mcpScriptPath: "/fake/none.mjs",
    devices: false,
    environment: { PATH: "/nowhere" },
    clock,
  });
  return { root, clock, harness };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("durable automatic avatar generation", () => {
  it("atomically gives every new bot one safe default job without leaking its private worker fields", async () => {
    const { root, harness } = fixture();
    const bot = await harness.bots.create({
      name: "Secret Client Name",
      title: "Secret product",
      description: "Private business data",
      instructions: "SYSTEM PROMPT MUST NEVER LEAVE",
    });
    expect(bot.avatarGeneration).toEqual({ status: "pending" });
    expect(JSON.stringify(bot)).not.toMatch(/avatarPrompt|taskId|leaseToken|avatarGenerationInternal/);

    const persisted = JSON.parse(readFileSync(join(root, "bots.json"), "utf8")) as Array<Record<string, unknown>>;
    const internal = JSON.stringify(persisted[0]?.avatarGenerationInternal);
    expect(internal).toContain("fictional adult human");
    expect(internal).not.toMatch(/Secret Client|Private business|SYSTEM PROMPT/);

    const uploaded = await harness.bots.create({ name: "Uploaded", avatarDataUrl: PNG });
    expect(uploaded.avatarKind).toBe("upload");
    expect(uploaded.avatarGeneration).toBeUndefined();
  });

  it("uses explicit user prompts and permits the paid submission exactly once", async () => {
    const { clock, harness } = fixture();
    const bot = await harness.bots.create({ name: "Ada", avatarPrompt: "Fictional adult botanist in a green studio." });
    expect(harness.avatarGeneration.claim("desktop-main", false)).toEqual({ job: null });
    expect((await harness.bots.list()).find((row) => row.id === bot.id)?.avatarGeneration).toEqual({ status: "needs_configuration" });

    const first = harness.avatarGeneration.claim("desktop-main", true).job!;
    expect(first).toMatchObject({ botId: bot.id, prompt: "Fictional adult botanist in a green studio.", state: "submitting" });
    expect(harness.avatarGeneration.claim("other-worker", true)).toEqual({ job: null });
    expect(harness.avatarGeneration.report({ jobId: first.id, leaseToken: first.leaseToken, event: "submitted", taskId: "kie-task-1" }))
      .toMatchObject({ ok: true, applied: true, status: "submitted" });

    const polling = harness.avatarGeneration.claim("desktop-main", true).job!;
    expect(polling).toMatchObject({ id: first.id, taskId: "kie-task-1", state: "submitted" });
    expect(polling.state).not.toBe("submitting");
    clock.advance(120_001);
    const resumed = harness.avatarGeneration.claim("desktop-main", true).job!;
    expect(resumed).toMatchObject({ id: first.id, taskId: "kie-task-1", state: "submitted" });
  });

  it("never retries an uncertain paid submission after a restart", async () => {
    const { root, clock, harness } = fixture();
    await harness.bots.create({ name: "Ada" });
    const submitting = harness.avatarGeneration.claim("desktop-main", true).job!;
    harness.stop();
    clock.advance(120_001);

    const restarted = new LocalBizosHarness({
      rootDir: root, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Fixture",
      execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: "/fake/none.mjs",
      devices: false, environment: { PATH: "/nowhere" }, clock,
    });
    expect(restarted.avatarGeneration.claim("desktop-main", true)).toEqual({ job: null });
    expect((await restarted.bots.list())[0]?.avatarGeneration).toEqual({ status: "submission_unknown", errorCode: "submission_outcome_unknown" });
    expect(submitting.state).toBe("submitting");
  });

  it("lets upload and explicit retry revisions win over stale ready reports", async () => {
    const { harness } = fixture();
    const bot = await harness.bots.create({ name: "Ada" });
    const claimed = harness.avatarGeneration.claim("desktop-main", true).job!;
    await harness.bots.setAvatar(bot.id, { dataUrl: PNG });
    const stale = harness.avatarGeneration.report({ jobId: claimed.id, leaseToken: claimed.leaseToken, event: "ready", dataUrl: PNG });
    expect(stale).toMatchObject({ ok: true, applied: false, status: "ready" });
    expect((await harness.bots.list())[0]).toMatchObject({ avatarKind: "upload", avatarUrl: PNG });

    const retry = await harness.avatarGeneration.generate(bot.id, "A fictional adult engineer on a blue background.");
    expect(retry.avatarGeneration).toEqual({ status: "pending" });
    expect(retry.avatarKind).toBe("upload");
  });

  it("fails closed when persisted generation state is malformed", async () => {
    const { root, harness } = fixture();
    await harness.bots.create({ name: "Ada" });
    harness.stop();
    const path = join(root, "bots.json");
    const rows = JSON.parse(readFileSync(path, "utf8")) as Array<Record<string, unknown>>;
    rows[0]!.avatarGenerationInternal = { state: "pending", prompt: "missing durable identity" };
    writeFileSync(path, `${JSON.stringify(rows)}\n`);

    const restarted = new LocalBizosHarness({
      rootDir: root, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Fixture",
      execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: "/fake/none.mjs",
      devices: false, environment: { PATH: "/nowhere" },
    });
    expect(restarted.avatarGeneration.claim("desktop-main", true)).toEqual({ job: null });
    expect((await restarted.bots.list())[0]?.avatarGeneration).toEqual({ status: "failed", errorCode: "corrupt_state" });
  });

  it.each([
    ["submitted without task id", { state: "submitted", taskId: undefined, leaseToken: undefined, leaseWorkerId: undefined, leaseExpiresAt: undefined }],
    ["submitting without a lease", { state: "submitting", leaseToken: undefined, leaseWorkerId: undefined, leaseExpiresAt: undefined }],
    ["pending with a provider task id", { state: "pending", taskId: "must-not-resubmit" }],
  ])("fails closed for %s", async (_label, mutation) => {
    const { root, harness } = fixture();
    await harness.bots.create({ name: "Ada" });
    harness.stop();
    const path = join(root, "bots.json");
    const rows = JSON.parse(readFileSync(path, "utf8")) as Array<Record<string, any>>;
    rows[0]!.avatarGenerationInternal = { ...rows[0]!.avatarGenerationInternal, ...mutation };
    writeFileSync(path, `${JSON.stringify(rows)}\n`);
    const restarted = new LocalBizosHarness({
      rootDir: root, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Fixture",
      execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: "/fake/none.mjs",
      devices: false, environment: { PATH: "/nowhere" },
    });
    expect(restarted.avatarGeneration.claim("desktop-main", true)).toEqual({ job: null });
    expect((await restarted.bots.list())[0]?.avatarGeneration).toEqual({ status: "failed", errorCode: "corrupt_state" });
  });

  it("refuses a corrupt whole bots file instead of replacing it with an empty team", async () => {
    const { root, harness } = fixture();
    await harness.bots.create({ name: "Ada" });
    harness.stop();
    writeFileSync(join(root, "bots.json"), "{truncated");
    expect(() => new LocalBizosHarness({
      rootDir: root, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Fixture",
      execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: "/fake/none.mjs",
      devices: false, environment: { PATH: "/nowhere" },
    })).toThrow(/bots\.json is corrupt/);
  });
});
