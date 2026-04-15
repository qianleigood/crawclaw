import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatCliCommand } from "../cli/command-format.js";
import {
  resolveCanonicalConfigPath,
  resolveLegacyStateDirs,
  resolveNewStateDir,
} from "../config/paths.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { autoMigrateLegacyStateDir } from "../infra/state-migrations.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { ensureDir, pathExists } from "../utils.js";

export type MigrateCrawClawOptions = {
  dryRun?: boolean;
};

type MigrateCrawClawDeps = {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
};

const BLOCKING_OVERRIDE_KEYS = [
  "CRAWCLAW_STATE_DIR",
  "CRAWCLAW_STATE_DIR",
  "CRAWCLAW_CONFIG_PATH",
  "CRAWCLAW_CONFIG_PATH",
  "CRAWCLAW_OAUTH_DIR",
  "CRAWCLAW_OAUTH_DIR",
] as const;

const LEGACY_CONFIG_BASENAMES = ["crawclaw.json", "clawdbot.json"] as const;

function resolveBlockingOverrides(env: NodeJS.ProcessEnv): string[] {
  return BLOCKING_OVERRIDE_KEYS.filter((key) => env[key]?.trim());
}

async function moveFile(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, targetPath);
    return;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "EXDEV") {
      throw err;
    }
  }

  await fs.copyFile(sourcePath, targetPath);
  await fs.unlink(sourcePath);
}

async function migrateLegacyConfigFile(params: {
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  dryRun: boolean;
}): Promise<{ changes: string[]; warnings: string[] }> {
  const changes: string[] = [];
  const warnings: string[] = [];
  const targetStateDir = resolveNewStateDir(params.homedir);
  const targetConfigPath = resolveCanonicalConfigPath(params.env, targetStateDir);

  if (await pathExists(targetConfigPath)) {
    return { changes, warnings };
  }

  const candidateDirs = [targetStateDir, ...resolveLegacyStateDirs(params.homedir)];
  const candidates = candidateDirs.flatMap((dir) =>
    LEGACY_CONFIG_BASENAMES.map((basename) => path.join(dir, basename)),
  );

  const sourcePath = (
    await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        exists: await pathExists(candidate),
      })),
    )
  ).find((entry) => entry.exists)?.candidate;

  if (!sourcePath) {
    return { changes, warnings };
  }

  if (params.dryRun) {
    changes.push(`[dry-run] Config: ${sourcePath} -> ${targetConfigPath}`);
    return { changes, warnings };
  }

  await ensureDir(path.dirname(targetConfigPath));
  try {
    await moveFile(sourcePath, targetConfigPath);
    changes.push(`Config: ${sourcePath} -> ${targetConfigPath}`);
  } catch (err) {
    warnings.push(`Failed migrating legacy config (${sourcePath}): ${String(err)}`);
  }

  return { changes, warnings };
}

export async function migrateCrawClawCommand(
  opts: MigrateCrawClawOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
  deps: MigrateCrawClawDeps = {},
) {
  const env = deps.env ?? process.env;
  const homedir = deps.homedir ?? (() => resolveRequiredHomeDir(env, os.homedir));
  const blockingOverrides = resolveBlockingOverrides(env);
  if (blockingOverrides.length > 0) {
    runtime.error(
      [
        "Migration expects default CrawClaw runtime paths.",
        `Unset ${blockingOverrides.join(", ")} and rerun ${formatCliCommand("crawclaw migrate-crawclaw")}.`,
      ].join(" "),
    );
    runtime.exit(1);
    return;
  }

  const dryRun = Boolean(opts.dryRun);
  const stateDirResult = dryRun
    ? {
        migrated: false,
        skipped: false,
        changes: await (async () => {
          const legacyDirs = resolveLegacyStateDirs(homedir);
          const existingLegacy = (
            await Promise.all(
              legacyDirs.map(async (dir) => ({
                dir,
                exists: await pathExists(dir),
              })),
            )
          ).find((entry) => entry.exists)?.dir;
          if (!existingLegacy) {
            return [] as string[];
          }
          return [`[dry-run] State dir: ${existingLegacy} -> ${resolveNewStateDir(homedir)}`];
        })(),
        warnings: [] as string[],
      }
    : await autoMigrateLegacyStateDir({ env, homedir });

  const configResult = await migrateLegacyConfigFile({ env, homedir, dryRun });

  const changes = [...stateDirResult.changes, ...configResult.changes];
  const warnings = [...stateDirResult.warnings, ...configResult.warnings];

  if (changes.length === 0 && warnings.length === 0) {
    runtime.log("No legacy CrawClaw runtime state found to migrate.");
    return;
  }

  if (changes.length > 0) {
    runtime.log(`Migration changes:\n${changes.map((entry) => `- ${entry}`).join("\n")}`);
  }
  if (warnings.length > 0) {
    runtime.error(`Migration warnings:\n${warnings.map((entry) => `- ${entry}`).join("\n")}`);
  }
}
