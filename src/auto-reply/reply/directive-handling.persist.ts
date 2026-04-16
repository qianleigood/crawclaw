import {
  resolveAgentDir,
  resolveDefaultAgentId,
  resolveSessionAgentId,
} from "../../agents/agent-scope.js";
import { lookupCachedContextTokens } from "../../agents/context-cache.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import type { ModelAliasIndex } from "../../agents/model-selection.js";
import type { CrawClawConfig } from "../../config/config.js";
import { updateSessionStore } from "../../config/sessions/store.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { resolveModelSelectionFromDirective } from "./directive-handling.model-selection.js";
import type { InlineDirectives } from "./directive-handling.parse.js";
import {
  canPersistInternalExecDirective,
  canPersistInternalVerboseDirective,
  enqueueModeSwitchEvents,
} from "./directive-handling.shared.js";
import type { ElevatedLevel, ReasoningLevel } from "./directives.js";
import {
  applySharedModelSelection,
  applySharedSessionPatch,
  type SharedSessionPatch,
} from "./session-patch-runtime.js";

export async function persistInlineDirectives(params: {
  directives: InlineDirectives;
  effectiveModelDirective?: string;
  cfg: CrawClawConfig;
  agentDir?: string;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  elevatedEnabled: boolean;
  elevatedAllowed: boolean;
  defaultProvider: string;
  defaultModel: string;
  aliasIndex: ModelAliasIndex;
  allowedModelKeys: Set<string>;
  provider: string;
  model: string;
  initialModelLabel: string;
  formatModelSwitchEvent: (label: string, alias?: string) => string;
  agentCfg: NonNullable<CrawClawConfig["agents"]>["defaults"] | undefined;
  messageProvider?: string;
  surface?: string;
  gatewayClientScopes?: string[];
}): Promise<{ provider: string; model: string; contextTokens: number }> {
  const {
    directives,
    cfg,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    elevatedEnabled,
    elevatedAllowed,
    defaultProvider,
    defaultModel,
    aliasIndex,
    allowedModelKeys,
    initialModelLabel,
    formatModelSwitchEvent,
    agentCfg,
  } = params;
  let { provider, model } = params;
  const allowInternalExecPersistence = canPersistInternalExecDirective({
    messageProvider: params.messageProvider,
    surface: params.surface,
    gatewayClientScopes: params.gatewayClientScopes,
  });
  const allowInternalVerbosePersistence = canPersistInternalVerboseDirective({
    messageProvider: params.messageProvider,
    surface: params.surface,
    gatewayClientScopes: params.gatewayClientScopes,
  });
  const activeAgentId = sessionKey
    ? resolveSessionAgentId({ sessionKey, config: cfg })
    : resolveDefaultAgentId(cfg);
  const agentDir = params.agentDir ?? resolveAgentDir(cfg, activeAgentId);

  if (sessionEntry && sessionStore && sessionKey) {
    const prevElevatedLevel =
      (sessionEntry.elevatedLevel as ElevatedLevel | undefined) ??
      (agentCfg?.elevatedDefault as ElevatedLevel | undefined) ??
      (elevatedAllowed ? ("on" as ElevatedLevel) : ("off" as ElevatedLevel));
    const prevReasoningLevel = (sessionEntry.reasoningLevel as ReasoningLevel | undefined) ?? "off";
    let elevatedChanged =
      directives.hasElevatedDirective &&
      directives.elevatedLevel !== undefined &&
      elevatedEnabled &&
      elevatedAllowed;
    let reasoningChanged =
      directives.hasReasoningDirective && directives.reasoningLevel !== undefined;
    let directMutationUpdated = false;
    let modelSelectionUpdated = false;
    let sharedPatchApplied = false;
    const sharedPatch: SharedSessionPatch = {};

    if (directives.hasThinkDirective && directives.thinkLevel) {
      sessionEntry.thinkingLevel = directives.thinkLevel;
      directMutationUpdated = true;
    }
    if (
      directives.hasVerboseDirective &&
      directives.verboseLevel &&
      allowInternalVerbosePersistence
    ) {
      sharedPatch.verboseLevel = directives.verboseLevel;
    }
    if (directives.hasReasoningDirective && directives.reasoningLevel) {
      reasoningChanged =
        reasoningChanged ||
        (directives.reasoningLevel !== prevReasoningLevel &&
          directives.reasoningLevel !== undefined);
      sharedPatch.reasoningLevel = directives.reasoningLevel;
    }
    if (
      directives.hasElevatedDirective &&
      directives.elevatedLevel &&
      elevatedEnabled &&
      elevatedAllowed
    ) {
      elevatedChanged =
        elevatedChanged ||
        (directives.elevatedLevel !== prevElevatedLevel && directives.elevatedLevel !== undefined);
      sharedPatch.elevatedLevel = directives.elevatedLevel;
    }
    if (directives.hasExecDirective && directives.hasExecOptions && allowInternalExecPersistence) {
      if (directives.execHost) {
        sharedPatch.execHost = directives.execHost;
      }
      if (directives.execSecurity) {
        sharedPatch.execSecurity = directives.execSecurity;
      }
      if (directives.execAsk) {
        sharedPatch.execAsk = directives.execAsk;
      }
      if (directives.execNode) {
        sharedPatch.execNode = directives.execNode;
      }
    }
    if (Object.keys(sharedPatch).length > 0) {
      const patched = await applySharedSessionPatch({
        cfg,
        sessionEntry,
        sessionStore,
        sessionKey,
        storePath,
        patch: sharedPatch,
      });
      if (!patched.ok) {
        throw new Error(
          `failed to persist inline directive session patch: ${patched.error.message}`,
        );
      }
      sharedPatchApplied = true;
    }

    const modelDirective =
      directives.hasModelDirective && params.effectiveModelDirective
        ? params.effectiveModelDirective
        : undefined;
    if (modelDirective) {
      const modelResolution = resolveModelSelectionFromDirective({
        directives: {
          ...directives,
          hasModelDirective: true,
          rawModelDirective: modelDirective,
        },
        cfg,
        agentDir,
        defaultProvider,
        defaultModel,
        aliasIndex,
        allowedModelKeys,
        allowedModelCatalog: [],
        provider,
      });
      if (modelResolution.modelSelection) {
        const { updated: modelUpdated } = await applySharedModelSelection({
          sessionEntry,
          sessionStore,
          sessionKey,
          storePath,
          selection: modelResolution.modelSelection,
          profileOverride: modelResolution.profileOverride,
        });
        provider = modelResolution.modelSelection.provider;
        model = modelResolution.modelSelection.model;
        const nextLabel = `${provider}/${model}`;
        if (nextLabel !== initialModelLabel) {
          enqueueSystemEvent(
            formatModelSwitchEvent(nextLabel, modelResolution.modelSelection.alias),
            {
              sessionKey,
              contextKey: `model:${nextLabel}`,
            },
          );
        }
        modelSelectionUpdated = modelSelectionUpdated || modelUpdated;
      }
    }
    if (directives.hasQueueDirective && directives.queueReset) {
      delete sessionEntry.queueMode;
      delete sessionEntry.queueDebounceMs;
      delete sessionEntry.queueCap;
      delete sessionEntry.queueDrop;
      directMutationUpdated = true;
    }

    if (directMutationUpdated) {
      sessionEntry.updatedAt = Date.now();
      sessionStore[sessionKey] = sessionEntry;
      if (storePath) {
        await updateSessionStore(storePath, (store) => {
          store[sessionKey] = sessionEntry;
        });
      }
    }
    if (directMutationUpdated || modelSelectionUpdated || sharedPatchApplied) {
      enqueueModeSwitchEvents({
        enqueueSystemEvent,
        sessionEntry,
        sessionKey,
        elevatedChanged,
        reasoningChanged,
      });
    }
  }

  return {
    provider,
    model,
    contextTokens:
      agentCfg?.contextTokens ?? lookupCachedContextTokens(model) ?? DEFAULT_CONTEXT_TOKENS,
  };
}
