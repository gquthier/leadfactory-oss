import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { seatbeltAvailable } from "../src/harness/secret-shield.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildClaudeArgs,
  claudeMcpInitFailure,
  startClaudeTurn,
} from "../src/harness/claude-driver.js";
import {
  startCodexTurn,
  type CodexTurnHandle,
  type RuntimeEvent,
} from "../src/harness/codex-driver.js";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function script(source: string) {
  const root = mkdtempSync(join(tmpdir(), "continuity-driver-"));
  roots.push(root);
  const cli = join(root, "cli.mjs");
  writeFileSync(cli, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  return { root, cli };
}
it("bounded Claude cannot inherit bypass, native tools, plugins or hooks", () => {
  const args = buildClaudeArgs({
    cwd: "/fixture",
    text: "hello",
    sandbox: "workspace-write",
    skipPermissions: true,
    boundedTools: true,
    mcpConfigPath: "/fixture/mcp.json",
  });
  expect(args).toContain("--restricted");
  // `--safe-mode` also disables the --mcp-config servers: the linked CEO
  // then had no recruit_agent at all (.51/.52 regression).
  expect(args).not.toContain("--safe-mode");
  expect(args).toContain("--strict-mcp-config");
  expect(args[args.indexOf("--mcp-config") + 1]).toBe("/fixture/mcp.json");
  expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
  expect(args).toContain("--disable-slash-commands");
  expect(args[args.indexOf("--tools") + 1]).toBe("");
  expect(args).not.toContain("--dangerously-skip-permissions");
  expect(args[args.indexOf("--permission-mode") + 1]).toBe("manual");
});

it("names the missing or unconnected team server in a Claude init frame", () => {
  const tools = ["mcp__local_team_actions__recruit_agent"];
  expect(claudeMcpInitFailure({ tools, mcp_servers: [{ name: "local_team_actions", status: "connected" }] }, ["local_team_actions"])).toBeNull();
  // Exactly what `--safe-mode` produced with claude 2.1.280–2.1.285.
  expect(claudeMcpInitFailure({ tools: [], mcp_servers: [] }, ["local_team_actions"])).toBe("local_team_actions: missing");
  expect(claudeMcpInitFailure({ tools: [], mcp_servers: [{ name: "local_team_actions", status: "failed" }] }, ["local_team_actions"])).toBe("local_team_actions: failed");
  expect(claudeMcpInitFailure({ tools: [], mcp_servers: [{ name: "local_team_actions", status: "connected" }] }, ["local_team_actions"])).toBe("local_team_actions: no tools");
});

/** A fake `claude` that answers init with the given MCP surface, after
 * checking that its --mcp-config is readable, then reports whether the
 * harness deleted that file once init was seen. */
function boundedCli(initFrame: string) {
  const f = script("");
  const observed = join(f.root, "observed.json");
  writeFileSync(f.cli, `#!${process.execPath}\nimport fs from 'node:fs';import readline from 'node:readline';
const args=process.argv.slice(2);const config=args[args.indexOf('--mcp-config')+1];
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const servers=Object.keys(JSON.parse(fs.readFileSync(config,'utf8')).mcpServers);
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);
if(r.type==='control_request')send({type:'control_response',response:{subtype:'success',request_id:r.request_id}});
if(r.type==='user'){send(${initFrame});setTimeout(()=>{fs.writeFileSync(${JSON.stringify(observed)},JSON.stringify({args,servers,configAfterInit:fs.existsSync(config)}));
send({type:'assistant',message:{id:'m1',role:'assistant',content:[{type:'text',text:'Nina recrutée.'}],stop_reason:'end_turn'}});
send({type:'result',subtype:'success',result:'Nina recrutée.'});},150);}});`, { mode: 0o700 });
  return { ...f, observed };
}

async function runBounded(cli: string, root: string): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("driver timeout")), 5000);
    startClaudeTurn({
      cli, cwd: root, text: "Recrute TEST53 Nina", system: "CEO", sandbox: "read-only", boundedTools: true,
      mcpServers: { local_team_actions: { command: process.execPath, args: ["team.mjs"], env: {}, forwarded: { LBZ_LOCAL_TEAM_TICKET: "one-shot" }, preApproved: true } },
      mcpConfigDir: join(root, "mcp"),
      environment: { PATH: process.env.PATH, HOME: root },
      onEvent: (event) => { events.push(event); if (event.type === "turn.completed") { clearTimeout(timer); resolve(); } },
    });
  });
  return events;
}

it("a linked (bounded) Claude turn verifies its team tools, then deletes the MCP config before acting", async () => {
  const f = boundedCli(`{type:'system',subtype:'init',session_id:'s',tools:['mcp__local_team_actions__recruit_agent','mcp__local_team_actions__schedule_routine'],mcp_servers:[{name:'local_team_actions',status:'connected',source:'dynamic'}]}`);
  const events = await runBounded(f.cli, f.root);
  const observed = JSON.parse(readFileSync(f.observed, "utf8")) as { args: string[]; servers: string[]; configAfterInit: boolean };
  expect(observed.servers).toEqual(["local_team_actions"]);
  expect(observed.args).not.toContain("--safe-mode");
  expect(observed.args[observed.args.indexOf("--allowedTools") + 1]).toBe("mcp__local_team_actions");
  expect(observed.configAfterInit).toBe(false);
  expect(events).toContainEqual({ type: "capabilities.verified", supervised: true, tools: ["mcp__local_team_actions__recruit_agent", "mcp__local_team_actions__schedule_routine"] });
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
});

it("a linked Claude turn whose init shows no team server fails visibly instead of answering without tools", async () => {
  const f = boundedCli(`{type:'system',subtype:'init',session_id:'s',tools:[],mcp_servers:[]}`);
  const events = await runBounded(f.cli, f.root);
  expect(events.some((event) => event.type === "capabilities.verified")).toBe(false);
  expect(events).toContainEqual(expect.objectContaining({ type: "runtime.error", message: expect.stringContaining("local_team_actions: missing") }));
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason: "mcp_tools_unavailable" });
  expect(existsSync(f.observed)).toBe(false);
  expect(readdirSync(join(f.root, "mcp"))).toEqual([]);
});

// Contract with the REAL CLI (opt-in: LBZ_REAL_CLAUDE_CLI=/path/to/claude).
// An empty CLAUDE_CONFIG_DIR: no account, no user MCP server, and the turn
// stops at init, so no prompt reaches a model.
function realTeamServer(root: string): string {
  const server = join(root, "team-server.mjs");
  writeFileSync(server, `import fs from 'node:fs';import readline from 'node:readline';const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
if(m.method==='initialize'){fs.writeFileSync(${JSON.stringify(join(root, "server-started"))},'1');send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'t',version:'1'}}});}
else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'recruit_agent',description:'Recruit',inputSchema:{type:'object',properties:{}}}]}});
else if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,result:{}});});`);
  return server;
}

async function runReal(root: string, options: { boundedTools?: boolean; skipPermissions?: boolean; protectedPaths?: string[] }): Promise<RuntimeEvent[]> {
  const configDir = join(root, "claude-config");
  mkdirSync(configDir, { recursive: true });
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("real CLI timeout")), 60_000);
    const handle = startClaudeTurn({
      cli: process.env.LBZ_REAL_CLAUDE_CLI!, cwd: root, text: "Reply OK.", sandbox: "read-only", model: "haiku", configDir, ...options,
      mcpServers: { local_team_actions: { command: process.execPath, args: [realTeamServer(root)], env: {}, forwarded: {}, preApproved: true } },
      mcpConfigDir: join(root, "mcp"),
      environment: { PATH: process.env.PATH, HOME: root },
      onEvent: (event) => {
        events.push(event);
        if (event.type === "session.started" || event.type === "capabilities.verified" || event.type === "runtime.error") handle.stop();
        if (event.type === "turn.completed") { clearTimeout(timer); resolve(); }
      },
    });
  });
  return events;
}

it.skipIf(!process.env.LBZ_REAL_CLAUDE_CLI)("the real claude CLI loads the team MCP server with the bounded argv", async () => {
  const f = script("");
  const events = await runReal(f.root, { boundedTools: true });
  expect(events).toContainEqual({ type: "capabilities.verified", supervised: true, tools: ["mcp__local_team_actions__recruit_agent"] });
  expect(readdirSync(join(f.root, "mcp"))).toEqual([]);
}, 70_000);

it.skipIf(!process.env.LBZ_REAL_CLAUDE_CLI || !seatbeltAvailable())("the real claude CLI still reads its MCP config under the « never ask » seatbelt", async () => {
  const f = script("");
  mkdirSync(join(f.root, "mcp"), { recursive: true });
  const events = await runReal(f.root, { skipPermissions: true, protectedPaths: [join(f.root, "mcp")] });
  expect(events.filter((event) => event.type === "runtime.error")).toEqual([]);
  expect(events.some((event) => event.type === "session.started")).toBe(true);
  expect(existsSync(join(f.root, "server-started"))).toBe(true);
  expect(readdirSync(join(f.root, "mcp"))).toEqual([]);
}, 70_000);
it("Claude sends a private 0600 prompt file, never argv persona or resume, and removes it after a turn", async () => {
  const f = script("");
  const observedPath = join(f.root, "observed.json");
  const source = `import fs from 'node:fs';import pathModule from 'node:path';import readline from 'node:readline';
const args=process.argv.slice(2);const path=args[args.indexOf('--append-system-prompt-file')+1];
fs.writeFileSync(${JSON.stringify(observedPath)},JSON.stringify({args,path,prompt:fs.readFileSync(path,'utf8'),mode:fs.statSync(path).mode&0o777,dirMode:fs.statSync(pathModule.dirname(path)).mode&0o777}));
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.type==='control_request')send({type:'control_response',response:{subtype:'success',request_id:r.request_id}});if(r.type==='user')send({type:'result',subtype:'success',result:'Done',session_id:'native-secret-session'});});`;
  writeFileSync(f.cli, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("driver timeout")), 3000);
    startClaudeTurn({ cli: f.cli, cwd: f.root, text: "Synthetic request", system: "Private BizOS persona", resumeCursor: "old-session", sandbox: "read-only", environment: { PATH: process.env.PATH }, onEvent: event => {
      events.push(event);
      if (event.type === "turn.completed") { clearTimeout(timer); resolve(); }
    } });
  });
  const observed = JSON.parse(readFileSync(observedPath, "utf8")) as { args: string[]; path: string; prompt: string; mode: number; dirMode: number };
  expect(observed.args).toContain("--no-session-persistence");
  expect(observed.args).toContain("--append-system-prompt-file");
  expect(observed.args).not.toContain("--resume");
  expect(observed.args.join(" ")).not.toContain("Private BizOS persona");
  expect(observed.prompt).toBe("Private BizOS persona");
  expect(observed.mode).toBe(0o600);
  expect(observed.dirMode).toBe(0o700);
  expect(existsSync(observed.path)).toBe(false);
  expect(events.find(event => event.type === "session.started")).toMatchObject({ sessionId: null });
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
});
it("Claude removes its private prompt immediately when the turn is stopped", async () => {
  const f = script("");
  const observedPath = join(f.root, "prompt-path.txt");
  writeFileSync(f.cli, `#!${process.execPath}\nimport fs from 'node:fs';
const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(observedPath)},args[args.indexOf('--append-system-prompt-file')+1]);
process.stdin.resume();`, { mode: 0o700 });
  const events: RuntimeEvent[] = [];
  const handle = startClaudeTurn({ cli: f.cli, cwd: f.root, text: "Synthetic request", system: "Synthetic private persona", sandbox: "read-only", environment: { PATH: process.env.PATH }, onEvent: event => events.push(event) });
  await vi.waitFor(() => expect(existsSync(observedPath)).toBe(true));
  const path = readFileSync(observedPath, "utf8");
  expect(existsSync(path)).toBe(true);
  handle.stop();
  expect(existsSync(path)).toBe(false);
  await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason: "interrupted" }), { timeout: 4000 });
});
it("Claude removes its private prompt when spawning the CLI fails", async () => {
  const privateDirs = () => readdirSync(tmpdir()).filter(name => name.startsWith("bizos-claude-prompt-"));
  const before = new Set(privateDirs());
  const f = script("");
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("spawn failure timeout")), 3000);
    startClaudeTurn({ cli: join(f.root, "missing-cli"), cwd: f.root, text: "Synthetic request", system: "Synthetic private persona", sandbox: "read-only", environment: { PATH: process.env.PATH }, onEvent: event => {
      events.push(event);
      if (event.type === "turn.completed") { clearTimeout(timer); resolve(); }
    } });
  });
  expect(privateDirs().filter(name => !before.has(name))).toEqual([]);
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false });
});
it("Claude publishes a result-only terminal answer", async () => {
  const f = script(`import readline from 'node:readline';const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.type==='control_request')send({type:'control_response',response:{subtype:'success',request_id:r.request_id}});if(r.type==='user')send({type:'result',subtype:'success',result:'Le fichier a été créé.',session_id:'session'});});`);
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("driver timeout")), 3000);
    startClaudeTurn({ cli: f.cli, cwd: f.root, text: "Create it", sandbox: "read-only", environment: { PATH: process.env.PATH }, onEvent: event => {
      events.push(event);
      if (event.type === "turn.completed") { clearTimeout(timer); resolve(); }
    } });
  });
  expect(events).toContainEqual(expect.objectContaining({ type: "item.completed", itemType: "assistant_text", text: "Le fichier a été créé.", phase: "final_answer" }));
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
});
it("Claude reports an explicit failure when it ends after announcing an action without a final result or permission", async () => {
  const f = script(`import readline from 'node:readline';const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.type==='control_request')send({type:'control_response',response:{subtype:'success',request_id:r.request_id}});if(r.type==='user'){send({type:'assistant',message:{id:'announced',role:'assistant',stop_reason:'tool_use',content:[{type:'text',text:'Je vais tenter de créer ce fichier…'}]}});send({type:'result',subtype:'success',result:'Je vais tenter de créer ce fichier…',session_id:'session'});}});`);
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("driver timeout")), 3000);
    startClaudeTurn({ cli: f.cli, cwd: f.root, text: "Create it", sandbox: "read-only", environment: { PATH: process.env.PATH }, onEvent: event => {
      events.push(event);
      if (event.type === "turn.completed") { clearTimeout(timer); resolve(); }
    } });
  });
  expect(events.find(event => event.type === "runtime.error")).toMatchObject({
    message: expect.stringMatching(/sans résultat final|without a final result/i),
  });
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false });
});
it("Claude accepts an empty end_turn after a successful tool result", async () => {
  const f = script(`import readline from 'node:readline';const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.type==='control_request')send({type:'control_response',response:{subtype:'success',request_id:r.request_id}});if(r.type==='user'){send({type:'assistant',message:{id:'action',role:'assistant',stop_reason:'tool_use',content:[{type:'text',text:'Je crée la routine.'},{type:'tool_use',id:'tool-1',name:'mcp__local__schedule_routine',input:{}}]}});send({type:'user',parent_tool_use_id:'tool-1',message:{role:'user',content:[{type:'tool_result',tool_use_id:'tool-1',content:'Routine créée.'}]}});send({type:'assistant',message:{id:'done',role:'assistant',stop_reason:'end_turn',content:[]}});send({type:'result',subtype:'success',result:'',session_id:'session'});}});`);
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("driver timeout")), 3000);
    startClaudeTurn({ cli: f.cli, cwd: f.root, text: "Create routine", sandbox: "read-only", environment: { PATH: process.env.PATH }, onEvent: event => {
      events.push(event);
      if (event.type === "turn.completed") { clearTimeout(timer); resolve(); }
    } });
  });
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
  expect(events.some(event => event.type === "runtime.error")).toBe(false);
});
it("Claude projects a native file permission before the turn can finish", async () => {
  const f = script(`import readline from 'node:readline';const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.type==='control_request'&&r.request?.subtype==='initialize'){send({type:'control_response',response:{subtype:'success',request_id:r.request_id}});return;}if(r.type==='user'){send({type:'assistant',message:{id:'announced',role:'assistant',stop_reason:'tool_use',content:[{type:'text',text:'Je vais créer le fichier.'}]}});send({type:'control_request',request_id:'permission-write',request:{subtype:'can_use_tool',tool_name:'Write',input:{file_path:'/fixture/report.md',content:'ok'}}});return;}if(r.type==='control_response'&&r.response?.request_id==='permission-write'){send({type:'assistant',message:{id:'done',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:'Le fichier est créé.'}]}});send({type:'result',subtype:'success',result:'Le fichier est créé.',session_id:'session'});}});`);
  const events: RuntimeEvent[] = [];
  let handle: CodexTurnHandle;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("driver timeout")), 3000);
    handle = startClaudeTurn({ cli: f.cli, cwd: f.root, text: "Create it", sandbox: "workspace-write", environment: { PATH: process.env.PATH }, onEvent: event => {
      events.push(event);
      if (event.type === "request.opened") handle.respond(event.requestId, { behavior: "allow" });
      if (event.type === "turn.completed") { clearTimeout(timer); resolve(); }
    } });
  });
  expect(events).toContainEqual(expect.objectContaining({
    type: "request.opened", requestId: "permission-write", requestType: "permission", tool: "Write",
  }));
  expect(events).toContainEqual(expect.objectContaining({
    type: "request.resolved", requestId: "permission-write", behavior: "allow", source: "user",
  }));
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
});
it("Claude init is not a payload receipt, and unexpected native tool exposure fails before it can act", async () => {
  const f = script(
    `import readline from 'node:readline';const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.type==='control_request')send({type:'control_response',response:{subtype:'success',request_id:r.request_id}});if(r.type==='user'){send({type:'system',subtype:'init',session_id:'unexpected-native-session',tools:['Bash']});}});`,
  );
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("driver timeout")), 3000);
    startClaudeTurn({
      cli: f.cli,
      cwd: f.root,
      text: "Correction from archive",
      system: "archive",
      sandbox: "read-only",
      boundedTools: true,
      environment: { PATH: process.env.PATH, HOME: f.root },
      onEvent: (e) => {
        events.push(e);
        if (e.type === "turn.completed") {
          clearTimeout(timer);
          resolve();
        }
      },
    });
  });
  expect(events.some((e) => e.type === "context.sent")).toBe(true);
  expect(events.some((e) => e.type === "context.confirmed")).toBe(false);
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false });
});
it("Codex ignores a stored cursor and sends the portable archive to a fresh ephemeral thread", async () => {
  const f = script(
    `import readline from 'node:readline';const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='thread/resume'){send({id:r.id,error:{message:'missing thread'}});return;}let result={};if(r.method==='thread/start')result={thread:{id:'fresh-thread'}};if(r.method==='turn/start'){const text=r.params.input[0].text;send({id:r.id,result:{}});send({method:'item/completed',params:{item:{type:'agentMessage',id:'reply',text,phase:'final_answer'}}});send({method:'turn/completed',params:{turn:{status:'completed'}}});return;}if(r.id)send({id:r.id,result});});`,
  );
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("driver timeout")), 3000);
    startCodexTurn({
      cli: f.cli,
      cwd: f.root,
      text: "latest request",
      system: "FULL ARCHIVE old correction EUR 9",
      resumedSystem: "delta only",
      resumeCursor: "deleted-cursor",
      sandbox: "read-only",
      environment: { PATH: process.env.PATH, HOME: f.root },
      onEvent: (e) => {
        events.push(e);
        if (e.type === "turn.completed") {
          clearTimeout(timer);
          resolve();
        }
      },
    });
  });
  const answer = events.find(
    (e) => e.type === "item.completed" && e.itemType === "assistant_text",
  );
  expect(answer).toMatchObject({
    text: expect.stringContaining("old correction EUR 9"),
  });
  expect(events.find((e) => e.type === "session.started")).toMatchObject({
    sessionId: null,
    resumed: false,
  });
  const sent = events.findIndex((e) => e.type === "context.sent");
  expect(sent).toBeGreaterThan(-1);
  expect(
    events.findIndex((e) => e.type === "context.confirmed"),
  ).toBeGreaterThan(sent);
});
it("Codex stops before sending a prompt when ephemeral thread creation is rejected", async () => {
  const f = script(`import readline from 'node:readline';const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')send({id:r.id,result:{}});if(r.method==='thread/start')send({id:r.id,error:{message:'ephemeral threads unsupported'}});if(r.method==='turn/start')send({id:r.id,result:{}});});`);
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("driver timeout")), 3000);
    startCodexTurn({ cli: f.cli, cwd: f.root, text: "Synthetic private prompt", system: "Synthetic persona", sandbox: "read-only", retryScale: 0.001, environment: { PATH: process.env.PATH }, onEvent: event => {
      events.push(event);
      if (event.type === "turn.completed") { clearTimeout(timer); resolve(); }
    } });
  });
  expect(events.some(event => event.type === "context.sent")).toBe(false);
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false });
});
