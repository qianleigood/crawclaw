import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CrawClawConfig } from "../config/config.js";

type RustLifecycleResult =
  | { ok: true; value: Record<string, unknown>; config?: CrawClawConfig }
  | { ok: false; error: string };

type RustLifecycleRunOptions = {
  config?: CrawClawConfig;
  env?: NodeJS.ProcessEnv;
};

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function resolveRustGatewayInvocation(
  root: string,
  env: NodeJS.ProcessEnv,
): {
  command: string;
  args: string[];
} {
  const envBinary = env.CRAWCLAW_RUST_GATEWAY_BIN?.trim();
  if (envBinary) {
    return { command: envBinary, args: ["call"] };
  }
  const binaryName = process.platform === "win32" ? "crawclaw-gateway.exe" : "crawclaw-gateway";
  for (const candidate of [
    path.join(root, "dist", "native", binaryName),
    path.join(root, "target", "debug", binaryName),
    path.join(root, "target", "release", binaryName),
  ]) {
    if (fsSync.existsSync(candidate)) {
      return { command: candidate, args: ["call"] };
    }
  }
  return {
    command: env.CARGO?.trim() || "cargo",
    args: ["run", "--quiet", "-p", "crawclaw-gateway", "--", "call"],
  };
}

async function runRustLifecycleJson(
  method: string,
  params: Record<string, unknown>,
  options: RustLifecycleRunOptions = {},
): Promise<RustLifecycleResult> {
  const root = repoRoot();
  const tempDir = options.config
    ? await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-rust-plugin-lifecycle-"))
    : null;
  const configPath = tempDir ? path.join(tempDir, "crawclaw.json") : undefined;
  if (configPath && options.config) {
    await fs.writeFile(configPath, `${JSON.stringify(options.config, null, 2)}\n`);
  }

  const env = {
    ...process.env,
    ...options.env,
    ...(configPath ? { CRAWCLAW_CONFIG_PATH: configPath } : {}),
  };
  const invocation = resolveRustGatewayInvocation(root, env);
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(
        invocation.command,
        [...invocation.args, "--method", method, "--params-json", JSON.stringify(params)],
        {
          cwd: root,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        resolve({ code: 1, stdout, stderr: error.message });
      });
      child.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });
    },
  );

  try {
    if (result.code !== 0) {
      return {
        ok: false,
        error: result.stderr.trim() || result.stdout.trim() || "Rust plugin lifecycle failed.",
      };
    }
    const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    const config =
      configPath && fsSync.existsSync(configPath)
        ? (JSON.parse(await fs.readFile(configPath, "utf8")) as CrawClawConfig)
        : undefined;
    return { ok: true, value: parsed, ...(config ? { config } : {}) };
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

export async function installPluginWithRustLifecycle(params: {
  raw: string;
  config?: CrawClawConfig;
  marketplace?: string;
  link?: boolean;
  pin?: boolean;
  dangerouslyForceUnsafeInstall?: boolean;
}): Promise<RustLifecycleResult> {
  const payload: Record<string, unknown> = {};
  if (params.marketplace) {
    payload.marketplaceSource = params.marketplace;
    payload.marketplacePlugin = params.raw;
  } else {
    payload.raw = params.raw;
  }
  if (params.link) {
    payload.link = true;
  }
  if (params.pin) {
    payload.pin = true;
  }
  if (params.dangerouslyForceUnsafeInstall) {
    payload.dangerouslyForceUnsafeInstall = true;
  }
  return await runRustLifecycleJson("plugins.install", payload, { config: params.config });
}

export async function updatePluginsWithRustLifecycle(params: {
  id?: string;
  all?: boolean;
  dryRun?: boolean;
  force?: boolean;
  config?: CrawClawConfig;
}): Promise<RustLifecycleResult> {
  const payload: Record<string, unknown> = {};
  if (params.id) {
    payload.id = params.id;
  }
  if (params.all) {
    payload.all = true;
  }
  if (params.dryRun) {
    payload.dryRun = true;
  }
  if (params.force) {
    payload.force = true;
  }
  return await runRustLifecycleJson("plugins.update", payload, { config: params.config });
}

export async function setPluginEnabledWithRustLifecycle(params: {
  id: string;
  enabled: boolean;
  config?: CrawClawConfig;
}): Promise<RustLifecycleResult> {
  return await runRustLifecycleJson(
    params.enabled ? "plugins.enable" : "plugins.disable",
    { id: params.id },
    { config: params.config },
  );
}
