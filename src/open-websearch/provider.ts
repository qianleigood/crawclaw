import { Type } from "@sinclair/typebox";
import {
  enablePluginInConfig,
  getScopedCredentialValue,
  readNumberParam,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  setScopedCredentialValue,
  setProviderWebSearchPluginConfigValue,
  type WebSearchProviderPlugin,
} from "../plugin-sdk/provider-web-search.js";
import { runOpenWebSearch } from "./client.js";

const OpenWebSearchSchema = Type.Object(
  {
    query: Type.String({ description: "Search query string." }),
    count: Type.Optional(
      Type.Number({
        description: "Number of results to return (1-10).",
        minimum: 1,
        maximum: 10,
      }),
    ),
  },
  { additionalProperties: false },
);

export function createOpenWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "open-websearch",
    label: "Open-WebSearch",
    hint: "Use the bundled managed open-websearch daemon for keyless multi-engine web search",
    onboardingScopes: ["text-inference"],
    requiresCredential: false,
    credentialLabel: "Open-WebSearch base URL override",
    envVars: ["OPEN_WEBSEARCH_BASE_URL"],
    placeholder: "http://127.0.0.1:3210",
    signupUrl: "https://github.com/Aas-ee/open-webSearch",
    docsUrl: "https://docs.crawclaw.ai/tools/open-websearch",
    autoDetectOrder: 5,
    credentialPath: "plugins.entries.open-websearch.config.webSearch.baseUrl",
    inactiveSecretPaths: ["plugins.entries.open-websearch.config.webSearch.baseUrl"],
    getCredentialValue: (searchConfig) => getScopedCredentialValue(searchConfig, "open-websearch"),
    setCredentialValue: (searchConfigTarget, value) =>
      setScopedCredentialValue(searchConfigTarget, "open-websearch", value),
    getConfiguredCredentialValue: (config) =>
      resolveProviderWebSearchPluginConfig(config, "open-websearch")?.baseUrl,
    setConfiguredCredentialValue: (configTarget, value) => {
      setProviderWebSearchPluginConfigValue(configTarget, "open-websearch", "baseUrl", value);
    },
    applySelectionConfig: (config) => enablePluginInConfig(config, "open-websearch").config,
    createTool: (ctx) => ({
      description:
        "Search the web using CrawClaw's managed local open-websearch daemon. Returns multi-engine results with titles, URLs, and snippets without API keys.",
      parameters: OpenWebSearchSchema,
      execute: async (args) =>
        await runOpenWebSearch({
          config: ctx.config,
          query: readStringParam(args, "query", { required: true }),
          count: readNumberParam(args, "count", { integer: true }),
        }),
    }),
  };
}
