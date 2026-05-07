import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import type { CliDeps } from "../cli/deps.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { PluginRegistry } from "../plugins/registry.js";
import {
  pinActivePluginChannelRegistry,
  pinActivePluginHttpRouteRegistry,
  releasePinnedPluginChannelRegistry,
  releasePinnedPluginHttpRouteRegistry,
  resolveActivePluginHttpRouteRegistry,
} from "../plugins/runtime.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import type { ChatAbortControllerEntry } from "./chat-abort.js";
import type { HooksConfigResolved } from "./hooks.js";
import { isLoopbackHost, resolveGatewayListenHosts } from "./net.js";
import {
  createGatewayBroadcaster,
  type GatewayBroadcastFn,
  type GatewayBroadcastToConnIdsFn,
} from "./server-broadcast.js";
import {
  type ChatRunEntry,
  createChatRunState,
  createToolEventRecipientRegistry,
} from "./server-chat.js";
import { MAX_PREAUTH_PAYLOAD_BYTES } from "./server-constants.js";
import {
  attachGatewayUpgradeHandler,
  createGatewayHttpServer,
  type HookClientIpConfig,
} from "./server-http.js";
import type { DedupeEntry } from "./server-shared.js";
import { createGatewayHooksRequestHandler } from "./server/hooks.js";
import { listenGatewayHttpServer } from "./server/http-listen.js";
import {
  createGatewayPluginRequestHandler,
  shouldEnforceGatewayAuthForPluginPath,
  type PluginRoutePathContext,
} from "./server/plugins-http.js";
import {
  createPreauthConnectionBudget,
  type PreauthConnectionBudget,
} from "./server/preauth-connection-budget.js";
import type { ReadinessChecker } from "./server/readiness.js";
import type { GatewayTlsRuntime } from "./server/tls.js";
import type { GatewayWsClient } from "./server/ws-types.js";

export type GatewayRuntimeHttpListenerSet = {
  httpServer: HttpServer;
  httpServers: HttpServer[];
  httpBindHosts: string[];
};

export async function startGatewayRuntimeHttpListeners(params: {
  cfg: import("../config/config.js").CrawClawConfig;
  bindHost: string;
  port: number;
  openAiChatCompletionsEnabled: boolean;
  openAiChatCompletionsConfig?: import("../config/types.gateway.js").GatewayHttpChatCompletionsConfig;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  strictTransportSecurityHeader?: string;
  resolvedAuth: ResolvedGatewayAuth;
  rateLimiter?: AuthRateLimiter;
  getHttpRuntimeSurface?: () => {
    openAiChatCompletionsEnabled: boolean;
    openAiChatCompletionsConfig?: import("../config/types.gateway.js").GatewayHttpChatCompletionsConfig;
    openResponsesEnabled: boolean;
    openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
    strictTransportSecurityHeader?: string;
    resolvedAuth: ResolvedGatewayAuth;
    rateLimiter?: AuthRateLimiter;
  };
  gatewayTls?: GatewayTlsRuntime;
  hooksConfig: () => HooksConfigResolved | null;
  getHookClientIpConfig: () => HookClientIpConfig;
  pluginRegistry: PluginRegistry;
  deps: CliDeps;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
  logHooks: ReturnType<typeof createSubsystemLogger>;
  logPlugins: ReturnType<typeof createSubsystemLogger>;
  getReadiness?: ReadinessChecker;
  wss: WebSocketServer;
  preauthConnectionBudget: PreauthConnectionBudget;
}): Promise<GatewayRuntimeHttpListenerSet> {
  const handleHooksRequest = createGatewayHooksRequestHandler({
    deps: params.deps,
    getHooksConfig: params.hooksConfig,
    getClientIpConfig: params.getHookClientIpConfig,
    bindHost: params.bindHost,
    port: params.port,
    logHooks: params.logHooks,
  });

  const handlePluginRequest = createGatewayPluginRequestHandler({
    registry: params.pluginRegistry,
    log: params.logPlugins,
  });
  const shouldEnforcePluginGatewayAuth = (pathContext: PluginRoutePathContext): boolean => {
    return shouldEnforceGatewayAuthForPluginPath(
      resolveActivePluginHttpRouteRegistry(params.pluginRegistry),
      pathContext,
    );
  };

  const bindHosts = await resolveGatewayListenHosts(params.bindHost);
  if (!isLoopbackHost(params.bindHost)) {
    params.log.warn(
      "⚠️  Gateway is binding to a non-loopback address. " +
        "Ensure authentication is configured before exposing to public networks.",
    );
  }
  if (params.cfg.gateway?.browserClients?.dangerouslyAllowHostHeaderOriginFallback === true) {
    params.log.warn(
      "⚠️  gateway.browserClients.dangerouslyAllowHostHeaderOriginFallback=true is enabled. " +
        "Host-header origin fallback weakens origin checks and should only be used as break-glass.",
    );
  }
  const httpServers: HttpServer[] = [];
  const httpBindHosts: string[] = [];
  for (const host of bindHosts) {
    const httpServer = createGatewayHttpServer({
      openAiChatCompletionsEnabled: params.openAiChatCompletionsEnabled,
      openAiChatCompletionsConfig: params.openAiChatCompletionsConfig,
      openResponsesEnabled: params.openResponsesEnabled,
      openResponsesConfig: params.openResponsesConfig,
      strictTransportSecurityHeader: params.strictTransportSecurityHeader,
      handleHooksRequest,
      handlePluginRequest,
      shouldEnforcePluginGatewayAuth,
      resolvedAuth: params.resolvedAuth,
      rateLimiter: params.rateLimiter,
      getRuntimeSurface: params.getHttpRuntimeSurface,
      getReadiness: params.getReadiness,
      tlsOptions: params.gatewayTls?.enabled ? params.gatewayTls.tlsOptions : undefined,
    });
    try {
      await listenGatewayHttpServer({
        httpServer,
        bindHost: host,
        port: params.port,
      });
      attachGatewayUpgradeHandler({
        httpServer,
        wss: params.wss,
        preauthConnectionBudget: params.preauthConnectionBudget,
      });
      httpServers.push(httpServer);
      httpBindHosts.push(host);
    } catch (err) {
      if (host === bindHosts[0]) {
        await closeGatewayHttpServers(httpServers).catch(() => undefined);
        throw err;
      }
      params.log.warn(
        `gateway: failed to bind loopback alias ${host}:${params.port} (${String(err)})`,
      );
    }
  }
  const httpServer = httpServers[0];
  if (!httpServer) {
    throw new Error("Gateway HTTP server failed to start");
  }
  return { httpServer, httpServers, httpBindHosts };
}

export async function closeGatewayHttpServers(httpServers: HttpServer[]): Promise<void> {
  for (const server of httpServers) {
    const httpServer = server as HttpServer & {
      closeIdleConnections?: () => void;
    };
    if (typeof httpServer.closeIdleConnections === "function") {
      httpServer.closeIdleConnections();
    }
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

export async function createGatewayRuntimeState(params: {
  cfg: import("../config/config.js").CrawClawConfig;
  bindHost: string;
  port: number;
  openAiChatCompletionsEnabled: boolean;
  openAiChatCompletionsConfig?: import("../config/types.gateway.js").GatewayHttpChatCompletionsConfig;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  strictTransportSecurityHeader?: string;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
  getHttpRuntimeSurface?: () => {
    openAiChatCompletionsEnabled: boolean;
    openAiChatCompletionsConfig?: import("../config/types.gateway.js").GatewayHttpChatCompletionsConfig;
    openResponsesEnabled: boolean;
    openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
    strictTransportSecurityHeader?: string;
    resolvedAuth: ResolvedGatewayAuth;
    rateLimiter?: AuthRateLimiter;
  };
  gatewayTls?: GatewayTlsRuntime;
  hooksConfig: () => HooksConfigResolved | null;
  getHookClientIpConfig: () => HookClientIpConfig;
  pluginRegistry: PluginRegistry;
  pinChannelRegistry?: boolean;
  deps: CliDeps;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
  logHooks: ReturnType<typeof createSubsystemLogger>;
  logPlugins: ReturnType<typeof createSubsystemLogger>;
  getReadiness?: ReadinessChecker;
}): Promise<{
  releasePluginRouteRegistry: () => void;
  httpServer: HttpServer;
  httpServers: HttpServer[];
  httpBindHosts: string[];
  wss: WebSocketServer;
  preauthConnectionBudget: PreauthConnectionBudget;
  clients: Set<GatewayWsClient>;
  broadcast: GatewayBroadcastFn;
  broadcastToConnIds: GatewayBroadcastToConnIdsFn;
  agentRunSeq: Map<string, number>;
  dedupe: Map<string, DedupeEntry>;
  chatRunState: ReturnType<typeof createChatRunState>;
  chatRunBuffers: Map<string, string>;
  chatDeltaSentAt: Map<string, number>;
  chatDeltaLastBroadcastLen: Map<string, number>;
  addChatRun: (sessionId: string, entry: ChatRunEntry) => void;
  removeChatRun: (
    sessionId: string,
    clientRunId: string,
    sessionKey?: string,
  ) => ChatRunEntry | undefined;
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  toolEventRecipients: ReturnType<typeof createToolEventRecipientRegistry>;
}> {
  pinActivePluginHttpRouteRegistry(params.pluginRegistry);
  if (params.pinChannelRegistry !== false) {
    pinActivePluginChannelRegistry(params.pluginRegistry);
  } else {
    releasePinnedPluginChannelRegistry();
  }
  try {
    const clients = new Set<GatewayWsClient>();
    const { broadcast, broadcastToConnIds } = createGatewayBroadcaster({ clients });

    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_PREAUTH_PAYLOAD_BYTES,
    });
    const preauthConnectionBudget = createPreauthConnectionBudget();
    const { httpServer, httpServers, httpBindHosts } = await startGatewayRuntimeHttpListeners({
      ...params,
      wss,
      preauthConnectionBudget,
    });

    const agentRunSeq = new Map<string, number>();
    const dedupe = new Map<string, DedupeEntry>();
    const chatRunState = createChatRunState();
    const chatRunRegistry = chatRunState.registry;
    const chatRunBuffers = chatRunState.buffers;
    const chatDeltaSentAt = chatRunState.deltaSentAt;
    const chatDeltaLastBroadcastLen = chatRunState.deltaLastBroadcastLen;
    const addChatRun = chatRunRegistry.add;
    const removeChatRun = chatRunRegistry.remove;
    const chatAbortControllers = new Map<string, ChatAbortControllerEntry>();
    const toolEventRecipients = createToolEventRecipientRegistry();

    return {
      releasePluginRouteRegistry: () => {
        // Releases both pinned HTTP-route and channel registries set at startup.
        // Release unconditionally (no registry arg): runtime reconfigure may
        // re-pin either surface to a registry that differs from the original
        // startup registry, so identity-guarded release would leak the pin.
        releasePinnedPluginHttpRouteRegistry();
        releasePinnedPluginChannelRegistry();
      },
      httpServer,
      httpServers,
      httpBindHosts,
      wss,
      preauthConnectionBudget,
      clients,
      broadcast,
      broadcastToConnIds,
      agentRunSeq,
      dedupe,
      chatRunState,
      chatRunBuffers,
      chatDeltaSentAt,
      chatDeltaLastBroadcastLen,
      addChatRun,
      removeChatRun,
      chatAbortControllers,
      toolEventRecipients,
    };
  } catch (err) {
    releasePinnedPluginHttpRouteRegistry(params.pluginRegistry);
    releasePinnedPluginChannelRegistry();
    throw err;
  }
}
