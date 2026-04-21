import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CrawClawConfig } from "../plugin-sdk/config-runtime.js";
import {
  materializeWindowsSpawnProgram,
  resolveWindowsSpawnProgram,
} from "../plugin-sdk/windows-spawn.js";
import { resolveOpenWebSearchRuntimeBin } from "../plugins/plugin-runtimes.js";
import {
  DEFAULT_OPEN_WEBSEARCH_HOST,
  DEFAULT_OPEN_WEBSEARCH_PORT,
  resolveOpenWebSearchAutoStart,
  resolveOpenWebSearchBaseUrl,
  resolveOpenWebSearchHost,
  resolveOpenWebSearchPort,
  resolveOpenWebSearchStartupTimeoutMs,
} from "./config.js";

const DEFAULT_READY_POLL_INTERVAL_MS = 250;
const DAEMON_STOP_TIMEOUT_MS = 5_000;
const startupPromises = new Map<string, Promise<void>>();
const managedChildren = new Map<string, ChildProcess>();

type LaunchCommand = {
  command: string;
  args: string[];
  shell?: boolean;
  windowsHide?: boolean;
};

function resolveRuntimeLaunchCommand(params: {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  packageName: string;
}): LaunchCommand {
  const program = resolveWindowsSpawnProgram({
    command: params.command,
    env: params.env,
    packageName: params.packageName,
  });
  const resolved = materializeWindowsSpawnProgram(program, params.args ?? []);
  return {
    command: resolved.command,
    args: resolved.argv,
    shell: resolved.shell,
    windowsHide: resolved.windowsHide,
  };
}

function buildMissingRuntimeError(): Error {
  return new Error(
    "Open-WebSearch runtime is not installed. Expected a managed runtime under the CrawClaw state directory or a user-local Open-WebSearch install. Install runtimes during setup/postinstall or run `crawclaw runtimes install`.",
  );
}

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

function resolveLaunchCommand(env: NodeJS.ProcessEnv = process.env): LaunchCommand {
  const managedRuntimeBin = resolveOpenWebSearchRuntimeBin(env);
  if (existsSync(managedRuntimeBin)) {
    return resolveRuntimeLaunchCommand({
      command: managedRuntimeBin,
      env,
      packageName: "open-websearch",
    });
  }
  const localBin =
    process.platform === "win32"
      ? join(homedir(), ".local", "open-websearch", "node_modules", ".bin", "open-websearch.cmd")
      : join(homedir(), ".local", "open-websearch", "node_modules", ".bin", "open-websearch");
  if (existsSync(localBin)) {
    return resolveRuntimeLaunchCommand({
      command: localBin,
      env,
      packageName: "open-websearch",
    });
  }
  throw buildMissingRuntimeError();
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

function spawnDaemon(params: {
  host: string;
  port: number;
  detached: boolean;
  env?: NodeJS.ProcessEnv;
}): ChildProcess {
  const env = params.env ?? process.env;
  const launch = resolveLaunchCommand(env);
  const logPath = resolveDaemonLogPath();
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");
  return spawn(
    launch.command,
    [...launch.args, "serve", "--host", params.host, "--port", String(params.port)],
    {
      detached: params.detached,
      stdio: ["ignore", logFd, logFd],
      shell: launch.shell,
      windowsHide: launch.windowsHide ?? true,
      env: {
        ...env,
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

  const key = resolveStartupKey({ host, port });
  const existingStartup = startupPromises.get(key);
  if (existingStartup) {
    await existingStartup;
    return baseUrl;
  }

  const startup = (async () => {
    const child = spawnDaemon({
      host,
      port,
      detached: params.mode === "detached",
      env,
    });
    if (params.mode === "service") {
      managedChildren.set(key, child);
    } else {
      child.unref();
    }
    try {
      await waitForReady({ baseUrl, timeoutMs });
    } catch (error) {
      if (params.mode === "service") {
        managedChildren.delete(key);
        await stopChildProcess(child);
      }
      throw error;
    }
  })();

  startupPromises.set(key, startup);
  try {
    await startup;
  } finally {
    startupPromises.delete(key);
  }
  return baseUrl;
}

export async function ensureManagedOpenWebSearchDaemon(
  params: ManagedDaemonParams = {},
): Promise<string> {
  return await ensureManagedOpenWebSearchDaemonWithMode({
    ...params,
    mode: "detached",
  });
}

export async function startManagedOpenWebSearchDaemonService(
  params: ManagedDaemonParams = {},
): Promise<string> {
  return await ensureManagedOpenWebSearchDaemonWithMode({
    ...params,
    mode: "service",
  });
}

export async function stopManagedOpenWebSearchDaemonService(
  params: ManagedDaemonParams = {},
): Promise<void> {
  const env = params.env ?? process.env;
  const host = resolveOpenWebSearchHost(params.config, env);
  const port = resolveOpenWebSearchPort(params.config, env);
  const key = resolveStartupKey({ host, port });
  const child = managedChildren.get(key);
  managedChildren.delete(key);
  if (!child) {
    return;
  }
  await stopChildProcess(child);
}

export const __testing = {
  buildManagedBaseUrl,
  buildStatusUrl,
  isLoopbackHost,
  isManagedLoopbackBaseUrl,
  normalizeBaseUrl,
  probeReady,
  resolveDaemonLogPath,
  resolveLaunchCommand,
  resolveStartupKey,
  spawnDaemon,
  startupPromises,
  managedChildren,
  stopChildProcess,
  waitForReady,
};
