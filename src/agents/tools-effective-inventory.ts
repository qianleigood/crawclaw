import type { CrawClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { coerceModelCompatConfig } from "../plugins/provider-model-compat.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { resolveAgentDir, resolveAgentWorkspaceDir, resolveSessionAgentId } from "./agent-scope.js";
import { getChannelAgentToolMeta } from "./channel-tools.js";
import { describeExecRiskDiagnostic, resolveExecPosture } from "./exec-posture.js";
import { resolveModel } from "./pi-embedded-runner/model.js";
import { createCrawClawCodingTools } from "./pi-tools.js";
import { isToolAllowedByPolicyName, resolveEffectiveToolPolicy } from "./pi-tools.policy.js";
import { resolveSandboxRuntimeStatus } from "./sandbox.js";
import {
  listCoreToolSections,
  resolveCoreToolLifecycle,
  resolveCoreToolProfiles,
  type ToolLifecycle,
} from "./tool-catalog.js";
import { summarizeToolDescriptionText } from "./tool-description-summary.js";
import { resolveToolDisplay } from "./tool-display.js";
import { isOwnerOnlyToolName, type ToolPolicyLike } from "./tool-policy.js";
import type { AnyAgentTool } from "./tools/common.js";

export type EffectiveToolSource = "core" | "plugin" | "channel";
export type EffectiveToolGate =
  | "profile"
  | "runtime"
  | "special"
  | "host"
  | "owner"
  | "sandbox"
  | "provider"
  | "config";

export type EffectiveToolInventoryEntry = {
  id: string;
  label: string;
  description: string;
  rawDescription: string;
  source: EffectiveToolSource;
  lifecycle?: ToolLifecycle;
  gatedBy?: EffectiveToolGate[];
  visibilityReason?: string;
  pluginId?: string;
  channelId?: string;
};

export type EffectiveToolInventoryGroup = {
  id: EffectiveToolSource;
  label: string;
  source: EffectiveToolSource;
  tools: EffectiveToolInventoryEntry[];
};

export type EffectiveToolInventoryResult = {
  agentId: string;
  profile: string;
  groups: EffectiveToolInventoryGroup[];
  unavailableTools?: EffectiveToolUnavailableEntry[];
  diagnostics?: EffectiveToolDiagnostic[];
};

export type EffectiveToolUnavailableEntry = {
  id: string;
  label: string;
  source: "core";
  lifecycle?: ToolLifecycle;
  gatedBy?: EffectiveToolGate[];
  reason: string;
};

export type EffectiveToolDiagnostic = {
  level: "warning";
  message: string;
};

export type ResolveEffectiveToolInventoryParams = {
  cfg: CrawClawConfig;
  sessionEntry?: SessionEntry;
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  agentDir?: string;
  messageProvider?: string;
  senderIsOwner?: boolean;
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
  accountId?: string | null;
  modelProvider?: string;
  modelId?: string;
  currentChannelId?: string;
  currentThreadTs?: string;
  currentMessageId?: string | number;
  groupId?: string | null;
  groupChannel?: string | null;
  groupSpace?: string | null;
  replyToMode?: "off" | "first" | "all";
  modelHasVision?: boolean;
  requireExplicitMessageTarget?: boolean;
  disableMessageTool?: boolean;
  sandboxAvailable?: boolean;
};

function resolveEffectiveToolLabel(tool: AnyAgentTool): string {
  const rawLabel = typeof tool.label === "string" ? tool.label.trim() : "";
  if (rawLabel && rawLabel.toLowerCase() !== tool.name.toLowerCase()) {
    return rawLabel;
  }
  return resolveToolDisplay({ name: tool.name }).title;
}

function resolveRawToolDescription(tool: AnyAgentTool): string {
  return typeof tool.description === "string" ? tool.description.trim() : "";
}

function summarizeToolDescription(tool: AnyAgentTool): string {
  return summarizeToolDescriptionText({
    rawDescription: resolveRawToolDescription(tool),
    displaySummary: tool.displaySummary,
  });
}

function resolveEffectiveToolSource(tool: AnyAgentTool): {
  source: EffectiveToolSource;
  pluginId?: string;
  channelId?: string;
} {
  const pluginMeta = getPluginToolMeta(tool);
  if (pluginMeta) {
    return { source: "plugin", pluginId: pluginMeta.pluginId };
  }
  const channelMeta = getChannelAgentToolMeta(tool as never);
  if (channelMeta) {
    return { source: "channel", channelId: channelMeta.channelId };
  }
  return { source: "core" };
}

function resolveGatesForLifecycle(lifecycle: ToolLifecycle): EffectiveToolGate[] {
  switch (lifecycle) {
    case "profile_default":
      return ["profile"];
    case "runtime_conditional":
      return ["runtime", "profile"];
    case "special_agent_only":
      return ["special"];
    case "owner_restricted":
      return ["owner"];
    default: {
      const exhaustive: never = lifecycle;
      void exhaustive;
      throw new Error("Unhandled tool lifecycle");
    }
  }
}

function resolveToolLifecycleMetadata(params: { toolId: string; source: EffectiveToolSource }): {
  lifecycle?: ToolLifecycle;
  gatedBy?: EffectiveToolGate[];
  visibilityReason?: string;
} {
  const lifecycle =
    params.source === "core" ? resolveCoreToolLifecycle(params.toolId) : "runtime_conditional";
  if (!lifecycle) {
    return {};
  }
  const gatedBy = resolveGatesForLifecycle(lifecycle);
  return {
    lifecycle,
    gatedBy,
    visibilityReason: `visible after ${gatedBy.join(", ")} gates`,
  };
}

function groupLabel(source: EffectiveToolSource): string {
  switch (source) {
    case "plugin":
      return "Connected tools";
    case "channel":
      return "Channel tools";
    default:
      return "Built-in tools";
  }
}

function disambiguateLabels(entries: EffectiveToolInventoryEntry[]): EffectiveToolInventoryEntry[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1);
  }
  return entries.map((entry) => {
    if ((counts.get(entry.label) ?? 0) < 2) {
      return entry;
    }
    const suffix = entry.pluginId ?? entry.channelId ?? entry.id;
    return { ...entry, label: `${entry.label} (${suffix})` };
  });
}

function resolveEffectiveModelCompat(params: {
  cfg: CrawClawConfig;
  agentDir: string;
  modelProvider?: string;
  modelId?: string;
}) {
  const provider = params.modelProvider?.trim();
  const modelId = params.modelId?.trim();
  if (!provider || !modelId) {
    return undefined;
  }
  try {
    return resolveModel(provider, modelId, params.agentDir, params.cfg).model?.compat;
  } catch {
    return undefined;
  }
}

function describeProfileBlock(params: {
  toolId: string;
  profile?: string;
  label: string;
}): string | undefined {
  const profile = params.profile?.trim();
  if (!profile || profile === "full") {
    return undefined;
  }
  if (resolveCoreToolProfiles(params.toolId).some((candidate) => candidate === profile)) {
    return undefined;
  }
  return `not included in ${params.label} (${profile})`;
}

function describePolicyBlock(params: {
  toolId: string;
  policy?: ToolPolicyLike;
  label: string;
}): string | undefined {
  if (!params.policy || isToolAllowedByPolicyName(params.toolId, params.policy)) {
    return undefined;
  }
  return `blocked by ${params.label}`;
}

function describeUnavailableCoreTool(params: {
  toolId: string;
  effectivePolicy: ReturnType<typeof resolveEffectiveToolPolicy>;
  senderIsOwner?: boolean;
}): string {
  if (isOwnerOnlyToolName(params.toolId) && params.senderIsOwner !== true) {
    return "restricted to owner senders";
  }
  const lifecycle = resolveCoreToolLifecycle(params.toolId);
  if (lifecycle === "special_agent_only") {
    return "available only to its special agent";
  }
  return (
    describeProfileBlock({
      toolId: params.toolId,
      profile: params.effectivePolicy.profile,
      label: "tools.profile",
    }) ??
    describeProfileBlock({
      toolId: params.toolId,
      profile: params.effectivePolicy.providerProfile,
      label: "tools.byProvider.profile",
    }) ??
    describePolicyBlock({
      toolId: params.toolId,
      policy: params.effectivePolicy.globalPolicy,
      label: "tools.allow",
    }) ??
    describePolicyBlock({
      toolId: params.toolId,
      policy: params.effectivePolicy.globalProviderPolicy,
      label: "tools.byProvider.allow",
    }) ??
    describePolicyBlock({
      toolId: params.toolId,
      policy: params.effectivePolicy.agentPolicy,
      label: "agent tools.allow",
    }) ??
    describePolicyBlock({
      toolId: params.toolId,
      policy: params.effectivePolicy.agentProviderPolicy,
      label: "agent tools.byProvider.allow",
    }) ??
    "not registered for the current model, config, or runtime"
  );
}

function buildUnavailableCoreTools(params: {
  availableTools: EffectiveToolInventoryEntry[];
  effectivePolicy: ReturnType<typeof resolveEffectiveToolPolicy>;
  senderIsOwner?: boolean;
}): EffectiveToolUnavailableEntry[] | undefined {
  const available = new Set(params.availableTools.map((tool) => tool.id));
  const unavailable = listCoreToolSections()
    .flatMap((section) => section.tools)
    .filter((tool) => !available.has(tool.id))
    .map((tool) => ({
      id: tool.id,
      label: tool.label,
      source: "core" as const,
      ...resolveToolLifecycleMetadata({ toolId: tool.id, source: "core" }),
      reason: describeUnavailableCoreTool({
        toolId: tool.id,
        effectivePolicy: params.effectivePolicy,
        senderIsOwner: params.senderIsOwner,
      }),
    }));
  return unavailable.length > 0 ? unavailable : undefined;
}

function buildDiagnostics(messages: string[]): EffectiveToolDiagnostic[] | undefined {
  const seen = new Set<string>();
  const diagnostics = messages
    .map((message) => message.trim())
    .filter((message) => {
      if (!message || seen.has(message)) {
        return false;
      }
      seen.add(message);
      return true;
    })
    .map((message) => ({ level: "warning" as const, message }));
  return diagnostics.length > 0 ? diagnostics : undefined;
}

function maybeDescribeExecRisk(params: {
  cfg: CrawClawConfig;
  sessionEntry?: SessionEntry;
  agentId: string;
  sessionKey?: string;
  sandboxAvailable?: boolean;
  availableTools: EffectiveToolInventoryEntry[];
}): string | undefined {
  if (!params.availableTools.some((tool) => tool.id === "exec")) {
    return undefined;
  }
  const sandboxAvailable =
    params.sandboxAvailable ??
    resolveSandboxRuntimeStatus({ cfg: params.cfg, sessionKey: params.sessionKey }).sandboxed;
  return describeExecRiskDiagnostic(
    resolveExecPosture({
      cfg: params.cfg,
      sessionEntry: params.sessionEntry,
      agentId: params.agentId,
      sandboxAvailable,
    }),
  );
}

export function resolveEffectiveToolInventory(
  params: ResolveEffectiveToolInventoryParams,
): EffectiveToolInventoryResult {
  const agentId =
    params.agentId?.trim() ||
    resolveSessionAgentId({ sessionKey: params.sessionKey, config: params.cfg });
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, agentId);
  const agentDir = params.agentDir ?? resolveAgentDir(params.cfg, agentId);
  const modelCompat = resolveEffectiveModelCompat({
    cfg: params.cfg,
    agentDir,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
  });

  const toolPolicyDiagnostics: string[] = [];
  const effectiveTools = createCrawClawCodingTools({
    agentId,
    sessionKey: params.sessionKey,
    workspaceDir,
    agentDir,
    config: params.cfg,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
    modelCompat: coerceModelCompatConfig(modelCompat),
    messageProvider: params.messageProvider,
    senderIsOwner: params.senderIsOwner,
    senderId: params.senderId,
    senderName: params.senderName ?? undefined,
    senderUsername: params.senderUsername ?? undefined,
    senderE164: params.senderE164 ?? undefined,
    agentAccountId: params.accountId ?? undefined,
    currentChannelId: params.currentChannelId,
    currentThreadTs: params.currentThreadTs,
    currentMessageId: params.currentMessageId,
    groupId: params.groupId ?? undefined,
    groupChannel: params.groupChannel ?? undefined,
    groupSpace: params.groupSpace ?? undefined,
    replyToMode: params.replyToMode,
    allowGatewaySubagentBinding: true,
    modelHasVision: params.modelHasVision,
    requireExplicitMessageTarget: params.requireExplicitMessageTarget,
    disableMessageTool: params.disableMessageTool,
    toolPolicyDiagnostics,
  });
  const effectivePolicy = resolveEffectiveToolPolicy({
    config: params.cfg,
    agentId,
    sessionKey: params.sessionKey,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
  });
  const profile = effectivePolicy.providerProfile ?? effectivePolicy.profile ?? "full";

  const entries = disambiguateLabels(
    effectiveTools
      .map((tool) => {
        const source = resolveEffectiveToolSource(tool);
        return {
          id: tool.name,
          label: resolveEffectiveToolLabel(tool),
          description: summarizeToolDescription(tool),
          rawDescription: resolveRawToolDescription(tool) || summarizeToolDescription(tool),
          ...source,
          ...resolveToolLifecycleMetadata({ toolId: tool.name, source: source.source }),
        } satisfies EffectiveToolInventoryEntry;
      })
      .toSorted((a, b) => a.label.localeCompare(b.label)),
  );
  const unavailableTools = buildUnavailableCoreTools({
    availableTools: entries,
    effectivePolicy,
    senderIsOwner: params.senderIsOwner,
  });
  const execRiskDiagnostic = maybeDescribeExecRisk({
    cfg: params.cfg,
    sessionEntry: params.sessionEntry,
    agentId,
    sessionKey: params.sessionKey,
    sandboxAvailable: params.sandboxAvailable,
    availableTools: entries,
  });
  const diagnostics = buildDiagnostics([
    ...toolPolicyDiagnostics,
    ...(execRiskDiagnostic ? [execRiskDiagnostic] : []),
  ]);
  const groupsBySource = new Map<EffectiveToolSource, EffectiveToolInventoryEntry[]>();
  for (const entry of entries) {
    const tools = groupsBySource.get(entry.source) ?? [];
    tools.push(entry);
    groupsBySource.set(entry.source, tools);
  }

  const groups = (["core", "plugin", "channel"] as const)
    .map((source) => {
      const tools = groupsBySource.get(source);
      if (!tools || tools.length === 0) {
        return null;
      }
      return {
        id: source,
        label: groupLabel(source),
        source,
        tools,
      } satisfies EffectiveToolInventoryGroup;
    })
    .filter((group): group is EffectiveToolInventoryGroup => group !== null);

  return {
    agentId,
    profile,
    groups,
    ...(unavailableTools ? { unavailableTools } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  };
}
