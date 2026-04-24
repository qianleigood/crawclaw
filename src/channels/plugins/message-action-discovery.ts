import type {
  CrawClawToolSchema,
  CrawClawToolSchemaProperties,
} from "../../agents/tools/schema-types.js";
import type { CrawClawConfig } from "../../config/config.js";
import { defaultRuntime } from "../../runtime.js";
import { normalizeAnyChannelId } from "../registry.js";
import { getChannelPlugin, listChannelPlugins } from "./index.js";
import type { ChannelMessageCapability } from "./message-capabilities.js";
import {
  resolveBundledChannelMessageToolDiscoveryAdapter,
  type ChannelMessageToolDiscoveryAdapter,
} from "./message-tool-api.js";
import type {
  ChannelMessageActionDiscoveryContext,
  ChannelMessageActionName,
  ChannelMessageToolDiscovery,
  ChannelMessageToolSchemaContribution,
} from "./types.js";

export type ChannelMessageActionDiscoveryInput = {
  cfg?: CrawClawConfig;
  channel?: string | null;
  currentChannelProvider?: string | null;
  currentChannelId?: string | null;
  currentThreadTs?: string | null;
  currentMessageId?: string | number | null;
  accountId?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  requesterSenderId?: string | null;
  senderIsOwner?: boolean;
};

type MessageToolMediaSourceParamMap = Partial<Record<ChannelMessageActionName, readonly string[]>>;

const loggedMessageActionErrors = new Set<string>();

export function resolveMessageActionDiscoveryChannelId(raw?: string | null): string | undefined {
  const normalized = normalizeAnyChannelId(raw);
  if (normalized) {
    return normalized;
  }
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

export function createMessageActionDiscoveryContext(
  params: ChannelMessageActionDiscoveryInput,
): ChannelMessageActionDiscoveryContext {
  const currentChannelProvider = resolveMessageActionDiscoveryChannelId(
    params.channel ?? params.currentChannelProvider,
  );
  return {
    cfg: params.cfg ?? ({} as CrawClawConfig),
    currentChannelId: params.currentChannelId,
    currentChannelProvider,
    currentThreadTs: params.currentThreadTs,
    currentMessageId: params.currentMessageId,
    accountId: params.accountId,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    agentId: params.agentId,
    requesterSenderId: params.requesterSenderId,
    senderIsOwner: params.senderIsOwner,
  };
}

function logMessageActionError(params: {
  pluginId: string;
  operation: "describeMessageTool";
  error: unknown;
}) {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  const key = `${params.pluginId}:${params.operation}:${message}`;
  if (loggedMessageActionErrors.has(key)) {
    return;
  }
  loggedMessageActionErrors.add(key);
  const stack = params.error instanceof Error && params.error.stack ? params.error.stack : null;
  defaultRuntime.error?.(
    `[message-action-discovery] ${params.pluginId}.actions.${params.operation} failed: ${stack ?? message}`,
  );
}

function describeMessageToolSafely(params: {
  pluginId: string;
  context: ChannelMessageActionDiscoveryContext;
  describeMessageTool: NonNullable<ChannelMessageToolDiscoveryAdapter["describeMessageTool"]>;
}): ChannelMessageToolDiscovery | null {
  try {
    return params.describeMessageTool(params.context) ?? null;
  } catch (error) {
    logMessageActionError({
      pluginId: params.pluginId,
      operation: "describeMessageTool",
      error,
    });
    return null;
  }
}

function normalizeToolSchemaContributions(
  value:
    | ChannelMessageToolSchemaContribution
    | ChannelMessageToolSchemaContribution[]
    | null
    | undefined,
): ChannelMessageToolSchemaContribution[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

type ResolvedChannelMessageActionDiscovery = {
  actions: ChannelMessageActionName[];
  capabilities: readonly ChannelMessageCapability[];
  schemaContributions: ChannelMessageToolSchemaContribution[];
  mediaSourceParams: readonly string[];
};

function normalizeMessageToolMediaSourceParams(
  mediaSourceParams: ChannelMessageToolDiscovery["mediaSourceParams"],
  action?: ChannelMessageActionName,
): readonly string[] {
  if (Array.isArray(mediaSourceParams)) {
    return mediaSourceParams;
  }
  if (!mediaSourceParams || typeof mediaSourceParams !== "object") {
    return [];
  }
  const scopedMediaSourceParams = mediaSourceParams as MessageToolMediaSourceParamMap;
  if (action) {
    const scoped = scopedMediaSourceParams[action];
    return Array.isArray(scoped) ? scoped : [];
  }
  return Object.values(scopedMediaSourceParams).flatMap((scoped) =>
    Array.isArray(scoped) ? scoped : [],
  );
}

export function resolveMessageActionDiscoveryForPlugin(params: {
  pluginId: string;
  actions?: ChannelMessageToolDiscoveryAdapter;
  context: ChannelMessageActionDiscoveryContext;
  action?: ChannelMessageActionName;
  includeActions?: boolean;
  includeCapabilities?: boolean;
  includeSchema?: boolean;
}): ResolvedChannelMessageActionDiscovery {
  const adapter =
    params.actions?.describeMessageTool !== undefined
      ? params.actions
      : resolveBundledChannelMessageToolDiscoveryAdapter(params.pluginId);
  if (!adapter?.describeMessageTool) {
    return {
      actions: [],
      capabilities: [],
      schemaContributions: [],
      mediaSourceParams: [],
    };
  }

  const described = describeMessageToolSafely({
    pluginId: params.pluginId,
    context: params.context,
    describeMessageTool: adapter.describeMessageTool,
  });
  return {
    actions:
      params.includeActions && Array.isArray(described?.actions) ? [...described.actions] : [],
    capabilities:
      params.includeCapabilities && Array.isArray(described?.capabilities)
        ? described.capabilities
        : [],
    schemaContributions: params.includeSchema
      ? normalizeToolSchemaContributions(described?.schema)
      : [],
    mediaSourceParams: normalizeMessageToolMediaSourceParams(
      described?.mediaSourceParams,
      params.action,
    ),
  };
}

export function listChannelMessageActions(cfg: CrawClawConfig): ChannelMessageActionName[] {
  const actions = new Set<ChannelMessageActionName>(["send", "broadcast"]);
  for (const plugin of listChannelPlugins()) {
    for (const action of resolveMessageActionDiscoveryForPlugin({
      pluginId: plugin.id,
      actions: plugin.actions,
      context: { cfg },
      includeActions: true,
    }).actions) {
      actions.add(action);
    }
  }
  return Array.from(actions);
}

export function listChannelMessageCapabilities(cfg: CrawClawConfig): ChannelMessageCapability[] {
  const capabilities = new Set<ChannelMessageCapability>();
  for (const plugin of listChannelPlugins()) {
    for (const capability of resolveMessageActionDiscoveryForPlugin({
      pluginId: plugin.id,
      actions: plugin.actions,
      context: { cfg },
      includeCapabilities: true,
    }).capabilities) {
      capabilities.add(capability);
    }
  }
  return Array.from(capabilities);
}

export function listChannelMessageCapabilitiesForChannel(params: {
  cfg: CrawClawConfig;
  channel?: string;
  currentChannelId?: string | null;
  currentThreadTs?: string | null;
  currentMessageId?: string | number | null;
  accountId?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  requesterSenderId?: string | null;
}): ChannelMessageCapability[] {
  const channelId = resolveMessageActionDiscoveryChannelId(params.channel);
  if (!channelId) {
    return [];
  }
  const plugin = getChannelPlugin(channelId as Parameters<typeof getChannelPlugin>[0]);
  const described = resolveMessageActionDiscoveryForPlugin({
    pluginId: plugin?.id ?? channelId,
    actions: plugin?.actions,
    context: createMessageActionDiscoveryContext(params),
    includeCapabilities: true,
  });
  return Array.from(described.capabilities);
}

function mergeToolSchemaProperties(
  target: CrawClawToolSchemaProperties,
  source: CrawClawToolSchemaProperties | undefined,
) {
  if (!source) {
    return;
  }
  for (const [name, schema] of Object.entries(source)) {
    if (!(name in target)) {
      target[name] = schema;
    }
  }
}

export function resolveChannelMessageToolSchemaProperties(params: {
  cfg: CrawClawConfig;
  channel?: string;
  currentChannelId?: string | null;
  currentThreadTs?: string | null;
  currentMessageId?: string | number | null;
  accountId?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  requesterSenderId?: string | null;
}): Record<string, CrawClawToolSchema> {
  const properties: CrawClawToolSchemaProperties = {};
  const currentChannel = resolveMessageActionDiscoveryChannelId(params.channel);
  const discoveryBase = createMessageActionDiscoveryContext(params);

  for (const plugin of listChannelPlugins()) {
    if (!plugin.actions) {
      continue;
    }
    for (const contribution of resolveMessageActionDiscoveryForPlugin({
      pluginId: plugin.id,
      actions: plugin.actions,
      context: discoveryBase,
      includeSchema: true,
    }).schemaContributions) {
      const visibility = contribution.visibility ?? "current-channel";
      if (currentChannel) {
        if (visibility === "all-configured" || plugin.id === currentChannel) {
          mergeToolSchemaProperties(properties, contribution.properties);
        }
        continue;
      }
      mergeToolSchemaProperties(properties, contribution.properties);
    }
  }

  return properties;
}

export function resolveChannelMessageToolMediaSourceParamKeys(params: {
  cfg: CrawClawConfig;
  action?: ChannelMessageActionName;
  channel?: string;
  currentChannelId?: string | null;
  currentThreadTs?: string | null;
  currentMessageId?: string | number | null;
  accountId?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  requesterSenderId?: string | null;
  senderIsOwner?: boolean;
}): string[] {
  const channelId = resolveMessageActionDiscoveryChannelId(params.channel);
  if (!channelId) {
    return [];
  }
  const plugin = getChannelPlugin(channelId as Parameters<typeof getChannelPlugin>[0]);
  const described = resolveMessageActionDiscoveryForPlugin({
    pluginId: plugin?.id ?? channelId,
    actions: plugin?.actions,
    context: createMessageActionDiscoveryContext(params),
    action: params.action,
  });
  return Array.from(new Set(described.mediaSourceParams));
}

export function channelSupportsMessageCapability(
  cfg: CrawClawConfig,
  capability: ChannelMessageCapability,
): boolean {
  return listChannelMessageCapabilities(cfg).includes(capability);
}

export function channelSupportsMessageCapabilityForChannel(
  params: {
    cfg: CrawClawConfig;
    channel?: string;
    currentChannelId?: string | null;
    currentThreadTs?: string | null;
    currentMessageId?: string | number | null;
    accountId?: string | null;
    sessionKey?: string | null;
    sessionId?: string | null;
    agentId?: string | null;
    requesterSenderId?: string | null;
  },
  capability: ChannelMessageCapability,
): boolean {
  return listChannelMessageCapabilitiesForChannel(params).includes(capability);
}

export const __testing = {
  resetLoggedMessageActionErrors() {
    loggedMessageActionErrors.clear();
  },
};
