import { describe, expect, it } from "vitest";
import {
  assertBundledTsChannelRuntimeAllowed,
  shouldAllowBundledTsChannelRuntime,
} from "./bundled-runtime-policy.js";

describe("bundled TS channel runtime policy", () => {
  it("allows bundled TS channel runtime only in tests", () => {
    expect(shouldAllowBundledTsChannelRuntime({ NODE_ENV: "test" })).toBe(true);
    expect(shouldAllowBundledTsChannelRuntime({ VITEST: "true" })).toBe(true);
    expect(shouldAllowBundledTsChannelRuntime({ NODE_ENV: "production" })).toBe(false);
  });

  it("throws when a bundled TS channel loader is called outside tests", () => {
    expect(() => assertBundledTsChannelRuntimeAllowed("loadBundledTsChannelModule")).not.toThrow();
    expect(() =>
      assertBundledTsChannelRuntimeAllowed("loadBundledTsChannelModule", {
        NODE_ENV: "production",
      }),
    ).toThrow("loadBundledTsChannelModule is disabled");
  });
});
