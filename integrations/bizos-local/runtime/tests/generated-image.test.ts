import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadGeneratedImage, MAX_IMAGE_BYTES } from "../src/generated-image.js";
import { attachmentsOf } from "../src/sidecar.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");

it("downloads a bounded hosted image to the scoped profile without keeping its signed URL", async () => {
  const root = mkdtempSync(join(tmpdir(), "generated-image-")); roots.push(root);
  const fetchImage = vi.fn(async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } }));
  const image = await downloadGeneratedImage("https://gallery.example/image.png?token=temporary", root, "123e4567-e89b-42d3-a456-426614174000", { fetch: fetchImage as typeof fetch, lookup: async () => ["203.0.113.8"] });
  expect(image.mimeType).toBe("image/png");
  expect(image.size).toBe(png.length);
  expect(readFileSync(image.path)).toEqual(png);
  expect(image.path).not.toContain("token");
  expect(fetchImage).toHaveBeenCalledOnce();
  const projected = attachmentsOf([{ kind: "image", id: "generated-image-123e4567-e89b-42d3-a456-426614174000", path: image.path,
    url: `file://${image.path}`, fileName: image.fileName, mimeType: image.mimeType, size: image.size }]);
  expect(projected[0]).toMatchObject({ kind: "image", status: "ready", contentType: "image/png",
    dataUrl: `data:image/png;base64,${png.toString("base64")}` });
});

it("rejects private destinations, non-images and oversized responses", async () => {
  const root = mkdtempSync(join(tmpdir(), "generated-image-")); roots.push(root);
  const fetchImage = vi.fn(async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } }));
  await expect(downloadGeneratedImage("http://127.0.0.1/a", root, "123e4567-e89b-42d3-a456-426614174000", { fetch: fetchImage as typeof fetch })).rejects.toThrow();
  expect(fetchImage).not.toHaveBeenCalled();
  await expect(downloadGeneratedImage("https://gallery.example/a", root, "123e4567-e89b-42d3-a456-426614174000", { fetch: fetchImage as typeof fetch, lookup: async () => ["127.0.0.1"] })).rejects.toThrow();
  const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
  await expect(downloadGeneratedImage("https://gallery.example/a", root, "123e4567-e89b-42d3-a456-426614174000", { fetch: redirect as typeof fetch, lookup: async () => ["203.0.113.8"] })).rejects.toThrow();
  expect(redirect).toHaveBeenCalledOnce();
  const html = vi.fn(async () => new Response("<h1>oops</h1>", { headers: { "content-type": "text/html" } }));
  await expect(downloadGeneratedImage("https://gallery.example/a", root, "123e4567-e89b-42d3-a456-426614174000", { fetch: html as typeof fetch, lookup: async () => ["203.0.113.8"] })).rejects.toThrow();
  const oversized = vi.fn(async () => new Response(png, { headers: { "content-type": "image/png", "content-length": String(MAX_IMAGE_BYTES + 1) } }));
  await expect(downloadGeneratedImage("https://gallery.example/a", root, "123e4567-e89b-42d3-a456-426614174000", { fetch: oversized as typeof fetch, lookup: async () => ["203.0.113.8"] })).rejects.toThrow(/size limit/);
});
