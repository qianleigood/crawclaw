import { describePluginRegistrationContract } from "../../../test/helpers/plugins/plugin-registration-contract.js";

type PluginRegistrationContractParams = Parameters<typeof describePluginRegistrationContract>[0];

const pluginRegistrationContractTests: PluginRegistrationContractParams[] = [
  {
    pluginId: "anthropic",
    mediaUnderstandingProviderIds: ["anthropic"],
    cliBackendIds: ["claude-cli"],
    requireDescribeImages: true,
  },
  {
    pluginId: "fal",
  },
  {
    pluginId: "google",
    mediaUnderstandingProviderIds: ["google"],
    cliBackendIds: ["google-gemini-cli"],
    requireDescribeImages: true,
  },
  {
    pluginId: "groq",
    mediaUnderstandingProviderIds: ["groq"],
  },
  {
    pluginId: "minimax",
    mediaUnderstandingProviderIds: ["minimax", "minimax-portal"],
    requireDescribeImages: true,
  },
  {
    pluginId: "mistral",
    mediaUnderstandingProviderIds: ["mistral"],
  },
  {
    pluginId: "moonshot",
    mediaUnderstandingProviderIds: ["moonshot"],
    requireDescribeImages: true,
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
    mediaUnderstandingProviderIds: ["openai", "openai-codex"],
    cliBackendIds: ["codex-cli"],
    requireDescribeImages: true,
  },
  {
    pluginId: "open-websearch",
    webSearchProviderIds: ["open-websearch"],
  },
  {
    pluginId: "qwen3-tts",
    speechProviderIds: ["qwen3-tts"],
    requireSpeechVoices: true,
  },
  {
    pluginId: "scrapling-fetch",
    webFetchProviderIds: ["scrapling"],
  },
  {
    pluginId: "openrouter",
    mediaUnderstandingProviderIds: ["openrouter"],
    requireDescribeImages: true,
  },
  {
    pluginId: "xai",
  },
  {
    pluginId: "zai",
    mediaUnderstandingProviderIds: ["zai"],
    requireDescribeImages: true,
  },
];

for (const params of pluginRegistrationContractTests) {
  describePluginRegistrationContract(params);
}
