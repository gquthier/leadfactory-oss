import { describe, expect, it } from "vitest";
import { aiSetupRequired } from "../src/harness/ai-setup-error.js";

describe("AI setup failures", () => {
  it.each([
    "`codex` isn't installed, or isn't on this app's PATH",
    "`claude` isn't installed, or isn't on this app's PATH",
    "Claude is not authenticated",
    "Authentication required. Please sign in to Codex.",
    "The selected personal plan was removed; choose another source.",
    "API key is missing",
  ])("shows setup guidance for %s", reason => {
    expect(aiSetupRequired(reason)).toBe(true);
  });

  it("does not relabel unrelated agent failures as missing AI", () => {
    expect(aiSetupRequired("The task failed because the file is unreadable.")).toBe(false);
  });
});
