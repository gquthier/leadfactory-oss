import { lookup as dnsLookup } from "node:dns/promises";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { imageDimensions, isPrivateAddress, isPublicPreviewHost } from "./harness/chat-outputs.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface GeneratedImageFile {
  path: string;
  fileName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
}

/** Copy a server gallery image into this sidecar's private profile. The URL
 * can expire; neither it nor its query string is persisted in the transcript. */
export async function downloadGeneratedImage(
  url: string,
  profileRoot: string,
  artifactId: string,
  options: { fetch?: typeof fetch; lookup?: (hostname: string) => Promise<string[]> } = {},
): Promise<GeneratedImageFile> {
  if (!ARTIFACT_ID.test(artifactId)) throw new Error("Image receipt has an invalid artifact ID.");
  const fetchImpl = options.fetch ?? fetch;
  const resolveHost = options.lookup ?? (async (host: string) => (await dnsLookup(host, { all: true })).map(row => row.address));
  let target = new URL(url);
  let response: Response | undefined;
  for (let hop = 0; hop < 4; hop++) {
    if (target.protocol !== "https:" || !isPublicPreviewHost(target.hostname)) throw new Error("Image URL is not a public HTTPS address.");
    const addresses = await resolveHost(target.hostname);
    if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("Image host is not public.");
    response = await fetchImpl(target.href, { headers: { accept: "image/png,image/jpeg,image/webp" }, redirect: "manual", signal: AbortSignal.timeout(90_000) });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("Image redirect has no destination.");
    target = new URL(location, target);
  }
  if (!response?.ok || response.status >= 300) throw new Error("Generated image could not be downloaded.");
  const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const extension = IMAGE_TYPES[mimeType];
  if (!extension) throw new Error("Generated image has an unsupported type.");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_IMAGE_BYTES) throw new Error("Generated image exceeds the size limit.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw new Error("Generated image is empty.");
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_IMAGE_BYTES) throw new Error("Generated image exceeds the size limit.");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, size);
  const dimensions = imageDimensions(bytes);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw new Error("Generated image bytes are invalid.");
  const directory = join(profileRoot, "generated-images");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fileName = `${artifactId}${extension}`;
  const path = join(directory, fileName);
  const temporary = join(directory, `.${artifactId}.${randomUUID()}.tmp`);
  writeFileSync(temporary, bytes, { mode: 0o600 });
  renameSync(temporary, path);
  return { path, fileName, mimeType, size, ...dimensions };
}
