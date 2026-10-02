import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function loadKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY manquante (32 bytes base64 — générer avec `openssl rand -base64 32`)"
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `APP_ENCRYPTION_KEY doit faire 32 bytes une fois décodée (got ${key.length})`
    );
  }
  return key;
}

export interface EncryptedToken {
  encrypted: string;
  iv: string;
  tag: string;
}

export function encryptToken(plaintext: string): EncryptedToken {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptToken(enc: {
  encrypted: string;
  iv: string;
  tag: string;
}): string {
  const key = loadKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(enc.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(enc.encrypted, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}
