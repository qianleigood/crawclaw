import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { resolveWindowsCommandShim } from "crawclaw/plugin-sdk/process-runtime";
import { runPluginCommandWithTimeout } from "crawclaw/plugin-sdk/sandbox";
import type { FeishuCliPluginConfig } from "./config.js";

export type FeishuCliStatus = {
  identity: "user";
  enabled: boolean;
  command: string;
  profile?: string;
  timeoutMs: number;
  installed: boolean;
  version?: string;
  authOk: boolean;
  status: "ready" | "not_configured" | "error" | "disabled";
  message?: string;
  hint?: string;
  raw?: unknown;
};

export type LarkCliJsonResult = {
  code: number;
  payload?: unknown;
  stdout: string;
  stderr: string;
};

function buildBaseArgv(config: FeishuCliPluginConfig): string[] {
  const argv = [config.command];
  if (config.profile) {
    argv.push("--profile", config.profile);
  }
  return argv;
}

function normalizeFeishuCliRecoveryText(text: string | undefined): string | undefined {
  if (typeof text !== "string" || !text.trim()) {
    return undefined;
  }
  return text
    .replaceAll("lark-cli auth login", "crawclaw feishu-cli auth login")
    .replaceAll("lark-cli auth logout", "crawclaw feishu-cli auth logout")
    .replaceAll("lark-cli auth status", "crawclaw feishu-cli status");
}

function parseJsonish(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function payloadMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const error = (payload as { error?: unknown }).error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  const message = (payload as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : undefined;
}

function payloadHint(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const error = (payload as { error?: unknown }).error;
  if (error && typeof error === "object") {
    const hint = (error as { hint?: unknown }).hint;
    if (typeof hint === "string" && hint.trim()) {
      return hint.trim();
    }
  }
  const hint = (payload as { hint?: unknown }).hint;
  return typeof hint === "string" && hint.trim() ? hint.trim() : undefined;
}

function payloadOk(payload: unknown): boolean | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const ok = (payload as { ok?: unknown }).ok;
  return typeof ok === "boolean" ? ok : undefined;
}

function versionFromStdout(stdout: string): string | undefined {
  const match = stdout.trim().match(/version\s+([^\s]+)$/i);
  return match?.[1];
}

export async function runLarkCliJson(
  config: FeishuCliPluginConfig,
  args: string[],
): Promise<LarkCliJsonResult> {
  const result = await runPluginCommandWithTimeout({
    argv: [...buildBaseArgv(config), ...args],
    timeoutMs: config.timeoutMs,
  });
  const payload = parseJsonish(result.stdout) ?? parseJsonish(result.stderr);
  return {
    code: result.code,
    payload,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function getFeishuCliStatus(params: {
  config: FeishuCliPluginConfig;
  verify?: boolean;
}): Promise<FeishuCliStatus> {
  const { config } = params;
  const versionResult = await runPluginCommandWithTimeout({
    argv: [...buildBaseArgv(config), "--version"],
    timeoutMs: Math.min(config.timeoutMs, 10_000),
  });

  if (versionResult.code !== 0) {
    const message =
      versionResult.stderr.trim() || versionResult.stdout.trim() || "lark-cli missing";
    return {
      identity: "user",
      enabled: config.enabled,
      command: config.command,
      ...(config.profile ? { profile: config.profile } : {}),
      timeoutMs: config.timeoutMs,
      installed: false,
      authOk: false,
      status: config.enabled ? "error" : "disabled",
      message,
    };
  }

  const version = versionFromStdout(versionResult.stdout);
  const authArgs = ["auth", "status"];
  if (params.verify) {
    authArgs.push("--verify");
  }
  const authResult = await runLarkCliJson(config, authArgs);
  const message = normalizeFeishuCliRecoveryText(
    payloadMessage(authResult.payload) || authResult.stderr.trim() || authResult.stdout.trim(),
  );
  const hint = normalizeFeishuCliRecoveryText(payloadHint(authResult.payload));
  const ok = payloadOk(authResult.payload);
  const authOk = authResult.code === 0 && ok !== false;

  return {
    identity: "user",
    enabled: config.enabled,
    command: config.command,
    ...(config.profile ? { profile: config.profile } : {}),
    timeoutMs: config.timeoutMs,
    installed: true,
    ...(version ? { version } : {}),
    authOk,
    status: !config.enabled
      ? "disabled"
      : authOk
        ? "ready"
        : message === "not configured"
          ? "not_configured"
          : "error",
    ...(message ? { message } : {}),
    ...(hint ? { hint } : {}),
    ...(authResult.payload !== undefined ? { raw: authResult.payload } : {}),
  };
}

export async function runFeishuCliUserCommand(params: {
  config: FeishuCliPluginConfig;
  args: string[];
  actionLabel: string;
}): Promise<unknown> {
  const result = await runLarkCliJson(params.config, params.args);
  if (result.code === 0) {
    return result.payload ?? result.stdout.trim();
  }
  const message =
    payloadMessage(result.payload) ||
    result.stderr.trim() ||
    result.stdout.trim() ||
    `${params.actionLabel} failed`;
  const hint = normalizeFeishuCliRecoveryText(payloadHint(result.payload));
  throw new Error(hint ? `${message} (${hint})` : message);
}

export function runInteractiveLarkCliCommand(params: {
  config: FeishuCliPluginConfig;
  args: string[];
  spawnSyncImpl?: typeof spawnSync;
}): number {
  const commandBase = path.basename(params.config.command).replace(/\.(cmd|bat|exe)$/i, "");
  const command = resolveWindowsCommandShim({
    command: params.config.command,
    cmdCommands: commandBase ? [commandBase.toLowerCase()] : [],
  });
  const argv = [
    ...(params.config.profile ? ["--profile", params.config.profile] : []),
    ...params.args,
  ];
  const runSpawnSync = params.spawnSyncImpl ?? spawnSync;
  const result = runSpawnSync(command, argv, {
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  return typeof result.status === "number" ? result.status : 1;
}
