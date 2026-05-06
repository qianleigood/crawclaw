import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveManagedQwen3TtsRuntimeVenvDir } from "crawclaw/plugin-sdk/state-paths";
import type { ResolvedQwen3TtsProviderConfig } from "./speech-provider.js";

const DEFAULT_READY_POLL_INTERVAL_MS = 250;
const startupPromises = new Map<string, Promise<void>>();

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function normalizeHealthPath(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "/health";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function buildHealthUrl(baseUrl: string, healthPath: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = healthPath;
  url.search = "";
  return url.toString();
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
  return join(homedir(), ".crawclaw", "logs", "qwen3-tts-daemon.log");
}

async function probeReady(baseUrl: string, healthPath: string): Promise<boolean> {
  try {
    const response = await fetch(buildHealthUrl(baseUrl, healthPath), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForReady(params: {
  baseUrl: string;
  timeoutMs: number;
  healthPath: string;
}): Promise<void> {
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() <= deadline) {
    if (await probeReady(params.baseUrl, params.healthPath)) {
      return;
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, DEFAULT_READY_POLL_INTERVAL_MS),
    );
  }
  throw new Error(
    `Managed Qwen3-TTS daemon did not become ready at ${params.baseUrl}${params.healthPath} within ${params.timeoutMs}ms.`,
  );
}

function resolveLaunchConfig(config: ResolvedQwen3TtsProviderConfig): {
  command: string;
  args: string[];
  cwd?: string;
} {
  if (!config.launchCommand) {
    throw new Error("Qwen3-TTS autoStart requires launchCommand");
  }
  return {
    command: config.launchCommand,
    args: config.launchArgs ?? [],
    cwd: config.launchCwd,
  };
}

function buildManagedRuntimeCheckScript(
  runtime: ResolvedQwen3TtsProviderConfig["managedRuntime"],
): string {
  if (runtime === "qwen-tts") {
    return [
      "import qwen_tts",
      "import torch",
      "import soundfile",
      "import numpy",
      "print('ok')",
    ].join("\n");
  }
  return [
    "import mlx",
    "import mlx_audio",
    "import huggingface_hub",
    "import numpy",
    "import soundfile",
    "import librosa",
    "import transformers",
    "print('ok')",
  ].join("\n");
}

function formatRuntimeCheckOutput(result: ReturnType<typeof spawnSync>): string {
  return [result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n").trim();
}

function ensureManagedRuntimeReady(
  command: string,
  runtime: ResolvedQwen3TtsProviderConfig["managedRuntime"],
): void {
  const result = spawnSync(command, ["-c", buildManagedRuntimeCheckScript(runtime)], {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
  });
  if (!result.error && result.status === 0) {
    return;
  }

  const detail = formatRuntimeCheckOutput(result);
  throw new Error(
    [
      "Managed Qwen3-TTS runtime is not installed or failed verification.",
      `Expected a verified runtime at ${resolveManagedQwen3TtsRuntimeVenvDir()}.`,
      "Run `crawclaw runtimes install` or `crawclaw runtimes repair`.",
      detail ? `Verification error: ${detail}` : null,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function spawnDaemon(launch: { command: string; args: string[]; cwd?: string }): ChildProcess {
  const logPath = resolveDaemonLogPath();
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");
  return spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
  });
}

export async function ensureManagedQwen3TtsDaemon(
  config: ResolvedQwen3TtsProviderConfig,
): Promise<string> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const healthPath = normalizeHealthPath(config.healthPath);
  if (!config.autoStart || !isManagedLoopbackBaseUrl(baseUrl)) {
    return baseUrl;
  }
  if (await probeReady(baseUrl, healthPath)) {
    return baseUrl;
  }

  const key = `${baseUrl}${healthPath}`;
  const existingStartup = startupPromises.get(key);
  if (existingStartup) {
    await existingStartup;
    return baseUrl;
  }

  const startup = (async () => {
    const launch = resolveLaunchConfig(config);
    if (config.managedRuntime) {
      ensureManagedRuntimeReady(launch.command, config.managedRuntime);
    }
    const child = spawnDaemon(launch);
    child.unref();
    try {
      await waitForReady({
        baseUrl,
        healthPath,
        timeoutMs: config.startupTimeoutMs,
      });
    } finally {
      startupPromises.delete(key);
    }
  })();

  startupPromises.set(key, startup);
  await startup;
  return baseUrl;
}
