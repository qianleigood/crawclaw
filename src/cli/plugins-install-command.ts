import fs from "node:fs";
import { cleanStaleMatrixPluginConfig } from "../commands/doctor/providers/matrix.js";
import type { CrawClawConfig } from "../config/config.js";
import { loadConfig, readConfigFileSnapshot, writeConfigFile } from "../config/config.js";
import { installHooksFromNpmSpec, installHooksFromPath } from "../hooks/install.js";
import { resolveArchiveKind } from "../infra/archive.js";
import { extractErrorCode, formatErrorMessage } from "../infra/errors.js";
import type { InstallSafetyOverrides } from "../plugins/install-security-scan.js";
import { resolveMarketplaceInstallShortcut } from "../plugins/marketplace.js";
import { installPluginWithRustLifecycle } from "../plugins/rust-lifecycle.js";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import { shortenHomePath } from "../utils.js";
import { looksLikeLocalInstallSpec } from "./install-spec.js";
import { resolvePinnedNpmInstallRecordForCli } from "./npm-resolution.js";
import {
  resolvePluginInstallInvalidConfigPolicy,
  resolvePluginInstallRequestContext,
  type PluginInstallRequestContext,
} from "./plugin-install-config-policy.js";
import {
  createHookPackInstallLogger,
  formatPluginInstallWithHookFallbackError,
} from "./plugins-command-helpers.js";
import { persistHookPackInstall } from "./plugins-install-persist.js";

async function tryInstallHookPackFromLocalPath(params: {
  config: CrawClawConfig;
  resolvedPath: string;
  link?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (params.link) {
    const stat = fs.statSync(params.resolvedPath);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        error: "Linked hook pack paths must be directories.",
      };
    }

    const probe = await installHooksFromPath({
      path: params.resolvedPath,
      dryRun: true,
    });
    if (!probe.ok) {
      return probe;
    }

    const existing = params.config.hooks?.internal?.load?.extraDirs ?? [];
    const merged = Array.from(new Set([...existing, params.resolvedPath]));
    await persistHookPackInstall({
      config: {
        ...params.config,
        hooks: {
          ...params.config.hooks,
          internal: {
            ...params.config.hooks?.internal,
            enabled: true,
            load: {
              ...params.config.hooks?.internal?.load,
              extraDirs: merged,
            },
          },
        },
      },
      hookPackId: probe.hookPackId,
      hooks: probe.hooks,
      install: {
        source: "path",
        sourcePath: params.resolvedPath,
        installPath: params.resolvedPath,
        version: probe.version,
      },
      successMessage: `Linked hook pack path: ${shortenHomePath(params.resolvedPath)}`,
    });
    return { ok: true };
  }

  const result = await installHooksFromPath({
    path: params.resolvedPath,
    logger: createHookPackInstallLogger(),
  });
  if (!result.ok) {
    return result;
  }

  const source: "archive" | "path" = resolveArchiveKind(params.resolvedPath) ? "archive" : "path";
  await persistHookPackInstall({
    config: params.config,
    hookPackId: result.hookPackId,
    hooks: result.hooks,
    install: {
      source,
      sourcePath: params.resolvedPath,
      installPath: result.targetDir,
      version: result.version,
    },
  });
  return { ok: true };
}

async function tryInstallHookPackFromNpmSpec(params: {
  config: CrawClawConfig;
  spec: string;
  pin?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await installHooksFromNpmSpec({
    spec: params.spec,
    logger: createHookPackInstallLogger(),
  });
  if (!result.ok) {
    return result;
  }

  const installRecord = resolvePinnedNpmInstallRecordForCli(
    params.spec,
    Boolean(params.pin),
    result.targetDir,
    result.version,
    result.npmResolution,
    defaultRuntime.log,
    theme.warn,
  );
  await persistHookPackInstall({
    config: params.config,
    hookPackId: result.hookPackId,
    hooks: result.hooks,
    install: installRecord,
  });
  return { ok: true };
}

function isAllowedMatrixRecoveryIssue(issue: { path?: string; message?: string }): boolean {
  return (
    (issue.path === "channels.matrix" && issue.message === "unknown channel id: matrix") ||
    (issue.path === "plugins.load.paths" &&
      typeof issue.message === "string" &&
      issue.message.includes("plugin path not found"))
  );
}

function buildInvalidPluginInstallConfigError(message: string): Error {
  const error = new Error(message);
  (error as { code?: string }).code = "INVALID_CONFIG";
  return error;
}

async function loadConfigFromSnapshotForInstall(
  request: PluginInstallRequestContext,
): Promise<CrawClawConfig> {
  if (resolvePluginInstallInvalidConfigPolicy(request) !== "recover-matrix-only") {
    throw buildInvalidPluginInstallConfigError(
      "Config invalid; run `crawclaw doctor --fix` before installing plugins.",
    );
  }
  const snapshot = await readConfigFileSnapshot();
  const parsed = (snapshot.parsed ?? {}) as Record<string, unknown>;
  if (!snapshot.exists || Object.keys(parsed).length === 0) {
    throw buildInvalidPluginInstallConfigError(
      "Config file could not be parsed; run `crawclaw doctor` to repair it.",
    );
  }
  if (
    snapshot.legacyIssues.length > 0 ||
    snapshot.issues.length === 0 ||
    snapshot.issues.some((issue) => !isAllowedMatrixRecoveryIssue(issue))
  ) {
    throw buildInvalidPluginInstallConfigError(
      "Config invalid outside the Matrix upgrade recovery path; run `crawclaw doctor --fix` before reinstalling Matrix.",
    );
  }
  const snapshotConfig = snapshot.config ?? snapshot.runtimeConfig;
  const cleaned = await cleanStaleMatrixPluginConfig(snapshotConfig);
  return cleaned.config;
}

export async function loadConfigForInstall(
  request: PluginInstallRequestContext,
): Promise<CrawClawConfig> {
  try {
    return loadConfig();
  } catch (err) {
    if (extractErrorCode(err) !== "INVALID_CONFIG") {
      throw err;
    }
  }
  return loadConfigFromSnapshotForInstall(request);
}

export async function runPluginInstallCommand(params: {
  raw: string;
  opts: InstallSafetyOverrides & {
    link?: boolean;
    pin?: boolean;
    marketplace?: string;
  };
}) {
  const shorthand = !params.opts.marketplace
    ? await resolveMarketplaceInstallShortcut(params.raw)
    : null;
  if (shorthand?.ok === false) {
    defaultRuntime.error(shorthand.error);
    return defaultRuntime.exit(1);
  }

  const raw = shorthand?.ok ? shorthand.plugin : params.raw;
  const opts = {
    ...params.opts,
    marketplace:
      params.opts.marketplace ?? (shorthand?.ok ? shorthand.marketplaceSource : undefined),
  };
  if (opts.marketplace) {
    if (opts.link) {
      defaultRuntime.error("`--link` is not supported with `--marketplace`.");
      return defaultRuntime.exit(1);
    }
    if (opts.pin) {
      defaultRuntime.error("`--pin` is not supported with `--marketplace`.");
      return defaultRuntime.exit(1);
    }
  }
  const requestResolution = resolvePluginInstallRequestContext({
    rawSpec: raw,
    marketplace: opts.marketplace,
  });
  if (!requestResolution.ok) {
    defaultRuntime.error(requestResolution.error);
    return defaultRuntime.exit(1);
  }
  const request = requestResolution.request;
  const cfg = await loadConfigForInstall(request).catch((error: unknown) => {
    defaultRuntime.error(formatErrorMessage(error));
    return null;
  });
  if (!cfg) {
    return defaultRuntime.exit(1);
  }

  const result = await installPluginWithRustLifecycle({
    raw,
    marketplace: opts.marketplace,
    link: opts.link,
    pin: opts.pin,
    dangerouslyForceUnsafeInstall: opts.dangerouslyForceUnsafeInstall,
    config: cfg,
  });
  if (result.ok) {
    if (result.config) {
      await writeConfigFile(result.config);
    }
    return;
  }

  const resolved = request.resolvedPath ?? request.normalizedSpec;
  const localPathExists = fs.existsSync(resolved);
  if (opts.link && !localPathExists) {
    defaultRuntime.error(result.error || "`--link` requires a local path.");
    return defaultRuntime.exit(1);
  }
  if (localPathExists) {
    const hookFallback = await tryInstallHookPackFromLocalPath({
      config: cfg,
      resolvedPath: resolved,
      link: opts.link,
    });
    if (hookFallback.ok) {
      return;
    }
    defaultRuntime.error(
      formatPluginInstallWithHookFallbackError(result.error, hookFallback.error),
    );
    return defaultRuntime.exit(1);
  }

  if (
    looksLikeLocalInstallSpec(raw, [
      ".ts",
      ".js",
      ".mjs",
      ".cjs",
      ".tgz",
      ".tar.gz",
      ".tar",
      ".zip",
    ])
  ) {
    defaultRuntime.error(result.error || `Path not found: ${resolved}`);
    return defaultRuntime.exit(1);
  }

  if (opts.marketplace) {
    defaultRuntime.error(result.error);
    return defaultRuntime.exit(1);
  }

  const hookFallback = await tryInstallHookPackFromNpmSpec({
    config: cfg,
    spec: raw,
    pin: opts.pin,
  });
  if (hookFallback.ok) {
    return;
  }
  defaultRuntime.error(formatPluginInstallWithHookFallbackError(result.error, hookFallback.error));
  return defaultRuntime.exit(1);
}
