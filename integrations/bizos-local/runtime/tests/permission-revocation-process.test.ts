import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { waitForCliShutdown } from "../src/harness/procs.js";

it.skipIf(process.platform === "win32")("does not confirm revocation while a real detached CLI descendant is still exiting", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lbz-revoke-process-")));
  const ready = join(root, "ready.json");
  const cli = join(root, "fixture-codex.mjs");
  // Fictitious JSON-RPC process: no account, network or user-profile access.
  const descendant = `process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),350));process.send('ready');setInterval(()=>{},1000);`;
  writeFileSync(cli, `#!${process.execPath}
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);
 if(r.id!==undefined)send({id:r.id,result:r.method.startsWith('thread/')?{thread:{id:'synthetic-thread'}}:{}});
 if(r.method==='turn/start'){
  const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
  child.on('message',()=>writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:child.pid})));
 }
});
`, { mode: 0o700 });
  const harness = new LocalBizosHarness({ rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Synthetic",
    execPath: process.execPath, packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"),
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: cli }, devices: false, linkPreviews: false, localTeamTools: () => [],
  });
  try {
    await harness.runtime.setPermissions({ permissions: "skip-all" });
    const bot = await harness.bots.create({ name: "Synthetic" });
    const { runIds } = await harness.threads.send({ botId: bot.id }, { text: "Synthetic test" });
    await vi.waitFor(() => expect(existsSync(ready)).toBe(true));
    const { pid } = JSON.parse(readFileSync(ready, "utf8")) as { pid: number };
    let confirmed = false;
    const revoking = harness.runtime.setPermissions({ permissions: "ask" }).then(result => { confirmed = true; return result; });
    await vi.waitFor(async () => expect((await harness.runs.get(runIds[0]!))!.state).toBe("cancelled"));
    expect(() => process.kill(pid, 0)).not.toThrow();
    expect(confirmed).toBe(false);
    expect((await harness.runtime.getSettings()).permissionTransition?.effect).toBe("revoking");
    await expect(revoking).resolves.toMatchObject({ permissionTransition: { effect: "revoked", stoppedRunIds: runIds } });
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  } finally {
    harness.stop();
    await waitForCliShutdown();
    rmSync(root, { recursive: true, force: true });
  }
});
