// Open a system Terminal window so the user can complete an OAuth login
// for an isolated plan home. The renderer never sees the command — only
// that login was started.
import { spawn } from "node:child_process";
import { platform } from "node:os";

export interface OpenCliLoginInput {
  /** Full shell command, already including env prefixes the CLI needs. */
  shellCommand: string;
}

/**
 * On macOS, ask Terminal.app to run the command in a new window (so the
 * browser OAuth dance has a TTY). Elsewhere, spawn a detached shell.
 */
export function openCliLogin(input: OpenCliLoginInput): { started: boolean } {
  const command = input.shellCommand.trim();
  if (!command) return { started: false };

  if (platform() === "darwin") {
    const escaped = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const script = `tell application "Terminal" to do script "${escaped}"`;
    const child = spawn("osascript", ["-e", script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { started: true };
  }

  const shell = process.env.SHELL || "/bin/sh";
  const child = spawn(shell, ["-lc", command], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return { started: true };
}
