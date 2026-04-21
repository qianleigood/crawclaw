import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CrawClawPluginService } from "crawclaw/plugin-sdk/core";
import { resolveManagedScraplingFetchRuntimePython } from "crawclaw/plugin-sdk/state-paths";
import {
  buildScraplingFetchEndpoint,
  resolveScraplingFetchBaseUrl,
  resolveScraplingFetchPluginConfig,
  SCRAPLING_FETCH_DEFAULT_BOOTSTRAP_PACKAGES,
  SCRAPLING_FETCH_SERVICE_ID,
  type ResolvedScraplingFetchPluginConfig,
} from "./config.js";

type SpawnLike = typeof spawn;
type SpawnSyncLike = typeof spawnSync;

type ScraplingFetchServiceState = {
  startedAt: number;
  baseUrl: string;
  mode: string;
  child: ChildProcess | null;
};

const serviceState = new Map<string, ScraplingFetchServiceState>();
const startupPromises = new Map<string, Promise<void>>();

const DEFAULT_READY_POLL_INTERVAL_MS = 250;
const STOP_TIMEOUT_MS = 5_000;
const SCRAPLING_IMPORT_CHECK_SCRIPT =
  "from scrapling.fetchers import Fetcher, StealthyFetcher, DynamicFetcher";

export function getScraplingFetchServiceState(stateDir: string): ScraplingFetchServiceState | null {
  return serviceState.get(stateDir) ?? null;
}

function resolveScriptPath(): string {
  const candidates = [
    fileURLToPath(new URL("../python/scrapling_sidecar.py", import.meta.url)),
    fileURLToPath(new URL("./python/scrapling_sidecar.py", import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0]!;
}

function resolveManagedVenvDir(stateDir: string): string {
  return join(stateDir, "runtimes", "scrapling-fetch", "venv");
}

function resolveManagedPythonPath(stateDir: string): string {
  return resolveManagedScraplingFetchRuntimePython({
    ...process.env,
    CRAWCLAW_STATE_DIR: stateDir,
  });
}

function buildLaunchCommand(params: {
  config: ResolvedScraplingFetchPluginConfig;
  command: string;
}): { command: string; args: string[] } {
  return {
    command: params.command,
    args: buildLaunchArgs(params.config),
  };
}

function buildLaunchArgs(config: ResolvedScraplingFetchPluginConfig): string[] {
  const baseUrl = new URL(config.service.baseUrl);
  return [
    ...config.service.args,
    resolveScriptPath(),
    "--host",
    baseUrl.hostname,
    "--port",
    baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80"),
    "--healthcheck-path",
    config.service.healthcheckPath,
    "--fetch-path",
    config.service.fetchPath,
  ];
}

function normalizeBootstrapPackages(config: ResolvedScraplingFetchPluginConfig): string[] {
  return config.service.bootstrapPackages.length > 0
    ? config.service.bootstrapPackages
    : [...SCRAPLING_FETCH_DEFAULT_BOOTSTRAP_PACKAGES];
}

function runSyncCommand(params: {
  command: string;
  args: string[];
  spawnSyncImpl?: SpawnSyncLike;
}): ReturnType<SpawnSyncLike> {
  const spawnSyncImpl = params.spawnSyncImpl ?? spawnSync;
  return spawnSyncImpl(params.command, params.args, {
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
  });
}

function verifyManagedRuntimeAvailable(params: {
  pythonCommand: string;
  spawnSyncImpl?: SpawnSyncLike;
}): boolean {
  const result = runSyncCommand({
    command: params.pythonCommand,
    args: ["-c", SCRAPLING_IMPORT_CHECK_SCRIPT],
    spawnSyncImpl: params.spawnSyncImpl,
  });
  return !result.error && result.status === 0;
}

function ensureManagedRuntimeBootstrap(params: {
  stateDir: string;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
  config: ResolvedScraplingFetchPluginConfig;
  spawnSyncImpl?: SpawnSyncLike;
}): string {
  if (!params.config.service.bootstrap) {
    return params.config.service.command;
  }

  const venvDir = resolveManagedVenvDir(params.stateDir);
  const managedPython = resolveManagedPythonPath(params.stateDir);
  if (
    existsSync(managedPython) &&
    verifyManagedRuntimeAvailable({
      pythonCommand: managedPython,
      spawnSyncImpl: params.spawnSyncImpl,
    })
  ) {
    return managedPython;
  }

  mkdirSync(params.stateDir, { recursive: true });
  const packages = normalizeBootstrapPackages(params.config);
  throw new Error(
    `Managed Scrapling runtime is not installed. Expected a verified runtime at ${venvDir}. Install runtimes during setup/postinstall or run \`crawclaw runtimes install\`. Required packages: ${packages.join(", ")}`,
  );
}

async function probeReady(baseUrl: string, healthcheckPath: string): Promise<boolean> {
  try {
    const response = await fetch(buildScraplingFetchEndpoint(baseUrl, healthcheckPath), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as Record<string, unknown>;
    return payload.ready !== false;
  } catch {
    return false;
  }
}

async function waitForReady(params: {
  baseUrl: string;
  healthcheckPath: string;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() <= deadline) {
    if (await probeReady(params.baseUrl, params.healthcheckPath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_READY_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Managed Scrapling fetch sidecar did not become ready at ${params.baseUrl}${params.healthcheckPath} within ${params.timeoutMs}ms.`,
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
  await Promise.race([
    onExit,
    new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
  ]);
  if (settled || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    return;
  }
  await Promise.race([onExit, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
}

function wireChildLogs(
  child: ChildProcess,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
) {
  child.stdout?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      logger.info(`[scrapling-fetch] ${text}`);
    }
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      logger.warn(`[scrapling-fetch] ${text}`);
    }
  });
}

async function ensureManagedService(params: {
  stateDir: string;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
  config?: Record<string, unknown>;
  spawnImpl?: SpawnLike;
  spawnSyncImpl?: SpawnSyncLike;
}) {
  const resolved = resolveScraplingFetchPluginConfig(params.config as never);
  const baseUrl = resolveScraplingFetchBaseUrl(resolved);

  if (!resolved.service.enabled) {
    serviceState.set(params.stateDir, {
      startedAt: Date.now(),
      baseUrl,
      mode: resolved.service.mode,
      child: null,
    });
    params.logger.info(`[scrapling-fetch] service disabled; using configured base URL ${baseUrl}`);
    return;
  }

  if (await probeReady(baseUrl, resolved.service.healthcheckPath)) {
    serviceState.set(params.stateDir, {
      startedAt: Date.now(),
      baseUrl,
      mode: resolved.service.mode,
      child: null,
    });
    params.logger.info(`[scrapling-fetch] reusing existing sidecar at ${baseUrl}`);
    return;
  }

  const existing = startupPromises.get(params.stateDir);
  if (existing) {
    await existing;
    return;
  }

  const startup = (async () => {
    const spawnImpl = params.spawnImpl ?? spawn;
    const runtimeCommand = ensureManagedRuntimeBootstrap({
      stateDir: params.stateDir,
      logger: params.logger,
      config: resolved,
      spawnSyncImpl: params.spawnSyncImpl,
    });
    const launchCommand = buildLaunchCommand({
      config: resolved,
      command: runtimeCommand,
    });
    const child = spawnImpl(launchCommand.command, launchCommand.args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    });
    wireChildLogs(child, params.logger);
    serviceState.set(params.stateDir, {
      startedAt: Date.now(),
      baseUrl,
      mode: resolved.service.mode,
      child,
    });
    child.once("exit", () => {
      const current = serviceState.get(params.stateDir);
      if (current?.child === child) {
        serviceState.set(params.stateDir, { ...current, child: null });
      }
    });
    try {
      await waitForReady({
        baseUrl,
        healthcheckPath: resolved.service.healthcheckPath,
        timeoutMs: resolved.service.startupTimeoutMs,
      });
    } catch (error) {
      await stopChildProcess(child).catch(() => {});
      serviceState.delete(params.stateDir);
      throw error;
    }
  })();
  startupPromises.set(params.stateDir, startup);
  try {
    await startup;
  } finally {
    startupPromises.delete(params.stateDir);
  }
}

export function createScraplingFetchPluginService(): CrawClawPluginService {
  return {
    id: SCRAPLING_FETCH_SERVICE_ID,
    start: async (ctx) => {
      await ensureManagedService({
        stateDir: ctx.stateDir,
        logger: ctx.logger,
        config: ctx.config as Record<string, unknown> | undefined,
      });
    },
    stop: async (ctx) => {
      const state = serviceState.get(ctx.stateDir);
      serviceState.delete(ctx.stateDir);
      if (!state?.child) {
        return;
      }
      await stopChildProcess(state.child);
    },
  };
}

export const __testing = {
  buildLaunchCommand,
  buildLaunchArgs,
  ensureManagedRuntimeBootstrap,
  resolveManagedPythonPath,
  resolveManagedVenvDir,
  probeReady,
  resolveScriptPath,
  verifyManagedRuntimeAvailable,
  waitForReady,
  ensureManagedService,
};
