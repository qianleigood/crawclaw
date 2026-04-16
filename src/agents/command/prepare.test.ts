import { describe, expect, it } from "vitest";
import { __testing } from "./prepare.js";

describe("agent command prepare helpers", () => {
  it("trims explicit override input", () => {
    expect(__testing.normalizeExplicitOverrideInput("  openai  ", "provider")).toBe("openai");
    expect(__testing.normalizeExplicitOverrideInput("  gpt-5.4  ", "model")).toBe("gpt-5.4");
  });

  it("rejects empty overrides", () => {
    expect(() => __testing.normalizeExplicitOverrideInput("   ", "provider")).toThrow(
      "Provider override must be non-empty.",
    );
  });

  it("rejects control characters", () => {
    expect(() => __testing.normalizeExplicitOverrideInput("gpt-\u0001mini", "model")).toThrow(
      "Model override contains invalid control characters.",
    );
  });

  it("rejects values longer than the configured limit", () => {
    const tooLong = "x".repeat(257);
    expect(() => __testing.normalizeExplicitOverrideInput(tooLong, "model")).toThrow(
      "Model override exceeds 256 characters.",
    );
  });
});
