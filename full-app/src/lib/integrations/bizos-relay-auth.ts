import { createHmac, timingSafeEqual } from "node:crypto";

interface RelayValue {
  page_id?: unknown;
}

interface RelayChange {
  field?: unknown;
  value?: RelayValue;
}

interface RelayEntry {
  id?: unknown;
  changes?: unknown;
}

interface RelayPayload {
  object?: unknown;
  entry?: unknown;
}

export function verifyHmacSha256(
  raw: string,
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret?.trim() || !header?.startsWith("sha256=")) return false;

  const provided = header.slice("sha256=".length);
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const providedBytes = Buffer.from(provided, "hex");
  return (
    expectedBytes.length > 0 &&
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

/**
 * Authorization boundary for requests authenticated with BizOS's dedicated
 * relay secret. Direct Meta webhooks do not use this allow-list.
 *
 * The entire signed payload must belong to allowlisted Pages. Mixed batches
 * fail closed because filtering the body would invalidate its HMAC.
 */
export function isAllowlistedBizosRelayPayload(
  body: unknown,
  pageIdsCsv: string | undefined,
): boolean {
  const allowed = new Set(
    (pageIdsCsv ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (allowed.size === 0 || !body || typeof body !== "object") return false;

  const payload = body as RelayPayload;
  if (payload.object !== "page" || !Array.isArray(payload.entry)) return false;

  let leadgenEvents = 0;
  for (const rawEntry of payload.entry) {
    if (!rawEntry || typeof rawEntry !== "object") return false;
    const entry = rawEntry as RelayEntry;
    const entryPageId = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!entryPageId || !allowed.has(entryPageId) || !Array.isArray(entry.changes)) return false;

    for (const rawChange of entry.changes) {
      if (!rawChange || typeof rawChange !== "object") return false;
      const change = rawChange as RelayChange;
      if (change.field !== "leadgen") continue;

      leadgenEvents += 1;
      const valuePageId = change.value?.page_id;
      const pageId =
        typeof valuePageId === "string" && valuePageId.trim()
          ? valuePageId.trim()
          : entryPageId;
      if (!allowed.has(pageId)) return false;
    }
  }

  return leadgenEvents > 0;
}
