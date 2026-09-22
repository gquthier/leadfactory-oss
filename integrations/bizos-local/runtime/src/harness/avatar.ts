import { createHash } from "node:crypto";

export const MAX_TEAM_AVATAR_DATA_URL_CHARS = 32_768;

export interface ParsedAvatarDataUrl {
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  hash: string;
}

function hasSignature(bytes: Buffer, mimeType: ParsedAvatarDataUrl["mimeType"]): boolean {
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

/** Strict team-tool avatar parser. It deliberately accepts no URL, path,
 * SVG, whitespace-tolerant base64 or MIME/signature mismatch. */
export function parseAvatarDataUrl(value: unknown): ParsedAvatarDataUrl {
  if (typeof value !== "string" || value.length > MAX_TEAM_AVATAR_DATA_URL_CHARS) {
    throw new Error(`avatar_data_url must be a PNG, JPEG or WebP data URL of at most ${MAX_TEAM_AVATAR_DATA_URL_CHARS} characters`);
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match?.[1] || !match[2] || match[2].length % 4 !== 0) {
    throw new Error("avatar_data_url must use canonical base64 for PNG, JPEG or WebP");
  }
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.toString("base64") !== match[2]) {
    throw new Error("avatar_data_url base64 is not canonical");
  }
  const mimeType = match[1] as ParsedAvatarDataUrl["mimeType"];
  if (!hasSignature(bytes, mimeType)) throw new Error(`avatar_data_url bytes do not match ${mimeType}`);
  return { dataUrl: value, mimeType, hash: createHash("sha256").update(bytes).digest("hex") };
}

/** Legacy bot rows may contain remote URLs or paths. The desktop bootstrap
 * receives only bytes that pass the current strict parser. */
export function safeAvatarDataUrl(value: unknown): ParsedAvatarDataUrl | null {
  try {
    return parseAvatarDataUrl(value);
  } catch {
    return null;
  }
}
