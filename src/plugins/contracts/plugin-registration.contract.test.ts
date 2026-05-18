import { describePluginRegistrationContract } from "../../../test/helpers/plugins/plugin-registration-contract.js";

type PluginRegistrationContractParams = Parameters<typeof describePluginRegistrationContract>[0];

const pluginRegistrationContractTests: PluginRegistrationContractParams[] = [
  {
    pluginId: "anthropic",
  },
  {
    pluginId: "fal",
  },
  {
    pluginId: "google",
  },
  {
    pluginId: "groq",
  },
  {
    pluginId: "minimax",
  },
  {
    pluginId: "mistral",
  },
  {
    pluginId: "moonshot",
    manifestAuthChoice: {
      pluginId: "kimi",
      choiceId: "kimi-code-api-key",
      choiceLabel: "Kimi Code API key (subscription)",
      groupId: "moonshot",
      groupLabel: "Moonshot AI (Kimi K2.5)",
      groupHint: "Kimi K2.5",
    },
  },
  {
    pluginId: "openai",
  },
  {
    pluginId: "searxng",
    webSearchProviderIds: ["searxng"],
  },
  {
    pluginId: "spider-fetch",
    webFetchProviderIds: ["spider"],
  },
  {
    pluginId: "openrouter",
  },
  {
    pluginId: "xai",
  },
  {
    pluginId: "zai",
  },
];

for (const params of pluginRegistrationContractTests) {
  describePluginRegistrationContract(params);
}
