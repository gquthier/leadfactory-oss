import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildClaudeArgs,
  startClaudeTurn,
} from "../src/harness/claude-driver.js";
import {
  startCodexTurn,
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
it("failed Codex resume sends the entire portable archive to fresh thread before confirming ingestion", async () => {
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
    sessionId: "fresh-thread",
    resumed: false,
  });
  const sent = events.findIndex((e) => e.type === "context.sent");
  expect(sent).toBeGreaterThan(-1);
  expect(
    events.findIndex((e) => e.type === "context.confirmed"),
  ).toBeGreaterThan(sent);
});
