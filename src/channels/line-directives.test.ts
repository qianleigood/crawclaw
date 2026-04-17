import { describe, expect, it } from "vitest";
import { hasLineDirectives, parseLineDirectives } from "./line-directives.js";

describe("line-directives", () => {
  it("detects supported LINE directive markers", () => {
    expect(hasLineDirectives("Hello [[quick_replies: A, B]]")).toBe(true);
    expect(hasLineDirectives("Just regular text")).toBe(false);
  });

  it("parses LINE quick replies into channelData", () => {
    const result = parseLineDirectives({
      text: "Choose one:\n[[quick_replies: Option A, Option B]]",
    });

    expect(result.text).toBe("Choose one:");
    expect(result.channelData?.line).toEqual({
      quickReplies: ["Option A", "Option B"],
    });
  });
});
