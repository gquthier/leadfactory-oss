import { expect, it } from "vitest";
import { remoteConversationBelongsToWorkspace } from "../src/sidecar.js";

it("imports cloud history only for an exact verified OS and local thread", () => {
  const row = { workspaceId: "os_shop", localConversationId: "bot:shop-ceo" };
  expect(remoteConversationBelongsToWorkspace(row, "os_shop", "bot:shop-ceo")).toBe(true);
  expect(remoteConversationBelongsToWorkspace(row, "os_other", "bot:shop-ceo")).toBe(false);
  expect(remoteConversationBelongsToWorkspace(row, "os_shop", "bot:other-ceo")).toBe(false);
  expect(remoteConversationBelongsToWorkspace({ localConversationId: "bot:shop-ceo" }, "os_shop", "bot:shop-ceo")).toBe(false);
});
