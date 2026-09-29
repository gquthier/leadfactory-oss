import { ContinuityBridgeError } from "./continuity-bridge.js";

export class ImageOperationPendingError extends Error {}

// Once the signed image request is pending, all subsequent calls use its same
// operation_id. Keep recovering that paid result if the CLI run ends meanwhile.
export async function pollSignedImageOperation<T>(
  invoke: () => Promise<T>,
  checkActive: () => void,
  options: { now?: () => number; wait?: () => Promise<void>; timeoutMs?: number } = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (() => new Promise<void>(resolveWait => setTimeout(resolveWait, 3_000)));
  const started = now();
  let pending = false;
  for (;;) {
    if (!pending) checkActive();
    let result: T;
    try {
      result = await invoke();
    } catch (error) {
      if (!(error instanceof ContinuityBridgeError) || error.code !== "operation_outcome_pending") throw error;
      result = { pending: true } as T;
    }
    if (!result || typeof result !== "object" || (result as Record<string, unknown>).pending !== true) return result;
    pending = true;
    if (now() - started > (options.timeoutMs ?? 8 * 60_000))
      throw new ImageOperationPendingError("Image generation is still processing. Retry with the same operation_id to recover the result.");
    await wait();
  }
}
