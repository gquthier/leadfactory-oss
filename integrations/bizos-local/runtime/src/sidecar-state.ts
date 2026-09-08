import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export function readStrictJson<T>(path: string, label: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    throw new Error(`${label} exists but is corrupt; refusing to replace durable state`);
  }
}

export interface StateLock {
  release(): void;
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM (or an unknown probe failure) is not proof that the owner died.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** An existence lock is sufficient because exactly one sidecar owns a state root. */
export function acquireStateLock(
  path: string,
  pid = process.pid,
  alive: (candidate: number) => boolean = processAlive,
): StateLock {
  const create = (): number => {
    if (existsSync(`${path}.repair`)) throw new Error("Local sidecar lock recovery is in progress; refusing a concurrent takeover");
    const fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify({ version: 1, pid })}\n`);
    return fd;
  };

  let fd: number;
  try {
    fd = create();
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code !== "EEXIST") throw error;
    const owner = readStrictJson<{ version?: unknown; pid?: unknown }>(path, "sidecar.lock");
    if (!owner || owner.version !== 1 || typeof owner.pid !== "number" || !Number.isInteger(owner.pid) || owner.pid <= 1) {
      throw new Error("sidecar.lock has an invalid shape; refusing an unsafe takeover");
    }
    if (alive(owner.pid)) throw new Error(`Local sidecar state is already owned by process ${owner.pid}`);
    repairStateLock(path, alive);
    // Exclusive creation remains the final arbiter when launchd and the UI
    // both attempt recovery. Never adopt another starter's new lock.
    fd = create();
  }

  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      closeSync(fd);
      const owner = readStrictJson<{ version?: unknown; pid?: unknown }>(path, "sidecar.lock");
      if (owner?.version === 1 && owner.pid === pid) unlinkSync(path);
    },
  };
}

/** Serialize stale recovery and recheck the owner inside that exclusion. */
export function repairStateLock(
  path: string,
  alive: (candidate: number) => boolean = processAlive,
): void {
  const guardPath = `${path}.repair`;
  const guard = openSync(guardPath, "wx", 0o600);
  try {
    const owner = readStrictJson<{ version?: unknown; pid?: unknown }>(path, "sidecar.lock");
    if (!owner) return;
    if (owner.version !== 1 || typeof owner.pid !== "number" || !Number.isInteger(owner.pid) || owner.pid <= 1) {
      throw new Error("sidecar.lock has an invalid shape; inspect it before manual recovery");
    }
    if (alive(owner.pid)) throw new Error(`Local sidecar state is still owned by process ${owner.pid}`);
    unlinkSync(path);
  } finally {
    closeSync(guard);
    unlinkSync(guardPath);
  }
}
