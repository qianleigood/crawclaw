import type { MediaUnderstandingProvider } from "crawclaw/plugin-sdk/media-understanding";
import {
  definePluginEntry,
  type CrawClawPluginApi,
  type ProviderAuthContext,
  type ProviderFetchUsageSnapshotContext,
} from "crawclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "crawclaw/plugin-sdk/provider-auth-api-key";
import type { ProviderPlugin } from "crawclaw/plugin-sdk/provider-model-shared";
import { createGoogleThinkingPayloadWrapper } from "crawclaw/plugin-sdk/provider-stream";
import {
  GOOGLE_GEMINI_DEFAULT_MODEL,
  applyGoogleGeminiModelDefault,
  normalizeGoogleProviderConfig,
  resolveGoogleGenerativeAiTransport,
  normalizeGoogleModelId,
} from "./api.js";
import { buildGoogleGeminiCliBackend } from "./cli-backend.js";
import { isModernGoogleModel, resolveGoogle31ForwardCompatModel } from "./provider-models.js";

const GOOGLE_GEMINI_CLI_PROVIDER_ID = "google-gemini-cli";
const GOOGLE_GEMINI_CLI_PROVIDER_LABEL = "Gemini CLI OAuth";
const GOOGLE_GEMINI_CLI_DEFAULT_MODEL = "google-gemini-cli/gemini-3.1-pro-preview";
const GOOGLE_GEMINI_CLI_ENV_VARS = [
  "CRAWCLAW_GEMINI_OAUTH_CLIENT_ID",
  "CRAWCLAW_GEMINI_OAUTH_CLIENT_SECRET",
  "CRAWCLAW_GEMINI_OAUTH_CLIENT_ID",
  "CRAWCLAW_GEMINI_OAUTH_CLIENT_SECRET",
  "GEMINI_CLI_OAUTH_CLIENT_ID",
  "GEMINI_CLI_OAUTH_CLIENT_SECRET",
] as const;

type GoogleOauthApiKeyCredential = {
  type?: string;
  access?: string;
  projectId?: string;
};

let googleGeminiCliProviderPromise: Promise<ProviderPlugin> | null = null;
let googleMediaUnderstandingProviderPromise: Promise<MediaUnderstandingProvider> | null = null;

type GoogleMediaUnderstandingProvider = MediaUnderstandingProvider & {
  describeImage: NonNullable<MediaUnderstandingProvider["describeImage"]>;
  describeImages: NonNullable<MediaUnderstandingProvider["describeImages"]>;
  transcribeAudio: NonNullable<MediaUnderstandingProvider["transcribeAudio"]>;
  describeVideo: NonNullable<MediaUnderstandingProvider["describeVideo"]>;
};

function formatGoogleOauthApiKey(cred: GoogleOauthApiKeyCredential): string {
  if (cred.type !== "oauth" || typeof cred.access !== "string" || !cred.access.trim()) {
    return "";
  }
  return JSON.stringify({
    token: cred.access,
    projectId: cred.projectId,
  });
}

async function loadGoogleGeminiCliProvider(): Promise<ProviderPlugin> {
  if (!googleGeminiCliProviderPromise) {
    googleGeminiCliProviderPromise = import("./gemini-cli-provider.js").then((mod) => {
      let provider: ProviderPlugin | undefined;
      mod.registerGoogleGeminiCliProvider({
        registerProvider(entry) {
          provider = entry;
        },
      } as Pick<CrawClawPluginApi, "registerProvider"> as CrawClawPluginApi);
      if (!provider) {
        throw new Error("google gemini cli provider missing provider registration");
      }
      return provider;
    });
  }
  return await googleGeminiCliProviderPromise;
}

async function loadGoogleMediaUnderstandingProvider(): Promise<MediaUnderstandingProvider> {
  if (!googleMediaUnderstandingProviderPromise) {
    googleMediaUnderstandingProviderPromise = import("./media-understanding-provider.js").then(
      (mod) => mod.googleMediaUnderstandingProvider,
    );
  }
  return await googleMediaUnderstandingProviderPromise;
}

async function loadGoogleRequiredMediaUnderstandingProvider(): Promise<GoogleMediaUnderstandingProvider> {
  const provider = await loadGoogleMediaUnderstandingProvider();
  if (
    !provider.describeImage ||
    !provider.describeImages ||
    !provider.transcribeAudio ||
    !provider.describeVideo
  ) {
    throw new Error("google media understanding provider missing required handlers");
  }
  return provider as GoogleMediaUnderstandingProvider;
}

function createLazyGoogleGeminiCliProvider(): ProviderPlugin {
  return {
    id: GOOGLE_GEMINI_CLI_PROVIDER_ID,
    label: GOOGLE_GEMINI_CLI_PROVIDER_LABEL,
    docsPath: "/providers/models",
    aliases: ["gemini-cli"],
    envVars: [...GOOGLE_GEMINI_CLI_ENV_VARS],
    auth: [
      {
        id: "oauth",
        label: "Google OAuth",
        hint: "PKCE + localhost callback",
        kind: "oauth",
        run: async (ctx: ProviderAuthContext) => {
          const provider = await loadGoogleGeminiCliProvider();
          const authMethod = provider.auth?.[0];
          if (!authMethod || authMethod.kind !== "oauth") {
            return { profiles: [] };
          }
          return await authMethod.run(ctx);
        },
      },
    ],
    wizard: {
      setup: {
        choiceId: "google-gemini-cli",
        choiceLabel: "Gemini CLI OAuth",
        choiceHint: "Google OAuth with project-aware token payload",
        methodId: "oauth",
      },
    },
    normalizeModelId: ({ modelId }) => normalizeGoogleModelId(modelId),
    resolveDynamicModel: (ctx) =>
      resolveGoogle31ForwardCompatModel({ providerId: GOOGLE_GEMINI_CLI_PROVIDER_ID, ctx }),
    isModernModelRef: ({ modelId }) => isModernGoogleModel(modelId),
    formatApiKey: (cred) => formatGoogleOauthApiKey(cred as GoogleOauthApiKeyCredential),
    resolveUsageAuth: async (ctx) => {
      const provider = await loadGoogleGeminiCliProvider();
      return await provider.resolveUsageAuth?.(ctx);
    },
    fetchUsageSnapshot: async (ctx: ProviderFetchUsageSnapshotContext) => {
      const provider = await loadGoogleGeminiCliProvider();
      if (!provider.fetchUsageSnapshot) {
        throw new Error("google gemini cli provider missing usage snapshot handler");
      }
      return await provider.fetchUsageSnapshot(ctx);
    },
  };
}

function createLazyGoogleMediaUnderstandingProvider(): MediaUnderstandingProvider {
  return {
    id: "google",
    capabilities: ["image", "audio", "video"],
    describeImage: async (...args) =>
      await (await loadGoogleRequiredMediaUnderstandingProvider()).describeImage(...args),
    describeImages: async (...args) =>
      await (await loadGoogleRequiredMediaUnderstandingProvider()).describeImages(...args),
    transcribeAudio: async (...args) =>
      await (await loadGoogleRequiredMediaUnderstandingProvider()).transcribeAudio(...args),
    describeVideo: async (...args) =>
      await (await loadGoogleRequiredMediaUnderstandingProvider()).describeVideo(...args),
  };
}

export default definePluginEntry({
  id: "google",
  name: "Google Plugin",
  description: "Bundled Google plugin",
  register(api) {
    api.registerProvider({
      id: "google",
      label: "Google AI Studio",
      docsPath: "/providers/models",
      hookAliases: ["google-antigravity", "google-vertex"],
      envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
      auth: [
        createProviderApiKeyAuthMethod({
          providerId: "google",
          methodId: "api-key",
          label: "Google Gemini API key",
          hint: "AI Studio / Gemini API key",
          optionKey: "geminiApiKey",
          flagName: "--gemini-api-key",
          envVar: "GEMINI_API_KEY",
          promptMessage: "Enter Gemini API key",
          defaultModel: GOOGLE_GEMINI_DEFAULT_MODEL,
          expectedProviders: ["google"],
          applyConfig: (cfg) => applyGoogleGeminiModelDefault(cfg).next,
          wizard: {
            choiceId: "gemini-api-key",
            choiceLabel: "Google Gemini API key",
            groupId: "google",
            groupLabel: "Google",
            groupHint: "Gemini API key + OAuth",
          },
        }),
      ],
      normalizeTransport: ({ api, baseUrl }) =>
        resolveGoogleGenerativeAiTransport({ api, baseUrl }),
      normalizeConfig: ({ provider, providerConfig }) =>
        normalizeGoogleProviderConfig(provider, providerConfig),
      normalizeModelId: ({ modelId }) => normalizeGoogleModelId(modelId),
      resolveDynamicModel: (ctx) =>
        resolveGoogle31ForwardCompatModel({
          providerId: ctx.provider,
          templateProviderId: GOOGLE_GEMINI_CLI_PROVIDER_ID,
          ctx,
        }),
      wrapStreamFn: (ctx) => createGoogleThinkingPayloadWrapper(ctx.streamFn, ctx.thinkingLevel),
      isModernModelRef: ({ modelId }) => isModernGoogleModel(modelId),
    });
    api.registerCliBackend(buildGoogleGeminiCliBackend());
    api.registerProvider(createLazyGoogleGeminiCliProvider());
    api.registerMediaUnderstandingProvider(createLazyGoogleMediaUnderstandingProvider());
  },
});
