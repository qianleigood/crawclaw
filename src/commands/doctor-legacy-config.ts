import { normalizeProviderId } from "../agents/model-selection.js";
import { shouldMoveSingleAccountChannelKey } from "../channels/plugins/setup-helpers.js";
import type { CrawClawConfig } from "../config/config.js";
import { resolveNormalizedProviderModelMaxTokens } from "../config/defaults.js";
import { LEGACY_TALK_PROVIDER_ID, normalizeTalkSection } from "../config/talk.js";
import { DEFAULT_GOOGLE_API_BASE_URL } from "../infra/google-api-base-url.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";

export function normalizeCompatibilityConfigValues(cfg: CrawClawConfig): {
  config: CrawClawConfig;
  changes: string[];
} {
  const changes: string[] = [];
  const NANO_BANANA_SKILL_KEY = "nano-banana-pro";
  let next: CrawClawConfig = cfg;

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const normalizeLegacyBrowserProfiles = () => {
    const rawBrowser = next.browser;
    if (!isRecord(rawBrowser)) {
      return;
    }

    const browser = structuredClone(rawBrowser);
    let browserChanged = false;

    if ("relayBindHost" in browser) {
      delete browser.relayBindHost;
      browserChanged = true;
      changes.push("Removed browser.relayBindHost (legacy browser relay setting).");
    }

    if (!browserChanged) {
      return;
    }

    next = {
      ...next,
      browser,
    };
  };

  const seedMissingDefaultAccountsFromSingleAccountBase = () => {
    const channels = next.channels as Record<string, unknown> | undefined;
    if (!channels) {
      return;
    }

    let channelsChanged = false;
    const nextChannels = { ...channels };
    for (const [channelId, rawChannel] of Object.entries(channels)) {
      if (!isRecord(rawChannel)) {
        continue;
      }
      const rawAccounts = rawChannel.accounts;
      if (!isRecord(rawAccounts)) {
        continue;
      }
      const accountKeys = Object.keys(rawAccounts);
      if (accountKeys.length === 0) {
        continue;
      }
      const hasDefault = accountKeys.some((key) => key.trim().toLowerCase() === DEFAULT_ACCOUNT_ID);
      if (hasDefault) {
        continue;
      }

      const keysToMove = Object.entries(rawChannel)
        .filter(
          ([key, value]) =>
            key !== "accounts" &&
            key !== "enabled" &&
            value !== undefined &&
            shouldMoveSingleAccountChannelKey({ channelKey: channelId, key }),
        )
        .map(([key]) => key);
      if (keysToMove.length === 0) {
        continue;
      }

      const defaultAccount: Record<string, unknown> = {};
      for (const key of keysToMove) {
        const value = rawChannel[key];
        defaultAccount[key] = value && typeof value === "object" ? structuredClone(value) : value;
      }
      const nextChannel: Record<string, unknown> = {
        ...rawChannel,
      };
      for (const key of keysToMove) {
        delete nextChannel[key];
      }
      nextChannel.accounts = {
        ...rawAccounts,
        [DEFAULT_ACCOUNT_ID]: defaultAccount,
      };

      nextChannels[channelId] = nextChannel;
      channelsChanged = true;
      changes.push(
        `Moved channels.${channelId} single-account top-level values into channels.${channelId}.accounts.default.`,
      );
    }

    if (!channelsChanged) {
      return;
    }
    next = {
      ...next,
      channels: nextChannels as CrawClawConfig["channels"],
    };
  };

  seedMissingDefaultAccountsFromSingleAccountBase();
  normalizeLegacyBrowserProfiles();

  const normalizeBrowserSsrFPolicyAlias = () => {
    const rawBrowser = next.browser;
    if (!isRecord(rawBrowser)) {
      return;
    }
    const rawSsrFPolicy = rawBrowser.ssrfPolicy;
    if (!isRecord(rawSsrFPolicy) || !("allowPrivateNetwork" in rawSsrFPolicy)) {
      return;
    }

    const legacyAllowPrivateNetwork = rawSsrFPolicy.allowPrivateNetwork;
    const currentDangerousAllowPrivateNetwork = rawSsrFPolicy.dangerouslyAllowPrivateNetwork;

    let resolvedDangerousAllowPrivateNetwork: unknown = currentDangerousAllowPrivateNetwork;
    if (
      typeof legacyAllowPrivateNetwork === "boolean" ||
      typeof currentDangerousAllowPrivateNetwork === "boolean"
    ) {
      // Preserve runtime behavior while collapsing to the canonical key.
      resolvedDangerousAllowPrivateNetwork =
        legacyAllowPrivateNetwork === true || currentDangerousAllowPrivateNetwork === true;
    } else if (currentDangerousAllowPrivateNetwork === undefined) {
      resolvedDangerousAllowPrivateNetwork = legacyAllowPrivateNetwork;
    }

    const nextSsrFPolicy: Record<string, unknown> = { ...rawSsrFPolicy };
    delete nextSsrFPolicy.allowPrivateNetwork;
    if (resolvedDangerousAllowPrivateNetwork !== undefined) {
      nextSsrFPolicy.dangerouslyAllowPrivateNetwork = resolvedDangerousAllowPrivateNetwork;
    }

    const migratedBrowser = { ...next.browser } as Record<string, unknown>;
    migratedBrowser.ssrfPolicy = nextSsrFPolicy;

    next = {
      ...next,
      browser: migratedBrowser as CrawClawConfig["browser"],
    };
    changes.push(
      `Moved browser.ssrfPolicy.allowPrivateNetwork → browser.ssrfPolicy.dangerouslyAllowPrivateNetwork (${String(resolvedDangerousAllowPrivateNetwork)}).`,
    );
  };

  const normalizeLegacyNanoBananaSkill = () => {
    type ModelProviderEntry = Partial<
      NonNullable<NonNullable<CrawClawConfig["models"]>["providers"]>[string]
    >;
    type ModelsConfigPatch = Partial<NonNullable<CrawClawConfig["models"]>>;

    const rawSkills = next.skills;
    if (!isRecord(rawSkills)) {
      return;
    }

    let skillsChanged = false;
    let skills = structuredClone(rawSkills);

    if (Array.isArray(skills.allowBundled)) {
      const allowBundled = skills.allowBundled.filter(
        (value) => typeof value !== "string" || value.trim() !== NANO_BANANA_SKILL_KEY,
      );
      if (allowBundled.length !== skills.allowBundled.length) {
        if (allowBundled.length === 0) {
          delete skills.allowBundled;
          changes.push(`Removed skills.allowBundled entry for ${NANO_BANANA_SKILL_KEY}.`);
        } else {
          skills.allowBundled = allowBundled;
          changes.push(`Removed ${NANO_BANANA_SKILL_KEY} from skills.allowBundled.`);
        }
        skillsChanged = true;
      }
    }

    const rawEntries = skills.entries;
    if (!isRecord(rawEntries)) {
      if (skillsChanged) {
        next = { ...next, skills };
      }
      return;
    }

    const rawLegacyEntry = rawEntries[NANO_BANANA_SKILL_KEY];
    if (!isRecord(rawLegacyEntry)) {
      if (skillsChanged) {
        next = { ...next, skills };
      }
      return;
    }

    const legacyEnv = isRecord(rawLegacyEntry.env) ? rawLegacyEntry.env : undefined;
    const legacyEnvApiKey =
      typeof legacyEnv?.GEMINI_API_KEY === "string" ? legacyEnv.GEMINI_API_KEY.trim() : "";
    const legacyApiKey =
      legacyEnvApiKey ||
      (typeof rawLegacyEntry.apiKey === "string"
        ? rawLegacyEntry.apiKey.trim()
        : rawLegacyEntry.apiKey && isRecord(rawLegacyEntry.apiKey)
          ? structuredClone(rawLegacyEntry.apiKey)
          : undefined);

    const rawModels = (
      isRecord(next.models) ? structuredClone(next.models) : {}
    ) as ModelsConfigPatch;
    const rawProviders = (
      isRecord(rawModels.providers) ? { ...rawModels.providers } : {}
    ) as Record<string, ModelProviderEntry>;
    const rawGoogle = (
      isRecord(rawProviders.google) ? { ...rawProviders.google } : {}
    ) as ModelProviderEntry;
    const hasGoogleApiKey = rawGoogle.apiKey !== undefined;
    if (!hasGoogleApiKey && legacyApiKey) {
      rawGoogle.apiKey = legacyApiKey;
      if (!rawGoogle.baseUrl) {
        rawGoogle.baseUrl = DEFAULT_GOOGLE_API_BASE_URL;
      }
      if (!Array.isArray(rawGoogle.models)) {
        rawGoogle.models = [];
      }
      rawProviders.google = rawGoogle;
      rawModels.providers = rawProviders as NonNullable<CrawClawConfig["models"]>["providers"];
      next = {
        ...next,
        models: rawModels as CrawClawConfig["models"],
      };
      changes.push(
        `Moved skills.entries.${NANO_BANANA_SKILL_KEY}.${legacyEnvApiKey ? "env.GEMINI_API_KEY" : "apiKey"} → models.providers.google.apiKey.`,
      );
    }

    const entries = { ...rawEntries };
    delete entries[NANO_BANANA_SKILL_KEY];
    if (Object.keys(entries).length === 0) {
      delete skills.entries;
      changes.push(`Removed legacy skills.entries.${NANO_BANANA_SKILL_KEY}.`);
    } else {
      skills.entries = entries;
      changes.push(`Removed legacy skills.entries.${NANO_BANANA_SKILL_KEY}.`);
    }
    skillsChanged = true;

    if (Object.keys(skills).length === 0) {
      const { skills: _ignored, ...rest } = next;
      next = rest;
      return;
    }

    if (skillsChanged) {
      next = {
        ...next,
        skills,
      };
    }
  };

  const normalizeLegacyTalkConfig = () => {
    const rawTalk = next.talk;
    if (!isRecord(rawTalk)) {
      return;
    }

    const normalizedTalk = normalizeTalkSection(rawTalk as CrawClawConfig["talk"]);
    if (!normalizedTalk) {
      return;
    }

    const sameShape = JSON.stringify(normalizedTalk) === JSON.stringify(rawTalk);
    if (sameShape) {
      return;
    }

    const hasProviderShape = typeof rawTalk.provider === "string" || isRecord(rawTalk.providers);
    next = {
      ...next,
      talk: normalizedTalk,
    };

    if (hasProviderShape) {
      changes.push(
        "Normalized talk.provider/providers shape (trimmed provider ids and merged missing compatibility fields).",
      );
      return;
    }

    changes.push(`Moved legacy talk flat fields → talk.providers.${LEGACY_TALK_PROVIDER_ID}.`);
  };

  const normalizeLegacyCrossContextMessageConfig = () => {
    const rawTools = next.tools;
    if (!isRecord(rawTools)) {
      return;
    }
    const rawMessage = rawTools.message;
    if (!isRecord(rawMessage) || !("allowCrossContextSend" in rawMessage)) {
      return;
    }

    const legacyAllowCrossContextSend = rawMessage.allowCrossContextSend;
    if (typeof legacyAllowCrossContextSend !== "boolean") {
      return;
    }

    const nextMessage = { ...rawMessage };
    delete nextMessage.allowCrossContextSend;

    if (legacyAllowCrossContextSend) {
      const rawCrossContext = isRecord(nextMessage.crossContext)
        ? structuredClone(nextMessage.crossContext)
        : {};
      rawCrossContext.allowWithinProvider = true;
      rawCrossContext.allowAcrossProviders = true;
      nextMessage.crossContext = rawCrossContext;
      changes.push(
        "Moved tools.message.allowCrossContextSend → tools.message.crossContext.allowWithinProvider/allowAcrossProviders (true).",
      );
    } else {
      changes.push(
        "Removed tools.message.allowCrossContextSend=false (default cross-context policy already matches canonical settings).",
      );
    }

    next = {
      ...next,
      tools: {
        ...next.tools,
        message: nextMessage,
      },
    };
  };

  const normalizeLegacyMistralModelMaxTokens = () => {
    const rawProviders = next.models?.providers;
    if (!isRecord(rawProviders)) {
      return;
    }

    let providersChanged = false;
    const nextProviders = { ...rawProviders };
    for (const [providerId, rawProvider] of Object.entries(rawProviders)) {
      if (normalizeProviderId(providerId) !== "mistral" || !isRecord(rawProvider)) {
        continue;
      }
      const rawModels = rawProvider.models;
      if (!Array.isArray(rawModels)) {
        continue;
      }

      let modelsChanged = false;
      const nextModels = rawModels.map((model, index) => {
        if (!isRecord(model)) {
          return model;
        }
        const modelId = typeof model.id === "string" ? model.id.trim() : "";
        const contextWindow =
          typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow)
            ? model.contextWindow
            : null;
        const maxTokens =
          typeof model.maxTokens === "number" && Number.isFinite(model.maxTokens)
            ? model.maxTokens
            : null;
        if (!modelId || contextWindow === null || maxTokens === null) {
          return model;
        }

        const normalizedMaxTokens = resolveNormalizedProviderModelMaxTokens({
          providerId,
          modelId,
          contextWindow,
          rawMaxTokens: maxTokens,
        });
        if (normalizedMaxTokens === maxTokens) {
          return model;
        }

        modelsChanged = true;
        changes.push(
          `Normalized models.providers.${providerId}.models[${index}].maxTokens (${maxTokens} → ${normalizedMaxTokens}) to avoid Mistral context-window rejects.`,
        );
        return {
          ...model,
          maxTokens: normalizedMaxTokens,
        };
      });

      if (!modelsChanged) {
        continue;
      }

      nextProviders[providerId] = {
        ...rawProvider,
        models: nextModels,
      };
      providersChanged = true;
    }

    if (!providersChanged) {
      return;
    }

    next = {
      ...next,
      models: {
        ...next.models,
        providers: nextProviders as NonNullable<CrawClawConfig["models"]>["providers"],
      },
    };
  };

  normalizeBrowserSsrFPolicyAlias();
  normalizeLegacyNanoBananaSkill();
  normalizeLegacyTalkConfig();
  normalizeLegacyCrossContextMessageConfig();
  normalizeLegacyMistralModelMaxTokens();

  return { config: next, changes };
}
