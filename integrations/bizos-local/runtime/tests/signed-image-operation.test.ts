import { expect, it, vi } from "vitest";
import { ContinuityBridgeError } from "../src/continuity-bridge.js";
import { ImageOperationPendingError, pollSignedImageOperation } from "../src/signed-image-operation.js";

it("recovers the same signed image after its CLI run ends while the paid operation is pending", async () => {
  let active = true;
  const authorize = vi.fn(() => { if (!active) throw new Error("run cancelled"); });
  const call = vi.fn().mockImplementationOnce(async () => {
    active = false;
    throw new ContinuityBridgeError(409, "operation_outcome_pending", "Generating");
  }).mockResolvedValueOnce({ artifactId: "image-1", url: "https://example.test/image.png" });
  const result = await pollSignedImageOperation(call, authorize, { wait: async () => undefined });
  expect(result).toMatchObject({ artifactId: "image-1" });
  expect(call).toHaveBeenCalledTimes(2);
  expect(authorize).toHaveBeenCalledOnce();
});

it("does not send a new image request after cancellation or change the pending result", async () => {
  const call = vi.fn().mockResolvedValue({ pending: true });
  await expect(pollSignedImageOperation(call, () => { throw new Error("run cancelled"); }))
    .rejects.toThrow("run cancelled");
  expect(call).not.toHaveBeenCalled();
  let now = 0;
  await expect(pollSignedImageOperation(call, () => undefined, {
    now: () => now, wait: async () => { now = 10; }, timeoutMs: 5,
  })).rejects.toBeInstanceOf(ImageOperationPendingError);
  expect(call).toHaveBeenCalledTimes(2);
});
