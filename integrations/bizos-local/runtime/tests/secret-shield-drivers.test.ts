import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeArgs } from "../src/harness/claude-driver.js";
import { buildAppServerArgs, startCodexTurn, type RuntimeEvent } from "../src/harness/codex-driver.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function script(source: string) {
  const root = mkdtempSync(join(tmpdir(), "shield-driver-"));
  roots.push(root);
  const cli = join(root, "cli.mjs");
  writeFileSync(cli, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  return { root, cli };
}

/** A fake `codex app-server` that records every request it receives. */
function fakeAppServer() {
  const { root, cli } = script("");
  const record = join(root, "requests.jsonl");
  writeFileSync(cli, `#!${process.execPath}
import readline from 'node:readline';import {appendFileSync} from 'node:fs';
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
appendFileSync(${JSON.stringify(record)}, JSON.stringify({argv:process.argv.slice(2)})+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);
appendFileSync(${JSON.stringify(record)}, JSON.stringify(r)+'\\n');
if(r.method==='config/read'){send({id:r.id,result:{config:{sandbox_workspace_write:{network_access:true,exclude_slash_tmp:true}}}});return;}
let result={};if(r.method==='thread/start')result={thread:{id:'fresh-thread'}};
if(r.method==='turn/start'){send({id:r.id,result:{}});send({method:'item/completed',params:{item:{type:'agentMessage',id:'reply',text:'ok',phase:'final_answer'}}});send({method:'turn/completed',params:{turn:{status:'completed'}}});return;}
if(r.id)send({id:r.id,result});});`, { mode: 0o700 });
  return { root, cli, requests: () => readFileSync(record, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) };
}

async function runTurn(input: Parameters<typeof startCodexTurn>[0]) {
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve) => {
    startCodexTurn({
      ...input,
      onEvent: (event) => {
        events.push(event);
        if (event.type === "turn.completed") resolve();
      },
    });
    setTimeout(resolve, 4_000).unref();
  });
  return events;
}

it("Claude gets deny rules for the protected paths, bounded turns keep their own settings", () => {
  const args = buildClaudeArgs({ cwd: "/work", text: "hi", sandbox: "workspace-write", protectedPaths: ["/state/providers.json"] });
  const settings = JSON.parse(args[args.indexOf("--settings") + 1]!) as { permissions: { deny: string[] } };
  expect(settings.permissions.deny).toContain("Read(//state/providers.json)");
  expect(settings.permissions.deny).toContain("Read(//state/providers.json/**)");
  const bypass = buildClaudeArgs({ cwd: "/work", text: "hi", sandbox: "workspace-write", skipPermissions: true, protectedPaths: ["/state/providers.json"] });
  expect(bypass).toContain("--dangerously-skip-permissions");
  expect(JSON.parse(bypass[bypass.indexOf("--settings") + 1]!)).toEqual(settings);
  const bounded = buildClaudeArgs({ cwd: "/work", text: "hi", sandbox: "read-only", boundedTools: true, protectedPaths: ["/state/providers.json"] });
  expect(JSON.parse(bounded[bounded.indexOf("--settings") + 1]!)).toEqual({ disableAllHooks: true });
  expect(bounded.filter((arg) => arg === "--settings")).toHaveLength(1);
});

it("codex strips every forwarded secret name from the agent's shell environment", () => {
  const args = buildAppServerArgs({
    team: { command: "node", args: ["team.mjs"], env: { LBZ_TOOLSET: "team" }, forwarded: { LBZ_TEAM_TICKET: "t-1" } },
    apps: { command: "node", args: ["apps.mjs"], env: {}, forwarded: { LBZ_APP_KEY: "k-1", LBZ_TEAM_TICKET: "t-1" } },
  } as never, { id: "or", name: "OpenRouter", baseUrl: "https://x", wireApi: "chat", envKey: "OPENROUTER_API_KEY", apiKey: "sk" } as never);
  const index = args.findIndex((arg) => arg.startsWith("shell_environment_policy.exclude="));
  expect(index).toBeGreaterThan(0);
  expect(args[index - 1]).toBe("-c");
  expect(args[index]).toBe('shell_environment_policy.exclude=["LBZ_TEAM_TICKET","LBZ_APP_KEY","OPENROUTER_API_KEY"]');
  expect(buildAppServerArgs({})).toEqual(["app-server"]);
});

it("a sandboxed codex turn starts its thread with the shield profile and sends no competing turn policy", async () => {
  const fake = fakeAppServer();
  const events = await runTurn({
    cli: fake.cli, cwd: fake.root, text: "hello", sandbox: "workspace-write", writableRoots: ["/Users/x/Clients"],
    protectedPaths: [join(fake.root, "local-harness.json")], environment: { PATH: process.env.PATH, TMPDIR: "/private/tmp/t" },
    onEvent: () => {},
  });
  expect(events.some((event) => event.type === "runtime.shield" && event.mode === "profile")).toBe(true);
  const requests = fake.requests();
  const threadStart = requests.find((request) => request.method === "thread/start") as { params: Record<string, unknown> };
  const config = threadStart.params.config as { default_permissions: string; permissions: Record<string, { filesystem: Record<string, string>; network: { enabled: boolean } }> };
  expect(config.default_permissions).toBe("bizos_shield");
  const profile = config.permissions.bizos_shield!;
  expect(profile.filesystem[join(fake.root, "local-harness.json")]).toBe("deny");
  expect(profile.filesystem["/Users/x/Clients"]).toBe("write");
  expect(profile.filesystem["/private/tmp/t"]).toBe("write");
  expect(profile.filesystem["/private/tmp"]).toBeUndefined();
  expect(profile.network).toEqual({ enabled: true });
  expect(threadStart.params.sandbox).toBe("workspace-write");
  const turnStart = requests.find((request) => request.method === "turn/start") as { params: Record<string, unknown> };
  expect(turnStart.params.sandboxPolicy).toBeUndefined();
  expect(turnStart.params.approvalPolicy).toBe("on-request");
  // config/read happened before the thread existed: the profile needs it.
  expect(requests.map((request) => request.method).filter(Boolean)).toEqual(["initialize", "initialized", "config/read", "thread/start", "turn/start"]);
});

it("without protected paths nothing changes: no config override, the per-turn policy as before", async () => {
  const fake = fakeAppServer();
  await runTurn({ cli: fake.cli, cwd: fake.root, text: "hello", sandbox: "workspace-write", environment: { PATH: process.env.PATH }, onEvent: () => {} });
  const requests = fake.requests();
  const threadStart = requests.find((request) => request.method === "thread/start") as { params: Record<string, unknown> };
  expect(threadStart.params.config).toBeUndefined();
  const turnStart = requests.find((request) => request.method === "turn/start") as { params: Record<string, unknown> };
  expect((turnStart.params.sandboxPolicy as { type: string }).type).toBe("workspaceWrite");
});

it("a skip-all codex turn keeps danger-full-access and is launched under the outer seatbelt on macOS", async () => {
  const fake = fakeAppServer();
  const events = await runTurn({
    cli: fake.cli, cwd: fake.root, text: "hello", sandbox: "workspace-write", skipPermissions: true,
    protectedPaths: [join(fake.root, "local-harness.json")], environment: { PATH: process.env.PATH }, onEvent: () => {},
  });
  const requests = fake.requests();
  const threadStart = requests.find((request) => request.method === "thread/start") as { params: Record<string, unknown> };
  expect(threadStart.params.sandbox).toBe("danger-full-access");
  expect(threadStart.params.config).toBeUndefined();
  const turnStart = requests.find((request) => request.method === "turn/start") as { params: Record<string, unknown> };
  expect((turnStart.params.sandboxPolicy as { type: string }).type).toBe("dangerFullAccess");
  const expected = process.platform === "darwin" ? "seatbelt" : "none";
  expect(events.find((event) => event.type === "runtime.shield")).toEqual({ type: "runtime.shield", mode: expected });
});
