import type { Api, Model } from "@mariozechner/pi-ai";
import type { ThinkLevel } from "../../../auto-reply/thinking.js";
import {
  type AuthProfileStore,
  isProfileInCooldown,
  resolveProfilesUnavailableReason,
} from "../../auth-profiles.js";
import { FailoverError, resolveFailoverStatus } from "../../failover-error.js";
import { shouldAllowCooldownProbeForReason } from "../../failover-policy.js";
import { getApiKeyForModel, type ResolvedProviderAuth } from "../../model-auth.js";
import { classifyFailoverReason, type FailoverReason } from "../../pi-embedded-helpers.js";
import { describeUnknownError } from "../utils.js";
import type { RuntimeAuthState } from "./helpers.js";
import type { RunEmbeddedPiAgentParams } from "./params.js";

type ApiKeyInfo = ResolvedProviderAuth;

type RuntimeApiKeySink = {
  setRuntimeApiKey(provider: string, apiKey: string): void;
};

type LogLike = {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
};

export function createEmbeddedRunAuthController(params: {
  config: RunEmbeddedPiAgentParams["config"];
  agentDir: string;
  workspaceDir: string;
  authStore: AuthProfileStore;
  authStorage: RuntimeApiKeySink;
  profileCandidates: Array<string | undefined>;
  lockedProfileId?: string;
  initialThinkLevel: ThinkLevel;
  attemptedThinking: Set<ThinkLevel>;
  fallbackConfigured: boolean;
  allowTransientCooldownProbe: boolean;
  getProvider(): string;
  getModelId(): string;
  getRuntimeModel(): Model<Api>;
  setRuntimeModel(next: Model<Api>): void;
  getEffectiveModel(): Model<Api>;
  setEffectiveModel(next: Model<Api>): void;
  getApiKeyInfo(): ApiKeyInfo | null;
  setApiKeyInfo(next: ApiKeyInfo | null): void;
  getLastProfileId(): string | undefined;
  setLastProfileId(next: string | undefined): void;
  getRuntimeAuthState(): RuntimeAuthState | null;
  setRuntimeAuthState(next: RuntimeAuthState | null): void;
  getRuntimeAuthRefreshCancelled(): boolean;
  setRuntimeAuthRefreshCancelled(next: boolean): void;
  getProfileIndex(): number;
  setProfileIndex(next: number): void;
  setThinkLevel(next: ThinkLevel): void;
  log: LogLike;
}) {
  const clearRuntimeAuthRefreshTimer = () => {
    const runtimeAuthState = params.getRuntimeAuthState();
    if (!runtimeAuthState?.refreshTimer) {
      return;
    }
    clearTimeout(runtimeAuthState.refreshTimer);
    runtimeAuthState.refreshTimer = undefined;
  };

  const stopRuntimeAuthRefreshTimer = () => {
    if (!params.getRuntimeAuthState()) {
      return;
    }
    params.setRuntimeAuthRefreshCancelled(true);
    clearRuntimeAuthRefreshTimer();
  };

  const resolveAuthProfileFailoverReason = (failoverParams: {
    allInCooldown: boolean;
    message: string;
    profileIds?: Array<string | undefined>;
  }): FailoverReason => {
    if (failoverParams.allInCooldown) {
      const profileIds = (failoverParams.profileIds ?? params.profileCandidates).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      return (
        resolveProfilesUnavailableReason({
          store: params.authStore,
          profileIds,
        }) ?? "unknown"
      );
    }
    const classified = classifyFailoverReason(failoverParams.message);
    return classified ?? "auth";
  };

  const throwAuthProfileFailover = (failoverParams: {
    allInCooldown: boolean;
    message?: string;
    error?: unknown;
  }): never => {
    const provider = params.getProvider();
    const modelId = params.getModelId();
    const fallbackMessage = `No available auth profile for ${provider} (all in cooldown or unavailable).`;
    const message =
      failoverParams.message?.trim() ||
      (failoverParams.error ? describeUnknownError(failoverParams.error).trim() : "") ||
      fallbackMessage;
    const reason = resolveAuthProfileFailoverReason({
      allInCooldown: failoverParams.allInCooldown,
      message,
      profileIds: params.profileCandidates,
    });
    if (params.fallbackConfigured) {
      throw new FailoverError(message, {
        reason,
        provider,
        model: modelId,
        status: resolveFailoverStatus(reason),
        cause: failoverParams.error,
      });
    }
    if (failoverParams.error instanceof Error) {
      throw failoverParams.error;
    }
    throw new Error(message);
  };

  const resolveApiKeyForCandidate = async (candidate?: string) => {
    return getApiKeyForModel({
      model: params.getRuntimeModel(),
      cfg: params.config,
      profileId: candidate,
      store: params.authStore,
      agentDir: params.agentDir,
      lockedProfile: candidate != null && candidate === params.lockedProfileId,
    });
  };

  const applyApiKeyInfo = async (candidate?: string): Promise<void> => {
    const apiKeyInfo = await resolveApiKeyForCandidate(candidate);
    params.setApiKeyInfo(apiKeyInfo);
    const resolvedProfileId = apiKeyInfo.profileId ?? candidate;
    if (!apiKeyInfo.apiKey) {
      if (apiKeyInfo.mode !== "aws-sdk") {
        const runtimeModel = params.getRuntimeModel();
        throw new Error(
          `No API key resolved for provider "${runtimeModel.provider}" (auth mode: ${apiKeyInfo.mode}).`,
        );
      }
      params.setLastProfileId(resolvedProfileId);
      return;
    }
    const runtimeModel = params.getRuntimeModel();
    params.authStorage.setRuntimeApiKey(runtimeModel.provider, apiKeyInfo.apiKey);
    params.setRuntimeAuthState(null);
    params.setLastProfileId(apiKeyInfo.profileId);
  };

  const advanceAuthProfile = async (): Promise<boolean> => {
    if (params.lockedProfileId) {
      return false;
    }
    let nextIndex = params.getProfileIndex() + 1;
    while (nextIndex < params.profileCandidates.length) {
      const candidate = params.profileCandidates[nextIndex];
      if (
        candidate &&
        isProfileInCooldown(params.authStore, candidate, undefined, params.getModelId())
      ) {
        nextIndex += 1;
        continue;
      }
      try {
        await applyApiKeyInfo(candidate);
        params.setProfileIndex(nextIndex);
        params.setThinkLevel(params.initialThinkLevel);
        params.attemptedThinking.clear();
        return true;
      } catch (err) {
        if (candidate && candidate === params.lockedProfileId) {
          throw err;
        }
        nextIndex += 1;
      }
    }
    return false;
  };

  const initializeAuthProfile = async () => {
    try {
      const autoProfileCandidates = params.profileCandidates.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" &&
          candidate.length > 0 &&
          candidate !== params.lockedProfileId,
      );
      const modelId = params.getModelId();
      const allAutoProfilesInCooldown =
        autoProfileCandidates.length > 0 &&
        autoProfileCandidates.every((candidate) =>
          isProfileInCooldown(params.authStore, candidate, undefined, modelId),
        );
      const unavailableReason = allAutoProfilesInCooldown
        ? (resolveProfilesUnavailableReason({
            store: params.authStore,
            profileIds: autoProfileCandidates,
          }) ?? "unknown")
        : null;
      const allowTransientCooldownProbe =
        params.allowTransientCooldownProbe &&
        allAutoProfilesInCooldown &&
        shouldAllowCooldownProbeForReason(unavailableReason);
      let didTransientCooldownProbe = false;

      while (params.getProfileIndex() < params.profileCandidates.length) {
        const candidate = params.profileCandidates[params.getProfileIndex()];
        const inCooldown =
          candidate &&
          candidate !== params.lockedProfileId &&
          isProfileInCooldown(params.authStore, candidate, undefined, modelId);
        if (inCooldown) {
          if (allowTransientCooldownProbe && !didTransientCooldownProbe) {
            didTransientCooldownProbe = true;
            params.log.warn(
              `probing cooldowned auth profile for ${params.getProvider()}/${modelId} due to ${unavailableReason ?? "transient"} unavailability`,
            );
          } else {
            params.setProfileIndex(params.getProfileIndex() + 1);
            continue;
          }
        }
        await applyApiKeyInfo(params.profileCandidates[params.getProfileIndex()]);
        break;
      }
      if (params.getProfileIndex() >= params.profileCandidates.length) {
        throwAuthProfileFailover({ allInCooldown: true });
      }
    } catch (err) {
      if (err instanceof FailoverError) {
        throw err;
      }
      if (params.profileCandidates[params.getProfileIndex()] === params.lockedProfileId) {
        throwAuthProfileFailover({ allInCooldown: false, error: err });
      }
      const advanced = await advanceAuthProfile();
      if (!advanced) {
        throwAuthProfileFailover({ allInCooldown: false, error: err });
      }
    }
  };

  const maybeRefreshRuntimeAuthForAuthError = async (
    errorText: string,
    retried: boolean,
  ): Promise<boolean> => {
    void errorText;
    void retried;
    return false;
  };

  return {
    advanceAuthProfile,
    initializeAuthProfile,
    maybeRefreshRuntimeAuthForAuthError,
    stopRuntimeAuthRefreshTimer,
  };
}
