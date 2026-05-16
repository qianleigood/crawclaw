// Public helper for bundled plugins that delegate business logic to CrawClaw's
// Rust native plugin runtime.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommandWithTimeout } from "../process/exec.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export type NativePluginOperationOptions = {
  plugin: string;
  operation: string;
  input?: unknown;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

type NativePluginEnvelope =
  | {
      ok: true;
      result: unknown;
    }
  | {
      ok: false;
      code?: string;
      message?: string;
    };

function nativeBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "crawclaw-native-plugins.exe" : "crawclaw-native-plugins";
}

function existingPath(paths: string[], existsSync: (path: string) => boolean = fs.existsSync) {
  return paths.find((candidate) => existsSync(candidate));
}

export function resolveNativePluginRuntimeArgv(
  params: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    platform?: NodeJS.Platform;
    existsSync?: (path: string) => boolean;
  } = {},
): string[] {
  const env = params.env ?? process.env;
  const cwd = params.cwd ?? process.cwd();
  const existsSync = params.existsSync ?? fs.existsSync;
  const explicit = env.CRAWCLAW_NATIVE_PLUGINS_BIN?.trim();
  if (explicit) {
    return [explicit];
  }

  const bin = nativeBinaryName(params.platform);
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate = existingPath(
    [
      path.resolve(moduleDir, "..", "native", bin),
      path.resolve(cwd, "dist", "native", bin),
      path.resolve(cwd, "target", "debug", bin),
      path.resolve(cwd, "target", "release", bin),
    ],
    existsSync,
  );
  if (candidate) {
    return [candidate];
  }

  if (existsSync(path.resolve(cwd, "Cargo.toml"))) {
    return ["cargo", "run", "--quiet", "-p", "crawclaw-native-plugins", "--"];
  }

  return [bin];
}

export async function runNativePluginOperation<T = unknown>(
  options: NativePluginOperationOptions,
): Promise<T> {
  const runtimeArgv = resolveNativePluginRuntimeArgv({ env: options.env });
  const result = await runCommandWithTimeout([...runtimeArgv, options.plugin, options.operation], {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    input: JSON.stringify(options.input ?? {}),
    env: options.env,
  });
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `native plugin runtime exited with code ${result.code}`,
    );
  }
  let envelope: NativePluginEnvelope;
  try {
    envelope = JSON.parse(result.stdout) as NativePluginEnvelope;
  } catch {
    throw new Error(`native plugin runtime returned invalid JSON: ${result.stdout.trim()}`);
  }
  if (!envelope.ok) {
    const code = envelope.code ? `${envelope.code}: ` : "";
    throw new Error(`${code}${envelope.message ?? "native plugin operation failed"}`);
  }
  return envelope.result as T;
}
