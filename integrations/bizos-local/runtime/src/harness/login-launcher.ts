// Open a system Terminal window for the user's OAuth login and wait until
// Terminal actually accepts the command. Login completion is probed later.
import { spawn, type ChildProcess } from "node:child_process";
import { platform } from "node:os";

export interface OpenCliLoginInput {
  shellCommand: string;
}

export interface LoginLaunchResult {
  started: boolean;
  reason?: "invalid_command" | "unsupported" | "launch_error" | "denied" | "timeout";
}

export async function openCliLogin(
  input: OpenCliLoginInput,
  options: { platform?: string; timeoutMs?: number; spawnProcess?: typeof spawn } = {},
): Promise<LoginLaunchResult> {
  const command = input.shellCommand.trim();
  if (!command || /[\r\n\0]/.test(command)) return { started: false, reason: "invalid_command" };
  const system = options.platform ?? platform();
  if (system === "win32") return { started: false, reason: "unsupported" };
  const escaped = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `tell application "Terminal" to do script "${escaped}"`;
  const file = system === "darwin" ? "/usr/bin/osascript" : "/bin/sh";
  const args = system === "darwin" ? ["-e", script] : ["-lc", command];
  let child: ChildProcess;
  try {
    child = (options.spawnProcess ?? spawn)(file, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
    });
  } catch { return { started: false, reason: "launch_error" }; }
  return new Promise(resolve => {
    let done = false;
    let stderr = "";
    const finish = (result: LoginLaunchResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-1024); });
    child.once("error", () => finish({ started: false, reason: "launch_error" }));
    child.once("exit", code => finish(code === 0 ? { started: true } : { started: false, reason: /not authorized|not permitted|denied|(-1743)/i.test(stderr) ? "denied" : "launch_error" }));
    const timer = setTimeout(() => {
      child.kill();
      finish({ started: false, reason: "timeout" });
    }, options.timeoutMs ?? 15_000);
  });
}
