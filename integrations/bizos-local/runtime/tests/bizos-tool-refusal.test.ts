// A BizOS tool refused by the usage window (.53): the agent's tool result
// carries `usage_limit_reached` and the server's FR/EN sentence, the person
// gets one grey line. Before, the agent read « insufficient_work_credits
// (402) » and nothing was shown.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ContinuityBridgeError, desktopContinuityTransport } from "../src/continuity-bridge.js";
import { bizosToolRefusal } from "../src/bizos-tool-refusal.js";
import { handleLocalTeamMessage } from "../src/local-team-mcp.js";

const WEEKLY = { fr: "Limite hebdomadaire BizOS atteinte — réinitialisation dans 5 j 21 h", en: "BizOS weekly limit reached — resets in 5 d 21 h" };

/** What Electron main answers on `/v1/continuity` for a refused tools/image-generate. */
async function bridgeRefusal(): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), "bizos-tool-refusal-"));
  try {
    const descriptor = join(dir, "bridge.json");
    writeFileSync(descriptor, JSON.stringify({ version: 1, origin: "http://127.0.0.1:12345", workspaceId: "workspace-fixture", secret: "b".repeat(64) }));
    const transport = desktopContinuityTransport(descriptor, (async () => Response.json({
      ok: false, code: "usage_limit_reached", error: WEEKLY.fr, requestRejected: false, message: WEEKLY,
    }, { status: 429 })) as typeof fetch);
    return await transport("tools/image-generate", { prompt: "cercle bleu", operation_id: "img-1" }).catch((error: unknown) => error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it("turns the signed bridge's usage_limit_reached into a clear FR/EN tool result and a localized notice", async () => {
  const error = await bridgeRefusal();
  expect(error).toBeInstanceOf(ContinuityBridgeError);
  const fr = bizosToolRefusal("bizos_image_generate", error, "fr-FR")!;
  expect(fr.status).toBe(429);
  expect(fr.code).toBe("usage_limit_reached");
  expect(fr.agentText.startsWith("usage_limit_reached — ")).toBe(true);
  expect(fr.agentText).toContain(WEEKLY.fr);
  expect(fr.agentText).toContain(WEEKLY.en);
  expect(fr.agentText).not.toMatch(/insufficient|402|crédits insuffisants/i);
  expect(fr.notice).toBe(`Image non générée : ${WEEKLY.fr}.`);
  expect(bizosToolRefusal("bizos_image_generate", error, "en-US")!.notice).toBe(`Image not generated: ${WEEKLY.en}.`);
});

it("keeps a generic but explicit sentence when the server sent none, and ignores every other failure", () => {
  const bare = new ContinuityBridgeError(429, "usage_limit_reached", "BizOS continuity usage_limit_reached (429)");
  expect(bizosToolRefusal("bizos_site_publish", bare, "fr")!.notice).toBe("Site non publié : Limite d’utilisation BizOS atteinte.");
  expect(bizosToolRefusal("bizos_image_generate", new ContinuityBridgeError(402, "insufficient_work_credits", "x"), "fr")).toBeNull();
  expect(bizosToolRefusal("bizos_image_generate", new Error("usage_limit_reached"), "fr")).toBeNull();
});

it("reaches Claude's MCP tool result with the code and both sentences", async () => {
  const error = await bridgeRefusal();
  const refusal = bizosToolRefusal("bizos_image_generate", error, "fr-FR")!;
  // The sidecar answers the MCP twin with { error: { code, message } }; the
  // team server turns a non-2xx body into an isError tool result.
  const reply = await handleLocalTeamMessage(
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "bizos_image_generate", arguments: { prompt: "cercle bleu", operation_id: "img-1" } } },
    undefined, undefined, undefined, undefined,
    { toolsets: new Set(["team", "bizos"]), bizos: async () => { throw new Error(JSON.stringify({ code: refusal.code, message: refusal.agentText })); } },
  );
  const result = (reply as { result: { isError?: boolean; content: Array<{ text: string }> } }).result;
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('"code":"usage_limit_reached"');
  expect(result.content[0]!.text).toContain(WEEKLY.fr);
  expect(result.content[0]!.text).toContain(WEEKLY.en);
});

it("names every MCP team route after the tool the model called, as Codex's dynamic tools do", async () => {
  const { MCP_OPERATION_TOOLS } = await import("../src/sidecar.js");
  const { LOCAL_TEAM_TOOL_SPECS } = await import("../src/local-team-mcp.js");
  const names = new Set(LOCAL_TEAM_TOOL_SPECS.map((tool) => tool.name));
  expect(MCP_OPERATION_TOOLS.recruit).toBe("recruit_agent");
  for (const tool of Object.values(MCP_OPERATION_TOOLS)) expect(names.has(tool as never)).toBe(true);
  // Every route the MCP twin calls without a `tool` field is mapped.
  const source = (await import("node:fs")).readFileSync(new URL("../src/local-team-mcp.ts", import.meta.url), "utf8");
  const routes = [...source.matchAll(/callEndpoint\("\/api\/internal\/local-team\/([a-z-]+)"/g)].map((match) => match[1]!)
    .filter((route) => !["exchange", "pack", "cloud", "computer", "context", "bizos"].includes(route));
  expect(routes.length).toBeGreaterThan(5);
  for (const route of routes) expect(MCP_OPERATION_TOOLS[route], route).toBeDefined();
});

it("shows the refusal as one grey line in the agent's conversation", async () => {
  const { mkdtempSync: temp, rmSync: remove } = await import("node:fs");
  const { LocalBizosHarness } = await import("../src/harness/harness.js");
  const root = temp(join(tmpdir(), "bizos-tool-notice-"));
  try {
    const harness = new LocalBizosHarness({
      rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Acme",
      execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "none.mjs"),
      environment: { PATH: "/nowhere" }, devices: false,
    });
    const ceo = await harness.bots.create({ name: "CEO" });
    const refusal = bizosToolRefusal("bizos_image_generate", await bridgeRefusal(), "fr-FR")!;
    harness.threads.appendNotice({ threadId: `bot:${ceo.id}` }, refusal.notice);
    const last = (await harness.threads.get({ botId: ceo.id })).messages.at(-1);
    expect(last).toMatchObject({ role: "system", blocks: [{ kind: "meta", text: `Image non générée : ${WEEKLY.fr}.` }] });
    harness.stop();
  } finally {
    remove(root, { recursive: true, force: true });
  }
});
