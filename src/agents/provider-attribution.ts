import {
  ANTHROPIC_MESSAGES_API,
  ANTHROPIC_PROVIDER_ID,
  GOOGLE_PROVIDER_ID,
  GROQ_PROVIDER_ID,
  KNOWN_PROVIDER_FAMILIES,
  LOCAL_ENDPOINT_HOSTS as LOCAL_ENDPOINT_HOST_VALUES,
  MODELSTUDIO_NATIVE_BASE_URLS as MODELSTUDIO_NATIVE_BASE_URL_VALUES,
  MODELSTUDIO_PROVIDER_ID,
  MOONSHOT_COMPAT_PROVIDERS as MOONSHOT_COMPAT_PROVIDER_VALUES,
  MOONSHOT_NATIVE_BASE_URLS as MOONSHOT_NATIVE_BASE_URL_VALUES,
  MOONSHOT_PROVIDER_ID,
  MISTRAL_PROVIDER_ID,
  OLLAMA_PROVIDER_ID,
  OPENAI_AUDIO_TRANSCRIPTIONS_API,
  OPENAI_CODEX_PROVIDER_ID,
  OPENAI_CODEX_RESPONSES_API,
  OPENAI_COMPLETIONS_API,
  OPENAI_PROVIDER_ID,
  OPENAI_RESPONSES_APIS as OPENAI_RESPONSES_API_VALUES,
  OPENAI_RESPONSES_API,
  OPENAI_RESPONSES_PROVIDERS as OPENAI_RESPONSES_PROVIDER_VALUES,
  OPENROUTER_ATTRIBUTION_CATEGORY,
  OPENROUTER_ATTRIBUTION_DOCS_URL,
  OPENROUTER_PROVIDER_ID,
  PROVIDER_ATTRIBUTION_ORIGINATOR,
  PROVIDER_ATTRIBUTION_PRODUCT,
  PROVIDER_ATTRIBUTION_REFERER_URL,
  TOGETHER_PROVIDER_ID,
} from "../providers/runtime-constants.js";
import type { RuntimeVersionEnv } from "../version.js";
import { resolveRuntimeServiceVersion } from "../version.js";
import { normalizeProviderId } from "./provider-id.js";

export type ProviderAttributionVerification =
  | "vendor-documented"
  | "vendor-hidden-api-spec"
  | "vendor-sdk-hook-only"
  | "internal-runtime";

export type ProviderAttributionHook =
  | "request-headers"
  | "default-headers"
  | "user-agent-extra"
  | "custom-user-agent";

export type ProviderAttributionPolicy = {
  provider: string;
  enabledByDefault: boolean;
  verification: ProviderAttributionVerification;
  hook?: ProviderAttributionHook;
  docsUrl?: string;
  reviewNote?: string;
  product: string;
  version: string;
  headers?: Record<string, string>;
};

export type ProviderAttributionIdentity = Pick<ProviderAttributionPolicy, "product" | "version">;

export type ProviderRequestTransport = "stream" | "websocket" | "http" | "media-understanding";
export type ProviderRequestCapability = "llm" | "audio" | "image" | "video" | "other";

export type ProviderEndpointClass =
  | "default"
  | "anthropic-public"
  | "github-copilot-native"
  | "moonshot-native"
  | "modelstudio-native"
  | "openai-public"
  | "openai-codex"
  | "azure-openai"
  | "openrouter"
  | "google-generative-ai"
  | "google-vertex"
  | "local"
  | "custom"
  | "invalid";

export type ProviderEndpointResolution = {
  endpointClass: ProviderEndpointClass;
  hostname?: string;
  googleVertexRegion?: string;
};

export type ProviderRequestPolicyInput = {
  provider?: string | null;
  api?: string | null;
  baseUrl?: string | null;
  transport?: ProviderRequestTransport;
  capability?: ProviderRequestCapability;
};

export type ProviderRequestPolicyResolution = {
  provider?: string;
  policy?: ProviderAttributionPolicy;
  endpointClass: ProviderEndpointClass;
  usesConfiguredBaseUrl: boolean;
  knownProviderFamily: string;
  attributionProvider?: string;
  attributionHeaders?: Record<string, string>;
  allowsHiddenAttribution: boolean;
  usesKnownNativeOpenAIEndpoint: boolean;
  usesKnownNativeOpenAIRoute: boolean;
  usesVerifiedOpenAIAttributionHost: boolean;
  usesExplicitProxyLikeEndpoint: boolean;
};

export type ProviderRequestCapabilitiesInput = ProviderRequestPolicyInput & {
  modelId?: string | null;
  compat?: {
    supportsStore?: boolean;
  } | null;
};

export type ProviderRequestCompatibilityFamily = "moonshot";

export type ProviderRequestCapabilities = ProviderRequestPolicyResolution & {
  isKnownNativeEndpoint: boolean;
  allowsOpenAIServiceTier: boolean;
  allowsAnthropicServiceTier: boolean;
  supportsResponsesStoreField: boolean;
  allowsResponsesStore: boolean;
  shouldStripResponsesPromptCache: boolean;
  supportsNativeStreamingUsageCompat: boolean;
  compatibilityFamily?: ProviderRequestCompatibilityFamily;
};

const LOCAL_ENDPOINT_HOSTS = new Set<string>(LOCAL_ENDPOINT_HOST_VALUES);
const MOONSHOT_NATIVE_BASE_URLS = new Set<string>(MOONSHOT_NATIVE_BASE_URL_VALUES);
const MODELSTUDIO_NATIVE_BASE_URLS = new Set<string>(MODELSTUDIO_NATIVE_BASE_URL_VALUES);
const OPENAI_RESPONSES_APIS = new Set<string>(OPENAI_RESPONSES_API_VALUES);
const OPENAI_RESPONSES_PROVIDERS = new Set<string>(OPENAI_RESPONSES_PROVIDER_VALUES);
const MOONSHOT_COMPAT_PROVIDERS = new Set<string>(MOONSHOT_COMPAT_PROVIDER_VALUES);
const KNOWN_PROVIDER_FAMILY_BY_ID: Readonly<Record<string, string>> = KNOWN_PROVIDER_FAMILIES;

function formatCrawClawUserAgent(version: string): string {
  return `${PROVIDER_ATTRIBUTION_ORIGINATOR}/${version}`;
}

function tryParseHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isSchemelessHostnameCandidate(value: string): boolean {
  return /^[a-z0-9.[\]-]+(?::\d+)?(?:[/?#].*)?$/i.test(value);
}

function resolveUrlHostname(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  const parsedHostname = tryParseHostname(trimmed);
  if (parsedHostname) {
    return parsedHostname;
  }
  if (!isSchemelessHostnameCandidate(trimmed)) {
    return undefined;
  }
  return tryParseHostname(`https://${trimmed}`);
}

function normalizeComparableBaseUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsedValue =
    tryParseHostname(trimmed) || !isSchemelessHostnameCandidate(trimmed)
      ? trimmed
      : `https://${trimmed}`;
  try {
    const url = new URL(parsedValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return undefined;
  }
}

function isLocalEndpointHost(host: string): boolean {
  return (
    LOCAL_ENDPOINT_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

export function resolveProviderEndpoint(
  baseUrl: string | null | undefined,
): ProviderEndpointResolution {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return { endpointClass: "default" };
  }

  const host = resolveUrlHostname(baseUrl);
  if (!host) {
    return { endpointClass: "invalid" };
  }
  const normalizedBaseUrl = normalizeComparableBaseUrl(baseUrl);
  if (normalizedBaseUrl && MOONSHOT_NATIVE_BASE_URLS.has(normalizedBaseUrl)) {
    return { endpointClass: "moonshot-native", hostname: host };
  }
  if (normalizedBaseUrl && MODELSTUDIO_NATIVE_BASE_URLS.has(normalizedBaseUrl)) {
    return { endpointClass: "modelstudio-native", hostname: host };
  }
  if (host === "api.openai.com") {
    return { endpointClass: "openai-public", hostname: host };
  }
  if (host === "api.anthropic.com") {
    return { endpointClass: "anthropic-public", hostname: host };
  }
  if (host.endsWith(".githubcopilot.com")) {
    return { endpointClass: "github-copilot-native", hostname: host };
  }
  if (host === "chatgpt.com") {
    return { endpointClass: "openai-codex", hostname: host };
  }
  if (host === "openrouter.ai" || host.endsWith(".openrouter.ai")) {
    return { endpointClass: "openrouter", hostname: host };
  }
  if (host.endsWith(".openai.azure.com")) {
    return { endpointClass: "azure-openai", hostname: host };
  }
  if (host === "generativelanguage.googleapis.com") {
    return { endpointClass: "google-generative-ai", hostname: host };
  }
  if (host === "aiplatform.googleapis.com") {
    return {
      endpointClass: "google-vertex",
      hostname: host,
      googleVertexRegion: "global",
    };
  }
  const googleVertexHost = /^([a-z0-9-]+)-aiplatform\.googleapis\.com$/.exec(host);
  if (googleVertexHost) {
    return {
      endpointClass: "google-vertex",
      hostname: host,
      googleVertexRegion: googleVertexHost[1],
    };
  }
  if (isLocalEndpointHost(host)) {
    return { endpointClass: "local", hostname: host };
  }
  return { endpointClass: "custom", hostname: host };
}

function resolveKnownProviderFamily(provider: string | undefined): string {
  return provider ? (KNOWN_PROVIDER_FAMILY_BY_ID[provider] ?? provider) : "unknown";
}

export function resolveProviderAttributionIdentity(
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
): ProviderAttributionIdentity {
  return {
    product: PROVIDER_ATTRIBUTION_PRODUCT,
    version: resolveRuntimeServiceVersion(env),
  };
}

function buildOpenRouterAttributionPolicy(
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
): ProviderAttributionPolicy {
  const identity = resolveProviderAttributionIdentity(env);
  return {
    provider: OPENROUTER_PROVIDER_ID,
    enabledByDefault: true,
    verification: "vendor-documented",
    hook: "request-headers",
    docsUrl: OPENROUTER_ATTRIBUTION_DOCS_URL,
    reviewNote: "Documented app attribution headers. Verified in CrawClaw runtime wrapper.",
    ...identity,
    headers: {
      "HTTP-Referer": PROVIDER_ATTRIBUTION_REFERER_URL,
      "X-OpenRouter-Title": identity.product,
      "X-OpenRouter-Categories": OPENROUTER_ATTRIBUTION_CATEGORY,
    },
  };
}

function buildOpenAIAttributionPolicy(
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
): ProviderAttributionPolicy {
  const identity = resolveProviderAttributionIdentity(env);
  return {
    provider: OPENAI_PROVIDER_ID,
    enabledByDefault: true,
    verification: "vendor-hidden-api-spec",
    hook: "request-headers",
    reviewNote:
      "OpenAI native traffic supports hidden originator/User-Agent attribution. Verified against the Codex wire contract.",
    ...identity,
    headers: {
      originator: PROVIDER_ATTRIBUTION_ORIGINATOR,
      version: identity.version,
      "User-Agent": formatCrawClawUserAgent(identity.version),
    },
  };
}

function buildOpenAICodexAttributionPolicy(
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
): ProviderAttributionPolicy {
  const identity = resolveProviderAttributionIdentity(env);
  return {
    provider: OPENAI_CODEX_PROVIDER_ID,
    enabledByDefault: true,
    verification: "vendor-hidden-api-spec",
    hook: "request-headers",
    reviewNote:
      "OpenAI Codex ChatGPT-backed traffic supports the same hidden originator/User-Agent attribution contract.",
    ...identity,
    headers: {
      originator: PROVIDER_ATTRIBUTION_ORIGINATOR,
      version: identity.version,
      "User-Agent": formatCrawClawUserAgent(identity.version),
    },
  };
}

function buildSdkHookOnlyPolicy(
  provider: string,
  hook: ProviderAttributionHook,
  reviewNote: string,
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
): ProviderAttributionPolicy {
  return {
    provider,
    enabledByDefault: false,
    verification: "vendor-sdk-hook-only",
    hook,
    reviewNote,
    ...resolveProviderAttributionIdentity(env),
  };
}

export function listProviderAttributionPolicies(
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
): ProviderAttributionPolicy[] {
  return [
    buildOpenRouterAttributionPolicy(env),
    buildOpenAIAttributionPolicy(env),
    buildOpenAICodexAttributionPolicy(env),
    buildSdkHookOnlyPolicy(
      ANTHROPIC_PROVIDER_ID,
      "default-headers",
      "Anthropic JS SDK exposes defaultHeaders, but app attribution is not yet verified.",
      env,
    ),
    buildSdkHookOnlyPolicy(
      GOOGLE_PROVIDER_ID,
      "user-agent-extra",
      "Google GenAI JS SDK exposes userAgentExtra/httpOptions, but provider-side attribution is not yet verified.",
      env,
    ),
    buildSdkHookOnlyPolicy(
      GROQ_PROVIDER_ID,
      "default-headers",
      "Groq JS SDK exposes defaultHeaders, but app attribution is not yet verified.",
      env,
    ),
    buildSdkHookOnlyPolicy(
      MISTRAL_PROVIDER_ID,
      "custom-user-agent",
      "Mistral JS SDK exposes a custom userAgent option, but app attribution is not yet verified.",
      env,
    ),
    buildSdkHookOnlyPolicy(
      TOGETHER_PROVIDER_ID,
      "default-headers",
      "Together JS SDK exposes defaultHeaders, but app attribution is not yet verified.",
      env,
    ),
  ];
}

export function resolveProviderAttributionPolicy(
  provider?: string | null,
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
): ProviderAttributionPolicy | undefined {
  const normalized = normalizeProviderId(provider ?? "");
  return listProviderAttributionPolicies(env).find((policy) => policy.provider === normalized);
}

export function resolveProviderAttributionHeaders(
  provider?: string | null,
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
): Record<string, string> | undefined {
  const policy = resolveProviderAttributionPolicy(provider, env);
  if (!policy?.enabledByDefault) {
    return undefined;
  }
  return policy.headers;
}

export function resolveProviderRequestPolicy(
  input: ProviderRequestPolicyInput,
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
): ProviderRequestPolicyResolution {
  const provider = normalizeProviderId(input.provider ?? "");
  const policy = resolveProviderAttributionPolicy(provider, env);
  const endpointResolution = resolveProviderEndpoint(input.baseUrl);
  const endpointClass = endpointResolution.endpointClass;
  const api = input.api?.trim().toLowerCase();
  const usesConfiguredBaseUrl = endpointClass !== "default";
  const usesKnownNativeOpenAIEndpoint =
    endpointClass === "openai-public" ||
    endpointClass === "openai-codex" ||
    endpointClass === "azure-openai";
  const usesOpenAIPublicAttributionHost = endpointClass === "openai-public";
  const usesOpenAICodexAttributionHost = endpointClass === "openai-codex";
  const usesVerifiedOpenAIAttributionHost =
    usesOpenAIPublicAttributionHost || usesOpenAICodexAttributionHost;
  const usesExplicitProxyLikeEndpoint = usesConfiguredBaseUrl && !usesKnownNativeOpenAIEndpoint;

  let attributionProvider: string | undefined;
  if (
    provider === OPENAI_PROVIDER_ID &&
    (api === OPENAI_COMPLETIONS_API ||
      api === OPENAI_RESPONSES_API ||
      (input.capability === "audio" && api === OPENAI_AUDIO_TRANSCRIPTIONS_API)) &&
    usesOpenAIPublicAttributionHost
  ) {
    attributionProvider = OPENAI_PROVIDER_ID;
  } else if (
    provider === OPENAI_CODEX_PROVIDER_ID &&
    (api === OPENAI_CODEX_RESPONSES_API || api === OPENAI_RESPONSES_API) &&
    usesOpenAICodexAttributionHost
  ) {
    attributionProvider = OPENAI_CODEX_PROVIDER_ID;
  } else if (provider === OPENROUTER_PROVIDER_ID && policy?.enabledByDefault) {
    // OpenRouter attribution is documented and intentionally remains
    // provider-key-gated for this pass, including custom base URLs configured
    // under the openrouter provider. The endpoint class is still surfaced so a
    // later host-gating decision can reuse the same classifier without changing
    // callers again.
    attributionProvider = OPENROUTER_PROVIDER_ID;
  }

  const attributionHeaders = attributionProvider
    ? resolveProviderAttributionHeaders(attributionProvider, env)
    : undefined;

  return {
    provider: provider || undefined,
    policy,
    endpointClass,
    usesConfiguredBaseUrl,
    knownProviderFamily: resolveKnownProviderFamily(provider || undefined),
    attributionProvider,
    attributionHeaders,
    allowsHiddenAttribution:
      attributionProvider !== undefined && policy?.verification === "vendor-hidden-api-spec",
    usesKnownNativeOpenAIEndpoint,
    usesKnownNativeOpenAIRoute:
      endpointClass === "default" ? provider === OPENAI_PROVIDER_ID : usesKnownNativeOpenAIEndpoint,
    usesVerifiedOpenAIAttributionHost,
    usesExplicitProxyLikeEndpoint,
  };
}

export function resolveProviderRequestAttributionHeaders(
  input: ProviderRequestPolicyInput,
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
): Record<string, string> | undefined {
  return resolveProviderRequestPolicy(input, env).attributionHeaders;
}

export function resolveProviderRequestCapabilities(
  input: ProviderRequestCapabilitiesInput,
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
): ProviderRequestCapabilities {
  const policy = resolveProviderRequestPolicy(input, env);
  const provider = policy.provider;
  const api = input.api?.trim().toLowerCase();
  const normalizedModelId = input.modelId?.trim().toLowerCase();
  const endpointClass = policy.endpointClass;
  const isKnownNativeEndpoint =
    endpointClass === "anthropic-public" ||
    endpointClass === "github-copilot-native" ||
    endpointClass === "moonshot-native" ||
    endpointClass === "modelstudio-native" ||
    endpointClass === "openai-public" ||
    endpointClass === "openai-codex" ||
    endpointClass === "azure-openai" ||
    endpointClass === "openrouter" ||
    endpointClass === "google-generative-ai" ||
    endpointClass === "google-vertex";

  let compatibilityFamily: ProviderRequestCompatibilityFamily | undefined;
  if (provider && MOONSHOT_COMPAT_PROVIDERS.has(provider)) {
    compatibilityFamily = "moonshot";
  } else if (
    provider === OLLAMA_PROVIDER_ID &&
    normalizedModelId?.startsWith("kimi-k") &&
    normalizedModelId.includes(":cloud")
  ) {
    compatibilityFamily = "moonshot";
  }

  return {
    ...policy,
    isKnownNativeEndpoint,
    allowsOpenAIServiceTier:
      (provider === OPENAI_PROVIDER_ID &&
        api === OPENAI_RESPONSES_API &&
        endpointClass === "openai-public") ||
      (provider === OPENAI_CODEX_PROVIDER_ID &&
        (api === OPENAI_CODEX_RESPONSES_API || api === OPENAI_RESPONSES_API) &&
        endpointClass === "openai-codex"),
    allowsAnthropicServiceTier:
      provider === ANTHROPIC_PROVIDER_ID &&
      api === ANTHROPIC_MESSAGES_API &&
      (endpointClass === "default" || endpointClass === "anthropic-public"),
    // This is intentionally the gate for emitting `store: false` on Responses
    // transports, not just a statement about vendor support in the abstract.
    supportsResponsesStoreField:
      input.compat?.supportsStore !== false && api !== undefined && OPENAI_RESPONSES_APIS.has(api),
    allowsResponsesStore:
      input.compat?.supportsStore !== false &&
      provider !== undefined &&
      api !== undefined &&
      OPENAI_RESPONSES_APIS.has(api) &&
      OPENAI_RESPONSES_PROVIDERS.has(provider) &&
      policy.usesKnownNativeOpenAIEndpoint,
    shouldStripResponsesPromptCache:
      api !== undefined && OPENAI_RESPONSES_APIS.has(api) && policy.usesExplicitProxyLikeEndpoint,
    supportsNativeStreamingUsageCompat:
      (provider === MOONSHOT_PROVIDER_ID && endpointClass === "moonshot-native") ||
      (provider === MODELSTUDIO_PROVIDER_ID && endpointClass === "modelstudio-native"),
    compatibilityFamily,
  };
}
