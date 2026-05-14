import { describe, expect, it } from "vitest";
import { validateConfigObjectRaw } from "./validation.js";

describe("config validation allowed-values metadata", () => {
  it("adds allowed values for invalid union paths", () => {
    const result = validateConfigObjectRaw({
      update: { channel: "nightly" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((entry) => entry.path === "update.channel");
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('(allowed: "stable", "beta", "dev")');
      expect(issue?.allowedValues).toEqual(["stable", "beta", "dev"]);
      expect(issue?.allowedValuesHiddenCount).toBe(0);
    }
  });

  it("keeps native enum messages while attaching allowed values metadata", () => {
    const result = validateConfigObjectRaw({
      commands: { ownerDisplay: "maybe" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((entry) => entry.path === "commands.ownerDisplay");
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("expected one of");
      expect(issue?.message).not.toContain("(allowed:");
      expect(issue?.allowedValues).toEqual(["raw", "hash"]);
      expect(issue?.allowedValuesHiddenCount).toBe(0);
    }
  });

  it("includes boolean variants for boolean-or-enum unions", () => {
    const result = validateConfigObjectRaw({
      commands: { native: "maybe" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((entry) => entry.path === "commands.native");
      expect(issue).toBeDefined();
      expect(issue?.allowedValues).toEqual(["true", "false", "auto"]);
    }
  });

  it("skips allowed-values hints for unions with open-ended branches", () => {
    const result = validateConfigObjectRaw({
      cron: { sessionRetention: true },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((entry) => entry.path === "cron.sessionRetention");
      expect(issue).toBeDefined();
      expect(issue?.allowedValues).toBeUndefined();
      expect(issue?.allowedValuesHiddenCount).toBeUndefined();
      expect(issue?.message).not.toContain("(allowed:");
    }
  });
});
