import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpServerSpec, RuntimeEvent } from "../src/harness/codex-driver.js";
import {
  buildCursorArgs,
  cursorMcpConfig,
  cursorMcpPermissions,
  cursorPreapprovedServers,
  startCursorTurn,
} from "../src/harness/cursor-driver.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lbz-cursor-driver-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function stdio(token: string): McpServerSpec {
  return {
    command: process.execPath,
    args: ["/private/server.mjs"],
    env: { FIXED_SETTING: "safe" },
    forwarded: { TURN_TOKEN: token },
    preApproved: true,
  };
}

describe("Cursor run-scoped MCP plugin", () => {
  it("writes environment references and exact plugin permissions without serializing secrets", () => {
    const servers: Record<string, McpServerSpec> = {
      bizos_computer: stdio("ticket-for-one-run"),
      hosted: {
        url: "https://mcp.example.invalid",
        headers: { "X-Public": "yes" },
        bearerTokenEnv: "HOSTED_TOKEN",
        forwarded: { HOSTED_TOKEN: "hosted-secret" },
        preApproved: true,
      },
    };
    const config = JSON.stringify(cursorMcpConfig(servers));
    expect(config).toContain("${env:TURN_TOKEN}");
    expect(config).toContain("Bearer ${env:HOSTED_TOKEN}");
    expect(config).not.toContain("ticket-for-one-run");
    expect(config).not.toContain("hosted-secret");
    expect(cursorMcpPermissions(servers)).toEqual([
      "Mcp(plugin-bizos-runtime-bizos_computer:*)",
      "Mcp(plugin-bizos-runtime-hosted:*)",
    ]);
  });

  it("keeps approval-gated servers off Cursor's no-card surface", () => {
    const mounted = cursorPreapprovedServers({
      bizos_computer: stdio("computer-ticket"),
      bizos_actions: { ...stdio("action-ticket"), preApproved: false },
    });
    expect(Object.keys(mounted)).toEqual(["bizos_computer"]);
    expect(JSON.stringify(mounted)).not.toContain("action-ticket");
  });

  it("never adds broad Cursor bypass flags", () => {
    const args = buildCursorArgs({
      cwd: "/workspace",
      text: "work",
      sandbox: "workspace-write",
      skipPermissions: true,
      pluginDir: "/private/plugin",
    });
    expect(args).toContain("--sandbox");
    expect(args).toContain("enabled");
    expect(args).toContain("--plugin-dir");
    expect(args).not.toContain("--force");
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("--approve-mcps");
  });

  it("isolates two concurrent turn profiles, canonicalizes the workspace and cleans both", async () => {
    const workspace = join(root, "workspace");
    const workspaceLink = join(root, "workspace-link");
    mkdirSync(workspace);
    const sentinel = cliConfigSentinel(workspace);
    symlinkSync(workspace, workspaceLink);

    const run = async (name: string, token: string) => {
      const log = join(root, `${name}.json`);
      const cli = join(root, `${name}-cursor`);
      writeFileSync(
        cli,
        `#!${process.execPath}\n` +
          `const fs=require("node:fs"),path=require("node:path");\n` +
          `const args=process.argv.slice(2);\n` +
          `const plugin=args[args.indexOf("--plugin-dir")+1];\n` +
          `const profile=process.env.CURSOR_CONFIG_DIR;\n` +
          `fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({args,plugin,profile,token:${JSON.stringify(token)}===process.env.TURN_TOKEN,mcp:fs.readFileSync(path.join(plugin,"mcp.json"),"utf8"),mcpMode:fs.statSync(path.join(plugin,"mcp.json")).mode&0o777,configMode:fs.statSync(path.join(profile,"cli-config.json")).mode&0o777}));\n` +
          `process.stdout.write(JSON.stringify({type:"system",subtype:"init",session_id:${JSON.stringify(name)},model:"fixture"})+"\\n");\n` +
          `setTimeout(()=>{process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"ok"})+"\\n");},25);\n`,
        { mode: 0o700 },
      );
      chmodSync(cli, 0o700);
      const events: RuntimeEvent[] = [];
      await new Promise<void>((resolve) => {
        startCursorTurn({
          cli,
          cwd: workspaceLink,
          text: "fixture",
          sandbox: "workspace-write",
          resumeCursor: "must-not-cross-profile",
          environment: { PATH: dirname(process.execPath), PROBE_NAME: name },
          pathOverride: dirname(process.execPath),
          mcpServers: { bizos_computer: stdio(token) },
          onEvent: event => {
            events.push(event);
            if (event.type === "turn.completed") resolve();
          },
        });
      });
      expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
      return JSON.parse(readFileSync(log, "utf8")) as {
        args: string[];
        plugin: string;
        profile: string;
        token: boolean;
        mcp: string;
        mcpMode: number;
        configMode: number;
      };
    };

    const [first, second] = await Promise.all([
      run("session-a", "ticket-a"),
      run("session-b", "ticket-b"),
    ]);
    expect(first.plugin).not.toBe(second.plugin);
    expect(first.profile).not.toBe(second.profile);
    for (const result of [first, second]) {
      expect(result.token).toBe(true);
      expect(result.mcp).toContain("${env:TURN_TOKEN}");
      expect(result.mcp).not.toMatch(/ticket-[ab]/);
      expect(result.mcpMode).toBe(0o600);
      expect(result.configMode).toBe(0o600);
      expect(result.args).toContain(realpathSync(workspace));
      expect(result.args).not.toContain("must-not-cross-profile");
      expect(existsSync(result.plugin)).toBe(false);
      expect(existsSync(result.profile)).toBe(false);
    }
    expect(lstatSync(workspaceLink).isSymbolicLink()).toBe(true);
    expect(readFileSync(sentinel, "utf8")).toBe("untouched");
  });
});

function cliConfigSentinel(workspace: string): string {
  const cursor = join(workspace, ".cursor");
  mkdirSync(cursor, { recursive: true });
  const sentinel = join(cursor, "sentinel");
  if (!existsSync(sentinel)) writeFileSync(sentinel, "untouched");
  return sentinel;
}
