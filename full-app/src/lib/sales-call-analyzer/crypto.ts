/**
 * AES-GCM 256 chiffrement pour les clés API externes (Fathom).
 *
 * Stockage : on garde séparément ciphertext + iv + tag + un preview en clair (4 derniers chars).
 * Clé : env var APP_ENCRYPTION_KEY (32 bytes en base64, 44 chars).
 */

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

export interface EncryptedKey {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
  preview: string; // 4 derniers chars du plaintext
}

export function encryptApiKey(plaintext: string): EncryptedKey {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    preview: plaintext.slice(-4),
  };
}

export function decryptApiKey(enc: {
  key_encrypted: string;
  key_iv: string;
  key_tag: string;
}): string {
  const key = loadKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(enc.key_iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(enc.key_tag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(enc.key_encrypted, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}
