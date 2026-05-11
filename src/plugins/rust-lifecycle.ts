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

function resolveRustCliInvocation(
  root: string,
  env: NodeJS.ProcessEnv,
): {
  command: string;
  args: string[];
} {
  const envBinary = env.CRAWCLAW_RUST_CLI_BIN?.trim();
  if (envBinary) {
    return { command: envBinary, args: [] };
  }
  const binaryName = process.platform === "win32" ? "crawclaw.exe" : "crawclaw";
  for (const candidate of [
    path.join(root, "dist", "native", binaryName),
    path.join(root, "target", "debug", binaryName),
    path.join(root, "target", "release", binaryName),
  ]) {
    if (fsSync.existsSync(candidate)) {
      return { command: candidate, args: [] };
    }
  }
  return {
    command: env.CARGO?.trim() || "cargo",
    args: ["run", "--quiet", "-p", "crawclaw-cli", "--"],
  };
}

async function runRustLifecycleJson(
  args: string[],
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
  const invocation = resolveRustCliInvocation(root, env);
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(invocation.command, [...invocation.args, ...args, "--json"], {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
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
  const args = ["plugins", "install", params.raw];
  if (params.marketplace) {
    args.push("--marketplace", params.marketplace);
  }
  if (params.link) {
    args.push("--link");
  }
  if (params.pin) {
    args.push("--pin");
  }
  if (params.dangerouslyForceUnsafeInstall) {
    args.push("--dangerously-force-unsafe-install");
  }
  return await runRustLifecycleJson(args, { config: params.config });
}

export async function updatePluginsWithRustLifecycle(params: {
  id?: string;
  all?: boolean;
  dryRun?: boolean;
  force?: boolean;
  config?: CrawClawConfig;
}): Promise<RustLifecycleResult> {
  const args = ["plugins", "update"];
  if (params.id) {
    args.push(params.id);
  }
  if (params.all) {
    args.push("--all");
  }
  if (params.dryRun) {
    args.push("--dry-run");
  }
  if (params.force) {
    args.push("--force");
  }
  return await runRustLifecycleJson(args, { config: params.config });
}

export async function setPluginEnabledWithRustLifecycle(params: {
  id: string;
  enabled: boolean;
  config?: CrawClawConfig;
}): Promise<RustLifecycleResult> {
  return await runRustLifecycleJson(["plugins", params.enabled ? "enable" : "disable", params.id], {
    config: params.config,
  });
}
