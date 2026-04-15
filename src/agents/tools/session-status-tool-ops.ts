import { buildStatusText } from "../../auto-reply/reply/commands-status.js";
import type {
  ElevatedLevel,
  ReasoningLevel,
  ThinkLevel,
  VerboseLevel,
} from "../../auto-reply/thinking.js";
import type { CrawClawConfig } from "../../config/config.js";
import { type SessionEntry, updateSessionStore } from "../../config/sessions.js";
import { resolveSessionModelIdentityRef } from "../../gateway/session-utils.js";
import {
  buildAgentMainSessionKey,
  DEFAULT_AGENT_ID,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { applyModelOverrideToSessionEntry } from "../../sessions/model-overrides.js";
import { buildTaskStatusSnapshotForRelatedSessionKeyForOwner } from "../../tasks/task-owner-access.js";
import { formatTaskStatusDetail, formatTaskStatusTitle } from "../../tasks/task-status.js";
import { loadModelCatalog } from "../model-catalog.js";
import {
  buildAllowedModelSet,
  buildModelAliasIndex,
  modelKey,
  resolveDefaultModelForAgent,
  resolveModelRefFromString,
} from "../model-selection.js";
import { resolveInternalSessionKey } from "./sessions-helpers.js";

export function resolveSessionEntry(params: {
  store: Record<string, SessionEntry>;
  keyRaw: string;
  alias: string;
  mainKey: string;
  requesterInternalKey?: string;
  includeAliasFallback?: boolean;
}): { key: string; entry: SessionEntry } | null {
  const keyRaw = params.keyRaw.trim();
  if (!keyRaw) {
    return null;
  }
  const includeAliasFallback = params.includeAliasFallback ?? true;
  const internal = resolveInternalSessionKey({
    key: keyRaw,
    alias: params.alias,
    mainKey: params.mainKey,
    requesterInternalKey: params.requesterInternalKey,
  });

  const candidates: string[] = [keyRaw];
  if (!keyRaw.startsWith("agent:")) {
    candidates.push(`agent:${DEFAULT_AGENT_ID}:${keyRaw}`);
  }
  if (includeAliasFallback && internal !== keyRaw) {
    candidates.push(internal);
  }
  if (includeAliasFallback && !keyRaw.startsWith("agent:")) {
    const agentInternal = `agent:${DEFAULT_AGENT_ID}:${internal}`;
    const agentRaw = `agent:${DEFAULT_AGENT_ID}:${keyRaw}`;
    if (agentInternal !== agentRaw) {
      candidates.push(agentInternal);
    }
  }
  if (includeAliasFallback && (keyRaw === "main" || keyRaw === "current")) {
    const defaultMainKey = buildAgentMainSessionKey({
      agentId: DEFAULT_AGENT_ID,
      mainKey: params.mainKey,
    });
    if (!candidates.includes(defaultMainKey)) {
      candidates.push(defaultMainKey);
    }
  }

  for (const key of candidates) {
    const entry = params.store[key];
    if (entry) {
      return { key, entry };
    }
  }

  return null;
}

export function resolveStoreScopedRequesterKey(params: {
  requesterKey: string;
  agentId: string;
  mainKey: string;
}) {
  const parsed = parseAgentSessionKey(params.requesterKey);
  if (!parsed || parsed.agentId !== params.agentId) {
    return params.requesterKey;
  }
  return parsed.rest === params.mainKey ? params.mainKey : params.requesterKey;
}

export function formatSessionTaskLine(params: {
  relatedSessionKey: string;
  callerOwnerKey: string;
}): string | undefined {
  const snapshot = buildTaskStatusSnapshotForRelatedSessionKeyForOwner({
    relatedSessionKey: params.relatedSessionKey,
    callerOwnerKey: params.callerOwnerKey,
  });
  const task = snapshot.focus;
  if (!task) {
    return undefined;
  }
  const headline =
    snapshot.activeCount > 0
      ? `${snapshot.activeCount} active`
      : snapshot.recentFailureCount > 0
        ? `${snapshot.recentFailureCount} recent failure${snapshot.recentFailureCount === 1 ? "" : "s"}`
        : `latest ${task.status.replaceAll("_", " ")}`;
  const title = formatTaskStatusTitle(task);
  const detail = formatTaskStatusDetail(task);
  const parts = [headline, task.runtime, title, detail].filter(Boolean);
  return parts.length ? `📌 Tasks: ${parts.join(" · ")}` : undefined;
}

export async function resolveModelOverride(params: {
  cfg: CrawClawConfig;
  raw: string;
  sessionEntry?: SessionEntry;
  agentId: string;
}): Promise<
  | { kind: "reset" }
  | {
      kind: "set";
      provider: string;
      model: string;
      isDefault: boolean;
    }
> {
  const raw = params.raw.trim();
  if (!raw) {
    return { kind: "reset" };
  }
  if (raw.toLowerCase() === "default") {
    return { kind: "reset" };
  }

  const configDefault = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const currentProvider = params.sessionEntry?.providerOverride?.trim() || configDefault.provider;
  const currentModel = params.sessionEntry?.modelOverride?.trim() || configDefault.model;

  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: currentProvider,
  });
  const catalog = await loadModelCatalog({ config: params.cfg });
  const allowed = buildAllowedModelSet({
    cfg: params.cfg,
    catalog,
    defaultProvider: currentProvider,
    defaultModel: currentModel,
    agentId: params.agentId,
  });

  const resolved = resolveModelRefFromString({
    raw,
    defaultProvider: currentProvider,
    aliasIndex,
  });
  if (!resolved) {
    throw new Error(`Unrecognized model "${raw}".`);
  }
  const key = modelKey(resolved.ref.provider, resolved.ref.model);
  if (allowed.allowedKeys.size > 0 && !allowed.allowedKeys.has(key)) {
    throw new Error(`Model "${key}" is not allowed.`);
  }
  const isDefault =
    resolved.ref.provider === configDefault.provider && resolved.ref.model === configDefault.model;
  return {
    kind: "set",
    provider: resolved.ref.provider,
    model: resolved.ref.model,
    isDefault,
  };
}

export async function applySessionStatusModelOverride(params: {
  cfg: CrawClawConfig;
  modelRaw: string;
  resolved: { key: string; entry: SessionEntry };
  agentId: string;
  store: Record<string, SessionEntry>;
  storePath: string;
  configured: { provider: string; model: string };
}): Promise<boolean> {
  const selection = await resolveModelOverride({
    cfg: params.cfg,
    raw: params.modelRaw,
    sessionEntry: params.resolved.entry,
    agentId: params.agentId,
  });
  const nextEntry: SessionEntry = { ...params.resolved.entry };
  const applied = applyModelOverrideToSessionEntry({
    entry: nextEntry,
    selection:
      selection.kind === "reset"
        ? {
            provider: params.configured.provider,
            model: params.configured.model,
            isDefault: true,
          }
        : {
            provider: selection.provider,
            model: selection.model,
            isDefault: selection.isDefault,
          },
  });
  if (!applied.updated) {
    return false;
  }
  params.store[params.resolved.key] = nextEntry;
  await updateSessionStore(params.storePath, (nextStore) => {
    nextStore[params.resolved.key] = nextEntry;
  });
  params.resolved.entry = nextEntry;
  return true;
}

export async function buildSessionStatusText(params: {
  cfg: CrawClawConfig;
  resolved: { key: string; entry: SessionEntry };
  agentId: string;
  storePath: string;
  visibilityRequesterKey: string;
}) {
  const configured = resolveDefaultModelForAgent({ cfg: params.cfg, agentId: params.agentId });
  const runtimeModelIdentity = resolveSessionModelIdentityRef(
    params.cfg,
    params.resolved.entry,
    params.agentId,
    `${configured.provider}/${configured.model}`,
  );
  const hasExplicitModelOverride = Boolean(
    params.resolved.entry.providerOverride?.trim() || params.resolved.entry.modelOverride?.trim(),
  );
  const runtimeProviderForCard = runtimeModelIdentity.provider?.trim();
  const runtimeModelForCard = runtimeModelIdentity.model.trim();
  const defaultProviderForCard = hasExplicitModelOverride
    ? configured.provider
    : (runtimeProviderForCard ?? "");
  const defaultModelForCard = hasExplicitModelOverride
    ? configured.model
    : runtimeModelForCard || configured.model;
  const statusSessionEntry =
    !hasExplicitModelOverride && !runtimeProviderForCard && runtimeModelForCard
      ? { ...params.resolved.entry, providerOverride: "" }
      : params.resolved.entry;
  const providerOverrideForCard = statusSessionEntry.providerOverride?.trim();
  const providerForCard = providerOverrideForCard ?? defaultProviderForCard;
  const primaryModelLabel =
    providerForCard && defaultModelForCard
      ? `${providerForCard}/${defaultModelForCard}`
      : defaultModelForCard;
  const isGroup =
    statusSessionEntry.chatType === "group" ||
    statusSessionEntry.chatType === "channel" ||
    params.resolved.key.includes(":group:") ||
    params.resolved.key.includes(":channel:");
  const taskLine = formatSessionTaskLine({
    relatedSessionKey: params.resolved.key,
    callerOwnerKey: params.visibilityRequesterKey,
  });
  const statusText = await buildStatusText({
    cfg: params.cfg,
    sessionEntry: statusSessionEntry,
    sessionKey: params.resolved.key,
    parentSessionKey: statusSessionEntry.parentSessionKey,
    sessionScope: params.cfg.session?.scope,
    storePath: params.storePath,
    statusChannel:
      statusSessionEntry.channel ??
      statusSessionEntry.lastChannel ??
      statusSessionEntry.origin?.provider ??
      "unknown",
    provider: providerForCard,
    model: defaultModelForCard,
    resolvedThinkLevel: statusSessionEntry.thinkingLevel as ThinkLevel | undefined,
    resolvedFastMode: statusSessionEntry.fastMode,
    resolvedVerboseLevel: (statusSessionEntry.verboseLevel ?? "off") as VerboseLevel,
    resolvedReasoningLevel: (statusSessionEntry.reasoningLevel ?? "off") as ReasoningLevel,
    resolvedElevatedLevel: statusSessionEntry.elevatedLevel as ElevatedLevel | undefined,
    resolveDefaultThinkingLevel: async () => params.cfg.agents?.defaults?.thinkingDefault,
    isGroup,
    defaultGroupActivation: () => "mention",
    taskLineOverride: taskLine,
    skipDefaultTaskLookup: true,
    primaryModelLabelOverride: primaryModelLabel,
    ...(providerForCard ? {} : { modelAuthOverride: undefined }),
  });
  return taskLine && !statusText.includes(taskLine) ? `${statusText}\n${taskLine}` : statusText;
}

export function buildSessionStatusResult(params: {
  resolvedKey: string;
  changedModel: boolean;
  statusText: string;
}) {
  return {
    content: [{ type: "text" as const, text: params.statusText }],
    details: {
      ok: true,
      sessionKey: params.resolvedKey,
      changedModel: params.changedModel,
      statusText: params.statusText,
    },
  };
}
