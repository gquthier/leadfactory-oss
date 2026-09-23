// The local plan tier (a dev/test stub, not billing): free by default,
// `BIZOS_LOCAL_PLAN` overrides, custom models and custom connectors are Pro,
// and a free turn sets an existing provider aside for the connected plan.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { FREE_TIER_PROVIDER_NOTE } from "../src/harness/dispatch.js";
import { ENTITLEMENT_FILE, EntitlementStore, ProRequiredError } from "../src/harness/entitlement.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { Storage } from "../src/harness/storage.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "lbz-entitlement-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("EntitlementStore", () => {
  it("is free by default, persists a local tier, and lets the env win", () => {
    const storage = new Storage(join(root, "state"));
    let env: NodeJS.ProcessEnv = {};
    const store = new EntitlementStore(storage, () => env);
    expect(store.get()).toEqual({ tier: "free", source: "default", features: { customModels: false, customConnectors: false } });
    expect(() => store.require("customModels")).toThrow(ProRequiredError);
    expect(store.set("pro")).toEqual({ tier: "pro", source: "local", features: { customModels: true, customConnectors: true } });
    expect(JSON.parse(readFileSync(join(root, "state", ENTITLEMENT_FILE), "utf8"))).toMatchObject({ tier: "pro" });
    expect(() => store.require("customConnectors")).not.toThrow();
    env = { BIZOS_LOCAL_PLAN: "free" };
    expect(store.get()).toMatchObject({ tier: "free", source: "env" });
    env = { BIZOS_LOCAL_PLAN: "PRO" };
    expect(store.set("free")).toMatchObject({ tier: "pro", source: "env" });
    expect(() => store.set("gold")).toThrow(/free.*pro/);
  });
});

function setup(environment: NodeJS.ProcessEnv = {}) {
  const turns: CodexTurnInput[] = [];
  const harness = new LocalBizosHarness({
    rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Acme",
    execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"),
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "scripted-codex"), ...environment }, devices: false,
    startTurn: (input): CodexTurnHandle => {
      turns.push(input);
      return { stop: () => undefined, respond: () => "unavailable", sessionId: () => null, settled: () => false };
    },
  });
  const facade = new CollaborationFacade(harness, "fixture", new LocalTeamBroker(), emptyDurableIndex(), null, () => undefined);
  return { harness, facade, turns };
}

describe("Pro gates on the facade", () => {
  it("refuses custom models and connectors on free, and allows them on pro", async () => {
    const { harness, facade } = setup();
    try {
      const gemini = { kind: "openai-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "k", model: "gemini-2.5-flash" };
      await expect(facade.addInferenceProvider(gemini)).rejects.toMatchObject({ code: "pro_required", feature: "customModels" });
      await expect(facade.setModel({ model: "gpt-5.4-mini" })).rejects.toBeInstanceOf(ProRequiredError);
      await expect(facade.createBot({ name: "Ada", model: "o3" })).rejects.toBeInstanceOf(ProRequiredError);
      const { bot } = await facade.createBot({ name: "Ada" });
      await expect(facade.updateBot(bot.id, { model: "o3" })).rejects.toBeInstanceOf(ProRequiredError);
      await expect(facade.updateBot(bot.id, { providerId: "prv_abc123def456" })).rejects.toBeInstanceOf(ProRequiredError);
      await expect(facade.updateBot(bot.id, { model: "", title: "Analyst" })).resolves.toMatchObject({ bot: { title: "Analyst" } });
      await expect(facade.setInference({ source: "provider", providerId: "prv_abc123def456" })).rejects.toBeInstanceOf(ProRequiredError);
      await expect(facade.setInference({ source: "auto" })).resolves.toBeDefined();
      expect(() => facade.installApp({ custom: { name: "Mine", transport: "http", url: "https://example.com/mcp" } })).toThrow(ProRequiredError);

      await expect(facade.setEntitlement({ tier: "pro" })).resolves.toMatchObject({ tier: "pro", source: "local", features: { customModels: true } });
      const provider = await facade.addInferenceProvider(gemini) as { id: string };
      await expect(facade.setInference({ source: "provider", providerId: provider.id })).resolves.toBeDefined();
      await expect(facade.updateBot(bot.id, { providerId: provider.id })).resolves.toMatchObject({ bot: { providerId: provider.id } });
      await expect(facade.setEntitlement({ tier: "gold" })).rejects.toMatchObject({ status: 400 });
    } finally {
      harness.stop();
    }
  });

  it("keeps a configured provider but answers a free turn with the connected plan, and says so", async () => {
    const { harness, turns } = setup();
    try {
      await harness.entitlement.set("pro");
      const provider = await harness.inference.add({ kind: "openrouter", apiKey: "k", model: "openai/gpt-4.1-mini" });
      await harness.runtime.setInference({ source: "provider", providerId: provider.id });
      await harness.entitlement.set("free");
      const bot = await harness.bots.create({ name: "Ada" });
      const sent = await harness.threads.send({ botId: bot.id }, { text: "hello" });
      for (let n = 0; n < 200 && !turns.length; n++) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(turns).toHaveLength(1);
      expect(turns[0]!.modelProvider).toBeUndefined();
      const snapshot = await harness.threads.get({ botId: bot.id });
      const botMessage = snapshot.messages.find((message) => message.runId === sent.runIds[0]);
      expect(botMessage?.blocks).toContainEqual({ kind: "meta", text: FREE_TIER_PROVIDER_NOTE });
      expect((await harness.runtime.getSettings()).local.inferenceProviderId).toBe(provider.id);
      expect(existsSync(join(root, "state", ENTITLEMENT_FILE))).toBe(true);
    } finally {
      harness.stop();
    }
  });
});
