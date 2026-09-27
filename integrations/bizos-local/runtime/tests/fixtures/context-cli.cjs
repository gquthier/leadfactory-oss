// Protocol fixture only. It performs no inference/login and contacts only the
// loopback sidecar capability supplied to its real stdio MCP child.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
if (process.argv.includes("--version")) {
  console.log("Claude Code context-test fixture");
  process.exit(0);
}
if (process.argv[2] === "auth") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.type === "control_request") {
    send({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: message.request_id,
        response: {},
      },
    });
    return;
  }
  if (message.type !== "user") return;
  let mcp;
  try {
    const config = JSON.parse(
      fs.readFileSync(
        process.argv[process.argv.indexOf("--mcp-config") + 1],
        "utf8",
      ),
    );
    const spec = Object.values(config.mcpServers).find((server) =>
      server.args.some((arg) => arg.includes("local-team-mcp.js")),
    );
    if (!spec) throw new Error("No real local-team MCP mounted");
    mcp = spawn(spec.command, spec.args, {
      env: { PATH: "/usr/bin:/bin", ...spec.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let seq = 0;
    const pending = new Map();
    createInterface({ input: mcp.stdout }).on("line", (line) => {
      const answer = JSON.parse(line);
      const resolve = pending.get(answer.id);
      if (resolve) {
        pending.delete(answer.id);
        resolve(answer);
      }
    });
    const call = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => reject(new Error("MCP timeout")), 10000);
        pending.set(id, (answer) => {
          clearTimeout(timer);
          resolve(answer);
        });
        mcp.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
        );
      });
    await call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "fixture", version: "1" },
    });
    const tools = await call("tools/list", {});
    const list = await call("tools/call", {
      name: "list_context_directory",
      arguments: { path: "", limit: 100 },
    });
    const read = await call("tools/call", {
      name: "read_context_file",
      arguments: { path: "notes é.txt", maxBytes: 64 },
    });
    const escape = await call("tools/call", {
      name: "read_context_file",
      arguments: { path: "../outside.txt" },
    });
    const replay = await fetch(
      new URL(
        "/api/internal/local-team/exchange",
        spec.env.LOCALBIZOS_TEAM_ORIGIN,
      ),
      {
        method: "POST",
        headers: { authorization: `Bearer ${spec.env.LBZ_LOCAL_TEAM_TICKET}` },
      },
    );
    fs.writeFileSync(
      path.join(__dirname, "context-proof.json"),
      JSON.stringify({
        tools,
        list,
        read,
        escape,
        replayStatus: replay.status,
        cwd: process.cwd(),
      }),
      { mode: 0o600 },
    );
    mcp.stdin.end();
    send({
      type: "result",
      subtype: "success",
      result: "Context fixture complete",
      session_id: "fixture-context",
    });
  } catch (error) {
    fs.writeFileSync(
      path.join(__dirname, "context-proof.json"),
      JSON.stringify({ error: error.message }),
      { mode: 0o600 },
    );
    send({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["Context fixture failed"],
    });
  } finally {
    if (mcp) mcp.kill("SIGTERM");
  }
});
