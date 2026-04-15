import { describe, expect, it } from "vitest";
import { resolveBrowserConfig, resolveProfile } from "../config.js";
import { resolveSnapshotPlan } from "./agent.snapshot.plan.js";

describe("resolveSnapshotPlan", () => {
  it("defaults managed snapshots to ai when format is omitted", () => {
    const resolved = resolveBrowserConfig({});
    const profile = resolveProfile(resolved, "crawclaw");
    expect(profile).toBeTruthy();
    expect(profile?.driver).toBe("crawclaw");

    const plan = resolveSnapshotPlan({
      profile: profile as NonNullable<typeof profile>,
      query: {},
      hasPlaywright: true,
    });

    expect(plan.format).toBe("ai");
  });

  it("keeps ai snapshots for managed browsers when Playwright is available", () => {
    const resolved = resolveBrowserConfig({});
    const profile = resolveProfile(resolved, "crawclaw");
    expect(profile).toBeTruthy();

    const plan = resolveSnapshotPlan({
      profile: profile as NonNullable<typeof profile>,
      query: {},
      hasPlaywright: true,
    });

    expect(plan.format).toBe("ai");
  });
});
