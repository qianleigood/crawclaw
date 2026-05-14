import { describe, expect, it } from "vitest";
import {
  assertTsAgentLoopCompatibilityAllowed,
  isTsAgentLoopCompatibilityAllowed,
} from "./ts-agent-loop-compatibility.js";

describe("TS agent loop compatibility policy", () => {
  it("allows TS reply loop facades only in test runtimes", () => {
    expect(isTsAgentLoopCompatibilityAllowed({ NODE_ENV: "test" })).toBe(true);
    expect(isTsAgentLoopCompatibilityAllowed({ VITEST: "true" })).toBe(true);
    expect(isTsAgentLoopCompatibilityAllowed({ NODE_ENV: "production" })).toBe(false);
  });

  it("throws when a TS reply loop facade is called outside tests", () => {
    expect(() => assertTsAgentLoopCompatibilityAllowed("getReplyFromConfig")).not.toThrow();
    expect(() =>
      assertTsAgentLoopCompatibilityAllowed("getReplyFromConfig", {
        NODE_ENV: "production",
      }),
    ).toThrow("getReplyFromConfig is a test-only TS agent loop compatibility facade");
  });
});
