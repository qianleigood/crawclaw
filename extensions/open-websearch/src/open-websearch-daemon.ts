import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CrawClawConfig } from "crawclaw/plugin-sdk/config-runtime";
import {
  DEFAULT_OPEN_WEBSEARCH_HOST,
  DEFAULT_OPEN_WEBSEARCH_PORT,
  resolveOpenWebSearchAutoStart,
  resolveOpenWebSearchBaseUrl,
  resolveOpenWebSearchHost,
  resolveOpenWebSearchPort,
  resolveOpenWebSearchStartupTimeoutMs,
} from "./config.js";

const OPEN_WEBSEARCH_PACKAGE_SPEC = "open-websearch";
const OPEN_WEBSEARCH_FALLBACK_VERSION = "2.1.5";
const DEFAULT_READY_POLL_INTERVAL_MS = 250;
const DAEMON_STOP_TIMEOUT_MS = 5_000;
const startupPromises = new Map<string, Promise<void>>();
const managedChildren = new Map<string, ChildProcess>();

type LaunchCommand = {
  command: string;
  args: string[];
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function buildStatusUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.endsWith("/") ? `${url.pathname}status` : `${url.pathname}/status`;
  url.search = "";
  return url.toString();
}

function buildManagedBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function isManagedLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveDaemonLogPath(): string {
  return join(homedir(), ".crawclaw", "logs", "open-websearch-daemon.log");
}

function resolveLaunchCommand(): LaunchCommand {
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["--yes", `${OPEN_WEBSEARCH_PACKAGE_SPEC}@${OPEN_WEBSEARCH_FALLBACK_VERSION}`],
  };
}

async function probeReady(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(buildStatusUrl(baseUrl), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForReady(params: { baseUrl: string; timeoutMs: number }): Promise<void> {
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() <= deadline) {
    if (await probeReady(params.baseUrl)) {
      return;
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, DEFAULT_READY_POLL_INTERVAL_MS),
    );
  }
  throw new Error(
    `Managed Open-WebSearch daemon did not become ready at ${params.baseUrl} within ${params.timeoutMs}ms.`,
  );
}

function spawnDaemon(params: { host: string; port: number; detached: boolean }): ChildProcess {
  const launch = resolveLaunchCommand();
  const logPath = resolveDaemonLogPath();
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");
  return spawn(
    launch.command,
    [...launch.args, "serve", "--host", params.host, "--port", String(params.port)],
    {
      detached: params.detached,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    },
  );
}

type ManagedDaemonParams = {
  config?: CrawClawConfig;
  env?: NodeJS.ProcessEnv;
};

type ManagedDaemonMode = "detached" | "service";

function resolveStartupKey(params: { host: string; port: number }): string {
  return `${params.host}:${params.port}`;
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
    new Promise<void>((resolve) => setTimeout(resolve, DAEMON_STOP_TIMEOUT_MS)),
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

async function ensureManagedOpenWebSearchDaemonWithMode(
  params: ManagedDaemonParams & { mode: ManagedDaemonMode },
): Promise<string> {
  const env = params.env ?? process.env;
  const autoStart = resolveOpenWebSearchAutoStart(params.config, env);
  const host = resolveOpenWebSearchHost(params.config, env);
  const port = resolveOpenWebSearchPort(params.config, env);
  const baseUrl = normalizeBaseUrl(
    resolveOpenWebSearchBaseUrl(params.config, env) ??
      buildManagedBaseUrl(DEFAULT_OPEN_WEBSEARCH_HOST, DEFAULT_OPEN_WEBSEARCH_PORT),
  );
  const timeoutMs = resolveOpenWebSearchStartupTimeoutMs(params.config, env);

  if (!autoStart || !isManagedLoopbackBaseUrl(baseUrl)) {
    return baseUrl;
  }
  if (await probeReady(baseUrl)) {
    return baseUrl;
  }

  const startupKey = resolveStartupKey({ host, port });
  const existing = startupPromises.get(startupKey);
  if (existing) {
    await existing;
    return baseUrl;
  }

  const startupPromise = (async () => {
    if (params.mode === "service") {
      const child = spawnDaemon({ host, port, detached: false });
      managedChildren.set(startupKey, child);
      child.once("exit", () => {
        if (managedChildren.get(startupKey) === child) {
          managedChildren.delete(startupKey);
        }
      });
      try {
        await waitForReady({ baseUrl, timeoutMs });
      } catch (err) {
        if (managedChildren.get(startupKey) === child) {
          managedChildren.delete(startupKey);
        }
        await stopChildProcess(child).catch(() => {});
        throw err;
      }
      return;
    }

    const child = spawnDaemon({ host, port, detached: true });
    child.unref();
    await waitForReady({ baseUrl, timeoutMs });
  })();
  startupPromises.set(startupKey, startupPromise);
  try {
    await startupPromise;
  } finally {
    startupPromises.delete(startupKey);
  }
  return baseUrl;
}

export async function ensureManagedOpenWebSearchDaemon(
  params: ManagedDaemonParams,
): Promise<string> {
  return await ensureManagedOpenWebSearchDaemonWithMode({
    ...params,
    mode: "detached",
  });
}

export async function startManagedOpenWebSearchDaemonService(
  params: ManagedDaemonParams,
): Promise<string> {
  return await ensureManagedOpenWebSearchDaemonWithMode({
    ...params,
    mode: "service",
  });
}

export async function stopManagedOpenWebSearchDaemonService(
  params: ManagedDaemonParams,
): Promise<void> {
  const env = params.env ?? process.env;
  const startupKey = resolveStartupKey({
    host: resolveOpenWebSearchHost(params.config, env),
    port: resolveOpenWebSearchPort(params.config, env),
  });
  const child = managedChildren.get(startupKey);
  if (!child) {
    return;
  }
  managedChildren.delete(startupKey);
  await stopChildProcess(child);
}

export const __testing = {
  buildManagedBaseUrl,
  buildStatusUrl,
  isManagedLoopbackBaseUrl,
  normalizeBaseUrl,
  probeReady,
  resolveDaemonLogPath,
  resolveLaunchCommand,
  resolveStartupKey,
};
