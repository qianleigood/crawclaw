import { formatCliCommand } from "../../../cli/command-format.js";
import type { CrawClawConfig } from "../../../config/config.js";
import { detectLegacyMatrixCrypto } from "../../../infra/matrix-legacy-crypto.js";
import { detectLegacyMatrixState } from "../../../infra/matrix-legacy-state.js";
import { hasPendingMatrixMigration } from "../../../infra/matrix-migration-snapshot.js";
import {
  detectPluginInstallPathIssue,
  formatPluginInstallPathIssue,
} from "../../../infra/plugin-install-path-warnings.js";
import { resolveBundledPluginInstallCommandHint } from "../../../plugins/bundled-sources.js";
import { removePluginFromConfig } from "../../../plugins/uninstall.js";
import { isRecord } from "../../../utils.js";
import type { DoctorConfigMutationResult } from "../shared/config-mutation-state.js";

export function formatMatrixLegacyStatePreview(
  detection: Exclude<ReturnType<typeof detectLegacyMatrixState>, null | { warning: string }>,
): string {
  return [
    "- Matrix legacy state was detected.",
    `- Legacy sync store: ${detection.legacyStoragePath}`,
    `- Current sync store: ${detection.targetStoragePath}`,
    `- Legacy crypto store: ${detection.legacyCryptoPath}`,
    `- Current crypto store: ${detection.targetCryptoPath}`,
    ...(detection.selectionNote ? [`- ${detection.selectionNote}`] : []),
    "- Automatic Matrix state migration was removed in v2026.4.24; move or rebuild this state manually.",
  ].join("\n");
}

export function formatMatrixLegacyCryptoPreview(
  detection: ReturnType<typeof detectLegacyMatrixCrypto>,
): string[] {
  const notes: string[] = [];
  for (const warning of detection.warnings) {
    notes.push(`- ${warning}`);
  }
  for (const plan of detection.plans) {
    notes.push(
      [
        `- Matrix encrypted-state migration is pending for account "${plan.accountId}".`,
        `- Legacy crypto store: ${plan.legacyCryptoPath}`,
        `- New recovery key file: ${plan.recoveryKeyPath}`,
        `- Migration state file: ${plan.statePath}`,
        "- Automatic Matrix crypto migration was removed in v2026.4.24; extract or rebuild this account manually before relying on the current store layout.",
      ].join("\n"),
    );
  }
  return notes;
}

export async function collectMatrixInstallPathWarnings(cfg: CrawClawConfig): Promise<string[]> {
  const issue = await detectPluginInstallPathIssue({
    pluginId: "matrix",
    install: cfg.plugins?.installs?.matrix,
  });
  if (!issue) {
    return [];
  }
  return formatPluginInstallPathIssue({
    issue,
    pluginLabel: "Matrix",
    defaultInstallCommand: "crawclaw plugins install @crawclaw/matrix",
    repoInstallCommand: resolveBundledPluginInstallCommandHint({
      pluginId: "matrix",
      workspaceDir: process.cwd(),
    }),
    formatCommand: formatCliCommand,
  }).map((entry) => `- ${entry}`);
}

function hasConfiguredMatrixChannel(cfg: CrawClawConfig): boolean {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  return isRecord(channels?.matrix);
}

function hasConfiguredMatrixPluginSurface(cfg: CrawClawConfig): boolean {
  return Boolean(
    cfg.plugins?.installs?.matrix ||
    cfg.plugins?.entries?.matrix ||
    cfg.plugins?.allow?.includes("matrix") ||
    cfg.plugins?.deny?.includes("matrix"),
  );
}

function hasConfiguredMatrixEnv(env: NodeJS.ProcessEnv): boolean {
  return Object.entries(env).some(
    ([key, value]) => key.startsWith("MATRIX_") && typeof value === "string" && value.trim(),
  );
}

function configMayNeedMatrixDoctorSequence(cfg: CrawClawConfig, env: NodeJS.ProcessEnv): boolean {
  return (
    hasConfiguredMatrixChannel(cfg) ||
    hasConfiguredMatrixPluginSurface(cfg) ||
    hasConfiguredMatrixEnv(env)
  );
}

/**
 * Produces a config mutation that removes stale Matrix plugin install/load-path
 * references left behind by the old bundled-plugin layout.  When the install
 * record points to a path that no longer exists on disk the config entry blocks
 * validation, so removing it lets reinstall proceed cleanly.
 */
export async function cleanStaleMatrixPluginConfig(
  cfg: CrawClawConfig,
): Promise<DoctorConfigMutationResult> {
  const issue = await detectPluginInstallPathIssue({
    pluginId: "matrix",
    install: cfg.plugins?.installs?.matrix,
  });
  if (!issue || issue.kind !== "missing-path") {
    return { config: cfg, changes: [] };
  }
  const { config, actions } = removePluginFromConfig(cfg, "matrix");
  const removed: string[] = [];
  if (actions.install) {
    removed.push("install record");
  }
  if (actions.loadPath) {
    removed.push("load path");
  }
  if (actions.entry) {
    removed.push("plugin entry");
  }
  if (actions.allowlist) {
    removed.push("allowlist entry");
  }
  if (removed.length === 0) {
    return { config: cfg, changes: [] };
  }
  return {
    config,
    changes: [
      `Removed stale Matrix plugin references (${removed.join(", ")}). ` +
        `The previous install path no longer exists: ${issue.path}`,
    ],
  };
}

export async function applyMatrixDoctorRepair(params: {
  cfg: CrawClawConfig;
  env: NodeJS.ProcessEnv;
}): Promise<{ changes: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const legacyState = detectLegacyMatrixState({ cfg: params.cfg, env: params.env });
  const legacyCrypto = detectLegacyMatrixCrypto({ cfg: params.cfg, env: params.env });

  if (legacyState) {
    if ("warning" in legacyState) {
      warnings.push(`- ${legacyState.warning}`);
    } else {
      warnings.push(formatMatrixLegacyStatePreview(legacyState));
    }
  }
  if (legacyCrypto.warnings.length > 0 || legacyCrypto.plans.length > 0) {
    warnings.push(...formatMatrixLegacyCryptoPreview(legacyCrypto));
  }
  if (warnings.length === 0 && hasPendingMatrixMigration({ cfg: params.cfg, env: params.env })) {
    warnings.push(
      "- Matrix legacy migration state is present, but automatic migration was removed in v2026.4.24.",
    );
  }

  return { changes: [], warnings };
}

export async function runMatrixDoctorSequence(params: {
  cfg: CrawClawConfig;
  env: NodeJS.ProcessEnv;
  shouldRepair: boolean;
}): Promise<{ changeNotes: string[]; warningNotes: string[] }> {
  const warningNotes: string[] = [];
  const changeNotes: string[] = [];
  const matrixInstallWarnings = await collectMatrixInstallPathWarnings(params.cfg);
  if (matrixInstallWarnings.length > 0) {
    warningNotes.push(matrixInstallWarnings.join("\n"));
  }
  if (!configMayNeedMatrixDoctorSequence(params.cfg, params.env)) {
    return { changeNotes, warningNotes };
  }

  const matrixLegacyState = detectLegacyMatrixState({
    cfg: params.cfg,
    env: params.env,
  });
  const matrixLegacyCrypto = detectLegacyMatrixCrypto({
    cfg: params.cfg,
    env: params.env,
  });

  if (params.shouldRepair) {
    const matrixRepair = await applyMatrixDoctorRepair({
      cfg: params.cfg,
      env: params.env,
    });
    changeNotes.push(...matrixRepair.changes);
    warningNotes.push(...matrixRepair.warnings);
  } else if (matrixLegacyState) {
    if ("warning" in matrixLegacyState) {
      warningNotes.push(`- ${matrixLegacyState.warning}`);
    } else {
      warningNotes.push(formatMatrixLegacyStatePreview(matrixLegacyState));
    }
  }

  if (
    !params.shouldRepair &&
    (matrixLegacyCrypto.warnings.length > 0 || matrixLegacyCrypto.plans.length > 0)
  ) {
    warningNotes.push(...formatMatrixLegacyCryptoPreview(matrixLegacyCrypto));
  }

  return { changeNotes, warningNotes };
}
