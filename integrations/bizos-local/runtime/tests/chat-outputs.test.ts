// Images, files, links and approvals in the chat (docs/specs/chat-outputs,
// owner decisions 2026-09-26): the send_to_chat tool, the link preview, the
// weight of a permission ask, the global skip-all switch, and the sidecar
// contract an older desktop must still be able to read.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessAsk } from "../src/harness/ask-impact.js";
import {
  extractLinks,
  fetchLinkPreview,
  imageDimensions,
  isBizosInternalLink,
  mimeTypeFor,
  outputsDirFor,
  parsePreviewHtml,
  parseSendToChat,
  resolveAttachment,
} from "../src/harness/chat-outputs.js";
import type { CodexTurnHandle, CodexTurnInput, RuntimeEvent } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { buildLocalBrief, buildPersonaPrompt, type LocalArchitectureManifest } from "../src/harness/prompt.js";
import { approvalTitle, chatOutputsStyle, labelForTool } from "../src/harness/style.js";
import type { Bot, ProductEvent } from "../src/harness/types.js";
import { handleLocalTeamMessage } from "../src/local-team-mcp.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "lbz-chat-outputs-"))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

// ── Binary fixtures ──────────────────────────────────────────────────────

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, APP0 (length 16), SOF0 (length 17): precision, height, width.
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const view = new DataView(bytes.buffer);
  view.setUint16(25, height);
  view.setUint16(27, width);
  return bytes;
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  new DataView(bytes.buffer).setUint16(6, width, true);
  new DataView(bytes.buffer).setUint16(8, height, true);
  return bytes;
}

function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0]);
  const w = width - 1, h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return bytes;
}

describe("MIME and image headers", () => {
  it("names the type from the extension and reads PNG / JPEG / GIF / WebP sizes", () => {
    expect(mimeTypeFor("Rapport-Q3.pdf")).toBe("application/pdf");
    expect(mimeTypeFor("sheet.XLSX")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(mimeTypeFor("weird.bin.unknown")).toBe("application/octet-stream");
    expect(imageDimensions(png(1536, 1024))).toEqual({ width: 1536, height: 1024 });
    expect(imageDimensions(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(gif(300, 200))).toEqual({ width: 300, height: 200 });
    expect(imageDimensions(webpVp8x(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(imageDimensions(new TextEncoder().encode("not an image"))).toBeNull();
  });
});

describe("resolveAttachment", () => {
  it("accepts a file inside the workspace, describes it, and takes a relative path from the first root", () => {
    const workspace = join(root, "ws");
    mkdirSync(join(workspace, "outputs", "2026-09-26"), { recursive: true });
    writeFileSync(join(workspace, "outputs", "2026-09-26", "shot.png"), png(800, 600));
    const image = resolveAttachment("outputs/2026-09-26/shot.png", [workspace], { alt: "The landing page" });
    expect(image).toMatchObject({ kind: "image", fileName: "shot.png", contentType: "image/png", width: 800, height: 600, alt: "The landing page" });
    expect(image.id).toMatch(/^att_[0-9a-f]{24}$/);
    expect(image.path).toBe(join(workspace, "outputs", "2026-09-26", "shot.png"));
    writeFileSync(join(workspace, "Rapport.pdf"), "%PDF-1.4");
    expect(resolveAttachment(join(workspace, "Rapport.pdf"), [workspace])).toMatchObject({ kind: "file", contentType: "application/pdf", size: 8 });
    // SVG is a file, not an inline image.
    writeFileSync(join(workspace, "logo.svg"), "<svg/>");
    expect(resolveAttachment(join(workspace, "logo.svg"), [workspace]).kind).toBe("file");
  });

  it("refuses paths that escape the workspace, through `..` or through a symlink", () => {
    const workspace = join(root, "ws");
    const outside = join(root, "secret");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "id_rsa"), "PRIVATE");
    expect(() => resolveAttachment("../secret/id_rsa", [workspace])).toThrow(/outside your workspace/);
    expect(() => resolveAttachment(join(outside, "id_rsa"), [workspace])).toThrow(/outside your workspace/);
    symlinkSync(join(outside, "id_rsa"), join(workspace, "innocent.txt"));
    expect(() => resolveAttachment(join(workspace, "innocent.txt"), [workspace])).toThrow(/outside your workspace/);
    expect(() => resolveAttachment(join(workspace, "missing.pdf"), [workspace])).toThrow(/does not exist/);
    expect(() => resolveAttachment(workspace, [workspace])).toThrow(/not a file/);
    // A second root (the company vault) is a valid source too.
    const vault = join(root, "vault");
    mkdirSync(vault, { recursive: true });
    writeFileSync(join(vault, "brief.md"), "# brief");
    expect(resolveAttachment(join(vault, "brief.md"), [workspace, vault]).contentType).toBe("text/markdown");
  });

  it("checks the tool's arguments and names the outputs folder by date", () => {
    expect(() => parseSendToChat({})).toThrow(/at least one file/);
    expect(() => parseSendToChat({ files: new Array(11).fill({ path: "a" }) })).toThrow(/at most 10/);
    expect(() => parseSendToChat({ files: [{ alt: "no path" }] })).toThrow(/files\[0\]\.path/);
    expect(parseSendToChat({ files: ["a.pdf", { path: "b.png", alt: "  b  " }], caption: " Voilà " }))
      .toEqual({ files: [{ path: "a.pdf" }, { path: "b.png", alt: "b" }], caption: "Voilà" });
    expect(outputsDirFor("/Users/g/Acme", new Date(2026, 8, 26, 10))).toBe("/Users/g/Acme/outputs/2026-09-26");
  });
});

describe("links", () => {
  it("lists labelled and bare links in reading order and picks the first external https one for the card", () => {
    const text = "See https://app.bizos.lol/d/chat/bot_1 first, then [the report](https://example.com/report?x=1). Also http://plain.example/ and https://example.com/report?x=1 again.";
    const found = extractLinks(text);
    expect(found.links).toEqual([
      { label: "https://app.bizos.lol/d/chat/bot_1", url: "https://app.bizos.lol/d/chat/bot_1" },
      { label: "the report", url: "https://example.com/report?x=1" },
      { label: "http://plain.example/", url: "http://plain.example/" },
    ]);
    expect(found.previewUrl).toBe("https://example.com/report?x=1");
    expect(isBizosInternalLink("https://app.bizos.lol/d/dashboard")).toBe(true);
    expect(isBizosInternalLink("https://app.bizos.lol/d/agent/bot_x")).toBe(true);
    expect(isBizosInternalLink("https://app.bizos.lol/localbizos")).toBe(false);
    expect(extractLinks("Only https://app.bizos.lol/d/routine/r_1 here.").previewUrl).toBeNull();
    expect(extractLinks("Ends with a link https://example.com/a.").links[0]!.url).toBe("https://example.com/a");
    expect(extractLinks("nothing here").links).toEqual([]);
  });

  it("reads og: tags, the <title> and a published date out of a page", () => {
    const parsed = parsePreviewHtml(
      `<html><head><title>Fallback</title><meta content="Q3 report &amp; notes" property="og:title"><meta name="description" content="What  happened   in Q3"><meta property="article:published_time" content="2026-09-20T08:00:00Z"><meta property="og:image" content="/cover.png"></head></html>`,
      "https://example.com/report",
    );
    expect(parsed).toEqual({ title: "Q3 report & notes", description: "What happened in Q3", date: "2026-09-20T08:00:00.000Z", imageUrl: "https://example.com/cover.png" });
    expect(parsePreviewHtml("<title>Only a title</title>", "https://example.com/").title).toBe("Only a title");
  });

  it("fetches a preview with the image under the caps, and gives up quietly otherwise", async () => {
    const html = `<html><head><meta property="og:title" content="Hello"><meta property="og:description" content="World"><meta property="og:image" content="https://example.com/c.png"></head></html>`;
    const response = (body: Uint8Array | string, type: string, ok = true) => ({
      ok, status: ok ? 200 : 500,
      headers: { get: (name: string) => name === "content-type" ? type : null },
      body: null,
      arrayBuffer: async () => (typeof body === "string" ? new TextEncoder().encode(body) : body).buffer.slice(0) as ArrayBuffer,
    });
    const fetch = vi.fn(async (url: string) => url.endsWith("c.png") ? response(png(1200, 630), "image/png") : response(html, "text/html; charset=utf-8"));
    const preview = await fetchLinkPreview("https://example.com/report", { fetch: fetch as never });
    expect(preview).toMatchObject({ url: "https://example.com/report", domain: "example.com", title: "Hello", description: "World", image: { contentType: "image/png", width: 1200, height: 630 } });
    expect(fetch).toHaveBeenCalledTimes(2);

    // Not html: no card. Too big: no card. Throws: no card. Internal / http: never fetched.
    expect(await fetchLinkPreview("https://example.com/x", { fetch: (async () => response("{}", "application/json")) as never })).toBeNull();
    expect(await fetchLinkPreview("https://example.com/x", { fetch: (async () => response(html, "text/html")) as never, maxHtmlBytes: 10 })).toBeNull();
    expect(await fetchLinkPreview("https://example.com/x", { fetch: (async () => { throw new Error("offline"); }) as never })).toBeNull();
    const never = vi.fn();
    expect(await fetchLinkPreview("https://app.bizos.lol/d/chat/bot_1", { fetch: never as never })).toBeNull();
    expect(await fetchLinkPreview("http://example.com/", { fetch: never as never })).toBeNull();
    expect(never).not.toHaveBeenCalled();
    // An image over its cap is dropped alone; the card stands.
    const bigImage = vi.fn(async (url: string) => url.endsWith("c.png") ? response(new Uint8Array(2000), "image/png") : response(html, "text/html"));
    expect((await fetchLinkPreview("https://example.com/report", { fetch: bigImage as never, maxImageBytes: 1000 }))?.image).toBeUndefined();
  });
});

describe("the weight of a permission ask", () => {
  it("never offers Always allow for an irreversible or high-impact action", () => {
    const rm = assessAsk({ tool: "shell", detailText: "rm -rf dist && npm run build" });
    expect(rm).toMatchObject({ impact: "high", reversible: false, allowAlways: false, action: "Delete files", details: { kind: "command" } });
    expect(assessAsk({ tool: "commandExecution", detailText: "git push origin main" })).toMatchObject({ impact: "high", allowAlways: false });
    expect(assessAsk({ tool: "shell", detailText: "curl -X POST https://api.example.com/send -d @body.json" })).toMatchObject({ impact: "high", allowAlways: false });
    expect(assessAsk({ tool: "send_email", detailText: '{"to":["a@example.com","b@example.com"],"subject":"Hi"}' }))
      .toMatchObject({ impact: "high", reversible: false, allowAlways: false, action: "Send 2 emails", target: "2 recipients", details: { kind: "recipients", items: ["a@example.com", "b@example.com"] } });
    expect(assessAsk({ tool: "delete_lead", detailText: "lead_1" })).toMatchObject({ impact: "high", reversible: false, allowAlways: false });
    expect(assessAsk({ tool: "commerce_refund_order" })).toMatchObject({ impact: "high", allowAlways: false });
  });

  it("calls a read a read, keeps Always allow for the rest, and defaults to medium", () => {
    expect(assessAsk({ tool: "shell", detailText: "ls -la && git status" })).toMatchObject({ impact: "low", reversible: true, allowAlways: true, action: "Run `ls -la && git status`" });
    expect(assessAsk({ tool: "get_document", detailText: "get_document\n{\"id\":\"d1\"}" })).toMatchObject({ impact: "low", reversible: true, allowAlways: true, action: "Open a document" });
    expect(assessAsk({ tool: "edit", detailText: "/Users/g/Acme/offer.md" })).toMatchObject({ impact: "medium", reversible: true, allowAlways: true, action: "Edit offer.md", target: "/Users/g/Acme/offer.md" });
    expect(assessAsk({ tool: "edit", detailText: "--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n-old\n+new\n+more" }).details).toEqual({ kind: "diff", text: "--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n-old\n+new\n+more", added: 2, removed: 1 });
    expect(assessAsk({ tool: "run_operation", detailText: "run_operation\n{}" })).toMatchObject({ impact: "medium", allowAlways: true, action: "Run an operation in BizOS" });
    expect(assessAsk({ tool: "run_operation" }).reversible).toBeUndefined();
    expect(assessAsk({ tool: "computer", summary: "Allow Vega to act on github.com?" })).toMatchObject({ impact: "medium", allowAlways: true });
    expect(assessAsk({ tool: "shell", detailText: "python3 build.py" })).toMatchObject({ impact: "medium", allowAlways: true });
  });
});

describe("prompt and labels", () => {
  const BOT: Bot = { id: "bot_vega", name: "Vega", title: "CTO" } as Bot;
  const MANIFEST: LocalArchitectureManifest = {
    mode: "local", instanceId: "i", workspaceId: "w", agentId: "a", threadId: "t", workspaceDir: "/Users/demo/Acme/Agents/Vega", sharedBrainPath: "/Users/demo/Acme",
    sandbox: "workspace-write", supportedProviders: ["codex", "claude", "cursor", "ollama"], peers: [], recruitment: "autonomous-local-tools",
    host: { platform: "darwin", home: "/Users/demo", provider: "codex", permissions: "ask", tools: ["tool:send_to_chat"] },
  };

  it("teaches the tool only when it is mounted, names the company outputs folder, and stays short", () => {
    const withTool = buildLocalBrief({ bot: BOT, orgName: "Acme", manifest: MANIFEST, teamTools: true });
    expect(withTool).toContain("call send_to_chat with its path");
    expect(withTool).toContain("/Users/demo/Acme/outputs/YYYY-MM-DD/");
    expect(withTool).toContain("never label it \"Generated\"");
    expect(withTool).toContain("https://app.bizos.lol/d/chat|agent|routine/<id>");
    expect(withTool).toMatch(/don't ask "can I send\?" in prose/);
    const withoutTool = buildLocalBrief({ bot: BOT, orgName: "Acme", manifest: { ...MANIFEST, host: { ...MANIFEST.host!, tools: [] } }, teamTools: false });
    expect(withoutTool).not.toContain("send_to_chat");
    expect(withoutTool).toContain("outputs/YYYY-MM-DD/");
    expect(chatOutputsStyle({ sendTool: true }).split("\n").length).toBeLessThanOrEqual(15);
    const persona = buildPersonaPrompt({ bot: BOT, orgName: "Acme", since: [], roster: [BOT], localArchitecture: MANIFEST });
    expect(persona).toContain("call send_to_chat");
    expect(buildPersonaPrompt({ bot: BOT, orgName: "Acme", since: [], roster: [BOT] })).not.toContain("send_to_chat");
    expect(labelForTool("send_to_chat")).toBe("Sending to the chat");
    expect(approvalTitle({ botName: "Vega", tool: "send_to_chat", requestType: "permission" })).toBe("Allow Vega to send a file to this chat?");
  });

  it("lists send_to_chat for Claude and routes it to the sidecar", async () => {
    const listed = await handleLocalTeamMessage({ id: 1, method: "tools/list", params: {} });
    expect(JSON.stringify(listed)).toContain("send_to_chat");
    const send = vi.fn(async (input: Record<string, unknown>) => ({ attached: [{ fileName: "a.pdf" }], note: `got ${(input.files as unknown[]).length}` }));
    const result = await handleLocalTeamMessage({ id: 2, method: "tools/call", params: { name: "send_to_chat", arguments: { files: [{ path: "a.pdf" }] } } }, undefined, undefined, undefined, undefined, { send });
    expect(send).toHaveBeenCalledWith({ files: [{ path: "a.pdf" }] });
    expect(JSON.stringify(result)).toContain("got 1");
  });
});

// ── Through the harness ──────────────────────────────────────────────────

function setup(options: { fetchLinkPreview?: (url: string) => Promise<never | null | import("../src/harness/chat-outputs.js").FetchedPreview> } = {}) {
  const turns: CodexTurnInput[] = [];
  const responded: Array<{ requestId: string; decision: string }> = [];
  const harness = new LocalBizosHarness({
    rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Acme",
    execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"),
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "scripted-codex") }, devices: false,
    ...(options.fetchLinkPreview ? { fetchLinkPreview: options.fetchLinkPreview } : { linkPreviews: false }),
    startTurn: (input): CodexTurnHandle => {
      turns.push(input);
      return {
        stop: () => undefined,
        respond: (requestId, decision) => { responded.push({ requestId, decision: String(decision) }); return "allowed-once"; },
        sessionId: () => null, settled: () => false,
      };
    },
    localTeamTools: () => [],
    localArchitecture: (input) => ({
      mode: "local", instanceId: "fixture", workspaceId: "w", agentId: `a:${input.bot.id}`, threadId: `t:${input.threadId}`,
      workspaceDir: input.workspaceDir, ...(input.sharedBrainPath ? { sharedBrainPath: input.sharedBrainPath } : {}),
      sandbox: input.sandbox, supportedProviders: ["codex", "claude", "cursor"],
      peers: [], recruitment: "autonomous-local-tools",
    }),
  });
  const events: ProductEvent[] = [];
  harness.events.subscribe((event) => { events.push(event); });
  const facade = new CollaborationFacade(harness, "fixture", new LocalTeamBroker(), emptyDurableIndex(), null, () => undefined);
  return { harness, facade, turns, responded, events };
}

const emit = (turn: CodexTurnInput, event: RuntimeEvent): void => turn.onEvent(event);
const say = (turn: CodexTurnInput, text: string): void =>
  emit(turn, { type: "item.completed", itemId: `m-${Math.random()}`, itemType: "assistant_text", phase: "final_answer", text });
const end = (turn: CodexTurnInput): void => emit(turn, { type: "turn.completed", ok: true, stopReason: null });

async function scopeOf(harness: LocalBizosHarness, bot: Bot) {
  const run = (await harness.runs.list({ limit: 1 }))[0]!;
  return { botId: bot.id, threadId: `bot:${bot.id}`, runId: run.id };
}

describe("send_to_chat through the harness", () => {
  it("attaches images and files to the next reply, same message, text first, and refuses the outside", async () => {
    const { harness, turns } = setup();
    const bot = await harness.bots.create({ name: "Vega", title: "CTO" });
    await harness.threads.send({ botId: bot.id }, { text: "Send me the report" });
    const workspace = (await harness.bots.list()).find((row) => row.id === bot.id)!.workspacePath!;
    mkdirSync(join(workspace, "outputs", "2026-09-26"), { recursive: true });
    writeFileSync(join(workspace, "outputs", "2026-09-26", "Rapport.pdf"), "%PDF");
    writeFileSync(join(workspace, "outputs", "2026-09-26", "chart.png"), png(1200, 800));
    writeFileSync(join(root, "outside.pdf"), "%PDF");
    const scope = await scopeOf(harness, bot);

    expect(() => harness.sendToChat(scope, { files: [{ path: join(root, "outside.pdf") }] })).toThrow(/outside your workspace/);
    expect(() => harness.sendToChat({ ...scope, runId: "run_other" }, { files: [{ path: "outputs/2026-09-26/Rapport.pdf" }] })).toThrow(/matching active run/);

    const result = harness.sendToChat(scope, { files: [
      { path: "outputs/2026-09-26/chart.png", alt: "Revenue by month" },
      { path: join(workspace, "outputs", "2026-09-26", "Rapport.pdf") },
    ] });
    expect(result.attached).toHaveLength(2);
    expect(result.attached[0]).toMatchObject({ kind: "image", fileName: "chart.png", width: 1200, height: 800 });
    expect(result.note).toMatch(/attached to your next message/);
    expect(result.note).not.toMatch(/belong under/);

    say(turns[0]!, "Here is the Q3 report.");
    end(turns[0]!);
    const messages = (await harness.threads.get({ botId: bot.id })).messages.filter((row) => row.role === "bot" && row.deliveryState === "complete");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.blocks.map((block) => block.kind)).toEqual(["text", "image", "file"]);
    expect(messages[0]!.blocks[1]).toMatchObject({ kind: "image", alt: "Revenue by month", fileName: "chart.png", mimeType: "image/png", width: 1200, height: 800, path: join(workspace, "outputs", "2026-09-26", "chart.png") });
    expect(messages[0]!.blocks[2]).toMatchObject({ kind: "file", name: "Rapport.pdf", mimeType: "application/pdf", size: 4 });
    expect(JSON.stringify(messages[0])).not.toMatch(/Generated/);
  });

  it("publishes staged files on their own message, with the caption, when the turn ends without text — and notes a file sent from outside outputs/", async () => {
    const { harness, turns } = setup();
    const bot = await harness.bots.create({ name: "Vega" });
    await harness.threads.send({ botId: bot.id }, { text: "Screenshot please" });
    const workspace = (await harness.bots.list()).find((row) => row.id === bot.id)!.workspacePath!;
    writeFileSync(join(workspace, "shot.png"), png(10, 10));
    const result = harness.sendToChat(await scopeOf(harness, bot), { files: [{ path: "shot.png", alt: "The screen" }], caption: "Voilà la capture." });
    expect(result.note).toMatch(/belong under .*outputs\/\d{4}-\d{2}-\d{2}/);
    end(turns[0]!);
    const messages = (await harness.threads.get({ botId: bot.id })).messages.filter((row) => row.role === "bot" && row.deliveryState === "complete");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.blocks).toMatchObject([{ kind: "text", text: "Voilà la capture." }, { kind: "image", alt: "The screen" }]);
  });

  it("keeps links on the reply and adds the preview later, without holding the reply", async () => {
    let resolvePreview!: (value: import("../src/harness/chat-outputs.js").FetchedPreview | null) => void;
    const fetched: string[] = [];
    const { harness, turns, events } = setup({ fetchLinkPreview: (url) => { fetched.push(url); return new Promise((resolve) => { resolvePreview = resolve; }); } });
    const bot = await harness.bots.create({ name: "Vega" });
    await harness.threads.send({ botId: bot.id }, { text: "Any news?" });
    say(turns[0]!, "Yes: see https://app.bizos.lol/d/routine/r_1 and [the article](https://example.com/post).");
    end(turns[0]!);
    const before = (await harness.threads.get({ botId: bot.id })).messages.find((row) => row.role === "bot" && row.deliveryState === "complete")!;
    expect(before.links).toEqual([
      { label: "https://app.bizos.lol/d/routine/r_1", url: "https://app.bizos.lol/d/routine/r_1" },
      { label: "the article", url: "https://example.com/post" },
    ]);
    expect(before.preview).toBeUndefined();
    expect(fetched).toEqual(["https://example.com/post"]);

    resolvePreview({ url: "https://example.com/post", domain: "example.com", title: "A post", description: "About things", image: { contentType: "image/png", bytes: png(600, 400), width: 600, height: 400 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = (await harness.threads.get({ botId: bot.id })).messages.find((row) => row.id === before.id)!;
    expect(after.preview).toMatchObject({ url: "https://example.com/post", domain: "example.com", title: "A post", image: { contentType: "image/png", width: 600, height: 400, size: 33 } });
    expect(after.preview!.image!.path).toContain(join("state", "previews"));
    expect(events.some((event) => event.type === "thread.message.updated" && event.message.id === before.id && event.message.preview)).toBe(true);
    // The card's text stays what it was: the words never changed.
    expect(after.blocks).toEqual(before.blocks);
  });

  it("weighs a permission card and lets a question through untouched", async () => {
    const { harness, turns } = setup();
    const bot = await harness.bots.create({ name: "Vega" });
    await harness.threads.send({ botId: bot.id }, { text: "Clean the build" });
    emit(turns[0]!, { type: "request.opened", requestId: "req_1", requestType: "permission", tool: "shell", summary: "rm -rf dist", detail: "rm -rf dist", detailText: "rm -rf dist" });
    emit(turns[0]!, { type: "request.opened", requestId: "req_2", requestType: "question", tool: "ask", summary: "Which account?", detail: "q", choices: ["Personal", "Company"] });
    const control = (await harness.threads.get({ botId: bot.id })).messages.find((row) => row.role === "bot")!;
    const asks = control.blocks.filter((block) => block.kind === "ask");
    expect(asks[0]).toMatchObject({ requestType: "permission", summary: "Allow Vega to run a command on this Mac?", action: "Delete files", target: "rm -rf dist", impact: "high", reversible: false, allowAlways: false, details: { kind: "command", text: "rm -rf dist" } });
    expect(asks[1]).toMatchObject({ requestType: "question", summary: "Which account?", choices: [{ value: "Personal", label: "Personal" }, { value: "Company", label: "Company" }] });
    expect(asks[1]).not.toHaveProperty("impact");
  });
});

describe("skip-all is one global switch", () => {
  it("auto-allows every driver permission and the runtime's own computer ask, while questions still reach the person", async () => {
    const { harness, turns } = setup();
    await harness.runtime.setPermissions({ permissions: "skip-all" });
    const bot = await harness.bots.create({ name: "Vega" });
    await harness.threads.send({ botId: bot.id }, { text: "Go" });
    // The codex / claude drivers consult `isAlwaysAllowed` before raising a card.
    expect(turns[0]!.skipPermissions).toBe(true);
    expect(turns[0]!.isAlwaysAllowed!({ requestType: "permission", tool: "shell", detail: "rm -rf /" })).toBe(true);
    // The runtime's own card (the agent's computer) is answered the same way: no card, no wait.
    const dispatcher = (harness as unknown as { dispatcher: { askLocally(input: { botId: string; summary: string; approvalKey: string }): Promise<boolean> } }).dispatcher;
    await expect(dispatcher.askLocally({ botId: bot.id, summary: "Allow Vega to act on github.com?", approvalKey: `${bot.id}|permission|computer|github.com` })).resolves.toBe(true);
    const control = (await harness.threads.get({ botId: bot.id })).messages.find((row) => row.role === "bot")!;
    expect(control.blocks.some((block) => block.kind === "ask")).toBe(false);
    expect(control.blocks.some((block) => block.kind === "meta" && /permission/i.test(block.text))).toBe(true);

    // Back to `ask`: the same question waits for a card again.
    await harness.runtime.setPermissions({ permissions: "ask" });
    let settled = false;
    void dispatcher.askLocally({ botId: bot.id, summary: "Allow Vega to act on github.com?", approvalKey: `${bot.id}|permission|computer|github.com` }).then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    const again = (await harness.threads.get({ botId: bot.id })).messages.find((row) => row.role === "bot")!;
    expect(again.blocks.find((block) => block.kind === "ask")).toMatchObject({ tool: "computer", status: "pending", impact: "medium", allowAlways: true });
  });
});

describe("sidecar contract", () => {
  it("keeps `content` exactly as before and adds attachments, links, preview and the weighed ask beside it", async () => {
    const { harness, facade, turns } = setup();
    const bot = await harness.bots.create({ name: "Vega" });
    await harness.threads.send({ botId: bot.id }, { text: "Report?" });
    const workspace = (await harness.bots.list()).find((row) => row.id === bot.id)!.workspacePath!;
    writeFileSync(join(workspace, "Rapport.pdf"), "%PDF");
    writeFileSync(join(workspace, "chart.png"), png(20, 10));
    harness.sendToChat(await scopeOf(harness, bot), { files: [{ path: "chart.png", alt: "Chart" }, { path: "Rapport.pdf" }] });
    say(turns[0]!, "Here it is: [the source](https://example.com/src)");
    end(turns[0]!);

    const page = await facade.messagePage(`local:fixture:thread:bot:${bot.id}`, new URL("http://127.0.0.1/x"));
    const reply = page.messages.find((row) => row.role === "assistant")!;
    // What an older desktop reads: the words, nothing about the files.
    expect(reply.content).toBe("Here it is: [the source](https://example.com/src)");
    expect(reply.attachments).toEqual([
      { id: expect.stringMatching(/^att_/), kind: "image", fileName: "chart.png", contentType: "image/png", size: 33, width: 20, height: 10, alt: "Chart", path: join(workspace, "chart.png"), url: expect.stringMatching(/^\/api\/local\/attachments\/att_/), status: "ready" },
      { id: expect.stringMatching(/^att_/), kind: "file", fileName: "Rapport.pdf", contentType: "application/pdf", size: 4, path: join(workspace, "Rapport.pdf"), url: expect.stringMatching(/^\/api\/local\/attachments\/att_/), status: "ready" },
    ]);
    expect(reply.links).toEqual([{ label: "the source", url: "https://example.com/src" }]);
    expect(reply.preview).toBeUndefined();
    expect(reply.ask).toBeUndefined();
    // The served bytes come from the transcript's record, never from a request.
    const served = facade.attachment(reply.attachments![1]!.id);
    expect(served).toEqual({ path: join(workspace, "Rapport.pdf"), contentType: "application/pdf", size: 4 });
    expect(facade.attachment("att_unknown")).toBeNull();
    expect(facade.attachment("../etc/passwd")).toBeNull();
    // A person's own message has no attachments field at all.
    const mine = page.messages.find((row) => row.role === "user")!;
    expect(mine).not.toHaveProperty("attachments");
    expect(mine).not.toHaveProperty("links");
  });

  it("exposes the weight of a pending ask on the approvals endpoint", async () => {
    const { harness, facade, turns } = setup();
    const bot = await harness.bots.create({ name: "Vega" });
    await harness.threads.send({ botId: bot.id }, { text: "Send the emails" });
    emit(turns[0]!, { type: "request.opened", requestId: "req_1", requestType: "permission", tool: "send_email", summary: "send_email", detail: "mcp:send_email", detailText: 'send_email\n{"to":["a@example.com"]}' });
    const run = (await harness.runs.list({ limit: 1 }))[0]!;
    const { approvals } = await facade.approvals(`local:fixture:run:${run.id}`);
    expect(approvals[0]).toMatchObject({ requestType: "permission", tool: "send_email", action: "Send an email", target: "a@example.com", impact: "high", reversible: false, allowAlways: false, details: { kind: "recipients", items: ["a@example.com"] }, status: "pending" });
  });
});
