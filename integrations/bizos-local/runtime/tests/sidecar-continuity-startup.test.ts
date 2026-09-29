import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Storage } from "../src/harness/storage.js";
import { ContinuityStore } from "../src/harness/continuity.js";

const runtime = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(runtime, "dist/sidecar.js");
const built = existsSync(script) && existsSync(join(runtime, "dist/agency-kit/lib/app.mjs"));

it.skipIf(!built)("starts with an os_x bridge without quarantining its existing link, transcript or outbox", async () => {
  const root = mkdtempSync(join(tmpdir(), "lbz-continuity-startup-"));
  const state = join(root, "state");
  const storage = new Storage(join(state, "runtime"));
  const store = new ContinuityStore(storage);
  const link = { conversationId: "conversation-original", installationId: "install-x", accountId: "owner-x", orgId: "org-x", workspaceId: "os_x" };
  store.link("bot:existing", link);
  const transcript = { id: "local-message", threadId: "bot:existing", seq: 1, role: "user", blocks: [{ kind: "text", text: "Unsent message" }], createdAt: "2026-09-29T00:00:00Z" };
  storage.appendNdjson(storage.threadPath("bot:existing"), transcript);
  store.capture(transcript as Parameters<typeof store.capture>[0]);
  store.effect("bot:existing", { id: "effect-original", tool: "schedule_routine", class: "mediated", state: "confirmed", generation: 1 });
  const before = readFileSync(storage.threadPath("bot:existing"), "utf8");
  const secret = randomBytes(32).toString("hex");
  let bridge: Server | undefined;
  let child: ChildProcess | undefined;
  let logs = "";
  try {
    bridge = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const token = createHmac("sha256", secret).update("os_x\0continuity").digest("hex");
      if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403); response.end(); return; }
      const { operation } = JSON.parse(Buffer.concat(chunks).toString()) as { operation: string };
      const result = operation === "status"
        ? { linked: false, workspaceId: "os_x", orgId: "org-x", userId: "owner-x", installationId: "install-x" }
        : operation === "conversations/list"
          ? { conversations: [{ conversationId: "conversation-duplicate", agentId: "ceo", audience: "private",
            title: "CEO", localConversationId: "bot:existing", workspaceId: "os_x" }] }
          : operation === "conversations/bind" ? { conversationId: "conversation-duplicate" }
          : null;
      response.writeHead(result ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify(result ? { ok: true, result } : { ok: false, code: "not_found" }));
    });
    await new Promise<void>(resolveListen => bridge!.listen(0, "127.0.0.1", resolveListen));
    const bridgePath = join(root, "bridge.json");
    writeFileSync(bridgePath, JSON.stringify({ version: 1, origin: `http://127.0.0.1:${(bridge.address() as { port: number }).port}`, workspaceId: "os_x", secret }));
    const home = join(root, "home");
    mkdirSync(home);
    const descriptorPath = join(root, "sidecar.json");
    child = spawn(process.execPath, [script, "serve"], { cwd: runtime, env: {
      HOME: home, PATH: "/usr/bin:/bin", TMPDIR: root, LOCALBIZOS_SIDECAR_STATE: state,
      LOCALBIZOS_SIDECAR_DESCRIPTOR: descriptorPath, LOCALBIZOS_NATIVE_COMPUTER_DESCRIPTOR: bridgePath,
    }, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr?.on("data", chunk => { logs += chunk.toString(); });
    const deadline = Date.now() + 30_000;
    while (!existsSync(descriptorPath) && Date.now() < deadline && child.exitCode === null)
      await new Promise(resolveWait => setTimeout(resolveWait, 50));
    expect(existsSync(descriptorPath), logs).toBe(true);
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as { origin: string; token: string };
    const autoLink = await fetch(new URL("/api/local/continuity/auto-link", descriptor.origin), {
      method: "POST", headers: { authorization: `Bearer ${descriptor.token}` },
    });
    expect(autoLink.status).toBe(200);
    const reopened = new ContinuityStore(storage);
    expect(reopened.status("bot:existing")?.conversationId).toBe(link.conversationId);
    expect(reopened.pending("bot:existing").map(event => event.content)).toEqual(["Unsent message"]);
    expect(reopened.effects("bot:existing").map(effect => effect.id)).toEqual(["effect-original"]);
    expect(reopened.links().some(row => row.link.conversationId === "conversation-duplicate")).toBe(false);
    expect(readFileSync(storage.threadPath("bot:existing"), "utf8")).toBe(before);
    expect(storage.readJsonStrict("continuity-quarantine.json", [])).toEqual([]);
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise(resolveExit => child!.once("exit", resolveExit));
    }
    if (bridge) await new Promise<void>(resolveClose => bridge!.close(() => resolveClose()));
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
