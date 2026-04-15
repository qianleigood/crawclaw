import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { loadConfig, resolveManagedBrowserRuntimeBin, type CrawClawConfig } from "../core-api.js";
import { createPinchTabClient } from "./pinchtab-client.js";

const DEFAULT_PINCHTAB_BASE_URL = "http://127.0.0.1:9867";
const READY_POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

type SpawnLike = typeof spawn;

type ManagedPinchTabServiceState = {
  child: ChildProcess | null;
  baseUrl: string;
  token?: string;
};

type PinchTabManagedServiceDeps = {
  spawnImpl: SpawnLike;
  existsSyncImpl: typeof existsSync;
  loadConfigImpl: typeof loadConfig;
  resolveBrowserRuntimeBinImpl: typeof resolveManagedBrowserRuntimeBin;
  createClientImpl: typeof createPinchTabClient;
};

const pinchTabManagedServiceDeps: PinchTabManagedServiceDeps = {
  spawnImpl: spawn,
  existsSyncImpl: existsSync,
  loadConfigImpl: loadConfig,
  resolveBrowserRuntimeBinImpl: resolveManagedBrowserRuntimeBin,
  createClientImpl: createPinchTabClient,
};

let serviceState: ManagedPinchTabServiceState | null = null;
let startupPromise: Promise<void> | null = null;

export const __testing = {
  setDepsForTest(overrides: Partial<PinchTabManagedServiceDeps> | null) {
    pinchTabManagedServiceDeps.spawnImpl = overrides?.spawnImpl ?? spawn;
    pinchTabManagedServiceDeps.existsSyncImpl = overrides?.existsSyncImpl ?? existsSync;
    pinchTabManagedServiceDeps.loadConfigImpl = overrides?.loadConfigImpl ?? loadConfig;
    pinchTabManagedServiceDeps.resolveBrowserRuntimeBinImpl =
      overrides?.resolveBrowserRuntimeBinImpl ?? resolveManagedBrowserRuntimeBin;
    pinchTabManagedServiceDeps.createClientImpl =
      overrides?.createClientImpl ?? createPinchTabClient;
  },
  resetState() {
    serviceState = null;
    startupPromise = null;
  },
};

export type ResolvedPinchTabConnectionConfig = {
  enabled: boolean;
  baseUrl: string;
  token?: string;
  managed: boolean;
};

function resolveConfigInput(config?: CrawClawConfig): CrawClawConfig {
  return config ?? pinchTabManagedServiceDeps.loadConfigImpl();
}

export function resolvePinchTabConnectionConfig(
  config?: CrawClawConfig,
): ResolvedPinchTabConnectionConfig {
  const resolved = resolveConfigInput(config);
  const browser = resolved.browser ?? {};
  const rawBaseUrl =
    typeof browser.pinchtab?.baseUrl === "string" ? browser.pinchtab.baseUrl.trim() : "";
  const explicitBaseUrl = rawBaseUrl ? rawBaseUrl.replace(/\/$/, "") : null;
  const token =
    typeof browser.pinchtab?.token === "string" && browser.pinchtab.token.trim()
      ? browser.pinchtab.token.trim()
      : undefined;
  const enabled =
    browser.enabled !== false &&
    (browser.provider === undefined || browser.provider === "pinchtab");
  return {
    enabled,
    baseUrl: explicitBaseUrl ?? DEFAULT_PINCHTAB_BASE_URL,
    token,
    managed: enabled && explicitBaseUrl === null,
  };
}

function wireChildLogs(child: ChildProcess, logger?: LoggerLike) {
  child.stdout?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      logger?.info?.(`[browser/pinchtab] ${text}`);
    }
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      logger?.warn?.(`[browser/pinchtab] ${text}`);
    }
  });
}

async function waitForHealthy(params: { baseUrl: string; token?: string; timeoutMs: number }) {
  const client = pinchTabManagedServiceDeps.createClientImpl({
    baseUrl: params.baseUrl,
    token: params.token,
  });
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() <= deadline) {
    try {
      await client.health();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
  }
  throw new Error(
    `Managed PinchTab did not become ready at ${params.baseUrl}/health within ${params.timeoutMs}ms.`,
  );
}

async function stopChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  let settled = false;
  const onExit = new Promise<void>((resolve) => {
    child.once("exit", () => {
      settled = true;
      resolve();
    });
  });
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  await Promise.race([onExit, new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))]);
  if (settled || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    return;
  }
  await Promise.race([onExit, new Promise((resolve) => setTimeout(resolve, 1_000))]);
}

export async function ensureManagedPinchTabService(params?: {
  config?: CrawClawConfig;
  logger?: LoggerLike;
}): Promise<ResolvedPinchTabConnectionConfig> {
  const resolved = resolvePinchTabConnectionConfig(params?.config);
  if (!resolved.enabled || !resolved.managed) {
    return resolved;
  }
  if (
    serviceState &&
    serviceState.baseUrl === resolved.baseUrl &&
    serviceState.token === resolved.token &&
    serviceState.child &&
    serviceState.child.exitCode === null &&
    serviceState.child.signalCode === null
  ) {
    return resolved;
  }
  if (startupPromise) {
    await startupPromise;
    return resolved;
  }

  startupPromise = (async () => {
    try {
      await waitForHealthy({
        baseUrl: resolved.baseUrl,
        token: resolved.token,
        timeoutMs: 1_000,
      });
      serviceState = {
        child: null,
        baseUrl: resolved.baseUrl,
        token: resolved.token,
      };
      return;
    } catch {
      // No existing healthy server; continue with managed startup.
    }

    const binPath = pinchTabManagedServiceDeps.resolveBrowserRuntimeBinImpl();
    if (!pinchTabManagedServiceDeps.existsSyncImpl(binPath)) {
      throw new Error(
        `Managed PinchTab runtime is not installed. Expected binary at ${binPath}. Run \`crawclaw runtimes install\`.`,
      );
    }
    const endpoint = new URL(resolved.baseUrl);
    const child = pinchTabManagedServiceDeps.spawnImpl(binPath, [], {
      stdio: "pipe",
      windowsHide: true,
      env: {
        ...process.env,
        BRIDGE_BIND: endpoint.hostname,
        BRIDGE_PORT: endpoint.port || (endpoint.protocol === "https:" ? "443" : "80"),
        ...(resolved.token ? { BRIDGE_TOKEN: resolved.token } : {}),
      },
    });
    serviceState = {
      child,
      baseUrl: resolved.baseUrl,
      token: resolved.token,
    };
    wireChildLogs(child, params?.logger);
    child.once("exit", () => {
      if (serviceState?.child === child) {
        serviceState = null;
      }
    });
    try {
      await waitForHealthy({
        baseUrl: resolved.baseUrl,
        token: resolved.token,
        timeoutMs: STARTUP_TIMEOUT_MS,
      });
    } catch (error) {
      await stopChildProcess(child);
      if (serviceState?.child === child) {
        serviceState = null;
      }
      throw error;
    }
  })();

  try {
    await startupPromise;
  } finally {
    startupPromise = null;
  }
  return resolved;
}

export async function stopManagedPinchTabService(): Promise<void> {
  const current = serviceState;
  serviceState = null;
  startupPromise = null;
  if (!current?.child) {
    return;
  }
  await stopChildProcess(current.child);
}
