// Spawning the agent CLI and its MCP children. Ported from OpenMausBot
// `server/procs.ts` (Apache-2.0), reduced to the POSIX paths this app ships
// (macOS first; Linux works the same way).
import {
  execFile,
  execFileSync,
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type ExecFileOptions,
  type SpawnOptions,
} from "node:child_process";
import { existsSync } from "node:fs";
import type { Readable, Writable } from "node:stream";

export type PipedChild = ChildProcessByStdio<Writable, Readable, Readable>;

/** How long a process group gets to honour SIGTERM before SIGKILL. */
export const KILL_GRACE_MS = 5_000;
const pendingCliStops = new Map<ChildProcess, Promise<boolean>>();
const completedCliStops = new WeakSet<ChildProcess>();
const failedCliStops = new WeakSet<ChildProcess>();
const capturedCliStops = new WeakMap<ChildProcess, { known: Map<number, CliProcessIdentity>; groupOwned: boolean }>();
const uncapturedCliStops = new WeakSet<ChildProcess>();
const exitedCliGroups = new WeakMap<ChildProcess, CliProcessIdentity[]>();

/** The service must stay alive until detached CLI/MCP process groups are gone. */
export async function waitForCliShutdown(): Promise<boolean> {
  const outcomes = await Promise.all([...pendingCliStops.values()]);
  return outcomes.every(Boolean);
}

export function spawnCli(cli: string, args: string[], options: SpawnOptions): PipedChild {
  const child = spawn(cli, args, {
    ...options,
    // Own process group so kill(-pid) reaps the MCP servers codex spawned.
    detached: true,
  }) as PipedChild;
  // A write to a dying child's stdin errors on the stream; nothing listens,
  // and an unlistened stream error takes the whole app down over one dead
  // CLI. `close` already settles every turn, so this is swallowed.
  child.stdin?.on("error", () => {});
  child.once("exit", () => {
    // Bind surviving group members while this ChildProcess has just exited;
    // a later cleanup must not claim a newly reused numeric process group.
    const rows = processSnapshot();
    if (rows && child.pid) exitedCliGroups.set(child, rows.filter(row => row.pgid === child.pid));
  });
  return child;
}

export function execCli(
  cli: string,
  args: string[],
  options: ExecFileOptions,
  callback: (error: Error | null, stdout: string, stderr: string) => void,
): void {
  execFile(cli, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) =>
    callback(error, String(stdout ?? ""), String(stderr ?? "")),
  );
}

export type SpawnFailure = { message: string; setup: boolean };

/** Human wording for a failed CLI spawn. Node reports these as bare errno
 * strings — "spawn codex ENOENT" — which reads as a crash.
 *
 * `cwd` matters: spawn answers ENOENT both when the BINARY is missing and
 * when the WORKING DIRECTORY is, and "codex isn't installed" is a lie when
 * codex is installed and it was the bot's folder that disappeared. */
export function describeSpawnFailure(
  error: NodeJS.ErrnoException,
  cli: string,
  cwd?: string,
): SpawnFailure {
  if (error.code === "ENOENT") {
    if (cwd && !existsSync(cwd)) {
      return { message: `this bot's working folder is gone (\`${cwd}\`)`, setup: true };
    }
    return { message: `\`${cli}\` isn't installed, or isn't on this app's PATH`, setup: true };
  }
  if (error.code === "EACCES" || error.code === "EPERM")
    return { message: `\`${cli}\` isn't executable — check its file permissions`, setup: true };
  return { message: `spawn failed: ${error.message}`, setup: false };
}

/** Metadata only: never collect argv/environment (which may contain secrets).
 * Darwin ps reports lstart to the second; identity checks cannot claim finer
 * precision. PGID plus birth time must still match before every later signal. */
export interface CliProcessIdentity {
  pid: number;
  ppid: number;
  pgid: number;
  startedAt: string;
  zombie: boolean;
}

export function parseCliProcessSnapshot(output: string): CliProcessIdentity[] {
  const rows: CliProcessIdentity[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)/.exec(line);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]),
      startedAt: match[4]!.replace(/\s+/g, " "), zombie: match[5]!.includes("Z") });
  }
  return rows;
}

function processSnapshot(): CliProcessIdentity[] | null {
  try {
    const rows = parseCliProcessSnapshot(execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,lstart=,stat="], {
      encoding: "utf8", timeout: 1_000, maxBuffer: 4 * 1024 * 1024,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" }, stdio: ["ignore", "pipe", "ignore"],
    }));
    return rows.length ? rows : null;
  } catch { return null; }
}

export function sameCliProcess(expected: CliProcessIdentity, actual: CliProcessIdentity): boolean {
  return expected.pid === actual.pid && expected.pgid === actual.pgid && expected.startedAt === actual.startedAt;
}

/** Select only proven descendants. A sibling sharing an unrelated group is
 * never included merely because one child belongs to that group. */
export function cliDescendants(rootPid: number, rows: readonly CliProcessIdentity[]): CliProcessIdentity[] {
  const selected: CliProcessIdentity[] = [];
  const parents = new Set([rootPid]);
  for (;;) {
    const next = rows.filter(row => !parents.has(row.pid) && parents.has(row.ppid));
    if (!next.length) break;
    for (const row of next) { parents.add(row.pid); selected.push(row); }
  }
  return selected;
}

/** Capture descendants BEFORE the first signal. Codex tools can create their
 * own process groups, and killing the CLI first reparents them to launchd.
 * Those exact identities stay tracked through TERM/KILL and service shutdown.
 * Only the CLI's own group is group-signalled; detached descendants are killed
 * by verified PID, never by their possibly shared process group. */
export function killCliTree(child: ChildProcess, graceMs = KILL_GRACE_MS): void {
  if (!child.pid || completedCliStops.has(child) || (pendingCliStops.has(child) && !failedCliStops.has(child))) return;
  failedCliStops.delete(child);
  const settled = stopCliTree(child, graceMs);
  pendingCliStops.set(child, settled);
  void settled.then(gone => {
    if (gone) { pendingCliStops.delete(child); completedCliStops.add(child); }
    else failedCliStops.add(child); // Preserve failure evidence, but permit a new STOP attempt.
  });
}

async function stopCliTree(child: ChildProcess, graceMs: number): Promise<boolean> {
  const pid = child.pid!;
  // A transient ps failure gets a bounded chance to recover BEFORE any signal
  // can detach descendants. No process authority is inferred from a failed ps.
  let initial = processSnapshot();
  for (let attempt = 0; !initial && attempt < 2; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    initial = processSnapshot();
  }
  if (!initial) {
    // ChildProcess owns this unreaped PID, even when tree enumeration is down.
    // Never fall back to a numeric group or to an unverified descendant PID.
    if (!capturedCliStops.has(child)) uncapturedCliStops.add(child);
    const signalOwnedChild = (value: NodeJS.Signals): void => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill(value); } catch { /* Failure remains explicit below. */ }
      }
    };
    signalOwnedChild("SIGTERM");
    await new Promise(resolve => setTimeout(resolve, graceMs));
    signalOwnedChild("SIGKILL");
    // We cannot certify that unknown descendants are gone. Retain this failed
    // attempt for shutdown accounting; the next STOP can retry enumeration.
    return false;
  }
  const leaderGone = child.exitCode !== null || child.signalCode !== null;
  const leader = initial.find(row => row.pid === pid);
  const prior = capturedCliStops.get(child);
  // A reaped ChildProcess PID now present again belongs to someone else. Still
  // drain identities captured earlier; never replace them with the reused PID.
  const reusedLeader = leaderGone && leader && !leader.zombie;
  const exitedGroup = exitedCliGroups.get(child) ?? [];
  const groupOwned = prior?.groupOwned ?? (!reusedLeader && (leaderGone ? exitedGroup.length > 0 : leader?.pgid === pid));
  const known = prior?.known ?? new Map<number, CliProcessIdentity>();
  if (!prior && !reusedLeader) {
    for (const row of [ ...(leader ? [leader] : []), ...cliDescendants(pid, initial),
      ...(groupOwned ? (leaderGone ? exitedGroup : initial.filter(row => row.pgid === pid)) : []),
    ]) known.set(row.pid, row);
  }
  capturedCliStops.set(child, { known, groupOwned: !!groupOwned });
  if (!known.size) return !uncapturedCliStops.has(child);

  const started = Date.now();
  const termSent = new Set<number>();
  const killSent = new Set<number>();
  let forced = false;
  let ambiguous = false;
  const signal = (target: number, value: NodeJS.Signals): void => {
    try { process.kill(target, value); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") ambiguous = true; }
  };
  const inspectAndSignal = (rows: CliProcessIdentity[], value: NodeJS.Signals): boolean => {
    const byPid = new Map(rows.map(row => [row.pid, row]));
    // Discover children of still-proven parents before those parents vanish.
    // Retain previous identities after reparenting, instead of re-discovering
    // from a dead CLI PID and accidentally losing detached tools.
    for (const expected of [...known.values()]) {
      const actual = byPid.get(expected.pid);
      if (!actual || !sameCliProcess(expected, actual)) continue;
      for (const descendant of cliDescendants(actual.pid, rows)) if (!known.has(descendant.pid)) known.set(descendant.pid, descendant);
    }
    const live: CliProcessIdentity[] = [];
    for (const expected of known.values()) {
      const actual = byPid.get(expected.pid);
      if (!actual || actual.zombie) continue;
      if (!sameCliProcess(expected, actual)) {
        // A different birth is PID reuse, not a survivor. Same birth with
        // changed group is ambiguous: do not broaden authority to that group.
        if (actual.startedAt === expected.startedAt) ambiguous = true;
        continue;
      }
      live.push(actual);
    }
    const sent = value === "SIGKILL" ? killSent : termSent;
    // Children first. Never signal an unrelated group shared by a descendant.
    for (const row of [...live].reverse()) {
      if (groupOwned && row.pgid === pid) continue;
      if (!sent.has(row.pid)) { signal(row.pid, value); sent.add(row.pid); }
    }
    const group = rows.filter(row => row.pgid === pid && !row.zombie);
    const safeGroup = groupOwned && group.length > 0 && group.every(row => {
      const expected = known.get(row.pid);
      return expected && sameCliProcess(expected, row);
    });
    if (safeGroup) {
      if (group.some(row => !sent.has(row.pid))) signal(-pid, value);
      for (const row of group) sent.add(row.pid);
    } else {
      for (const row of live.filter(row => row.pgid === pid)) {
        if (!sent.has(row.pid)) { signal(row.pid, value); sent.add(row.pid); }
      }
    }
    return live.length === 0;
  };

  // Take a second snapshot while the tree is still attached, so children
  // created during enumeration can be included before the parent is killed.
  const beforeSignal = processSnapshot() ?? initial;
  inspectAndSignal(beforeSignal, "SIGTERM");
  return new Promise<boolean>((resolveStop) => {
    const poll = (): void => {
      const rows = processSnapshot();
      if (rows) {
        if (!forced && Date.now() - started >= graceMs) forced = true;
        const gone = inspectAndSignal(rows, forced ? "SIGKILL" : "SIGTERM");
        if (gone) { resolveStop(!ambiguous && !uncapturedCliStops.has(child)); return; }
      }
      if (Date.now() - started >= graceMs + 2_000) { resolveStop(false); return; }
      // Referenced intentionally: the service cannot exit before escalation.
      setTimeout(poll, 50);
    };
    setTimeout(poll, 0);
  });
}
