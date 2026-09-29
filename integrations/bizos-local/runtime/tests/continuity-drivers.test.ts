import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildClaudeArgs,
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
  expect(args).toContain("--safe-mode");
  expect(args).toContain("--strict-mcp-config");
  expect(args[args.indexOf("--tools") + 1]).toBe("");
  expect(args).not.toContain("--dangerously-skip-permissions");
});
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
