import type { IncomingMessage } from "node:http";
import os from "node:os";
import type { WebSocket } from "ws";
import { loadConfig } from "../../../config/config.js";
import { upsertPresence } from "../../../infra/system-presence.js";
import { rawDataToString } from "../../../infra/ws.js";
import type { createSubsystemLogger } from "../../../logging/subsystem.js";
import {
  isBrowserOperatorUiClient,
  isGatewayCliClient,
  isWebchatClient,
} from "../../../utils/gateway-client-surface.js";
import { resolveRuntimeServiceVersion } from "../../../version.js";
import type { AuthRateLimiter } from "../../auth-rate-limit.js";
import type { GatewayAuthResult, ResolvedGatewayAuth } from "../../auth.js";
import { isLocalDirectRequest } from "../../auth.js";
import { ADMIN_SCOPE } from "../../method-scopes.js";
import {
  isLocalishHost,
  isLoopbackAddress,
  isTrustedProxyAddress,
  resolveClientIp,
} from "../../net.js";
import { checkBrowserOrigin } from "../../origin-check.js";
import {
  ConnectErrorDetailCodes,
  resolveAuthConnectErrorDetailCode,
} from "../../protocol/connect-error-details.js";
import {
  type ConnectParams,
  ErrorCodes,
  type ErrorShape,
  errorShape,
  formatValidationErrors,
  PROTOCOL_VERSION,
  validateConnectParams,
  validateRequestFrame,
} from "../../protocol/index.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "../../request-types.js";
import { parseGatewayRole } from "../../role-policy.js";
import {
  MAX_BUFFERED_BYTES,
  MAX_PAYLOAD_BYTES,
  MAX_PREAUTH_PAYLOAD_BYTES,
  TICK_INTERVAL_MS,
} from "../../server-constants.js";
import type { GatewayRequestDispatcher } from "../../server-request-dispatcher.js";
import { formatError } from "../../server-utils.js";
import { formatForLog, logWs } from "../../ws-log.js";
import { truncateCloseReason } from "../close-reason.js";
import {
  buildGatewaySnapshot,
  getHealthCache,
  getHealthVersion,
  incrementPresenceVersion,
  refreshGatewayHealthSnapshot,
} from "../health-state.js";
import type { GatewayWsClient } from "../ws-types.js";
import { resolveConnectAuthDecision, resolveConnectAuthState } from "./auth-context.js";
import { formatGatewayAuthFailureMessage } from "./auth-messages.js";
import {
  resolveHandshakeBrowserSecurityContext,
  resolveUnauthorizedHandshakeContext,
} from "./handshake-auth-helpers.js";
import { isUnauthorizedRoleError, UnauthorizedFloodGuard } from "./unauthorized-flood-guard.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

export type WsOriginCheckMetrics = {
  hostHeaderFallbackAccepted: number;
};

export function attachGatewayWsMessageHandler(params: {
  socket: WebSocket;
  upgradeReq: IncomingMessage;
  connId: string;
  remoteAddr?: string;
  forwardedFor?: string;
  realIp?: string;
  requestHost?: string;
  requestOrigin?: string;
  requestUserAgent?: string;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
  /** Browser-origin fallback limiter (loopback is never exempt). */
  browserRateLimiter?: AuthRateLimiter;
  gatewayMethods: string[];
  events: string[];
  extraHandlers: GatewayRequestHandlers;
  buildRequestContext: () => GatewayRequestContext;
  handleGatewayRequest: GatewayRequestDispatcher;
  send: (obj: unknown) => void;
  close: (code?: number, reason?: string) => void;
  isClosed: () => boolean;
  clearHandshakeTimer: () => void;
  getClient: () => GatewayWsClient | null;
  setClient: (next: GatewayWsClient) => void;
  setHandshakeState: (state: "pending" | "connected" | "failed") => void;
  setCloseCause: (cause: string, meta?: Record<string, unknown>) => void;
  setLastFrameMeta: (meta: { type?: string; method?: string; id?: string }) => void;
  originCheckMetrics: WsOriginCheckMetrics;
  logGateway: SubsystemLogger;
  logHealth: SubsystemLogger;
  logWsControl: SubsystemLogger;
}) {
  const {
    socket,
    upgradeReq,
    connId,
    remoteAddr,
    forwardedFor,
    realIp,
    requestHost,
    requestOrigin,
    requestUserAgent,
    resolvedAuth,
    rateLimiter,
    browserRateLimiter,
    gatewayMethods,
    events,
    extraHandlers,
    buildRequestContext,
    handleGatewayRequest,
    send,
    close,
    isClosed,
    clearHandshakeTimer,
    getClient,
    setClient,
    setHandshakeState,
    setCloseCause,
    setLastFrameMeta,
    originCheckMetrics,
    logGateway,
    logHealth,
    logWsControl,
  } = params;

  const configSnapshot = loadConfig();
  const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
  const allowRealIpFallback = configSnapshot.gateway?.allowRealIpFallback === true;
  const clientIp = resolveClientIp({
    remoteAddr,
    forwardedFor,
    realIp,
    trustedProxies,
    allowRealIpFallback,
  });

  // If proxy headers are present but the remote address isn't trusted, don't treat
  // the connection as local. This prevents auth bypass when running behind a reverse
  // proxy without proper configuration - the proxy's loopback connection would otherwise
  // cause all external requests to be treated as trusted local clients.
  const hasProxyHeaders = Boolean(forwardedFor || realIp);
  const remoteIsTrustedProxy = isTrustedProxyAddress(remoteAddr, trustedProxies);
  const hasUntrustedProxyHeaders = hasProxyHeaders && !remoteIsTrustedProxy;
  const hostIsLocalish = isLocalishHost(requestHost);
  const isLocalClient = isLocalDirectRequest(upgradeReq, trustedProxies, allowRealIpFallback);
  const reportedClientIp =
    isLocalClient || hasUntrustedProxyHeaders
      ? undefined
      : clientIp && !isLoopbackAddress(clientIp)
        ? clientIp
        : undefined;

  if (hasUntrustedProxyHeaders) {
    logWsControl.warn(
      "Proxy headers detected from untrusted address. " +
        "Connection will not be treated as local. " +
        "Configure gateway.trustedProxies to restore local client detection behind your proxy.",
    );
  }
  if (!hostIsLocalish && isLoopbackAddress(remoteAddr) && !hasProxyHeaders) {
    logWsControl.warn(
      "Loopback connection with non-local Host header. " +
        "Treating it as remote. If you're behind a reverse proxy, " +
        "set gateway.trustedProxies and forward X-Forwarded-For/X-Real-IP.",
    );
  }

  const isWebchatConnect = (p: ConnectParams | null | undefined) => isWebchatClient(p?.client);
  const unauthorizedFloodGuard = new UnauthorizedFloodGuard();
  const browserSecurity = resolveHandshakeBrowserSecurityContext({
    requestOrigin,
    clientIp,
    rateLimiter,
    browserRateLimiter,
  });
  const {
    enforceOriginCheckForAnyClient,
    rateLimitClientIp: browserRateLimitClientIp,
    authRateLimiter,
  } = browserSecurity;

  socket.on("message", async (data) => {
    if (isClosed()) {
      return;
    }

    const preauthPayloadBytes = !getClient() ? getRawDataByteLength(data) : undefined;
    if (preauthPayloadBytes !== undefined && preauthPayloadBytes > MAX_PREAUTH_PAYLOAD_BYTES) {
      setHandshakeState("failed");
      setCloseCause("preauth-payload-too-large", {
        payloadBytes: preauthPayloadBytes,
        limitBytes: MAX_PREAUTH_PAYLOAD_BYTES,
      });
      close(1009, "preauth payload too large");
      return;
    }

    const text = rawDataToString(data);
    try {
      const parsed = JSON.parse(text);
      const frameType =
        parsed && typeof parsed === "object" && "type" in parsed
          ? typeof (parsed as { type?: unknown }).type === "string"
            ? String((parsed as { type?: unknown }).type)
            : undefined
          : undefined;
      const frameMethod =
        parsed && typeof parsed === "object" && "method" in parsed
          ? typeof (parsed as { method?: unknown }).method === "string"
            ? String((parsed as { method?: unknown }).method)
            : undefined
          : undefined;
      const frameId =
        parsed && typeof parsed === "object" && "id" in parsed
          ? typeof (parsed as { id?: unknown }).id === "string"
            ? String((parsed as { id?: unknown }).id)
            : undefined
          : undefined;
      if (frameType || frameMethod || frameId) {
        setLastFrameMeta({ type: frameType, method: frameMethod, id: frameId });
      }

      const client = getClient();
      if (!client) {
        // Handshake must be a normal request:
        // { type:"req", method:"connect", params: ConnectParams }.
        const isRequestFrame = validateRequestFrame(parsed);
        if (
          !isRequestFrame ||
          parsed.method !== "connect" ||
          !validateConnectParams(parsed.params)
        ) {
          const handshakeError = isRequestFrame
            ? parsed.method === "connect"
              ? `invalid connect params: ${formatValidationErrors(validateConnectParams.errors)}`
              : "invalid handshake: first request must be connect"
            : "invalid request frame";
          setHandshakeState("failed");
          setCloseCause("invalid-handshake", {
            frameType,
            frameMethod,
            frameId,
            handshakeError,
          });
          if (isRequestFrame) {
            const req = parsed;
            send({
              type: "res",
              id: req.id,
              ok: false,
              error: errorShape(ErrorCodes.INVALID_REQUEST, handshakeError),
            });
          } else {
            logWsControl.warn(
              `invalid handshake conn=${connId} remote=${remoteAddr ?? "?"} fwd=${forwardedFor ?? "n/a"} origin=${requestOrigin ?? "n/a"} host=${requestHost ?? "n/a"} ua=${requestUserAgent ?? "n/a"}`,
            );
          }
          const closeReason = truncateCloseReason(handshakeError || "invalid handshake");
          if (isRequestFrame) {
            queueMicrotask(() => close(1008, closeReason));
          } else {
            close(1008, closeReason);
          }
          return;
        }

        const frame = parsed;
        const connectParams = frame.params as ConnectParams;
        const clientLabel = connectParams.client.displayName ?? connectParams.client.id;
        const clientMeta = {
          client: connectParams.client.id,
          clientDisplayName: connectParams.client.displayName,
          mode: connectParams.client.mode,
          version: connectParams.client.version,
        };
        const markHandshakeFailure = (cause: string, meta?: Record<string, unknown>) => {
          setHandshakeState("failed");
          setCloseCause(cause, { ...meta, ...clientMeta });
        };
        const sendHandshakeErrorResponse = (
          code: Parameters<typeof errorShape>[0],
          message: string,
          options?: Parameters<typeof errorShape>[2],
        ) => {
          send({
            type: "res",
            id: frame.id,
            ok: false,
            error: errorShape(code, message, options),
          });
        };

        // protocol negotiation
        const { minProtocol, maxProtocol } = connectParams;
        if (maxProtocol < PROTOCOL_VERSION || minProtocol > PROTOCOL_VERSION) {
          markHandshakeFailure("protocol-mismatch", {
            minProtocol,
            maxProtocol,
            expectedProtocol: PROTOCOL_VERSION,
          });
          logWsControl.warn(
            `protocol mismatch conn=${connId} remote=${remoteAddr ?? "?"} client=${clientLabel} ${connectParams.client.mode} v${connectParams.client.version}`,
          );
          sendHandshakeErrorResponse(ErrorCodes.INVALID_REQUEST, "protocol mismatch", {
            details: { expectedProtocol: PROTOCOL_VERSION },
          });
          close(1002, "protocol mismatch");
          return;
        }

        const roleRaw = connectParams.role ?? "operator";
        const role = parseGatewayRole(roleRaw);
        if (!role) {
          markHandshakeFailure("invalid-role", {
            role: roleRaw,
          });
          sendHandshakeErrorResponse(ErrorCodes.INVALID_REQUEST, "invalid role");
          close(1008, "invalid role");
          return;
        }
        // Default-deny: scopes must be explicit. Empty/missing scopes means no permissions.
        let scopes = Array.isArray(connectParams.scopes) ? connectParams.scopes : [];
        connectParams.role = role;
        connectParams.scopes = scopes;

        const isBrowserOperatorUi = isBrowserOperatorUiClient(connectParams.client);
        const isWebchat = isWebchatConnect(connectParams);
        if (enforceOriginCheckForAnyClient || isBrowserOperatorUi || isWebchat) {
          const hostHeaderOriginFallbackEnabled =
            configSnapshot.gateway?.browserClients?.dangerouslyAllowHostHeaderOriginFallback ===
            true;
          const originCheck = checkBrowserOrigin({
            requestHost,
            origin: requestOrigin,
            allowedOrigins: configSnapshot.gateway?.browserClients?.allowedOrigins,
            allowHostHeaderOriginFallback: hostHeaderOriginFallbackEnabled,
            isLocalClient,
          });
          if (!originCheck.ok) {
            const errorMessage =
              "origin not allowed (open the Browser client from the gateway host or allow it in gateway.browserClients.allowedOrigins)";
            markHandshakeFailure("origin-mismatch", {
              origin: requestOrigin ?? "n/a",
              host: requestHost ?? "n/a",
              reason: originCheck.reason,
            });
            sendHandshakeErrorResponse(ErrorCodes.INVALID_REQUEST, errorMessage, {
              details: {
                code: ConnectErrorDetailCodes.BROWSER_CLIENT_ORIGIN_NOT_ALLOWED,
                reason: originCheck.reason,
              },
            });
            close(1008, truncateCloseReason(errorMessage));
            return;
          }
          if (originCheck.matchedBy === "host-header-fallback") {
            originCheckMetrics.hostHeaderFallbackAccepted += 1;
            logWsControl.warn(
              `security warning: websocket origin accepted via Host-header fallback conn=${connId} count=${originCheckMetrics.hostHeaderFallbackAccepted} host=${requestHost ?? "n/a"} origin=${requestOrigin ?? "n/a"}`,
            );
            if (hostHeaderOriginFallbackEnabled) {
              logGateway.warn(
                "security metric: gateway.browserClients.dangerouslyAllowHostHeaderOriginFallback accepted a websocket connect request",
              );
            }
          }
        }

        const hasTokenAuth = Boolean(connectParams.auth?.token);
        const hasPasswordAuth = Boolean(connectParams.auth?.password);
        const hasSharedAuth = hasTokenAuth || hasPasswordAuth;

        let { authResult, authOk, authMethod, sharedAuthOk } = await resolveConnectAuthState({
          resolvedAuth,
          connectAuth: connectParams.auth,
          req: upgradeReq,
          trustedProxies,
          allowRealIpFallback,
          rateLimiter: authRateLimiter,
          clientIp: browserRateLimitClientIp,
        });
        const rejectUnauthorized = (failedAuth: GatewayAuthResult) => {
          const { authProvided, recommendedNextStep } = resolveUnauthorizedHandshakeContext({
            connectAuth: connectParams.auth,
            failedAuth,
          });
          markHandshakeFailure("unauthorized", {
            authMode: resolvedAuth.mode,
            authProvided,
            authReason: failedAuth.reason,
            allowTailscale: resolvedAuth.allowTailscale,
          });
          logWsControl.warn(
            `unauthorized conn=${connId} remote=${remoteAddr ?? "?"} client=${clientLabel} ${connectParams.client.mode} v${connectParams.client.version} reason=${failedAuth.reason ?? "unknown"}`,
          );
          const authMessage = formatGatewayAuthFailureMessage({
            authMode: resolvedAuth.mode,
            authProvided,
            reason: failedAuth.reason,
            client: connectParams.client,
          });
          sendHandshakeErrorResponse(ErrorCodes.INVALID_REQUEST, authMessage, {
            details: {
              code: resolveAuthConnectErrorDetailCode(failedAuth.reason),
              authReason: failedAuth.reason,
              recommendedNextStep,
            },
          });
          close(1008, truncateCloseReason(authMessage));
        };
        ({ authResult, authOk, authMethod } = await resolveConnectAuthDecision({
          state: {
            authResult,
            authOk,
            authMethod,
            sharedAuthOk,
            sharedAuthProvided: hasSharedAuth,
          },
        }));
        if (!authOk) {
          rejectUnauthorized(authResult);
          return;
        }
        const shouldTrackPresence = !isGatewayCliClient(connectParams.client);
        const clientId = connectParams.client.id;
        const instanceId = connectParams.client.instanceId;
        const presenceKey = shouldTrackPresence ? (instanceId ?? connId) : undefined;

        logWs("in", "connect", {
          connId,
          client: connectParams.client.id,
          clientDisplayName: connectParams.client.displayName,
          version: connectParams.client.version,
          mode: connectParams.client.mode,
          clientId,
          platform: connectParams.client.platform,
          auth: authMethod,
        });

        if (isWebchatConnect(connectParams)) {
          logWsControl.info(
            `webchat connected conn=${connId} remote=${remoteAddr ?? "?"} client=${clientLabel} ${connectParams.client.mode} v${connectParams.client.version}`,
          );
        }

        if (presenceKey) {
          upsertPresence(presenceKey, {
            host: connectParams.client.displayName ?? connectParams.client.id ?? os.hostname(),
            ip: isLocalClient ? undefined : reportedClientIp,
            version: connectParams.client.version,
            platform: connectParams.client.platform,
            deviceFamily: connectParams.client.deviceFamily,
            modelIdentifier: connectParams.client.modelIdentifier,
            mode: connectParams.client.mode,
            deviceId: instanceId,
            roles: [role],
            scopes,
            instanceId: instanceId ?? connId,
            reason: "connect",
          });
          incrementPresenceVersion();
        }

        const snapshot = buildGatewaySnapshot({
          includeSensitive: scopes.includes(ADMIN_SCOPE),
        });
        const cachedHealth = getHealthCache();
        if (cachedHealth) {
          snapshot.health = cachedHealth;
          snapshot.stateVersion.health = getHealthVersion();
        }
        const helloOk = {
          type: "hello-ok",
          protocol: PROTOCOL_VERSION,
          server: {
            version: resolveRuntimeServiceVersion(process.env),
            connId,
          },
          features: { methods: gatewayMethods, events },
          snapshot,
          policy: {
            maxPayload: MAX_PAYLOAD_BYTES,
            maxBufferedBytes: MAX_BUFFERED_BYTES,
            tickIntervalMs: TICK_INTERVAL_MS,
          },
        };

        clearHandshakeTimer();
        const nextClient: GatewayWsClient = {
          socket,
          connect: connectParams,
          connId,
          presenceKey,
          clientIp: reportedClientIp,
        };
        setSocketMaxPayload(socket, MAX_PAYLOAD_BYTES);
        setClient(nextClient);
        setHandshakeState("connected");
        logWs("out", "hello-ok", {
          connId,
          methods: gatewayMethods.length,
          events: events.length,
          presence: snapshot.presence.length,
          stateVersion: snapshot.stateVersion.presence,
        });

        send({ type: "res", id: frame.id, ok: true, payload: helloOk });
        void refreshGatewayHealthSnapshot({ probe: true }).catch((err) =>
          logHealth.error(`post-connect health refresh failed: ${formatError(err)}`),
        );
        return;
      }

      // After handshake, accept only req frames
      if (!validateRequestFrame(parsed)) {
        send({
          type: "res",
          id: (parsed as { id?: unknown })?.id ?? "invalid",
          ok: false,
          error: errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid request frame: ${formatValidationErrors(validateRequestFrame.errors)}`,
          ),
        });
        return;
      }
      const req = parsed;
      logWs("in", "req", { connId, id: req.id, method: req.method });
      const respond = (
        ok: boolean,
        payload?: unknown,
        error?: ErrorShape,
        meta?: Record<string, unknown>,
      ) => {
        send({ type: "res", id: req.id, ok, payload, error });
        const unauthorizedRoleError = isUnauthorizedRoleError(error);
        let logMeta = meta;
        if (unauthorizedRoleError) {
          const unauthorizedDecision = unauthorizedFloodGuard.registerUnauthorized();
          if (unauthorizedDecision.suppressedSinceLastLog > 0) {
            logMeta = {
              ...logMeta,
              suppressedUnauthorizedResponses: unauthorizedDecision.suppressedSinceLastLog,
            };
          }
          if (!unauthorizedDecision.shouldLog) {
            return;
          }
          if (unauthorizedDecision.shouldClose) {
            setCloseCause("repeated-unauthorized-requests", {
              unauthorizedCount: unauthorizedDecision.count,
              method: req.method,
            });
            queueMicrotask(() => close(1008, "repeated unauthorized calls"));
          }
          logMeta = {
            ...logMeta,
            unauthorizedCount: unauthorizedDecision.count,
          };
        } else {
          unauthorizedFloodGuard.reset();
        }
        logWs("out", "res", {
          connId,
          id: req.id,
          ok,
          method: req.method,
          errorCode: error?.code,
          errorMessage: error?.message,
          ...logMeta,
        });
      };

      void (async () => {
        await handleGatewayRequest({
          req,
          respond,
          client,
          isWebchatConnect,
          extraHandlers,
          context: buildRequestContext(),
        });
      })().catch((err) => {
        logGateway.error(`request handler failed: ${formatForLog(err)}`);
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
      });
    } catch (err) {
      logGateway.error(`parse/handle error: ${String(err)}`);
      logWs("out", "parse-error", { connId, error: formatForLog(err) });
      if (!getClient()) {
        close();
      }
    }
  });
}

function getRawDataByteLength(data: unknown): number {
  if (Buffer.isBuffer(data)) {
    return data.byteLength;
  }
  if (Array.isArray(data)) {
    return data.reduce((total, chunk) => total + chunk.byteLength, 0);
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  return Buffer.byteLength(String(data));
}

function setSocketMaxPayload(socket: WebSocket, maxPayload: number): void {
  const receiver = (socket as { _receiver?: { _maxPayload?: number } })._receiver;
  if (receiver) {
    receiver._maxPayload = maxPayload;
  }
}
