import { randomUUID } from "node:crypto";

/** Opaque id for a domain row. Prefixed so a stray id in a log or a file
 * name says what it belongs to without a lookup. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function newRunId(): string {
  return newId("run");
}

export function newMessageId(): string {
  return newId("msg");
}

export function newAskId(): string {
  return newId("ask");
}
