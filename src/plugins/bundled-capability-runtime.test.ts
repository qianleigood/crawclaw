import { describe, expect, it } from "vitest";
import { loadBundledCapabilityRuntimeRegistry } from "./bundled-capability-runtime.js";

describe("loadBundledCapabilityRuntimeRegistry", () => {
  it("loads the bundled browser plugin without a capability loader error", () => {
    const registry = loadBundledCapabilityRuntimeRegistry({
      pluginIds: ["browser"],
      pluginSdkResolution: "src",
    });

    const browser = registry.plugins.find((plugin) => plugin.id === "browser");
    expect(browser?.status).toBe("loaded");
    expect(browser?.error).toBeUndefined();
    expect(registry.diagnostics.filter((diagnostic) => diagnostic.pluginId === "browser")).toEqual(
      [],
    );
  });
});
