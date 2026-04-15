import { describePluginRegistrationContract } from "../../../test/helpers/plugins/plugin-registration-contract.js";

type PluginRegistrationContractParams = Parameters<typeof describePluginRegistrationContract>[0];

const pluginRegistrationContractTests: PluginRegistrationContractParams[] = [
  {
    pluginId: "anthropic",
    providerIds: ["anthropic"],
    mediaUnderstandingProviderIds: ["anthropic"],
    cliBackendIds: ["claude-cli"],
    requireDescribeImages: true,
  },
  {
    pluginId: "deepgram",
    mediaUnderstandingProviderIds: ["deepgram"],
  },
  {
    pluginId: "elevenlabs",
    speechProviderIds: ["elevenlabs"],
    requireSpeechVoices: true,
  },
  {
    pluginId: "fal",
    providerIds: ["fal"],
  },
  {
    pluginId: "google",
    providerIds: ["google", "google-gemini-cli"],
    mediaUnderstandingProviderIds: ["google"],
    cliBackendIds: ["google-gemini-cli"],
    requireDescribeImages: true,
  },
  {
    pluginId: "groq",
    mediaUnderstandingProviderIds: ["groq"],
  },
  {
    pluginId: "microsoft",
    speechProviderIds: ["microsoft"],
    requireSpeechVoices: true,
  },
  {
    pluginId: "minimax",
    providerIds: ["minimax", "minimax-portal"],
    mediaUnderstandingProviderIds: ["minimax", "minimax-portal"],
    requireDescribeImages: true,
  },
  {
    pluginId: "mistral",
    mediaUnderstandingProviderIds: ["mistral"],
  },
  {
    pluginId: "moonshot",
    providerIds: ["moonshot"],
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
    providerIds: ["openai", "openai-codex"],
    speechProviderIds: ["openai"],
    mediaUnderstandingProviderIds: ["openai", "openai-codex"],
    cliBackendIds: ["codex-cli"],
    requireSpeechVoices: true,
    requireDescribeImages: true,
  },
  {
    pluginId: "open-websearch",
    webSearchProviderIds: ["open-websearch"],
  },
  {
    pluginId: "scrapling-fetch",
    webFetchProviderIds: ["scrapling"],
  },
  {
    pluginId: "openrouter",
    providerIds: ["openrouter"],
    mediaUnderstandingProviderIds: ["openrouter"],
    requireDescribeImages: true,
  },
  {
    pluginId: "xai",
    providerIds: ["xai"],
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
