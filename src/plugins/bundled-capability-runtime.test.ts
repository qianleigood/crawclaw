import { describe, expect, it } from "vitest";
import { loadBundledCapabilityRuntimeRegistry } from "./bundled-capability-runtime.js";

describe("loadBundledCapabilityRuntimeRegistry", () => {
  it("uses native manifests for migrated bundled native plugins", () => {
    const registry = loadBundledCapabilityRuntimeRegistry({
      pluginIds: ["lobster"],
    });

    const lobster = registry.plugins.find((plugin) => plugin.id === "lobster");
    expect(lobster?.status).toBe("loaded");
    expect(lobster?.source).toMatch(/crawclaw\.plugin\.json$/);
    expect(lobster?.toolNames).toEqual(["lobster"]);
  });
});
