import { randomUUID } from "node:crypto";
import { runNativeAgentTurn } from "../../agents/runtime-tools/agent-turn-client.js";
import type { CrawClawConfig } from "../../config/config.js";
import { resolveMainSessionKeyFromConfig } from "../../config/sessions.js";
import { requestMainSessionWakeNow } from "../../infra/main-session-wake.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import type { createSubsystemLogger } from "../../logging/subsystem.js";
import type { CliDeps } from "../../terminal/deps.js";
import { type HookAgentDispatchPayload, type HooksConfigResolved } from "../hooks.js";
import { createHooksRequestHandler, type HookClientIpConfig } from "../server-http.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

export function resolveHookClientIpConfig(cfg: CrawClawConfig): HookClientIpConfig {
  return {
    trustedProxies: cfg.gateway?.trustedProxies,
    allowRealIpFallback: cfg.gateway?.allowRealIpFallback === true,
  };
}

export function createGatewayHooksRequestHandler(params: {
  deps: CliDeps;
  getHooksConfig: () => HooksConfigResolved | null;
  getClientIpConfig: () => HookClientIpConfig;
  bindHost: string;
  port: number;
  logHooks: SubsystemLogger;
}) {
  const { getHooksConfig, getClientIpConfig, bindHost, port, logHooks } = params;

  const dispatchWakeHook = (value: { text: string; mode: "now" }) => {
    const sessionKey = resolveMainSessionKeyFromConfig();
    enqueueSystemEvent(value.text, { sessionKey });
    requestMainSessionWakeNow({ reason: "hook:wake" });
  };

  const dispatchAgentHook = (value: HookAgentDispatchPayload) => {
    const sessionKey = value.sessionKey;
    const mainSessionKey = resolveMainSessionKeyFromConfig();
    const runId = randomUUID();
    void (async () => {
      try {
        const result = await runNativeAgentTurn({
          runId,
          agentId: value.agentId,
          sessionKey,
          message: value.message,
          model: value.model,
          thinkLevel: value.thinking,
          timeoutMs:
            typeof value.timeoutSeconds === "number"
              ? Math.max(1, value.timeoutSeconds) * 1000
              : undefined,
          trigger: "hook",
          channel: value.channel,
          to: value.to,
          messageId: runId,
          messageThreadId: sessionKey,
        });
        const outputText =
          result.assistantText ??
          result.payloads
            ?.map((payload) => payload.text?.trim())
            .filter((text): text is string => !!text)
            .join("\n") ??
          "";
        const error = result.meta.error?.message;
        const status = error ? "error" : "ok";
        const summary = outputText || error || status;
        const prefix = status === "ok" ? `Hook ${value.name}` : `Hook ${value.name} (${status})`;
        if (result.didSendViaMessagingTool !== true) {
          enqueueSystemEvent(`${prefix}: ${summary}`.trim(), {
            sessionKey: mainSessionKey,
          });
          requestMainSessionWakeNow({ reason: `hook:${runId}` });
        }
      } catch (err) {
        logHooks.warn(`hook agent failed: ${String(err)}`);
        enqueueSystemEvent(`Hook ${value.name} (error): ${String(err)}`, {
          sessionKey: mainSessionKey,
        });
        requestMainSessionWakeNow({ reason: `hook:${runId}:error` });
      }
    })();

    return runId;
  };

  return createHooksRequestHandler({
    getHooksConfig,
    bindHost,
    port,
    logHooks,
    getClientIpConfig,
    dispatchAgentHook,
    dispatchWakeHook,
  });
}
