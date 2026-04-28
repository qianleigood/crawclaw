import { resolveAgentDir, resolveSessionAgentId } from "../../agents/agent-scope.js";
import { renderExecTargetLabel } from "../../agents/bash-tools.exec-runtime.js";
import { describeExecRiskDiagnostic, resolveExecPosture } from "../../agents/exec-posture.js";
import { resolveFastModeState } from "../../agents/fast-mode.js";
import { resolveSandboxRuntimeStatus } from "../../agents/sandbox.js";
import { updateSessionStore } from "../../config/sessions.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { formatThinkingLevels, formatXHighModelHint, supportsXHighThinking } from "../thinking.js";
import type { ReplyPayload } from "../types.js";
import { resolveModelSelectionFromDirective } from "./directive-handling.model-selection.js";
import { maybeHandleModelDirectiveInfo } from "./directive-handling.model.js";
import type { HandleDirectiveOnlyParams } from "./directive-handling.params.js";
import { maybeHandleQueueDirective } from "./directive-handling.queue-validation.js";
import {
  canPersistInternalExecDirective,
  canPersistInternalVerboseDirective,
  formatDirectiveAck,
  formatElevatedRuntimeHint,
  formatElevatedUnavailableText,
  formatInternalExecPersistenceDeniedText,
  formatInternalVerboseCurrentReplyOnlyText,
  formatInternalVerbosePersistenceDeniedText,
  enqueueModeSwitchEvents,
  withOptions,
} from "./directive-handling.shared.js";
import type { ElevatedLevel, ReasoningLevel, ThinkLevel } from "./directives.js";
import { refreshQueuedFollowupSession } from "./queue.js";
import {
  applySharedModelSelection,
  applySharedSessionPatch,
  type SharedSessionPatch,
} from "./session-patch-runtime.js";

export async function handleDirectiveOnly(
  params: HandleDirectiveOnlyParams,
): Promise<ReplyPayload | undefined> {
  const {
    directives,
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
    allowedModelCatalog,
    resetModelOverride,
    provider,
    model,
    initialModelLabel,
    formatModelSwitchEvent,
    currentThinkLevel,
    currentFastMode,
    currentVerboseLevel,
    currentReasoningLevel,
    currentElevatedLevel,
  } = params;
  const activeAgentId = resolveSessionAgentId({
    sessionKey: params.sessionKey,
    config: params.cfg,
  });
  const agentDir = resolveAgentDir(params.cfg, activeAgentId);
  const runtimeIsSandboxed = resolveSandboxRuntimeStatus({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
  }).sandboxed;
  const shouldHintDirectRuntime = directives.hasElevatedDirective && !runtimeIsSandboxed;
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

  const modelInfo = await maybeHandleModelDirectiveInfo({
    directives,
    cfg: params.cfg,
    agentDir,
    activeAgentId,
    provider,
    model,
    defaultProvider,
    defaultModel,
    aliasIndex,
    allowedModelCatalog,
    resetModelOverride,
    surface: params.surface,
    sessionEntry,
  });
  if (modelInfo) {
    return modelInfo;
  }

  const modelResolution = resolveModelSelectionFromDirective({
    directives,
    cfg: params.cfg,
    agentDir,
    defaultProvider,
    defaultModel,
    aliasIndex,
    allowedModelKeys,
    allowedModelCatalog,
    provider,
  });
  if (modelResolution.errorText) {
    return { text: modelResolution.errorText };
  }
  const modelSelection = modelResolution.modelSelection;
  const profileOverride = modelResolution.profileOverride;

  const resolvedProvider = modelSelection?.provider ?? provider;
  const resolvedModel = modelSelection?.model ?? model;
  const fastModeState = resolveFastModeState({
    cfg: params.cfg,
    provider: resolvedProvider,
    model: resolvedModel,
    agentId: activeAgentId,
    sessionEntry,
  });
  const effectiveFastMode = directives.fastMode ?? currentFastMode ?? fastModeState.enabled;
  const effectiveFastModeSource =
    directives.fastMode !== undefined ? "session" : fastModeState.source;

  if (directives.hasThinkDirective && !directives.thinkLevel) {
    // If no argument was provided, show the current level
    if (!directives.rawThinkLevel) {
      const level = currentThinkLevel ?? "off";
      return {
        text: withOptions(
          `Current thinking level: ${level}.`,
          formatThinkingLevels(resolvedProvider, resolvedModel),
        ),
      };
    }
    return {
      text: `Unrecognized thinking level "${directives.rawThinkLevel}". Valid levels: ${formatThinkingLevels(resolvedProvider, resolvedModel)}.`,
    };
  }
  if (directives.hasVerboseDirective && !directives.verboseLevel) {
    if (!directives.rawVerboseLevel) {
      const level = currentVerboseLevel ?? "off";
      return {
        text: withOptions(`Current verbose level: ${level}.`, "on, full, off"),
      };
    }
    return {
      text: `Unrecognized verbose level "${directives.rawVerboseLevel}". Valid levels: off, on, full.`,
    };
  }
  if (directives.hasFastDirective && directives.fastMode === undefined) {
    if (!directives.rawFastMode || directives.rawFastMode.toLowerCase() === "status") {
      const sourceSuffix =
        effectiveFastModeSource === "config"
          ? " (config)"
          : effectiveFastModeSource === "default"
            ? " (default)"
            : "";
      return {
        text: withOptions(
          `Current fast mode: ${effectiveFastMode ? "on" : "off"}${sourceSuffix}.`,
          "status, on, off",
        ),
      };
    }
    return {
      text: `Unrecognized fast mode "${directives.rawFastMode}". Valid levels: status, on, off.`,
    };
  }
  if (directives.hasReasoningDirective && !directives.reasoningLevel) {
    if (!directives.rawReasoningLevel) {
      const level = currentReasoningLevel ?? "off";
      return {
        text: withOptions(`Current reasoning level: ${level}.`, "on, off, stream"),
      };
    }
    return {
      text: `Unrecognized reasoning level "${directives.rawReasoningLevel}". Valid levels: on, off, stream.`,
    };
  }
  if (directives.hasElevatedDirective && !directives.elevatedLevel) {
    if (!directives.rawElevatedLevel) {
      if (!elevatedEnabled || !elevatedAllowed) {
        return {
          text: formatElevatedUnavailableText({
            runtimeSandboxed: runtimeIsSandboxed,
            failures: params.elevatedFailures,
            sessionKey: params.sessionKey,
          }),
        };
      }
      const level = currentElevatedLevel ?? "off";
      return {
        text: [
          withOptions(`Current elevated level: ${level}.`, "on, off, ask, full"),
          shouldHintDirectRuntime ? formatElevatedRuntimeHint() : null,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    return {
      text: `Unrecognized elevated level "${directives.rawElevatedLevel}". Valid levels: off, on, ask, full.`,
    };
  }
  if (directives.hasElevatedDirective && (!elevatedEnabled || !elevatedAllowed)) {
    return {
      text: formatElevatedUnavailableText({
        runtimeSandboxed: runtimeIsSandboxed,
        failures: params.elevatedFailures,
        sessionKey: params.sessionKey,
      }),
    };
  }
  if (directives.hasExecDirective) {
    if (directives.invalidExecHost) {
      return {
        text: `Unrecognized exec host "${directives.rawExecHost ?? ""}". Valid hosts: auto, sandbox, gateway, node.`,
      };
    }
    if (directives.invalidExecSecurity) {
      return {
        text: `Unrecognized exec security "${directives.rawExecSecurity ?? ""}". Valid: deny, allowlist, full.`,
      };
    }
    if (directives.invalidExecAsk) {
      return {
        text: `Unrecognized exec ask "${directives.rawExecAsk ?? ""}". Valid: off, on-miss, always.`,
      };
    }
    if (directives.invalidExecNode) {
      return {
        text: "Exec node requires a value.",
      };
    }
    if (!directives.hasExecOptions) {
      const execDefaults = resolveExecPosture({
        cfg: params.cfg,
        sessionEntry,
        agentId: activeAgentId,
        sandboxAvailable: runtimeIsSandboxed,
      });
      const execDiagnostic = describeExecRiskDiagnostic(execDefaults);
      const nodeLabel = execDefaults.node ? `node=${execDefaults.node}` : "node=(unset)";
      return {
        text: withOptions(
          [
            `Current exec defaults: host=${renderExecTargetLabel(execDefaults.host)}, effective=${execDefaults.effectiveHost}, security=${execDefaults.security}, ask=${execDefaults.ask}, ${nodeLabel}.`,
            execDiagnostic,
          ]
            .filter(Boolean)
            .join("\n"),
          "host=auto|sandbox|gateway|node, security=deny|allowlist|full, ask=off|on-miss|always, node=<id>",
        ),
      };
    }
  }

  const queueAck = maybeHandleQueueDirective({
    directives,
    cfg: params.cfg,
    channel: provider,
    sessionEntry,
  });
  if (queueAck) {
    return queueAck;
  }

  if (
    directives.hasThinkDirective &&
    directives.thinkLevel === "xhigh" &&
    !supportsXHighThinking(resolvedProvider, resolvedModel)
  ) {
    return {
      text: `Thinking level "xhigh" is only supported for ${formatXHighModelHint()}.`,
    };
  }

  const nextThinkLevel = directives.hasThinkDirective
    ? directives.thinkLevel
    : ((sessionEntry?.thinkingLevel as ThinkLevel | undefined) ?? currentThinkLevel);
  const shouldDowngradeXHigh =
    !directives.hasThinkDirective &&
    nextThinkLevel === "xhigh" &&
    !supportsXHighThinking(resolvedProvider, resolvedModel);

  const prevElevatedLevel =
    currentElevatedLevel ??
    (sessionEntry.elevatedLevel as ElevatedLevel | undefined) ??
    (elevatedAllowed ? ("on" as ElevatedLevel) : ("off" as ElevatedLevel));
  const prevReasoningLevel =
    currentReasoningLevel ?? (sessionEntry.reasoningLevel as ReasoningLevel | undefined) ?? "off";
  let elevatedChanged =
    directives.hasElevatedDirective &&
    directives.elevatedLevel !== undefined &&
    elevatedEnabled &&
    elevatedAllowed;
  let modelSelectionUpdated = false;
  const shouldPersistSessionEntry =
    (directives.hasThinkDirective && Boolean(directives.thinkLevel)) ||
    (directives.hasFastDirective && directives.fastMode !== undefined) ||
    (directives.hasVerboseDirective &&
      Boolean(directives.verboseLevel) &&
      allowInternalVerbosePersistence) ||
    (directives.hasReasoningDirective && Boolean(directives.reasoningLevel)) ||
    (directives.hasElevatedDirective && Boolean(directives.elevatedLevel)) ||
    (directives.hasExecDirective && directives.hasExecOptions && allowInternalExecPersistence) ||
    Boolean(modelSelection) ||
    directives.hasQueueDirective ||
    shouldDowngradeXHigh;
  const fastModeChanged =
    directives.hasFastDirective &&
    directives.fastMode !== undefined &&
    directives.fastMode !== currentFastMode;
  let reasoningChanged =
    directives.hasReasoningDirective && directives.reasoningLevel !== undefined;
  if (shouldPersistSessionEntry) {
    let directMutationUpdated = false;
    const sharedPatch: SharedSessionPatch = {};
    if (directives.hasThinkDirective && directives.thinkLevel) {
      sessionEntry.thinkingLevel = directives.thinkLevel;
      directMutationUpdated = true;
    }
    if (directives.hasFastDirective && directives.fastMode !== undefined) {
      sessionEntry.fastMode = directives.fastMode;
      directMutationUpdated = true;
    }
    if (shouldDowngradeXHigh) {
      sessionEntry.thinkingLevel = "high";
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
        directives.reasoningLevel !== prevReasoningLevel && directives.reasoningLevel !== undefined;
      sharedPatch.reasoningLevel = directives.reasoningLevel;
    }
    if (directives.hasElevatedDirective && directives.elevatedLevel) {
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
        cfg: params.cfg,
        sessionEntry,
        sessionStore,
        sessionKey,
        storePath,
        patch: sharedPatch,
      });
      if (!patched.ok) {
        return { text: `⚠️ Failed to update session defaults: ${patched.error.message}` };
      }
    }
    if (modelSelection) {
      const applied = await applySharedModelSelection({
        sessionEntry,
        sessionStore,
        sessionKey,
        storePath,
        selection: modelSelection,
        profileOverride,
      });
      modelSelectionUpdated = applied.updated;
    }
    if (directives.hasQueueDirective && directives.queueReset) {
      delete sessionEntry.queueMode;
      delete sessionEntry.queueDebounceMs;
      delete sessionEntry.queueCap;
      delete sessionEntry.queueDrop;
      directMutationUpdated = true;
    } else if (directives.hasQueueDirective) {
      if (directives.queueMode) {
        sessionEntry.queueMode = directives.queueMode;
        directMutationUpdated = true;
      }
      if (typeof directives.debounceMs === "number") {
        sessionEntry.queueDebounceMs = directives.debounceMs;
        directMutationUpdated = true;
      }
      if (typeof directives.cap === "number") {
        sessionEntry.queueCap = directives.cap;
        directMutationUpdated = true;
      }
      if (directives.dropPolicy) {
        sessionEntry.queueDrop = directives.dropPolicy;
        directMutationUpdated = true;
      }
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
    if (modelSelection && modelSelectionUpdated && sessionKey) {
      // `/model` should retarget queued/future work without interrupting the
      // active run. Refresh queued followups so they pick up the persisted
      // selection once the current turn finishes.
      refreshQueuedFollowupSession({
        key: sessionKey,
        nextProvider: modelSelection.provider,
        nextModel: modelSelection.model,
        nextAuthProfileId: profileOverride,
        nextAuthProfileIdSource: profileOverride ? "user" : undefined,
      });
    }
  }
  if (modelSelection) {
    const nextLabel = `${modelSelection.provider}/${modelSelection.model}`;
    if (nextLabel !== initialModelLabel) {
      enqueueSystemEvent(formatModelSwitchEvent(nextLabel, modelSelection.alias), {
        sessionKey,
        contextKey: `model:${nextLabel}`,
      });
    }
  }
  enqueueModeSwitchEvents({
    enqueueSystemEvent,
    sessionEntry,
    sessionKey,
    elevatedChanged,
    reasoningChanged,
  });

  const parts: string[] = [];
  if (directives.hasThinkDirective && directives.thinkLevel) {
    parts.push(
      directives.thinkLevel === "off"
        ? "Thinking disabled."
        : `Thinking level set to ${directives.thinkLevel}.`,
    );
  }
  if (directives.hasFastDirective && directives.fastMode !== undefined) {
    parts.push(
      directives.fastMode
        ? formatDirectiveAck("Fast mode enabled.")
        : formatDirectiveAck("Fast mode disabled."),
    );
  }
  if (directives.hasVerboseDirective && directives.verboseLevel) {
    parts.push(
      !allowInternalVerbosePersistence
        ? formatDirectiveAck(formatInternalVerboseCurrentReplyOnlyText())
        : directives.verboseLevel === "off"
          ? formatDirectiveAck("Verbose logging disabled.")
          : directives.verboseLevel === "full"
            ? formatDirectiveAck("Verbose logging set to full.")
            : formatDirectiveAck("Verbose logging enabled."),
    );
  }
  if (
    directives.hasVerboseDirective &&
    directives.verboseLevel &&
    !allowInternalVerbosePersistence
  ) {
    parts.push(formatDirectiveAck(formatInternalVerbosePersistenceDeniedText()));
  }
  if (directives.hasReasoningDirective && directives.reasoningLevel) {
    parts.push(
      directives.reasoningLevel === "off"
        ? formatDirectiveAck("Reasoning visibility disabled.")
        : directives.reasoningLevel === "stream"
          ? formatDirectiveAck("Reasoning stream enabled (Telegram only).")
          : formatDirectiveAck("Reasoning visibility enabled."),
    );
  }
  if (directives.hasElevatedDirective && directives.elevatedLevel) {
    parts.push(
      directives.elevatedLevel === "off"
        ? formatDirectiveAck("Elevated mode disabled.")
        : directives.elevatedLevel === "full"
          ? formatDirectiveAck("Elevated mode set to full (auto-approve).")
          : formatDirectiveAck("Elevated mode set to ask (approvals may still apply)."),
    );
    if (shouldHintDirectRuntime) {
      parts.push(formatElevatedRuntimeHint());
    }
  }
  if (directives.hasExecDirective && directives.hasExecOptions && allowInternalExecPersistence) {
    const execParts: string[] = [];
    if (directives.execHost) {
      execParts.push(`host=${directives.execHost}`);
    }
    if (directives.execSecurity) {
      execParts.push(`security=${directives.execSecurity}`);
    }
    if (directives.execAsk) {
      execParts.push(`ask=${directives.execAsk}`);
    }
    if (directives.execNode) {
      execParts.push(`node=${directives.execNode}`);
    }
    if (execParts.length > 0) {
      parts.push(formatDirectiveAck(`Exec defaults set (${execParts.join(", ")}).`));
    }
  }
  if (directives.hasExecDirective && directives.hasExecOptions && !allowInternalExecPersistence) {
    parts.push(formatDirectiveAck(formatInternalExecPersistenceDeniedText()));
  }
  if (shouldDowngradeXHigh) {
    parts.push(
      `Thinking level set to high (xhigh not supported for ${resolvedProvider}/${resolvedModel}).`,
    );
  }
  if (modelSelection) {
    const label = `${modelSelection.provider}/${modelSelection.model}`;
    const labelWithAlias = modelSelection.alias ? `${modelSelection.alias} (${label})` : label;
    parts.push(
      modelSelection.isDefault
        ? `Model reset to default (${labelWithAlias}).`
        : `Model set to ${labelWithAlias}.`,
    );
    if (profileOverride) {
      parts.push(`Auth profile set to ${profileOverride}.`);
    }
  }
  if (directives.hasQueueDirective && directives.queueMode) {
    parts.push(formatDirectiveAck(`Queue mode set to ${directives.queueMode}.`));
  } else if (directives.hasQueueDirective && directives.queueReset) {
    parts.push(formatDirectiveAck("Queue mode reset to default."));
  }
  if (directives.hasQueueDirective && typeof directives.debounceMs === "number") {
    parts.push(formatDirectiveAck(`Queue debounce set to ${directives.debounceMs}ms.`));
  }
  if (directives.hasQueueDirective && typeof directives.cap === "number") {
    parts.push(formatDirectiveAck(`Queue cap set to ${directives.cap}.`));
  }
  if (directives.hasQueueDirective && directives.dropPolicy) {
    parts.push(formatDirectiveAck(`Queue drop set to ${directives.dropPolicy}.`));
  }
  if (fastModeChanged) {
    enqueueSystemEvent(`Fast mode ${sessionEntry.fastMode ? "enabled" : "disabled"}.`, {
      sessionKey,
      contextKey: `fast:${sessionEntry.fastMode ? "on" : "off"}`,
    });
  }
  const ack = parts.join(" ").trim();
  if (!ack && directives.hasStatusDirective) {
    return undefined;
  }
  return { text: ack || "OK." };
}
