import fs from "node:fs";
import path from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import { XAI_PROVIDER_ID } from "../generated/providers/runtime-constants.generated.js";
import { normalizeModelCompat } from "../plugins/provider-model-compat.js";
import { ensureAuthProfileStore } from "./auth-profiles.js";
import { PROVIDER_ENV_API_KEY_CANDIDATES } from "./model-auth-env-vars.js";
import { resolveEnvApiKey } from "./model-auth-env.js";
import { resolvePiCredentialMapFromStore, type PiCredentialMap } from "./pi-auth-credentials.js";
import type { ProviderRuntimeModel } from "./provider-runtime-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRegistryModel<T>(value: T): T {
  if (!isRecord(value)) {
    return value;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.api !== "string"
  ) {
    return value;
  }
  const model = value as unknown as ProviderRuntimeModel;
  return normalizeModelCompat(model as Model<Api>) as T;
}

function applyDiscoveredProviderCompat(model: Model<Api>): Model<Api> {
  const provider = typeof model.provider === "string" ? model.provider.toLowerCase() : "";
  const id = typeof model.id === "string" ? model.id.toLowerCase() : "";
  const baseUrl = typeof model.baseUrl === "string" ? model.baseUrl.toLowerCase() : "";
  const isMistral =
    provider.includes("mistral") || id.includes("mistral") || baseUrl.includes("mistral.ai");
  const isXai =
    provider === XAI_PROVIDER_ID ||
    provider.includes("xai") ||
    id.startsWith("x-ai/") ||
    id.includes("grok") ||
    baseUrl.includes("api.x.ai");
  if (isXai) {
    return {
      ...model,
      api: "openai-responses",
      compat: {
        ...model.compat,
        toolSchemaProfile: "xai",
        nativeWebSearchTool: true,
        toolCallArgumentsEncoding: "html-entities",
      } as unknown as Model<Api>["compat"],
    } as Model<Api>;
  }
  if (isMistral) {
    return {
      ...model,
      compat: {
        ...model.compat,
        supportsStore: false,
        supportsReasoningEffort: false,
        maxTokensField: "max_tokens",
      } as unknown as Model<Api>["compat"],
    } as Model<Api>;
  }
  return model;
}

function readModelsJson(modelsJsonPath: string): Model<Api>[] {
  if (!fs.existsSync(modelsJsonPath)) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(modelsJsonPath, "utf8")) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed.providers)) {
    return [];
  }
  const models: Model<Api>[] = [];
  for (const [provider, providerConfig] of Object.entries(parsed.providers)) {
    if (!isRecord(providerConfig) || !Array.isArray(providerConfig.models)) {
      continue;
    }
    for (const entry of providerConfig.models) {
      if (!isRecord(entry) || typeof entry.id !== "string") {
        continue;
      }
      const api =
        typeof entry.api === "string"
          ? entry.api
          : typeof providerConfig.api === "string"
            ? providerConfig.api
            : "openai-responses";
      const model = {
        ...entry,
        id: entry.id,
        name: typeof entry.name === "string" ? entry.name : entry.id,
        provider,
        api,
        baseUrl:
          typeof entry.baseUrl === "string"
            ? entry.baseUrl
            : typeof providerConfig.baseUrl === "string"
              ? providerConfig.baseUrl
              : undefined,
        headers: isRecord(providerConfig.headers) ? providerConfig.headers : entry.headers,
        input: Array.isArray(entry.input) ? entry.input : ["text"],
        cost: isRecord(entry.cost)
          ? entry.cost
          : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow:
          typeof entry.contextWindow === "number" && Number.isFinite(entry.contextWindow)
            ? entry.contextWindow
            : 128_000,
        maxTokens:
          typeof entry.maxTokens === "number" && Number.isFinite(entry.maxTokens)
            ? entry.maxTokens
            : 16_384,
      } as Model<Api>;
      models.push(applyDiscoveredProviderCompat(normalizeRegistryModel(model)));
    }
  }
  return models;
}

function scrubLegacyStaticAuthJsonEntries(pathname: string): void {
  if (process.env.CRAWCLAW_AUTH_STORE_READONLY === "1") {
    return;
  }
  if (!fs.existsSync(pathname)) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(pathname, "utf8")) as unknown;
  } catch {
    return;
  }
  if (!isRecord(parsed)) {
    return;
  }

  let changed = false;
  for (const [provider, value] of Object.entries(parsed)) {
    if (!isRecord(value)) {
      continue;
    }
    if (value.type !== "api_key") {
      continue;
    }
    delete parsed[provider];
    changed = true;
  }

  if (!changed) {
    return;
  }

  if (Object.keys(parsed).length === 0) {
    fs.rmSync(pathname, { force: true });
    return;
  }

  fs.writeFileSync(pathname, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  fs.chmodSync(pathname, 0o600);
}

function resolvePiCredentials(agentDir: string): PiCredentialMap {
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const credentials = resolvePiCredentialMapFromStore(store);
  for (const provider of Object.keys(PROVIDER_ENV_API_KEY_CANDIDATES)) {
    if (credentials[provider]) {
      continue;
    }
    const resolved = resolveEnvApiKey(provider);
    if (!resolved?.apiKey) {
      continue;
    }
    credentials[provider] = {
      type: "api_key",
      key: resolved.apiKey,
    };
  }
  return credentials;
}

export class AuthStorage {
  private readonly runtimeApiKeys = new Map<string, string>();

  constructor(private readonly credentials: PiCredentialMap = {}) {}

  static inMemory(data?: unknown): AuthStorage {
    return new AuthStorage(isRecord(data) ? (data as PiCredentialMap) : {});
  }

  static create(_pathname: string): AuthStorage {
    return new AuthStorage();
  }

  hasAuth(provider: string): boolean {
    return this.getCredential(provider) !== undefined;
  }

  get(provider: string): PiCredentialMap[string] | undefined {
    return this.getCredential(provider);
  }

  async getApiKey(provider: string): Promise<string | undefined> {
    const credential = this.getCredential(provider);
    if (!credential) {
      return undefined;
    }
    return credential.type === "api_key" ? credential.key : credential.access;
  }

  private getCredential(provider: string): PiCredentialMap[string] | undefined {
    const normalized = provider.trim();
    const runtimeKey = this.runtimeApiKeys.get(normalized);
    if (runtimeKey) {
      return { type: "api_key", key: runtimeKey };
    }
    return this.credentials[normalized];
  }

  setRuntimeApiKey(provider: string, apiKey: string): void {
    const normalized = provider.trim();
    if (normalized && apiKey) {
      this.runtimeApiKeys.set(normalized, apiKey);
    }
  }
}

export class ModelRegistry {
  private readonly models: Model<Api>[];

  constructor(_authStorage: AuthStorage, modelsJsonPath: string) {
    this.models = readModelsJson(modelsJsonPath);
  }

  static create(authStorage: AuthStorage, modelsJsonPath: string): ModelRegistry {
    return new ModelRegistry(authStorage, modelsJsonPath);
  }

  getAll(): Model<Api>[] {
    return this.models.map((model) => normalizeRegistryModel(model));
  }

  getAvailable(): Model<Api>[] {
    return this.getAll();
  }

  find(provider: string, modelId: string): Model<Api> | null {
    return this.models.find((model) => model.provider === provider && model.id === modelId) ?? null;
  }

  getError(): undefined {
    return undefined;
  }
}

export function discoverAuthStorage(agentDir: string): AuthStorage {
  const credentials = resolvePiCredentials(agentDir);
  const authPath = path.join(agentDir, "auth.json");
  scrubLegacyStaticAuthJsonEntries(authPath);
  return new AuthStorage(credentials);
}

export function discoverModels(authStorage: AuthStorage, agentDir: string): ModelRegistry {
  return new ModelRegistry(authStorage, path.join(agentDir, "models.json"));
}
