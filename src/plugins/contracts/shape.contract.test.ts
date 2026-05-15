import { describe, expect, it } from "vitest";
import { buildAllPluginInspectReports } from "../status.js";
import { createPluginRegistryFixture, registerVirtualTestPlugin } from "./testkit.js";

describe("plugin shape compatibility matrix", () => {
  it("classifies remaining plugin capabilities without TS provider or typed hook registration", () => {
    const { config, registry } = createPluginRegistryFixture();

    registerVirtualTestPlugin({
      registry,
      config,
      id: "hybrid-company",
      name: "Hybrid Company",
      register(api) {
        api.registerWebSearchProvider({
          id: "hybrid-search",
          label: "Hybrid Search",
          hint: "Search the web",
          envVars: ["HYBRID_SEARCH_KEY"],
          placeholder: "hsk_...",
          signupUrl: "https://example.com/signup",
          credentialPath: "tools.web.search.hybrid-search.apiKey",
          getCredentialValue: () => "hsk-test",
          setCredentialValue(searchConfigTarget, value) {
            searchConfigTarget.apiKey = value;
          },
          createTool: () => ({
            description: "Hybrid search",
            parameters: {},
            execute: async () => ({}),
          }),
        });
      },
    });

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
