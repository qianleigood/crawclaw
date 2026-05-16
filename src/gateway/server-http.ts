import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { TlsOptions } from "node:tls";
import type { WebSocketServer } from "ws";
import { loadConfig } from "../config/config.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import {
  authorizeHttpGatewayConnect,
  isLocalDirectRequest,
  type ResolvedGatewayAuth,
} from "./auth.js";
import { setDefaultSecurityHeaders } from "./http-common.js";
import { getBearerToken, resolveHttpBrowserOriginPolicy } from "./http-utils.js";
import { handleOpenAiModelsHttpRequest } from "./models-http.js";
import { resolveRequestClientIp } from "./net.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";
import { enforcePluginRouteGatewayAuth } from "./server/http-auth.js";
import {
  isProtectedPluginRoutePathFromContext,
  resolvePluginRoutePathContext,
  type PluginHttpRequestHandler,
  type PluginRoutePathContext,
} from "./server/plugins-http.js";
import type { PreauthConnectionBudget } from "./server/preauth-connection-budget.js";
import type { ReadinessChecker } from "./server/readiness.js";
import { handleSessionKillHttpRequest } from "./session-kill-http.js";
import { handleSessionHistoryHttpRequest } from "./sessions-history-http.js";
import { handleWorkflowAgentHttpRequest } from "./workflow-agent-http.js";

export type HookClientIpConfig = Readonly<{
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
}>;

const GATEWAY_PROBE_STATUS_BY_PATH = new Map<string, "live" | "ready">([
  ["/health", "live"],
  ["/healthz", "live"],
  ["/ready", "ready"],
  ["/readyz", "ready"],
]);
function shouldEnforceDefaultPluginGatewayAuth(pathContext: PluginRoutePathContext): boolean {
  return (
    pathContext.malformedEncoding ||
    pathContext.decodePassLimitReached ||
    isProtectedPluginRoutePathFromContext(pathContext)
  );
}

async function canRevealReadinessDetails(params: {
  req: IncomingMessage;
  resolvedAuth: ResolvedGatewayAuth;
  trustedProxies: string[];
  allowRealIpFallback: boolean;
}): Promise<boolean> {
  if (isLocalDirectRequest(params.req, params.trustedProxies, params.allowRealIpFallback)) {
    return true;
  }
  if (params.resolvedAuth.mode === "none") {
    return false;
  }

  const bearerToken = getBearerToken(params.req);
  const authResult = await authorizeHttpGatewayConnect({
    auth: params.resolvedAuth,
    connectAuth: bearerToken ? { token: bearerToken, password: bearerToken } : null,
    req: params.req,
    trustedProxies: params.trustedProxies,
    allowRealIpFallback: params.allowRealIpFallback,
    browserOriginPolicy: resolveHttpBrowserOriginPolicy(params.req),
  });
  return authResult.ok;
}

async function handleGatewayProbeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestPath: string,
  resolvedAuth: ResolvedGatewayAuth,
  trustedProxies: string[],
  allowRealIpFallback: boolean,
  getReadiness?: ReadinessChecker,
): Promise<boolean> {
  const status = GATEWAY_PROBE_STATUS_BY_PATH.get(requestPath);
  if (!status) {
    return false;
  }

  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  let statusCode: number;
  let body: string;
  if (status === "ready" && getReadiness) {
    const includeDetails = await canRevealReadinessDetails({
      req,
      resolvedAuth,
      trustedProxies,
      allowRealIpFallback,
    });
    try {
      const result = getReadiness();
      statusCode = result.ready ? 200 : 503;
      body = JSON.stringify(includeDetails ? result : { ready: result.ready });
    } catch {
      statusCode = 503;
      body = JSON.stringify(
        includeDetails ? { ready: false, failing: ["internal"], uptimeMs: 0 } : { ready: false },
      );
    }
  } else {
    statusCode = 200;
    body = JSON.stringify({ ok: true, status });
  }
  res.statusCode = statusCode;
  res.end(method === "HEAD" ? undefined : body);
  return true;
}

export type HooksRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

type GatewayHttpRequestStage = {
  name: string;
  run: () => Promise<boolean> | boolean;
};

export async function runGatewayHttpRequestStages(
  stages: readonly GatewayHttpRequestStage[],
): Promise<boolean> {
  for (const stage of stages) {
    try {
      if (await stage.run()) {
        return true;
      }
    } catch (err) {
      // Log and skip the failing stage so subsequent stages (browser-client,
      // gateway-probes, etc.) remain reachable.  A common trigger is a
      // bundled-plugin facade that fails to load because an optional
      // dependency is missing after a lazy-facade
      // refactor).
      console.error(`[gateway-http] stage "${stage.name}" threw — skipping:`, err);
    }
  }
  return false;
}

function buildPluginRequestStages(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestPath: string;
  pluginPathContext: PluginRoutePathContext | null;
  handlePluginRequest?: PluginHttpRequestHandler;
  shouldEnforcePluginGatewayAuth?: (pathContext: PluginRoutePathContext) => boolean;
  resolvedAuth: ResolvedGatewayAuth;
  trustedProxies: string[];
  allowRealIpFallback: boolean;
  rateLimiter?: AuthRateLimiter;
}): GatewayHttpRequestStage[] {
  if (!params.handlePluginRequest) {
    return [];
  }
  let pluginGatewayAuthSatisfied = false;
  return [
    {
      name: "plugin-auth",
      run: async () => {
        const pathContext =
          params.pluginPathContext ?? resolvePluginRoutePathContext(params.requestPath);
        if (
          !(params.shouldEnforcePluginGatewayAuth ?? shouldEnforceDefaultPluginGatewayAuth)(
            pathContext,
          )
        ) {
          return false;
        }
        const pluginAuthOk = await enforcePluginRouteGatewayAuth({
          req: params.req,
          res: params.res,
          auth: params.resolvedAuth,
          trustedProxies: params.trustedProxies,
          allowRealIpFallback: params.allowRealIpFallback,
          rateLimiter: params.rateLimiter,
        });
        if (!pluginAuthOk) {
          return true;
        }
        pluginGatewayAuthSatisfied = true;
        return false;
      },
    },
    {
      name: "plugin-http",
      run: () => {
        const pathContext =
          params.pluginPathContext ?? resolvePluginRoutePathContext(params.requestPath);
        return (
          params.handlePluginRequest?.(params.req, params.res, pathContext, {
            gatewayAuthSatisfied: pluginGatewayAuthSatisfied,
          }) ?? false
        );
      },
    },
  ];
}

export function createHooksRequestHandler(_opts: {
  getHooksConfig: () => unknown;
  bindHost: string;
  port: number;
  logHooks: unknown;
  getClientIpConfig?: () => HookClientIpConfig;
}): HooksRequestHandler {
  return async () => false;
}

export function createGatewayHttpServer(opts: {
  openAiChatCompletionsEnabled: boolean;
  openAiChatCompletionsConfig?: import("../config/types.gateway.js").GatewayHttpChatCompletionsConfig;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  strictTransportSecurityHeader?: string;
  handleHooksRequest: HooksRequestHandler;
  handlePluginRequest?: PluginHttpRequestHandler;
  shouldEnforcePluginGatewayAuth?: (pathContext: PluginRoutePathContext) => boolean;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
  getRuntimeSurface?: () => {
    openAiChatCompletionsEnabled: boolean;
    openAiChatCompletionsConfig?: import("../config/types.gateway.js").GatewayHttpChatCompletionsConfig;
    openResponsesEnabled: boolean;
    openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
    strictTransportSecurityHeader?: string;
    resolvedAuth: ResolvedGatewayAuth;
    rateLimiter?: AuthRateLimiter;
  };
  getReadiness?: ReadinessChecker;
  tlsOptions?: TlsOptions;
}): HttpServer {
  const {
    openAiChatCompletionsEnabled,
    openAiChatCompletionsConfig,
    openResponsesEnabled,
    openResponsesConfig,
    strictTransportSecurityHeader,
    handleHooksRequest,
    handlePluginRequest,
    shouldEnforcePluginGatewayAuth,
    resolvedAuth,
    rateLimiter,
    getReadiness,
  } = opts;
  const getRuntimeSurface =
    opts.getRuntimeSurface ??
    (() => ({
      openAiChatCompletionsEnabled,
      openAiChatCompletionsConfig,
      openResponsesEnabled,
      openResponsesConfig,
      strictTransportSecurityHeader,
      resolvedAuth,
      rateLimiter,
    }));
  const httpServer: HttpServer = opts.tlsOptions
    ? createHttpsServer(opts.tlsOptions, (req, res) => {
        void handleRequest(req, res);
      })
    : createHttpServer((req, res) => {
        void handleRequest(req, res);
      });

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const runtimeSurface = getRuntimeSurface();
    const openAiCompatEnabled =
      runtimeSurface.openAiChatCompletionsEnabled || runtimeSurface.openResponsesEnabled;
    setDefaultSecurityHeaders(res, {
      strictTransportSecurity: runtimeSurface.strictTransportSecurityHeader,
    });

    // Don't interfere with WebSocket upgrades; ws handles the 'upgrade' event.
    if ((req.headers.upgrade ?? "").toLowerCase() === "websocket") {
      return;
    }

    try {
      const configSnapshot = loadConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
      const allowRealIpFallback = configSnapshot.gateway?.allowRealIpFallback === true;
      const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
      const pluginPathContext = handlePluginRequest
        ? resolvePluginRoutePathContext(requestPath)
        : null;
      const requestStages: GatewayHttpRequestStage[] = [
        {
          name: "hooks",
          run: () => handleHooksRequest(req, res),
        },
        {
          name: "models",
          run: () =>
            openAiCompatEnabled
              ? handleOpenAiModelsHttpRequest(req, res, {
                  auth: runtimeSurface.resolvedAuth,
                  trustedProxies,
                  allowRealIpFallback,
                  rateLimiter: runtimeSurface.rateLimiter,
                })
              : false,
        },
        {
          name: "workflow-agent",
          run: () =>
            handleWorkflowAgentHttpRequest(req, res, {
              auth: runtimeSurface.resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter: runtimeSurface.rateLimiter,
            }),
        },
        {
          name: "sessions-kill",
          run: () =>
            handleSessionKillHttpRequest(req, res, {
              auth: runtimeSurface.resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter: runtimeSurface.rateLimiter,
            }),
        },
        {
          name: "sessions-history",
          run: () =>
            handleSessionHistoryHttpRequest(req, res, {
              auth: runtimeSurface.resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter: runtimeSurface.rateLimiter,
            }),
        },
      ];
      if (runtimeSurface.openResponsesEnabled) {
        requestStages.push({
          name: "openresponses",
          run: () =>
            handleOpenResponsesHttpRequest(req, res, {
              auth: runtimeSurface.resolvedAuth,
              config: runtimeSurface.openResponsesConfig,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter: runtimeSurface.rateLimiter,
            }),
        });
      }
      if (runtimeSurface.openAiChatCompletionsEnabled) {
        requestStages.push({
          name: "openai",
          run: () =>
            handleOpenAiHttpRequest(req, res, {
              auth: runtimeSurface.resolvedAuth,
              config: runtimeSurface.openAiChatCompletionsConfig,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter: runtimeSurface.rateLimiter,
            }),
        });
      }
      // Plugin routes run before the Browser client SPA catch-all so explicitly
      // registered plugin endpoints stay reachable. Core built-in gateway
      // routes above still keep precedence on overlapping paths.
      requestStages.push(
        ...buildPluginRequestStages({
          req,
          res,
          requestPath,
          pluginPathContext,
          handlePluginRequest,
          shouldEnforcePluginGatewayAuth,
          resolvedAuth: runtimeSurface.resolvedAuth,
          trustedProxies,
          allowRealIpFallback,
          rateLimiter: runtimeSurface.rateLimiter,
        }),
      );

      requestStages.push({
        name: "gateway-probes",
        run: () =>
          handleGatewayProbeRequest(
            req,
            res,
            requestPath,
            runtimeSurface.resolvedAuth,
            trustedProxies,
            allowRealIpFallback,
            getReadiness,
          ),
      });

      if (await runGatewayHttpRequestStages(requestStages)) {
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch (err) {
      console.error("[gateway-http] unhandled error in request handler:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  }

  return httpServer;
}

export function attachGatewayUpgradeHandler(opts: {
  httpServer: HttpServer;
  wss: WebSocketServer;
  preauthConnectionBudget: PreauthConnectionBudget;
}) {
  const { httpServer, wss, preauthConnectionBudget } = opts;
  httpServer.on("upgrade", (req, socket, head) => {
    void (async () => {
      const configSnapshot = loadConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
      const allowRealIpFallback = configSnapshot.gateway?.allowRealIpFallback === true;
      const preauthBudgetKey = resolveRequestClientIp(req, trustedProxies, allowRealIpFallback);
      if (wss.listenerCount("connection") === 0) {
        const responseBody = "Gateway websocket handlers unavailable";
        socket.write(
          "HTTP/1.1 503 Service Unavailable\r\n" +
            "Connection: close\r\n" +
            "Content-Type: text/plain; charset=utf-8\r\n" +
            `Content-Length: ${Buffer.byteLength(responseBody, "utf8")}\r\n` +
            "\r\n" +
            responseBody,
        );
        socket.destroy();
        return;
      }
      if (!preauthConnectionBudget.acquire(preauthBudgetKey)) {
        const responseBody = "Too many unauthenticated sockets";
        socket.write(
          "HTTP/1.1 503 Service Unavailable\r\n" +
            "Connection: close\r\n" +
            "Content-Type: text/plain; charset=utf-8\r\n" +
            `Content-Length: ${Buffer.byteLength(responseBody, "utf8")}\r\n` +
            "\r\n" +
            responseBody,
        );
        socket.destroy();
        return;
      }
      let budgetTransferred = false;
      const releaseUpgradeBudget = () => {
        if (budgetTransferred) {
          return;
        }
        budgetTransferred = true;
        preauthConnectionBudget.release(preauthBudgetKey);
      };
      socket.once("close", releaseUpgradeBudget);
      try {
        wss.handleUpgrade(req, socket, head, (ws) => {
          (
            ws as unknown as import("ws").WebSocket & {
              __crawclawPreauthBudgetClaimed?: boolean;
              __crawclawPreauthBudgetKey?: string;
            }
          ).__crawclawPreauthBudgetKey = preauthBudgetKey;
          wss.emit("connection", ws, req);
          const budgetClaimed = Boolean(
            (
              ws as unknown as import("ws").WebSocket & {
                __crawclawPreauthBudgetClaimed?: boolean;
              }
            ).__crawclawPreauthBudgetClaimed,
          );
          if (budgetClaimed) {
            budgetTransferred = true;
            socket.off("close", releaseUpgradeBudget);
          }
        });
      } catch {
        socket.off("close", releaseUpgradeBudget);
        releaseUpgradeBudget();
        throw new Error("gateway websocket upgrade failed");
      }
    })().catch(() => {
      socket.destroy();
    });
  });
}
