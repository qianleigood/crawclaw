import { Type, type TSchema } from "@sinclair/typebox";
import { listChannelPlugins } from "../../channels/plugins/index.js";
import {
  channelSupportsMessageCapability,
  channelSupportsMessageCapabilityForChannel,
  listChannelMessageActions,
  resolveChannelMessageToolSchemaProperties,
} from "../../channels/plugins/message-action-discovery.js";
import type { ChannelMessageCapability } from "../../channels/plugins/message-capabilities.js";
import {
  CHANNEL_MESSAGE_ACTION_NAMES,
  type ChannelMessageActionName,
} from "../../channels/plugins/types.js";
import type { CrawClawConfig } from "../../config/config.js";
import { POLL_CREATION_PARAM_DEFS, SHARED_POLL_CREATION_PARAM_NAMES } from "../../poll-params.js";
import { normalizeMessageChannel } from "../../utils/message-channel.js";
import { listChannelSupportedActions } from "../channel-tools.js";
import { channelTargetSchema, channelTargetsSchema, stringEnum } from "../schema/typebox.js";

const AllMessageActions = CHANNEL_MESSAGE_ACTION_NAMES;
const EXPLICIT_TARGET_ACTIONS = new Set<ChannelMessageActionName>([
  "send",
  "sendWithEffect",
  "sendAttachment",
  "upload-file",
  "reply",
  "thread-reply",
  "broadcast",
]);

export type MessageToolSchemaContext = {
  cfg: CrawClawConfig;
  currentChannelProvider?: string;
  currentChannelId?: string;
  currentThreadTs?: string;
  currentMessageId?: string | number;
  currentAccountId?: string;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  requesterSenderId?: string;
};

export function actionNeedsExplicitTarget(action: ChannelMessageActionName): boolean {
  return EXPLICIT_TARGET_ACTIONS.has(action);
}

function buildRoutingSchema() {
  return {
    channel: Type.Optional(Type.String()),
    target: Type.Optional(channelTargetSchema({ description: "Target channel/user id or name." })),
    targets: Type.Optional(channelTargetsSchema()),
    accountId: Type.Optional(Type.String()),
    dryRun: Type.Optional(Type.Boolean()),
  };
}

const interactiveOptionSchema = Type.Object({
  label: Type.String(),
  value: Type.String(),
});

const interactiveButtonSchema = Type.Object({
  label: Type.String(),
  value: Type.String(),
  style: Type.Optional(stringEnum(["primary", "secondary", "success", "danger"])),
});

const interactiveBlockSchema = Type.Object({
  type: stringEnum(["text", "buttons", "select"]),
  text: Type.Optional(Type.String()),
  buttons: Type.Optional(Type.Array(interactiveButtonSchema)),
  placeholder: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(interactiveOptionSchema)),
});

const interactiveMessageSchema = Type.Object(
  {
    blocks: Type.Array(interactiveBlockSchema),
  },
  {
    description:
      "Shared interactive message payload for buttons and selects. Channels render this into their native components when supported.",
  },
);

function buildSendSchema(options: { includeInteractive: boolean }) {
  const props: Record<string, TSchema> = {
    message: Type.Optional(Type.String()),
    effectId: Type.Optional(
      Type.String({
        description: "Message effect name/id for sendWithEffect (e.g., invisible ink).",
      }),
    ),
    effect: Type.Optional(
      Type.String({ description: "Alias for effectId (e.g., invisible-ink, balloons)." }),
    ),
    media: Type.Optional(
      Type.String({
        description: "Media URL or local path. data: URLs are not supported here, use buffer.",
      }),
    ),
    filename: Type.Optional(Type.String()),
    buffer: Type.Optional(
      Type.String({
        description: "Base64 payload for attachments (optionally a data: URL).",
      }),
    ),
    contentType: Type.Optional(Type.String()),
    mimeType: Type.Optional(Type.String()),
    caption: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
    filePath: Type.Optional(Type.String()),
    replyTo: Type.Optional(Type.String()),
    threadId: Type.Optional(Type.String()),
    asVoice: Type.Optional(Type.Boolean()),
    silent: Type.Optional(Type.Boolean()),
    quoteText: Type.Optional(
      Type.String({ description: "Quote text for Telegram reply_parameters" }),
    ),
    bestEffort: Type.Optional(Type.Boolean()),
    gifPlayback: Type.Optional(Type.Boolean()),
    forceDocument: Type.Optional(
      Type.Boolean({
        description: "Send image/GIF as document to avoid Telegram compression (Telegram only).",
      }),
    ),
    asDocument: Type.Optional(
      Type.Boolean({
        description:
          "Send image/GIF as document to avoid Telegram compression. Alias for forceDocument (Telegram only).",
      }),
    ),
    interactive: Type.Optional(interactiveMessageSchema),
  };
  if (!options.includeInteractive) {
    delete props.interactive;
  }
  return props;
}

function buildReactionSchema() {
  return {
    messageId: Type.Optional(
      Type.String({
        description:
          "Target message id for reaction. If omitted, defaults to the current inbound message id when available.",
      }),
    ),
    message_id: Type.Optional(
      Type.String({
        description:
          "snake_case alias of messageId. If omitted, defaults to the current inbound message id when available.",
      }),
    ),
    emoji: Type.Optional(Type.String()),
    remove: Type.Optional(Type.Boolean()),
    targetAuthor: Type.Optional(Type.String()),
    targetAuthorUuid: Type.Optional(Type.String()),
    groupId: Type.Optional(Type.String()),
  };
}

function buildFetchSchema() {
  return {
    limit: Type.Optional(Type.Number()),
    pageSize: Type.Optional(Type.Number()),
    pageToken: Type.Optional(Type.String()),
    before: Type.Optional(Type.String()),
    after: Type.Optional(Type.String()),
    around: Type.Optional(Type.String()),
    fromMe: Type.Optional(Type.Boolean()),
    includeArchived: Type.Optional(Type.Boolean()),
  };
}

function buildPollSchema() {
  const props: Record<string, TSchema> = {
    pollId: Type.Optional(Type.String()),
    pollOptionId: Type.Optional(
      Type.String({
        description: "Poll answer id to vote for. Use when the channel exposes stable answer ids.",
      }),
    ),
    pollOptionIds: Type.Optional(
      Type.Array(
        Type.String({
          description:
            "Poll answer ids to vote for in a multiselect poll. Use when the channel exposes stable answer ids.",
        }),
      ),
    ),
    pollOptionIndex: Type.Optional(
      Type.Number({
        description:
          "1-based poll option number to vote for, matching the rendered numbered poll choices.",
      }),
    ),
    pollOptionIndexes: Type.Optional(
      Type.Array(
        Type.Number({
          description:
            "1-based poll option numbers to vote for in a multiselect poll, matching the rendered numbered poll choices.",
        }),
      ),
    ),
  };
  for (const name of SHARED_POLL_CREATION_PARAM_NAMES) {
    const def = POLL_CREATION_PARAM_DEFS[name];
    switch (def.kind) {
      case "string":
        props[name] = Type.Optional(Type.String());
        break;
      case "stringArray":
        props[name] = Type.Optional(Type.Array(Type.String()));
        break;
      case "number":
        props[name] = Type.Optional(Type.Number());
        break;
      case "boolean":
        props[name] = Type.Optional(Type.Boolean());
        break;
    }
  }
  return props;
}

function buildChannelTargetSchema() {
  return {
    channelId: Type.Optional(
      Type.String({ description: "Channel id filter (search/thread list/event create)." }),
    ),
    chatId: Type.Optional(
      Type.String({ description: "Chat id for chat-scoped metadata actions." }),
    ),
    channelIds: Type.Optional(
      Type.Array(Type.String({ description: "Channel id filter (repeatable)." })),
    ),
    memberId: Type.Optional(Type.String()),
    memberIdType: Type.Optional(Type.String()),
    guildId: Type.Optional(Type.String()),
    userId: Type.Optional(Type.String()),
    openId: Type.Optional(Type.String()),
    unionId: Type.Optional(Type.String()),
    authorId: Type.Optional(Type.String()),
    authorIds: Type.Optional(Type.Array(Type.String())),
    roleId: Type.Optional(Type.String()),
    roleIds: Type.Optional(Type.Array(Type.String())),
    participant: Type.Optional(Type.String()),
    includeMembers: Type.Optional(Type.Boolean()),
    members: Type.Optional(Type.Boolean()),
    scope: Type.Optional(Type.String()),
    kind: Type.Optional(Type.String()),
  };
}

function buildStickerSchema() {
  return {
    emojiName: Type.Optional(Type.String()),
    stickerId: Type.Optional(Type.Array(Type.String())),
    stickerName: Type.Optional(Type.String()),
    stickerDesc: Type.Optional(Type.String()),
    stickerTags: Type.Optional(Type.String()),
  };
}

function buildThreadSchema() {
  return {
    threadName: Type.Optional(Type.String()),
    autoArchiveMin: Type.Optional(Type.Number()),
    appliedTags: Type.Optional(Type.Array(Type.String())),
  };
}

function buildEventSchema() {
  return {
    query: Type.Optional(Type.String()),
    eventName: Type.Optional(Type.String()),
    eventType: Type.Optional(Type.String()),
    startTime: Type.Optional(Type.String()),
    endTime: Type.Optional(Type.String()),
    desc: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    durationMin: Type.Optional(Type.Number()),
    until: Type.Optional(Type.String()),
  };
}

function buildModerationSchema() {
  return {
    reason: Type.Optional(Type.String()),
    deleteDays: Type.Optional(Type.Number()),
  };
}

function buildGatewaySchema() {
  return {
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
  };
}

function buildPresenceSchema() {
  return {
    activityType: Type.Optional(
      Type.String({
        description: "Activity type: playing, streaming, listening, watching, competing, custom.",
      }),
    ),
    activityName: Type.Optional(
      Type.String({
        description: "Activity name shown in sidebar (e.g. 'with fire'). Ignored for custom type.",
      }),
    ),
    activityUrl: Type.Optional(
      Type.String({
        description:
          "Streaming URL (Twitch or YouTube). Only used with streaming type; may not render for bots.",
      }),
    ),
    activityState: Type.Optional(
      Type.String({
        description:
          "State text. For custom type this is the status text; for others it shows in the flyout.",
      }),
    ),
    status: Type.Optional(
      Type.String({ description: "Bot status: online, dnd, idle, invisible." }),
    ),
  };
}

function buildChannelManagementSchema() {
  return {
    name: Type.Optional(Type.String()),
    type: Type.Optional(Type.Number()),
    parentId: Type.Optional(Type.String()),
    topic: Type.Optional(Type.String()),
    position: Type.Optional(Type.Number()),
    nsfw: Type.Optional(Type.Boolean()),
    rateLimitPerUser: Type.Optional(Type.Number()),
    categoryId: Type.Optional(Type.String()),
    clearParent: Type.Optional(
      Type.Boolean({
        description: "Clear the parent/category when supported by the provider.",
      }),
    ),
  };
}

function buildMessageToolSchemaProps(options: {
  includeInteractive: boolean;
  extraProperties?: Record<string, TSchema>;
}) {
  return {
    ...buildRoutingSchema(),
    ...buildSendSchema(options),
    ...buildReactionSchema(),
    ...buildFetchSchema(),
    ...buildPollSchema(),
    ...buildChannelTargetSchema(),
    ...buildStickerSchema(),
    ...buildThreadSchema(),
    ...buildEventSchema(),
    ...buildModerationSchema(),
    ...buildGatewaySchema(),
    ...buildChannelManagementSchema(),
    ...buildPresenceSchema(),
    ...options.extraProperties,
  };
}

function buildMessageToolSchemaFromActions(
  actions: readonly string[],
  options: {
    includeInteractive: boolean;
    extraProperties?: Record<string, TSchema>;
  },
) {
  const props = buildMessageToolSchemaProps(options);
  return Type.Object({
    action: stringEnum(actions),
    ...props,
  });
}

export const MessageToolSchema = buildMessageToolSchemaFromActions(AllMessageActions, {
  includeInteractive: true,
});

function resolveMessageToolSchemaActions(params: MessageToolSchemaContext): string[] {
  const currentChannel = normalizeMessageChannel(params.currentChannelProvider);
  if (currentChannel) {
    const scopedActions = listChannelSupportedActions({
      cfg: params.cfg,
      channel: currentChannel,
      currentChannelId: params.currentChannelId,
      currentThreadTs: params.currentThreadTs,
      currentMessageId: params.currentMessageId,
      accountId: params.currentAccountId,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      agentId: params.agentId,
      requesterSenderId: params.requesterSenderId,
    });
    const allActions = new Set<string>(["send", ...scopedActions]);
    for (const plugin of listChannelPlugins()) {
      if (plugin.id === currentChannel) {
        continue;
      }
      for (const action of listChannelSupportedActions({
        cfg: params.cfg,
        channel: plugin.id,
        currentChannelId: params.currentChannelId,
        currentThreadTs: params.currentThreadTs,
        currentMessageId: params.currentMessageId,
        accountId: params.currentAccountId,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        agentId: params.agentId,
        requesterSenderId: params.requesterSenderId,
      })) {
        allActions.add(action);
      }
    }
    return Array.from(allActions);
  }
  const actions = listChannelMessageActions(params.cfg);
  return actions.length > 0 ? actions : ["send"];
}

function resolveIncludeCapability(
  params: MessageToolSchemaContext,
  capability: ChannelMessageCapability,
): boolean {
  const currentChannel = normalizeMessageChannel(params.currentChannelProvider);
  if (currentChannel) {
    return channelSupportsMessageCapabilityForChannel(
      {
        cfg: params.cfg,
        channel: currentChannel,
        currentChannelId: params.currentChannelId,
        currentThreadTs: params.currentThreadTs,
        currentMessageId: params.currentMessageId,
        accountId: params.currentAccountId,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        agentId: params.agentId,
        requesterSenderId: params.requesterSenderId,
      },
      capability,
    );
  }
  return channelSupportsMessageCapability(params.cfg, capability);
}

function resolveIncludeInteractive(params: MessageToolSchemaContext): boolean {
  return resolveIncludeCapability(params, "interactive");
}

export function buildMessageToolSchema(params: MessageToolSchemaContext) {
  const actions = resolveMessageToolSchemaActions(params);
  const includeInteractive = resolveIncludeInteractive(params);
  const extraProperties = resolveChannelMessageToolSchemaProperties({
    cfg: params.cfg,
    channel: normalizeMessageChannel(params.currentChannelProvider),
    currentChannelId: params.currentChannelId,
    currentThreadTs: params.currentThreadTs,
    currentMessageId: params.currentMessageId,
    accountId: params.currentAccountId,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    agentId: params.agentId,
    requesterSenderId: params.requesterSenderId,
  });
  return buildMessageToolSchemaFromActions(actions.length > 0 ? actions : ["send"], {
    includeInteractive,
    extraProperties,
  });
}

export function buildMessageToolDescription(options?: {
  config?: CrawClawConfig;
  currentChannel?: string;
  currentChannelId?: string;
  currentThreadTs?: string;
  currentMessageId?: string | number;
  currentAccountId?: string;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  requesterSenderId?: string;
}): string {
  const baseDescription = "Send, delete, and manage messages via channel plugins.";
  const resolvedOptions = options ?? {};
  const currentChannel = normalizeMessageChannel(resolvedOptions.currentChannel);

  if (currentChannel) {
    const channelActions = listChannelSupportedActions({
      cfg: resolvedOptions.config,
      channel: currentChannel,
      currentChannelId: resolvedOptions.currentChannelId,
      currentThreadTs: resolvedOptions.currentThreadTs,
      currentMessageId: resolvedOptions.currentMessageId,
      accountId: resolvedOptions.currentAccountId,
      sessionKey: resolvedOptions.sessionKey,
      sessionId: resolvedOptions.sessionId,
      agentId: resolvedOptions.agentId,
      requesterSenderId: resolvedOptions.requesterSenderId,
    });
    if (channelActions.length > 0) {
      const allActions = new Set(["send", ...channelActions]);
      const actionList = Array.from(allActions).toSorted().join(", ");
      let desc = `${baseDescription} Current channel (${currentChannel}) supports: ${actionList}.`;

      const otherChannels: string[] = [];
      for (const plugin of listChannelPlugins()) {
        if (plugin.id === currentChannel) {
          continue;
        }
        const actions = listChannelSupportedActions({
          cfg: resolvedOptions.config,
          channel: plugin.id,
          currentChannelId: resolvedOptions.currentChannelId,
          currentThreadTs: resolvedOptions.currentThreadTs,
          currentMessageId: resolvedOptions.currentMessageId,
          accountId: resolvedOptions.currentAccountId,
          sessionKey: resolvedOptions.sessionKey,
          sessionId: resolvedOptions.sessionId,
          agentId: resolvedOptions.agentId,
          requesterSenderId: resolvedOptions.requesterSenderId,
        });
        if (actions.length > 0) {
          const all = new Set(["send", ...actions]);
          otherChannels.push(`${plugin.id} (${Array.from(all).toSorted().join(", ")})`);
        }
      }
      if (otherChannels.length > 0) {
        desc += ` Other configured channels: ${otherChannels.join(", ")}.`;
      }

      return desc;
    }
  }

  if (resolvedOptions.config) {
    const actions = listChannelMessageActions(resolvedOptions.config);
    if (actions.length > 0) {
      return `${baseDescription} Supports actions: ${actions.join(", ")}.`;
    }
  }

  return `${baseDescription} Supports actions: send, delete, react, poll, pin, threads, and more.`;
}
