/** Injectable time source. Tests drive schedules and timeouts without
 * sleeping, and every persisted timestamp comes from one place. */
export interface Clock {
  now(): Date;
  nowIso(): string;
  setTimeout(handler: () => void, ms: number): () => void;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
  setTimeout: (handler, ms) => {
    const timer = setTimeout(handler, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

export function fixedClock(startMs: number): Clock & { advance(ms: number): void } {
  let current = startMs;
  const pending: Array<{ at: number; handler: () => void; cancelled: boolean }> = [];
  return {
    now: () => new Date(current),
    nowIso: () => new Date(current).toISOString(),
    setTimeout(handler, ms) {
      const entry = { at: current + ms, handler, cancelled: false };
      pending.push(entry);
      return () => { entry.cancelled = true; };
    },
    advance(ms) {
      current += ms;
      for (const entry of [...pending]) {
        if (entry.cancelled || entry.at > current) continue;
        entry.cancelled = true;
        entry.handler();
      }
    },
  };
}
