import { randomUUID } from "node:crypto";
import { formatErrorMessage } from "../infra/errors.js";
import type { SystemPresence } from "../infra/system-presence.js";
import { defaultGatewayHttpFetch, type GatewayHttpFetch } from "./http-fetch.js";

const GATEWAY_TOKEN_HEADER = "x-crawclaw-gateway-token";

export type GatewayProbeAuth = {
  token?: string;
  password?: string;
};

export type GatewayProbeClose = {
  code: number;
  reason: string;
  hint?: string;
};

export type GatewayProbeResult = {
  ok: boolean;
  url: string;
  connectLatencyMs: number | null;
  error: string | null;
  close: GatewayProbeClose | null;
  health: unknown;
  status: unknown;
  presence: SystemPresence[] | null;
  configSnapshot: unknown;
};

export const MIN_PROBE_TIMEOUT_MS = 250;
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function clampProbeTimeoutMs(timeoutMs: number): number {
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(MIN_PROBE_TIMEOUT_MS, timeoutMs));
}

type GatewayRpcEnvelope = {
  ok?: unknown;
  result?: unknown;
  error?: unknown;
};

const gatewayProbeDeps = {
  fetch: defaultGatewayHttpFetch,
};

export const __testing = {
  setFetchForTests(fetch: GatewayHttpFetch): void {
    gatewayProbeDeps.fetch = fetch;
  },
  resetDepsForTests(): void {
    gatewayProbeDeps.fetch = defaultGatewayHttpFetch;
  },
};

function gatewayHttpUrlFromGatewayUrl(url: string, pathname: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }
  parsed.pathname = pathname;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function gatewayProbeHeaders(auth?: GatewayProbeAuth): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const credential = auth?.token ?? auth?.password;
  if (credential) {
    headers[GATEWAY_TOKEN_HEADER] = credential;
  }
  return headers;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function fetchGatewayRpc<T>(params: {
  url: string;
  auth?: GatewayProbeAuth;
  signal: AbortSignal;
  method: string;
  rpcParams?: unknown;
  tlsFingerprint?: string;
}): Promise<T> {
  const response = await gatewayProbeDeps.fetch(
    gatewayHttpUrlFromGatewayUrl(params.url, "/api/gateway/rpc"),
    {
      method: "POST",
      headers: gatewayProbeHeaders(params.auth),
      body: JSON.stringify({
        id: randomUUID(),
        method: params.method,
        params: params.rpcParams ?? {},
      }),
      signal: params.signal,
    },
    { tlsFingerprint: params.tlsFingerprint },
  );
  if (!response.ok) {
    throw new Error(`gateway HTTP RPC failed (${response.status} ${response.statusText})`);
  }
  const envelope = (await response.json()) as GatewayRpcEnvelope;
  if (envelope.ok !== true) {
    throw new Error(
      typeof envelope.error === "string" && envelope.error.trim().length > 0
        ? envelope.error
        : "gateway request failed",
    );
  }
  return envelope.result as T;
}

async function fetchGatewayHealth(params: {
  url: string;
  auth?: GatewayProbeAuth;
  signal: AbortSignal;
  tlsFingerprint?: string;
}): Promise<unknown> {
  const response = await gatewayProbeDeps.fetch(
    gatewayHttpUrlFromGatewayUrl(params.url, "/health"),
    {
      method: "GET",
      headers: gatewayProbeHeaders(params.auth),
      signal: params.signal,
    },
    { tlsFingerprint: params.tlsFingerprint },
  );
  if (!response.ok) {
    throw new Error(`gateway health failed (${response.status} ${response.statusText})`);
  }
  return await response.json();
}

async function probeGatewayWithHttp(opts: {
  url: string;
  auth?: GatewayProbeAuth;
  timeoutMs: number;
  includeDetails?: boolean;
  detailLevel?: "none" | "presence" | "full";
  tlsFingerprint?: string;
}): Promise<GatewayProbeResult> {
  const startedAt = Date.now();
  const detailLevel = opts.includeDetails === false ? "none" : (opts.detailLevel ?? "full");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clampProbeTimeoutMs(opts.timeoutMs));
  const base = {
    url: opts.url,
    close: null,
  };

  try {
    if (detailLevel === "none") {
      await fetchGatewayHealth({
        url: opts.url,
        auth: opts.auth,
        signal: controller.signal,
        tlsFingerprint: opts.tlsFingerprint,
      });
      return {
        ...base,
        ok: true,
        connectLatencyMs: Date.now() - startedAt,
        error: null,
        health: null,
        status: null,
        presence: null,
        configSnapshot: null,
      };
    }
    if (detailLevel === "presence") {
      const presence = await fetchGatewayRpc<unknown>({
        url: opts.url,
        auth: opts.auth,
        signal: controller.signal,
        method: "system-presence",
        tlsFingerprint: opts.tlsFingerprint,
      });
      return {
        ...base,
        ok: true,
        connectLatencyMs: Date.now() - startedAt,
        error: null,
        health: null,
        status: null,
        presence: Array.isArray(presence) ? (presence as SystemPresence[]) : null,
        configSnapshot: null,
      };
    }

    const health = await fetchGatewayRpc<unknown>({
      url: opts.url,
      auth: opts.auth,
      signal: controller.signal,
      method: "health",
      tlsFingerprint: opts.tlsFingerprint,
    });
    const connectLatencyMs = Date.now() - startedAt;
    const [status, presence, configSnapshot] = await Promise.all([
      fetchGatewayRpc<unknown>({
        url: opts.url,
        auth: opts.auth,
        signal: controller.signal,
        method: "status",
        tlsFingerprint: opts.tlsFingerprint,
      }),
      fetchGatewayRpc<unknown>({
        url: opts.url,
        auth: opts.auth,
        signal: controller.signal,
        method: "system-presence",
        tlsFingerprint: opts.tlsFingerprint,
      }),
      fetchGatewayRpc<unknown>({
        url: opts.url,
        auth: opts.auth,
        signal: controller.signal,
        method: "config.get",
        tlsFingerprint: opts.tlsFingerprint,
      }),
    ]);
    return {
      ...base,
      ok: true,
      connectLatencyMs,
      error: null,
      health,
      status,
      presence: Array.isArray(presence) ? (presence as SystemPresence[]) : null,
      configSnapshot,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      connectLatencyMs: null,
      error: isAbortError(error) ? "timeout" : formatErrorMessage(error),
      health: null,
      status: null,
      presence: null,
      configSnapshot: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeGateway(opts: {
  url: string;
  auth?: GatewayProbeAuth;
  timeoutMs: number;
  includeDetails?: boolean;
  detailLevel?: "none" | "presence" | "full";
  tlsFingerprint?: string;
}): Promise<GatewayProbeResult> {
  return await probeGatewayWithHttp(opts);
}
