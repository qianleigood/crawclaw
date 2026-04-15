import type { ChannelMessageActionName } from "../../channels/plugins/types.js";
import { resolveCommandSecretRefsViaGateway } from "../../cli/command-secret-gateway.js";
import { getScopedChannelsCommandSecretTargets } from "../../cli/command-secret-targets.js";
import { resolveMessageSecretScope } from "../../cli/message-secret-scope.js";
import type { CrawClawConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { GATEWAY_CLIENT_IDS, GATEWAY_CLIENT_MODES } from "../../gateway/protocol/client-info.js";
import { getToolResult, runMessageAction } from "../../infra/outbound/message-action-runner.js";
import { normalizeAccountId } from "../../routing/session-key.js";
import { stripReasoningTagsFromText } from "../../shared/text/reasoning-tags.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import { resolveGatewayOptions } from "./gateway.js";
import {
  MessageToolSchema,
  actionNeedsExplicitTarget,
  buildMessageToolDescription,
  buildMessageToolSchema,
} from "./message-tool-schema.js";

type MessageToolOptions = {
  agentAccountId?: string;
  agentSessionKey?: string;
  sessionId?: string;
  config?: CrawClawConfig;
  loadConfig?: () => CrawClawConfig;
  resolveCommandSecretRefsViaGateway?: typeof resolveCommandSecretRefsViaGateway;
  runMessageAction?: typeof runMessageAction;
  currentChannelId?: string;
  currentChannelProvider?: string;
  currentThreadTs?: string;
  currentMessageId?: string | number;
  replyToMode?: "off" | "first" | "all";
  hasRepliedRef?: { value: boolean };
  sandboxRoot?: string;
  requireExplicitTarget?: boolean;
  requesterSenderId?: string;
};

function resolveAgentAccountId(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return normalizeAccountId(trimmed);
}

export function createMessageTool(options?: MessageToolOptions): AnyAgentTool {
  const loadConfigForTool = options?.loadConfig ?? loadConfig;
  const resolveSecretRefsForTool =
    options?.resolveCommandSecretRefsViaGateway ?? resolveCommandSecretRefsViaGateway;
  const runMessageActionForTool = options?.runMessageAction ?? runMessageAction;
  const agentAccountId = resolveAgentAccountId(options?.agentAccountId);
  const resolvedAgentId = options?.agentSessionKey
    ? resolveSessionAgentId({
        sessionKey: options.agentSessionKey,
        config: options?.config,
      })
    : undefined;
  const schema = options?.config
    ? buildMessageToolSchema({
        cfg: options.config,
        currentChannelProvider: options.currentChannelProvider,
        currentChannelId: options.currentChannelId,
        currentThreadTs: options.currentThreadTs,
        currentMessageId: options.currentMessageId,
        currentAccountId: agentAccountId,
        sessionKey: options.agentSessionKey,
        sessionId: options.sessionId,
        agentId: resolvedAgentId,
        requesterSenderId: options.requesterSenderId,
      })
    : MessageToolSchema;
  const description = buildMessageToolDescription({
    config: options?.config,
    currentChannel: options?.currentChannelProvider,
    currentChannelId: options?.currentChannelId,
    currentThreadTs: options?.currentThreadTs,
    currentMessageId: options?.currentMessageId,
    currentAccountId: agentAccountId,
    sessionKey: options?.agentSessionKey,
    sessionId: options?.sessionId,
    agentId: resolvedAgentId,
    requesterSenderId: options?.requesterSenderId,
  });

  return {
    label: "Message",
    name: "message",
    displaySummary: "Send and manage messages across configured channels.",
    description,
    parameters: schema,
    execute: async (_toolCallId, args, signal) => {
      // Check if already aborted before doing any work
      if (signal?.aborted) {
        const err = new Error("Message send aborted");
        err.name = "AbortError";
        throw err;
      }
      // Shallow-copy so we don't mutate the original event args (used for logging/dedup).
      const params = { ...(args as Record<string, unknown>) };

      // Strip reasoning tags from text fields — models may include <think>…</think>
      // in tool arguments, and the messaging tool send path has no other tag filtering.
      for (const field of ["text", "content", "message", "caption"]) {
        if (typeof params[field] === "string") {
          params[field] = stripReasoningTagsFromText(params[field]);
        }
      }

      const action = readStringParam(params, "action", {
        required: true,
      }) as ChannelMessageActionName;
      let cfg = options?.config;
      if (!cfg) {
        const loadedRaw = loadConfigForTool();
        const scope = resolveMessageSecretScope({
          channel: params.channel,
          target: params.target,
          targets: params.targets,
          fallbackChannel: options?.currentChannelProvider,
          accountId: params.accountId,
          fallbackAccountId: agentAccountId,
        });
        const scopedTargets = getScopedChannelsCommandSecretTargets({
          config: loadedRaw,
          channel: scope.channel,
          accountId: scope.accountId,
        });
        cfg = (
          await resolveSecretRefsForTool({
            config: loadedRaw,
            commandName: "tools.message",
            targetIds: scopedTargets.targetIds,
            ...(scopedTargets.allowedPaths ? { allowedPaths: scopedTargets.allowedPaths } : {}),
            mode: "enforce_resolved",
          })
        ).resolvedConfig;
      }
      const requireExplicitTarget = options?.requireExplicitTarget === true;
      if (requireExplicitTarget && actionNeedsExplicitTarget(action)) {
        const explicitTarget =
          (typeof params.target === "string" && params.target.trim().length > 0) ||
          (typeof params.to === "string" && params.to.trim().length > 0) ||
          (typeof params.channelId === "string" && params.channelId.trim().length > 0) ||
          (Array.isArray(params.targets) &&
            params.targets.some((value) => typeof value === "string" && value.trim().length > 0));
        if (!explicitTarget) {
          throw new Error(
            "Explicit message target required for this run. Provide target/targets (and channel when needed).",
          );
        }
      }

      const accountId = readStringParam(params, "accountId") ?? agentAccountId;
      if (accountId) {
        params.accountId = accountId;
      }

      const gatewayResolved = resolveGatewayOptions({
        gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
        gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
        timeoutMs: readNumberParam(params, "timeoutMs"),
      });
      const gateway = {
        url: gatewayResolved.url,
        token: gatewayResolved.token,
        timeoutMs: gatewayResolved.timeoutMs,
        clientName: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
        clientDisplayName: "agent",
        mode: GATEWAY_CLIENT_MODES.BACKEND,
      };
      const hasCurrentMessageId =
        typeof options?.currentMessageId === "number" ||
        (typeof options?.currentMessageId === "string" &&
          options.currentMessageId.trim().length > 0);

      const toolContext =
        options?.currentChannelId ||
        options?.currentChannelProvider ||
        options?.currentThreadTs ||
        hasCurrentMessageId ||
        options?.replyToMode ||
        options?.hasRepliedRef
          ? {
              currentChannelId: options?.currentChannelId,
              currentChannelProvider: options?.currentChannelProvider,
              currentThreadTs: options?.currentThreadTs,
              currentMessageId: options?.currentMessageId,
              replyToMode: options?.replyToMode,
              hasRepliedRef: options?.hasRepliedRef,
              // Direct tool invocations should not add cross-context decoration.
              // The agent is composing a message, not forwarding from another chat.
              skipCrossContextDecoration: true,
            }
          : undefined;

      const result = await runMessageActionForTool({
        cfg,
        action,
        params,
        defaultAccountId: accountId ?? undefined,
        requesterSenderId: options?.requesterSenderId,
        gateway,
        toolContext,
        sessionKey: options?.agentSessionKey,
        sessionId: options?.sessionId,
        agentId: resolvedAgentId,
        sandboxRoot: options?.sandboxRoot,
        abortSignal: signal,
      });

      const toolResult = getToolResult(result);
      if (toolResult) {
        return toolResult;
      }
      return jsonResult(result.payload);
    },
  };
}
