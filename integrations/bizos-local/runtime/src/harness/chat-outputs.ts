// What an agent can put in the chat besides words: files and images from
// its workspace, and links the runtime dresses up with a preview.
//
// Design (docs/specs/chat-outputs, 2026-09-25, owner decisions 2026-09-26):
//   * a file the agent sends stays WHERE IT IS in the company workspace; the
//     runtime never copies it. Anything outside the workspace is refused —
//     after resolving symlinks, so a link planted inside cannot point out.
//   * produced files belong under `outputs/YYYY-MM-DD/` of the company
//     workspace. The tool does not enforce it (a file elsewhere is attached
//     as is); the prompt asks for it and `outputsDirFor` names the folder.
//   * an AI image is never labelled "Generated": the image and its alt, that
//     is all.
//   * the FIRST external https link of a reply gets a preview fetched by the
//     runtime (the sender), with Signal's caps: ≤ 1 MB of HTML, ≤ 1 MB of
//     image, a short timeout. A failed fetch is simply no preview.
//
// No dependencies: MIME comes from the extension, image dimensions from the
// first bytes of PNG / JPEG / GIF / WebP headers.
import { randomBytes } from "node:crypto";
import { lstatSync, openSync, readSync, closeSync, realpathSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** At most this many files in one call: an album, not a folder dump. */
export const MAX_ATTACHMENTS_PER_CALL = 10;
/** A single attachment, in bytes. The desktop stores the PATH, not the
 * bytes, but the served route reads the file whole. */
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;
export const MAX_ALT_CHARS = 200;
export const MAX_CAPTION_CHARS = 2_000;

/** Signal's own caps for link previews (`linkPreviewFetch`). */
export const PREVIEW_MAX_HTML_BYTES = 1024 * 1024;
export const PREVIEW_MAX_IMAGE_BYTES = 1024 * 1024;
export const PREVIEW_TIMEOUT_MS = 4_000;

export type AttachmentKind = "image" | "file";

/** One file the agent attached, as the runtime verified it. */
export interface ResolvedAttachment {
  id: string;
  kind: AttachmentKind;
  /** Canonical absolute path, symlinks resolved, inside a workspace root. */
  path: string;
  fileName: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  alt?: string;
}

export interface SendToChatInput {
  files: Array<{ path: string; alt?: string }>;
  caption?: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".json": "application/json",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

/** The MIME type for a file name, by extension. Unknown ⇒ octet-stream. */
export function mimeTypeFor(fileName: string): string {
  return MIME_BY_EXTENSION[extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

/** The image types the chat renders inline. SVG is a FILE here: the
 * desktop's image grid does not rasterise it, and a script inside one is
 * not something to put in a chat bubble. */
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isInlineImageType(contentType: string): boolean {
  return INLINE_IMAGE_TYPES.has(contentType);
}

/**
 * Width and height from the first bytes of a PNG, JPEG, GIF or WebP.
 * `null` when the header is not one of these or is truncated.
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number): string =>
    String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + length)));
  // PNG: 8-byte signature, then the IHDR chunk (length, "IHDR", width, height).
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF: "GIF87a" / "GIF89a", then the logical screen size, little-endian.
  if (bytes.length >= 10 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  // WebP: "RIFF" …. "WEBP", then a VP8 / VP8L / VP8X chunk.
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return { width, height };
    }
    if (chunk === "VP8L") {
      const b0 = bytes[21]!, b1 = bytes[22]!, b2 = bytes[23]!, b3 = bytes[24]!;
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
    if (chunk === "VP8 ") {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    return null;
  }
  // JPEG: walk the markers to the first SOF (C0–CF, except C4, C8, CC).
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 <= bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) { offset += 1; continue; }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { offset += 2; continue; }
      const length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** A fresh, unguessable attachment id — it names the served route. */
export function newAttachmentId(): string {
  return `att_${randomBytes(12).toString("hex")}`;
}

function readHead(path: string, length: number): Uint8Array {
  const buffer = new Uint8Array(length);
  const fd = openSync(path, "r");
  try {
    const read = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/**
 * Check one path the agent named and describe the file behind it.
 *
 * `roots` are the folders it may send from (its own workspace, the company
 * vault). A relative path is taken from the first root. The path is
 * canonicalised BEFORE the containment test, so `../` and symlinks planted
 * inside the workspace cannot reach `~/.ssh`.
 */
export function resolveAttachment(
  rawPath: string,
  roots: readonly string[],
  options: { alt?: string; id?: string } = {},
): ResolvedAttachment {
  const trimmed = String(rawPath ?? "").trim();
  if (!trimmed) throw new Error("a file path is required");
  if (trimmed.includes("\0")) throw new Error("that path is not valid");
  const canonicalRoots = roots.map((root) => {
    try { return realpathSync(root); } catch { return resolve(root); }
  });
  if (!canonicalRoots.length) throw new Error("no workspace folder to send from");
  const absolute = isAbsolute(trimmed) ? trimmed : join(canonicalRoots[0]!, trimmed);
  let canonical: string;
  try {
    canonical = realpathSync(absolute);
  } catch {
    throw new Error(`${trimmed} does not exist`);
  }
  if (!canonicalRoots.some((root) => isInside(canonical, root))) {
    throw new Error(`${trimmed} is outside your workspace; only files in your workspace can be sent`);
  }
  const stat = lstatSync(canonical);
  if (!stat.isFile()) throw new Error(`${trimmed} is not a file`);
  if (stat.size > MAX_ATTACHMENT_BYTES) throw new Error(`${trimmed} is too large to send (${Math.round(stat.size / 1_048_576)} MB)`);
  const fileName = basename(canonical);
  const contentType = mimeTypeFor(fileName);
  const image = isInlineImageType(contentType);
  const alt = typeof options.alt === "string" ? options.alt.trim().slice(0, MAX_ALT_CHARS) : "";
  const dimensions = image && stat.size > 0 ? imageDimensions(readHead(canonical, 64 * 1024)) : null;
  return {
    id: options.id ?? newAttachmentId(),
    kind: image ? "image" : "file",
    path: canonical,
    fileName,
    contentType,
    size: stat.size,
    ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
    ...(alt ? { alt } : {}),
  };
}

/** The tool's arguments, checked. Throws a sentence the model can act on. */
export function parseSendToChat(raw: unknown): SendToChatInput {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const list = Array.isArray(input.files) ? input.files : [];
  if (!list.length) throw new Error("files must list at least one file to send");
  if (list.length > MAX_ATTACHMENTS_PER_CALL) throw new Error(`send at most ${MAX_ATTACHMENTS_PER_CALL} files in one message`);
  const files = list.map((entry, index) => {
    const row = typeof entry === "string"
      ? { path: entry }
      : entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const path = typeof row.path === "string" ? row.path.trim() : "";
    if (!path) throw new Error(`files[${index}].path is required`);
    const alt = typeof row.alt === "string" ? row.alt.trim().slice(0, MAX_ALT_CHARS) : "";
    return { path, ...(alt ? { alt } : {}) };
  });
  const caption = typeof input.caption === "string" ? input.caption.trim().slice(0, MAX_CAPTION_CHARS) : "";
  return { files, ...(caption ? { caption } : {}) };
}

/** `<root>/outputs/YYYY-MM-DD` — where produced files belong. */
export function outputsDirFor(workspaceRoot: string, at: Date): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return join(workspaceRoot, "outputs", `${year}-${month}-${day}`);
}

// ── Links ───────────────────────────────────────────────────────────────

export interface ReplyLink {
  /** The words the agent wrote for it (`[label](url)`), or the URL itself. */
  label: string;
  url: string;
}

/** `https://app.bizos.lol/d/{chat|agent|routine}/<id>` and `/d/dashboard`:
 * opened inside the app, never fetched. */
export const BIZOS_INTERNAL_LINK = /^https:\/\/app\.bizos\.lol\/d\/(?:(?:chat|agent|routine)\/[A-Za-z0-9:_.-]+|dashboard)\/?$/;

export function isBizosInternalLink(url: string): boolean {
  return BIZOS_INTERNAL_LINK.test(url.trim());
}

const MARKDOWN_LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /https?:\/\/[^\s<>"'`)\]]+/g;

/** Trailing punctuation a sentence leaves stuck to a URL. */
function trimUrl(url: string): string {
  return url.replace(/[.,;:!?'"]+$/, "");
}

function validHttpUrl(candidate: string): URL | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Every link in a reply, in reading order, and the first one worth a card.
 *
 * `links` keeps labelled links (the desktop renders the label as the link
 * text); bare URLs are listed too, labelled with themselves, so a client can
 * draw them without re-parsing the text. `previewUrl` is the first EXTERNAL
 * https link — never a BizOS-internal one, never plain http.
 */
export function extractLinks(text: string): { links: ReplyLink[]; previewUrl: string | null } {
  const links: ReplyLink[] = [];
  const seen = new Set<string>();
  const source = String(text ?? "");
  const consumed: Array<[number, number]> = [];
  for (const match of source.matchAll(MARKDOWN_LINK)) {
    const url = validHttpUrl(trimUrl(match[2]!));
    if (!url) continue;
    consumed.push([match.index!, match.index! + match[0].length]);
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    links.push({ label: match[1]!.trim(), url: url.href });
  }
  for (const match of source.matchAll(BARE_URL)) {
    const start = match.index!;
    if (consumed.some(([from, to]) => start >= from && start < to)) continue;
    const url = validHttpUrl(trimUrl(match[0]));
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    links.push({ label: url.href, url: url.href });
  }
  // Reading order: a bare URL before a labelled one should still come first.
  const ordered = links
    .map((link) => ({ link, at: source.indexOf(link.url) === -1 ? source.indexOf(link.label) : source.indexOf(link.url) }))
    .sort((a, b) => a.at - b.at)
    .map((row) => row.link);
  const previewUrl = ordered.find((link) => link.url.startsWith("https://") && !isBizosInternalLink(link.url))?.url ?? null;
  return { links: ordered.slice(0, 20), previewUrl };
}

export interface FetchedPreview {
  url: string;
  title?: string;
  description?: string;
  domain: string;
  /** ISO date the page declares (`article:published_time`), when it does. */
  date?: string;
  image?: { contentType: string; bytes: Uint8Array; width?: number; height?: number };
}

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string>; redirect?: "manual" }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface PreviewFetchOptions {
  fetch?: FetchLike;
  /** Addresses a host name resolves to. Defaults to the system resolver when
   * `fetch` is the real one; an injected `fetch` skips it unless given. */
  lookup?: (hostname: string) => Promise<string[]>;
  timeoutMs?: number;
  maxHtmlBytes?: number;
  maxImageBytes?: number;
}

/** Read a body up to `limit` bytes, then stop reading. */
async function readCapped(response: Awaited<ReturnType<FetchLike>>, limit: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer());
    return whole.length > limit ? null : whole;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

/** `<meta property="og:title" content="…">` in either attribute order. */
function metaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]?.trim()) return decodeEntities(match[1].trim());
  }
  return undefined;
}

/** Title, description, date and image URL out of a page's `<head>`. */
export function parsePreviewHtml(html: string, pageUrl: string): { title?: string; description?: string; date?: string; imageUrl?: string } {
  const head = html.slice(0, 512 * 1024);
  const title = metaContent(head, "og:title") ?? metaContent(head, "twitter:title")
    ?? (() => { const match = /<title[^>]*>([^<]{1,500})<\/title>/i.exec(head); return match ? decodeEntities(match[1]!.trim()) : undefined; })();
  const description = metaContent(head, "og:description") ?? metaContent(head, "twitter:description") ?? metaContent(head, "description");
  const rawDate = metaContent(head, "article:published_time") ?? metaContent(head, "og:updated_time");
  const date = rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : undefined;
  const rawImage = metaContent(head, "og:image:secure_url") ?? metaContent(head, "og:image") ?? metaContent(head, "twitter:image");
  let imageUrl: string | undefined;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl);
      if (resolved.protocol === "https:") imageUrl = resolved.href;
    } catch { /* not a URL */ }
  }
  return {
    ...(title ? { title: title.slice(0, 200) } : {}),
    ...(description ? { description: description.replace(/\s+/g, " ").slice(0, 500) } : {}),
    ...(date ? { date } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

const PREVIEW_HEADERS = { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "user-agent": "Mozilla/5.0 (compatible; BizOS link preview)" };

const MAX_PREVIEW_REDIRECTS = 3;

/** True for an IP literal on this Mac, its network or a private range. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]!);
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (ip.includes(":")) {
    return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  }
  return false;
}

/** Only a public https host: never this Mac, its network, or a private name. */
export function isPublicPreviewHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return false;
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return !isPrivateAddress(host);
  return host.includes(".");
}

async function systemLookup(hostname: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  return (await lookup(hostname, { all: true })).map((entry) => entry.address);
}

/**
 * GET with redirects followed by hand, each hop re-checked: https only and a
 * public host (and, with a resolver, public addresses), so a link or a
 * redirect can never make the runtime read something on the person's network.
 */
async function fetchPublic(fetchImpl: FetchLike, start: URL, init: { signal: AbortSignal; headers: Record<string, string> }, lookup?: (hostname: string) => Promise<string[]>) {
  let target = start;
  for (let hop = 0; hop <= MAX_PREVIEW_REDIRECTS; hop += 1) {
    if (target.protocol !== "https:" || !isPublicPreviewHost(target.hostname)) return null;
    if (lookup) {
      const addresses = await lookup(target.hostname);
      if (!addresses.length || addresses.some(isPrivateAddress)) return null;
    }
    const response = await fetchImpl(target.href, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      target = new URL(location, target);
      continue;
    }
    return response;
  }
  return null;
}

/**
 * A preview for one external https link, or `null` — never a throw.
 *
 * Only https, only a text/html answer, only up to the caps; the image is
 * fetched afterwards under its own cap and dropped alone if it fails.
 */
export async function fetchLinkPreview(url: string, options: PreviewFetchOptions = {}): Promise<FetchedPreview | null> {
  const target = validHttpUrl(url);
  if (!target || target.protocol !== "https:" || isBizosInternalLink(target.href)) return null;
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) return null;
  const lookup = options.lookup ?? (options.fetch ? undefined : systemLookup);
  const timeoutMs = options.timeoutMs ?? PREVIEW_TIMEOUT_MS;
  const maxHtml = options.maxHtmlBytes ?? PREVIEW_MAX_HTML_BYTES;
  const maxImage = options.maxImageBytes ?? PREVIEW_MAX_IMAGE_BYTES;
  const domain = target.hostname.toLowerCase();
  try {
    const response = await fetchPublic(fetchImpl, target, { signal: AbortSignal.timeout(timeoutMs), headers: PREVIEW_HEADERS }, lookup);
    if (!response || !response.ok) return null;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) return null;
    const bytes = await readCapped(response, maxHtml);
    if (!bytes) return null;
    const parsed = parsePreviewHtml(new TextDecoder("utf-8", { fatal: false }).decode(bytes), target.href);
    if (!parsed.title && !parsed.description) return null;
    const preview: FetchedPreview = {
      url: target.href,
      domain,
      ...(parsed.title ? { title: parsed.title } : {}),
      ...(parsed.description ? { description: parsed.description } : {}),
      ...(parsed.date ? { date: parsed.date } : {}),
    };
    if (parsed.imageUrl) {
      try {
        const image = await fetchPublic(fetchImpl, new URL(parsed.imageUrl), { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "image/*" } }, lookup);
        const imageType = (image?.headers.get("content-type") ?? "").toLowerCase().split(";")[0]!.trim();
        if (image && image.ok && isInlineImageType(imageType)) {
          const imageBytes = await readCapped(image, maxImage);
          if (imageBytes && imageBytes.length) {
            const dimensions = imageDimensions(imageBytes);
            preview.image = { contentType: imageType, bytes: imageBytes, ...(dimensions ?? {}) };
          }
        }
      } catch { /* the card stands without its image */ }
    }
    return preview;
  } catch {
    return null;
  }
}

/** The file extension a preview image is stored under. */
export function extensionForImageType(contentType: string): string {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "image/webp") return ".webp";
  return ".bin";
}

/** Size, for a tool result: "1.2 MB". */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

export function fileStat(path: string): { size: number } | null {
  try { return { size: statSync(path).size }; } catch { return null; }
}
