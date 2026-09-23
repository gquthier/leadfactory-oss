// `GET /api/local/events`: the desktop's push channel. It carries no content,
// only "this thread changed" hints (and team events, which are small and
// public already): the desktop answers each one with the thread refresh it
// already has, so polling remains the source of truth and the stream is only
// what makes it immediate.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LocalTeamEvent } from "./sidecar-contract.js";

export const EVENT_STREAM_PING_MS = 15_000;
/** A window per desktop, plus reconnect overlap; anything beyond is a leak. */
export const MAX_EVENT_STREAMS = 16;
/** A client this far behind is not reading: it is closed and will resync. */
export const MAX_STREAM_BACKLOG_BYTES = 1024 * 1024;

export type LocalStreamFrame =
  | { event: "message"; data: { threadId: string; messageId: string; change: "created" | "updated" } }
  | { event: "team-event"; data: LocalTeamEvent }
  | { event: "run"; data: { runId: string; threadId: string; state: "queued" | "running" | "done" | "failed" | "cancelled" } };

export type LocalStreamListener = (frame: LocalStreamFrame) => void;

/** Fan-out to the open streams. */
export class LocalEventHub {
  private readonly listeners = new Set<LocalStreamListener>();

  get size(): number {
    return this.listeners.size;
  }

  subscribe(listener: LocalStreamListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(frame: LocalStreamFrame): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(frame);
      } catch {
        // One broken stream must not stop the others.
      }
    }
  }
}

export function formatFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Hold one SSE response open until the client goes away. Returns `false`
 * (nothing written) when too many streams are already open. Every exit path —
 * client close, socket error, server shutdown, a client too slow to read —
 * runs the same cleanup once: listener removed, ping cleared.
 */
export function serveEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  hub: LocalEventHub,
  options: { pingMs?: number } = {},
): boolean {
  if (hub.size >= MAX_EVENT_STREAMS) return false;
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.flushHeaders?.();
  let closed = false;
  const send = (chunk: string): void => {
    if (closed) return;
    if (response.writableLength > MAX_STREAM_BACKLOG_BYTES) {
      cleanup();
      response.destroy();
      return;
    }
    response.write(chunk);
  };
  const unsubscribe = hub.subscribe((frame) => send(formatFrame(frame.event, frame.data)));
  const ping = setInterval(() => send(": ping\n\n"), options.pingMs ?? EVENT_STREAM_PING_MS);
  ping.unref?.();
  function cleanup(): void {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    unsubscribe();
  }
  // The RESPONSE's close, not the request's: an IncomingMessage without a body
  // emits `close` as soon as it has been read, long before the client leaves.
  response.once("close", cleanup);
  response.once("error", cleanup);
  send(formatFrame("ready", {}));
  return true;
}
