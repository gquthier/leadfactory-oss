/** Workspace-scoped bridge to Electron main. Main holds the app identity,
 * validates enrollment, signs the backend request, and performs HTTPS. */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
export type ContinuityTransport = <T = unknown>(
  operation: string,
  body: Record<string, unknown>,
) => Promise<T>;
export interface ContinuityIdentity {
  installationId: string;
  userId: string;
  orgId: string;
  workspaceId: string;
  machineName?: string;
}
export interface LocalizedBridgeMessage {
  fr: string;
  en: string;
}
export class ContinuityBridgeError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly requestRejected = false,
    readonly localizedMessage?: LocalizedBridgeMessage) {
    super(message);
  }
}
export function desktopContinuityTransport(
  descriptorPath: string,
  fetchImpl: typeof fetch = fetch,
): ContinuityTransport {
  return async <T>(
    operation: string,
    body: Record<string, unknown>,
  ): Promise<T> => {
    const row = JSON.parse(readFileSync(descriptorPath, "utf8")) as Record<
      string,
      unknown
    >;
    const origin = new URL(String(row.origin));
    if (
      row.version !== 1 ||
      origin.protocol !== "http:" ||
      origin.hostname !== "127.0.0.1" ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      typeof row.workspaceId !== "string" ||
      typeof row.secret !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.secret)
    )
      throw new Error("Desktop continuity bridge is invalid.");
    const token = createHmac("sha256", row.secret)
      .update(`${row.workspaceId}\0continuity`)
      .digest("hex");
    const response = await fetchImpl(`${origin.origin}/v1/continuity`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-bizos-workspace": row.workspaceId,
      },
      body: JSON.stringify({ operation, body }),
      signal: AbortSignal.timeout(operation === "cloud/send" ? 70_000 : operation === "inference/chat" ? 130_000 : operation === "tools/image-generate" ? 320_000 : 15_000),
    });
    const result = (await response.json()) as {
      ok?: boolean;
      result?: T;
      error?: string;
      code?: string;
      requestRejected?: boolean;
      message?: unknown;
    };
    const localized = result.code === "usage_limit_reached" && result.message !== null && typeof result.message === "object"
      && !Array.isArray(result.message) ? result.message as Record<string, unknown> : null;
    const localizedMessage = localized && typeof localized.fr === "string" && localized.fr.length > 0 && localized.fr.length <= 200
      && typeof localized.en === "string" && localized.en.length > 0 && localized.en.length <= 200
      ? { fr: localized.fr, en: localized.en } : undefined;
    if (!response.ok || result.ok !== true)
      throw new ContinuityBridgeError(
        response.status, result.code ?? 'unavailable',
        result.error?.slice(0, 400) ?? `Continuity bridge refused request (${response.status}).`,
        result.requestRejected === true,
        localizedMessage,
      );
    return result.result as T;
  };
}
