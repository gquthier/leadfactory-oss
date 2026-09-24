// A host tool's answer that carries a picture as well as words — a
// computer_observe screenshot. Codex takes the image as an `inputImage`
// content item; drivers without image input get the words only (never a
// base64 blob pasted into the model's context as text).

export interface RichToolResult {
  readonly richToolResult: true;
  text: string;
  image?: { mimeType: string; data: string };
}

export function richToolResult(text: string, image?: { mimeType: string; data: string } | null): RichToolResult {
  return { richToolResult: true, text, ...(image && image.data ? { image } : {}) };
}

export function isRichToolResult(value: unknown): value is RichToolResult {
  return Boolean(value) && typeof value === "object" && (value as { richToolResult?: unknown }).richToolResult === true
    && typeof (value as { text?: unknown }).text === "string";
}

/** The words of any tool answer. */
export function toolResultText(value: unknown): string {
  if (isRichToolResult(value)) return value.text;
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}
