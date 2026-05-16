import { describe, expect, it } from "vitest";
import { buildAllPluginInspectReports } from "../status.js";
import { createPluginRecord } from "../status.test-helpers.js";
import { createPluginRegistryFixture } from "./testkit.js";

describe("plugin shape compatibility matrix", () => {
  it("classifies remaining plugin capabilities without TS provider or typed hook registration", () => {
    const { config, registry } = createPluginRegistryFixture();

    registry.registry.plugins.push(
      createPluginRecord({
        id: "hybrid-company",
        name: "Hybrid Company",
        source: "/virtual/hybrid-company/crawclaw.plugin.json",
      }),
    );
    const plugin = registry.registry.plugins.find((entry) => entry.id === "hybrid-company");
    if (!plugin) {
      throw new Error("Expected hybrid-company plugin record");
    }
    plugin.webSearchProviderIds.push("hybrid-search");

    const inspect = buildAllPluginInspectReports({
      config,
      report: {
        workspaceDir: "/virtual-workspace",
        ...registry.registry,
      },
    });

    expect(
      inspect.map((entry) => ({
        id: entry.plugin.id,
        shape: entry.shape,
        capabilityMode: entry.capabilityMode,
      })),
    ).toEqual([
      {
        id: "hybrid-company",
        shape: "plain-capability",
        capabilityMode: "plain",
      },
    ]);

    expect(inspect.map((entry) => entry.capabilities.map((capability) => capability.kind))).toEqual(
      [["web-search"]],
    );
  });
});
