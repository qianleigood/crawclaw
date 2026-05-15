import { describe, expect, it } from "vitest";
import {
  loadChannelTimingManifest,
  loadTestRunnerBehavior,
} from "../scripts/test-runner-manifest.mjs";

describe("loadTestRunnerBehavior", () => {
  it("loads extension isolated entries from the behavior manifest", () => {
    const behavior = loadTestRunnerBehavior();
    const files = behavior.extensions.isolated.map((entry) => entry.file);

    expect(files).toContain("extensions/duckduckgo/src/ddg-search-provider.test.ts");
  });

  it("does not keep bundled channel isolated prefixes after TS channel cleanup", () => {
    const behavior = loadTestRunnerBehavior();

    expect(behavior.channels.isolatedPrefixes).toEqual([]);
  });

  it("loads channel timing metadata from the timing manifest", () => {
    const timings = loadChannelTimingManifest();

    expect(timings.config).toBe("vitest.channels.config.ts");
    expect(timings.files).toEqual({});
  });
});
