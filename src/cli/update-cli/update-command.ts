import path from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import {
  checkShellCompletionStatus,
  ensureCompletionCacheExists,
} from "../../commands/doctor-completion.js";
import { doctorCommand } from "../../commands/doctor.js";
import {
  readConfigFileSnapshot,
  replaceConfigFile,
  resolveGatewayPort,
} from "../../config/config.js";
import { formatConfigIssueLines } from "../../config/issue-format.js";
import { asResolvedSourceConfig, asRuntimeConfig } from "../../config/materialize.js";
import { resolveGatewayService } from "../../daemon/service.js";
import { nodeVersionSatisfiesEngine } from "../../infra/runtime-guard.js";
import {
  channelToNpmTag,
  DEFAULT_GIT_CHANNEL,
  DEFAULT_PACKAGE_CHANNEL,
  normalizeUpdateChannel,
} from "../../infra/update-channels.js";
import {
  compareSemverStrings,
  fetchNpmPackageTargetStatus,
  resolveNpmChannelTag,
  checkUpdateStatus,
} from "../../infra/update-check.js";
import {
  collectInstalledGlobalPackageErrors,
  canResolveRegistryVersionForPackageTarget,
  createGlobalInstallEnv,
  cleanupGlobalRenameDirs,
  globalInstallArgs,
  resolveExpectedInstalledVersionFromSpec,
  resolveGlobalInstallSpec,
  resolveGlobalPackageRoot,
} from "../../infra/update-global.js";
import { runGatewayUpdate, type UpdateRunResult } from "../../infra/update-runner.js";
import { syncPluginsForUpdateChannel, updateNpmInstalledPlugins } from "../../plugins/update.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { defaultRuntime } from "../../runtime.js";
import { stylePromptMessage } from "../../terminal/prompt-style.js";
import { theme } from "../../terminal/theme.js";
import { pathExists } from "../../utils.js";
import { replaceCliName, resolveCliName } from "../cli-name.js";
import { formatCliCommand } from "../command-format.js";
import { installCompletion } from "../completion-cli.js";
import { runDaemonInstall, runDaemonRestart } from "../daemon-cli.js";
import {
  renderRestartDiagnostics,
  terminateStaleGatewayPids,
  waitForGatewayHealthyRestart,
} from "../daemon-cli/restart-health.js";
import { createCliTranslator, getActiveCliLocale } from "../i18n/index.js";
import { createUpdateProgress, printResult } from "./progress.js";
import { prepareRestartScript, runRestartScript } from "./restart-helper.js";
import {
  DEFAULT_PACKAGE_NAME,
  createGlobalCommandRunner,
  ensureGitCheckout,
  normalizeTag,
  parseTimeoutMsOrExit,
  readPackageName,
  readPackageVersion,
  resolveGitInstallDir,
  resolveGlobalManager,
  resolveNodeRunner,
  resolveTargetVersion,
  resolveUpdateRoot,
  runUpdateStep,
  tryWriteCompletionCache,
  type UpdateCommandOptions,
} from "./shared.js";
import { suppressDeprecations } from "./suppress-deprecations.js";

const CLI_NAME = resolveCliName();
const SERVICE_REFRESH_TIMEOUT_MS = 60_000;
const SERVICE_REFRESH_PATH_ENV_KEYS = [
  "CRAWCLAW_HOME",
  "CRAWCLAW_STATE_DIR",
  "CRAWCLAW_CONFIG_PATH",
] as const;

const UPDATE_QUIPS = [
  "update.quip.1",
  "update.quip.2",
  "update.quip.3",
  "update.quip.4",
  "update.quip.5",
  "update.quip.6",
  "update.quip.7",
  "update.quip.8",
  "update.quip.9",
  "update.quip.10",
  "update.quip.11",
  "update.quip.12",
  "update.quip.13",
  "update.quip.14",
  "update.quip.15",
  "update.quip.16",
  "update.quip.17",
  "update.quip.18",
  "update.quip.19",
  "update.quip.20",
];

function pickUpdateQuip(): string {
  const t = createCliTranslator(getActiveCliLocale());
  const key = UPDATE_QUIPS[Math.floor(Math.random() * UPDATE_QUIPS.length)] ?? "update.quip.4";
  return t(key);
}

function resolveGatewayInstallEntrypointCandidates(root?: string): string[] {
  if (!root) {
    return [];
  }
  return [
    path.join(root, "dist", "entry.js"),
    path.join(root, "dist", "entry.mjs"),
    path.join(root, "dist", "index.js"),
    path.join(root, "dist", "index.mjs"),
  ];
}

function formatCommandFailure(stdout: string, stderr: string): string {
  const t = createCliTranslator(getActiveCliLocale());
  const detail = (stderr || stdout).trim();
  if (!detail) {
    return t("update.error.commandNonZero");
  }
  return detail.split("\n").slice(-3).join("\n");
}

function tryResolveInvocationCwd(): string | undefined {
  try {
    return process.cwd();
  } catch {
    return undefined;
  }
}

async function resolvePackageRuntimePreflightError(params: {
  tag: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const t = createCliTranslator(getActiveCliLocale());
  if (!canResolveRegistryVersionForPackageTarget(params.tag)) {
    return null;
  }
  const target = params.tag.trim();
  if (!target) {
    return null;
  }
  const status = await fetchNpmPackageTargetStatus({
    target,
    timeoutMs: params.timeoutMs,
  });
  if (status.error) {
    return null;
  }
  const satisfies = nodeVersionSatisfiesEngine(process.versions.node ?? null, status.nodeEngine);
  if (satisfies !== false) {
    return null;
  }
  const targetLabel = status.version ?? target;
  return [
    t("update.error.nodeTooOld.current", {
      nodeVersion: process.versions.node ?? "unknown",
      packageName: DEFAULT_PACKAGE_NAME,
      target: targetLabel,
    }),
    t("update.error.nodeTooOld.requires", { nodeEngine: status.nodeEngine ?? "unknown" }),
    t("update.error.nodeTooOld.upgradeNode", { cliName: CLI_NAME }),
    t("update.error.nodeTooOld.silentOlderCompatible", { packageName: DEFAULT_PACKAGE_NAME }),
    t("update.error.nodeTooOld.afterUpgradeInstallLatest", { packageName: DEFAULT_PACKAGE_NAME }),
  ].join("\n");
}

function resolveServiceRefreshEnv(
  env: NodeJS.ProcessEnv,
  invocationCwd?: string,
): NodeJS.ProcessEnv {
  const resolvedEnv: NodeJS.ProcessEnv = { ...env };
  for (const key of SERVICE_REFRESH_PATH_ENV_KEYS) {
    const rawValue = resolvedEnv[key]?.trim();
    if (!rawValue) {
      continue;
    }
    if (rawValue.startsWith("~") || path.isAbsolute(rawValue) || path.win32.isAbsolute(rawValue)) {
      resolvedEnv[key] = rawValue;
      continue;
    }
    if (!invocationCwd) {
      resolvedEnv[key] = rawValue;
      continue;
    }
    resolvedEnv[key] = path.resolve(invocationCwd, rawValue);
  }
  return resolvedEnv;
}

type UpdateDryRunPreview = {
  dryRun: true;
  root: string;
  installKind: "git" | "package" | "unknown";
  mode: UpdateRunResult["mode"];
  updateInstallKind: "git" | "package" | "unknown";
  switchToGit: boolean;
  switchToPackage: boolean;
  restart: boolean;
  requestedChannel: "stable" | "beta" | "dev" | null;
  storedChannel: "stable" | "beta" | "dev" | null;
  effectiveChannel: "stable" | "beta" | "dev";
  tag: string;
  currentVersion: string | null;
  targetVersion: string | null;
  downgradeRisk: boolean;
  actions: string[];
  notes: string[];
};

function printDryRunPreview(preview: UpdateDryRunPreview, jsonMode: boolean): void {
  if (jsonMode) {
    defaultRuntime.writeJson(preview);
    return;
  }

  const t = createCliTranslator(getActiveCliLocale());

  defaultRuntime.log(theme.heading(t("update.dryRun.title")));
  defaultRuntime.log(theme.muted(t("update.dryRun.noChanges")));
  defaultRuntime.log("");
  defaultRuntime.log(`  ${t("update.dryRun.label.root")}: ${theme.muted(preview.root)}`);
  defaultRuntime.log(
    `  ${t("update.dryRun.label.installKind")}: ${theme.muted(preview.installKind)}`,
  );
  defaultRuntime.log(`  ${t("update.dryRun.label.mode")}: ${theme.muted(preview.mode)}`);
  defaultRuntime.log(
    `  ${t("update.dryRun.label.channel")}: ${theme.muted(preview.effectiveChannel)}`,
  );
  defaultRuntime.log(`  ${t("update.dryRun.label.tagSpec")}: ${theme.muted(preview.tag)}`);
  if (preview.currentVersion) {
    defaultRuntime.log(
      `  ${t("update.dryRun.label.currentVersion")}: ${theme.muted(preview.currentVersion)}`,
    );
  }
  if (preview.targetVersion) {
    defaultRuntime.log(
      `  ${t("update.dryRun.label.targetVersion")}: ${theme.muted(preview.targetVersion)}`,
    );
  }
  if (preview.downgradeRisk) {
    defaultRuntime.log(theme.warn(`  ${t("update.dryRun.downgradeWarning")}`));
  }

  defaultRuntime.log("");
  defaultRuntime.log(theme.heading(t("update.dryRun.plannedActions")));
  for (const action of preview.actions) {
    defaultRuntime.log(`  - ${action}`);
  }

  if (preview.notes.length > 0) {
    defaultRuntime.log("");
    defaultRuntime.log(theme.heading(t("update.dryRun.notes")));
    for (const note of preview.notes) {
      defaultRuntime.log(`  - ${theme.muted(note)}`);
    }
  }
}

async function refreshGatewayServiceEnv(params: {
  result: UpdateRunResult;
  jsonMode: boolean;
  invocationCwd?: string;
}): Promise<void> {
  const args = ["gateway", "install", "--force"];
  if (params.jsonMode) {
    args.push("--json");
  }

  for (const candidate of resolveGatewayInstallEntrypointCandidates(params.result.root)) {
    if (!(await pathExists(candidate))) {
      continue;
    }
    const res = await runCommandWithTimeout([resolveNodeRunner(), candidate, ...args], {
      cwd: params.result.root,
      env: resolveServiceRefreshEnv(process.env, params.invocationCwd),
      timeoutMs: SERVICE_REFRESH_TIMEOUT_MS,
    });
    if (res.code === 0) {
      return;
    }
    const t = createCliTranslator(getActiveCliLocale());
    throw new Error(
      t("update.restart.updatedInstallRefreshFailed", {
        candidate,
        detail: formatCommandFailure(res.stdout, res.stderr),
      }),
    );
  }

  await runDaemonInstall({ force: true, json: params.jsonMode || undefined });
}

async function tryInstallShellCompletion(opts: {
  jsonMode: boolean;
  skipPrompt: boolean;
}): Promise<void> {
  const t = createCliTranslator(getActiveCliLocale());
  if (opts.jsonMode || !process.stdin.isTTY) {
    return;
  }

  const status = await checkShellCompletionStatus(CLI_NAME);

  if (status.usesSlowPattern) {
    defaultRuntime.log(theme.muted(t("update.completion.upgradingCached")));
    const cacheGenerated = await ensureCompletionCacheExists(CLI_NAME);
    if (cacheGenerated) {
      await installCompletion(status.shell, true, CLI_NAME);
    }
    return;
  }

  if (status.profileInstalled && !status.cacheExists) {
    defaultRuntime.log(theme.muted(t("update.completion.regeneratingCache")));
    await ensureCompletionCacheExists(CLI_NAME);
    return;
  }

  if (!status.profileInstalled) {
    defaultRuntime.log("");
    defaultRuntime.log(theme.heading(t("update.completion.heading")));

    const shouldInstall = await confirm({
      message: stylePromptMessage(
        t("update.completion.enablePrompt", {
          shell: status.shell,
          cliName: CLI_NAME,
        }),
      ),
      initialValue: true,
    });

    if (isCancel(shouldInstall) || !shouldInstall) {
      if (!opts.skipPrompt) {
        defaultRuntime.log(
          theme.muted(
            t("update.completion.skipped", {
              command: replaceCliName(formatCliCommand("crawclaw completion --install"), CLI_NAME),
            }),
          ),
        );
      }
      return;
    }

    const cacheGenerated = await ensureCompletionCacheExists(CLI_NAME);
    if (!cacheGenerated) {
      defaultRuntime.log(theme.warn(t("update.completion.generateFailed")));
      return;
    }

    await installCompletion(status.shell, opts.skipPrompt, CLI_NAME);
  }
}

async function runPackageInstallUpdate(params: {
  root: string;
  installKind: "git" | "package" | "unknown";
  tag: string;
  timeoutMs: number;
  startedAt: number;
  progress: ReturnType<typeof createUpdateProgress>["progress"];
}): Promise<UpdateRunResult> {
  const manager = await resolveGlobalManager({
    root: params.root,
    installKind: params.installKind,
    timeoutMs: params.timeoutMs,
  });
  const installEnv = await createGlobalInstallEnv();
  const runCommand = createGlobalCommandRunner();

  const pkgRoot = await resolveGlobalPackageRoot(manager, runCommand, params.timeoutMs);
  const packageName =
    (pkgRoot ? await readPackageName(pkgRoot) : await readPackageName(params.root)) ??
    DEFAULT_PACKAGE_NAME;
  const installSpec = resolveGlobalInstallSpec({
    packageName,
    tag: params.tag,
    env: installEnv,
  });

  const beforeVersion = pkgRoot ? await readPackageVersion(pkgRoot) : null;
  if (pkgRoot) {
    await cleanupGlobalRenameDirs({
      globalRoot: path.dirname(pkgRoot),
      packageName,
    });
  }

  const updateStep = await runUpdateStep({
    name: "global update",
    argv: globalInstallArgs(manager, installSpec),
    env: installEnv,
    timeoutMs: params.timeoutMs,
    progress: params.progress,
  });

  const steps = [updateStep];
  let afterVersion = beforeVersion;

  const verifiedPackageRoot =
    (await resolveGlobalPackageRoot(manager, runCommand, params.timeoutMs)) ?? pkgRoot;
  if (verifiedPackageRoot) {
    afterVersion = await readPackageVersion(verifiedPackageRoot);
    const expectedVersion = resolveExpectedInstalledVersionFromSpec(packageName, installSpec);
    const verificationErrors = await collectInstalledGlobalPackageErrors({
      packageRoot: verifiedPackageRoot,
      expectedVersion,
    });
    if (verificationErrors.length > 0) {
      steps.push({
        name: "global install verify",
        command: `verify ${verifiedPackageRoot}`,
        cwd: verifiedPackageRoot,
        durationMs: 0,
        exitCode: 1,
        stderrTail: verificationErrors.join("\n"),
        stdoutTail: null,
      });
    }
    const entryPath = path.join(verifiedPackageRoot, "dist", "entry.js");
    if (await pathExists(entryPath)) {
      const doctorStep = await runUpdateStep({
        name: `${CLI_NAME} doctor`,
        argv: [resolveNodeRunner(), entryPath, "doctor", "--non-interactive"],
        timeoutMs: params.timeoutMs,
        progress: params.progress,
      });
      steps.push(doctorStep);
    }
  }

  const failedStep = steps.find((step) => step.exitCode !== 0);
  return {
    status: failedStep ? "error" : "ok",
    mode: manager,
    root: verifiedPackageRoot ?? params.root,
    reason: failedStep ? failedStep.name : undefined,
    before: { version: beforeVersion },
    after: { version: afterVersion },
    steps,
    durationMs: Date.now() - params.startedAt,
  };
}

async function runGitUpdate(params: {
  root: string;
  switchToGit: boolean;
  installKind: "git" | "package" | "unknown";
  timeoutMs: number | undefined;
  startedAt: number;
  progress: ReturnType<typeof createUpdateProgress>["progress"];
  channel: "stable" | "beta" | "dev";
  tag: string;
  showProgress: boolean;
  opts: UpdateCommandOptions;
  stop: () => void;
}): Promise<UpdateRunResult> {
  const updateRoot = params.switchToGit ? resolveGitInstallDir() : params.root;
  const effectiveTimeout = params.timeoutMs ?? 20 * 60_000;
  const installEnv = await createGlobalInstallEnv();

  const cloneStep = params.switchToGit
    ? await ensureGitCheckout({
        dir: updateRoot,
        env: installEnv,
        timeoutMs: effectiveTimeout,
        progress: params.progress,
      })
    : null;

  if (cloneStep && cloneStep.exitCode !== 0) {
    const result: UpdateRunResult = {
      status: "error",
      mode: "git",
      root: updateRoot,
      reason: cloneStep.name,
      steps: [cloneStep],
      durationMs: Date.now() - params.startedAt,
    };
    params.stop();
    printResult(result, { ...params.opts, hideSteps: params.showProgress });
    defaultRuntime.exit(1);
    return result;
  }

  const updateResult = await runGatewayUpdate({
    cwd: updateRoot,
    argv1: params.switchToGit ? undefined : process.argv[1],
    timeoutMs: params.timeoutMs,
    progress: params.progress,
    channel: params.channel,
    tag: params.tag,
  });
  const steps = [...(cloneStep ? [cloneStep] : []), ...updateResult.steps];

  if (params.switchToGit && updateResult.status === "ok") {
    const manager = await resolveGlobalManager({
      root: params.root,
      installKind: params.installKind,
      timeoutMs: effectiveTimeout,
    });
    const installStep = await runUpdateStep({
      name: "global install",
      argv: globalInstallArgs(manager, updateRoot),
      cwd: updateRoot,
      env: installEnv,
      timeoutMs: effectiveTimeout,
      progress: params.progress,
    });
    steps.push(installStep);

    const failedStep = installStep.exitCode !== 0 ? installStep : null;
    return {
      ...updateResult,
      status: updateResult.status === "ok" && !failedStep ? "ok" : "error",
      steps,
      durationMs: Date.now() - params.startedAt,
    };
  }

  return {
    ...updateResult,
    steps,
    durationMs: Date.now() - params.startedAt,
  };
}

async function updatePluginsAfterCoreUpdate(params: {
  root: string;
  channel: "stable" | "beta" | "dev";
  configSnapshot: Awaited<ReturnType<typeof readConfigFileSnapshot>>;
  opts: UpdateCommandOptions;
}): Promise<void> {
  const t = createCliTranslator(getActiveCliLocale());
  if (!params.configSnapshot.valid) {
    if (!params.opts.json) {
      defaultRuntime.log(theme.warn(t("update.plugins.skipInvalidConfig")));
    }
    return;
  }

  const pluginLogger = params.opts.json
    ? {}
    : {
        info: (msg: string) => defaultRuntime.log(msg),
        warn: (msg: string) => defaultRuntime.log(theme.warn(msg)),
        error: (msg: string) => defaultRuntime.log(theme.error(msg)),
      };

  if (!params.opts.json) {
    defaultRuntime.log("");
    defaultRuntime.log(theme.heading(t("update.plugins.heading")));
  }

  const syncResult = await syncPluginsForUpdateChannel({
    config: params.configSnapshot.config,
    channel: params.channel,
    workspaceDir: params.root,
    logger: pluginLogger,
  });
  let pluginConfig = syncResult.config;

  const npmResult = await updateNpmInstalledPlugins({
    config: pluginConfig,
    skipIds: new Set(syncResult.summary.switchedToNpm),
    logger: pluginLogger,
  });
  pluginConfig = npmResult.config;

  if (syncResult.changed || npmResult.changed) {
    await replaceConfigFile({
      nextConfig: pluginConfig,
      baseHash: params.configSnapshot.hash,
    });
  }

  if (params.opts.json) {
    return;
  }

  const summarizeList = (list: string[]) => {
    if (list.length <= 6) {
      return list.join(", ");
    }
    return t("update.plugins.summary.truncatedList", {
      items: list.slice(0, 6).join(", "),
      count: list.length - 6,
    });
  };

  if (syncResult.summary.switchedToBundled.length > 0) {
    defaultRuntime.log(
      theme.muted(
        t("update.plugins.switchedToBundled", {
          plugins: summarizeList(syncResult.summary.switchedToBundled),
        }),
      ),
    );
  }
  if (syncResult.summary.switchedToNpm.length > 0) {
    defaultRuntime.log(
      theme.muted(
        t("update.plugins.restoredNpm", {
          plugins: summarizeList(syncResult.summary.switchedToNpm),
        }),
      ),
    );
  }
  for (const warning of syncResult.summary.warnings) {
    defaultRuntime.log(theme.warn(warning));
  }
  for (const error of syncResult.summary.errors) {
    defaultRuntime.log(theme.error(error));
  }

  const updated = npmResult.outcomes.filter((entry) => entry.status === "updated").length;
  const unchanged = npmResult.outcomes.filter((entry) => entry.status === "unchanged").length;
  const failed = npmResult.outcomes.filter((entry) => entry.status === "error").length;
  const skipped = npmResult.outcomes.filter((entry) => entry.status === "skipped").length;

  if (npmResult.outcomes.length === 0) {
    defaultRuntime.log(theme.muted(t("update.plugins.noUpdatesNeeded")));
  } else {
    const parts = [
      t("update.plugins.summary.updated", { count: updated }),
      t("update.plugins.summary.unchanged", { count: unchanged }),
    ];
    if (failed > 0) {
      parts.push(t("update.plugins.summary.failed", { count: failed }));
    }
    if (skipped > 0) {
      parts.push(t("update.plugins.summary.skipped", { count: skipped }));
    }
    defaultRuntime.log(theme.muted(t("update.plugins.summary.line", { parts: parts.join(", ") })));
  }

  for (const outcome of npmResult.outcomes) {
    if (outcome.status !== "error") {
      continue;
    }
    defaultRuntime.log(theme.error(outcome.message));
  }
}

async function maybeRestartService(params: {
  shouldRestart: boolean;
  result: UpdateRunResult;
  opts: UpdateCommandOptions;
  refreshServiceEnv: boolean;
  gatewayPort: number;
  restartScriptPath?: string | null;
  invocationCwd?: string;
}): Promise<void> {
  const t = createCliTranslator(getActiveCliLocale());
  if (params.shouldRestart) {
    if (!params.opts.json) {
      defaultRuntime.log("");
      defaultRuntime.log(theme.heading(t("update.restart.heading")));
    }

    try {
      let restarted = false;
      let restartInitiated = false;
      if (params.refreshServiceEnv) {
        try {
          await refreshGatewayServiceEnv({
            result: params.result,
            jsonMode: Boolean(params.opts.json),
            invocationCwd: params.invocationCwd,
          });
        } catch (err) {
          // Always log the refresh failure so callers can detect it (issue #56772).
          // Previously this was silently suppressed in --json mode, hiding the root
          // cause and preventing auto-update callers from detecting the failure.
          const message = t("update.restart.refreshFailed", { error: String(err) });
          if (params.opts.json) {
            defaultRuntime.error(message);
          } else {
            defaultRuntime.log(theme.warn(message));
          }
        }
      }
      if (params.restartScriptPath) {
        await runRestartScript(params.restartScriptPath);
        restartInitiated = true;
      } else {
        restarted = await runDaemonRestart();
      }

      if (!params.opts.json && restarted) {
        defaultRuntime.log(theme.success(t("update.restart.daemonRestartedSuccessfully")));
        defaultRuntime.log("");
        process.env.CRAWCLAW_UPDATE_IN_PROGRESS = "1";
        try {
          const interactiveDoctor =
            process.stdin.isTTY && !params.opts.json && params.opts.yes !== true;
          await doctorCommand(defaultRuntime, {
            nonInteractive: !interactiveDoctor,
          });
        } catch (err) {
          defaultRuntime.log(theme.warn(t("update.restart.doctorFailed", { error: String(err) })));
        } finally {
          delete process.env.CRAWCLAW_UPDATE_IN_PROGRESS;
        }
      }

      if (!params.opts.json && restartInitiated) {
        const service = resolveGatewayService();
        let health = await waitForGatewayHealthyRestart({
          service,
          port: params.gatewayPort,
        });
        if (!health.healthy && health.staleGatewayPids.length > 0) {
          if (!params.opts.json) {
            defaultRuntime.log(
              theme.warn(
                t("update.restart.foundStaleProcesses", {
                  pids: health.staleGatewayPids.join(", "),
                }),
              ),
            );
          }
          await terminateStaleGatewayPids(health.staleGatewayPids);
          await runDaemonRestart();
          health = await waitForGatewayHealthyRestart({
            service,
            port: params.gatewayPort,
          });
        }

        if (health.healthy) {
          defaultRuntime.log(theme.success(t("update.restart.completed")));
        } else {
          defaultRuntime.log(theme.warn(t("update.restart.gatewayNotHealthy")));
          for (const line of renderRestartDiagnostics(health)) {
            defaultRuntime.log(theme.muted(line));
          }
          defaultRuntime.log(
            theme.muted(
              t("update.restart.runStatusDeep", {
                command: replaceCliName(
                  formatCliCommand("crawclaw gateway status --deep"),
                  CLI_NAME,
                ),
              }),
            ),
          );
        }
        defaultRuntime.log("");
      }
    } catch (err) {
      if (!params.opts.json) {
        defaultRuntime.log(theme.warn(t("update.restart.failed", { error: String(err) })));
        defaultRuntime.log(
          theme.muted(
            t("update.restart.manualTip", {
              command: replaceCliName(formatCliCommand("crawclaw gateway restart"), CLI_NAME),
            }),
          ),
        );
      }
    }
    return;
  }

  if (!params.opts.json) {
    defaultRuntime.log("");
    if (params.result.mode === "npm" || params.result.mode === "pnpm") {
      defaultRuntime.log(
        theme.muted(
          t("update.tip.doctorThenRestart", {
            doctor: replaceCliName(formatCliCommand("crawclaw doctor"), CLI_NAME),
            restart: replaceCliName(formatCliCommand("crawclaw gateway restart"), CLI_NAME),
          }),
        ),
      );
    } else {
      defaultRuntime.log(
        theme.muted(
          t("update.tip.restartOnly", {
            restart: replaceCliName(formatCliCommand("crawclaw gateway restart"), CLI_NAME),
          }),
        ),
      );
    }
  }
}

export async function updateCommand(opts: UpdateCommandOptions): Promise<void> {
  suppressDeprecations();
  const t = createCliTranslator(getActiveCliLocale());
  const invocationCwd = tryResolveInvocationCwd();

  const timeoutMs = parseTimeoutMsOrExit(opts.timeout);
  const shouldRestart = opts.restart !== false;
  if (timeoutMs === null) {
    return;
  }

  const root = await resolveUpdateRoot();
  const updateStatus = await checkUpdateStatus({
    root,
    timeoutMs: timeoutMs ?? 3500,
    fetchGit: false,
    includeRegistry: false,
  });

  const configSnapshot = await readConfigFileSnapshot();
  const storedChannel = configSnapshot.valid
    ? normalizeUpdateChannel(configSnapshot.config.update?.channel)
    : null;

  const requestedChannel = normalizeUpdateChannel(opts.channel);
  if (opts.channel && !requestedChannel) {
    defaultRuntime.error(t("update.error.invalidChannel", { channel: opts.channel }));
    defaultRuntime.exit(1);
    return;
  }
  if (opts.channel && !configSnapshot.valid) {
    const issues = formatConfigIssueLines(configSnapshot.issues, "-");
    defaultRuntime.error([t("update.error.invalidConfigSetChannel"), ...issues].join("\n"));
    defaultRuntime.exit(1);
    return;
  }

  const installKind = updateStatus.installKind;
  const switchToGit = requestedChannel === "dev" && installKind !== "git";
  const switchToPackage =
    requestedChannel !== null && requestedChannel !== "dev" && installKind === "git";
  const updateInstallKind = switchToGit ? "git" : switchToPackage ? "package" : installKind;
  const defaultChannel =
    updateInstallKind === "git" ? DEFAULT_GIT_CHANNEL : DEFAULT_PACKAGE_CHANNEL;
  const channel = requestedChannel ?? storedChannel ?? defaultChannel;

  const explicitTag = normalizeTag(opts.tag);
  let tag = explicitTag ?? channelToNpmTag(channel);
  let currentVersion: string | null = null;
  let targetVersion: string | null = null;
  let downgradeRisk = false;
  let fallbackToLatest = false;
  let packageInstallSpec: string | null = null;

  if (updateInstallKind !== "git") {
    currentVersion = switchToPackage ? null : await readPackageVersion(root);
    if (explicitTag) {
      targetVersion = await resolveTargetVersion(tag, timeoutMs);
    } else {
      targetVersion = await resolveNpmChannelTag({ channel, timeoutMs }).then((resolved) => {
        tag = resolved.tag;
        fallbackToLatest = channel === "beta" && resolved.tag === "latest";
        return resolved.version;
      });
    }
    const cmp =
      currentVersion && targetVersion ? compareSemverStrings(currentVersion, targetVersion) : null;
    downgradeRisk =
      canResolveRegistryVersionForPackageTarget(tag) &&
      !fallbackToLatest &&
      currentVersion != null &&
      (targetVersion == null || (cmp != null && cmp > 0));
    packageInstallSpec = resolveGlobalInstallSpec({
      packageName: DEFAULT_PACKAGE_NAME,
      tag,
      env: process.env,
    });
  }

  if (opts.dryRun) {
    const t = createCliTranslator(getActiveCliLocale());
    let mode: UpdateRunResult["mode"] = "unknown";
    if (updateInstallKind === "git") {
      mode = "git";
    } else if (updateInstallKind === "package") {
      mode = await resolveGlobalManager({
        root,
        installKind,
        timeoutMs: timeoutMs ?? 20 * 60_000,
      });
    }

    const actions: string[] = [];
    if (requestedChannel && requestedChannel !== storedChannel) {
      actions.push(t("update.dryRun.action.persistChannel", { channel: requestedChannel }));
    }
    if (switchToGit) {
      actions.push(t("update.dryRun.action.switchToGit"));
    } else if (switchToPackage) {
      actions.push(t("update.dryRun.action.switchToPackage", { mode }));
    } else if (updateInstallKind === "git") {
      actions.push(t("update.dryRun.action.gitFlow", { channel }));
    } else {
      actions.push(t("update.dryRun.action.packageFlow", { spec: packageInstallSpec ?? tag }));
    }
    actions.push(t("update.dryRun.action.pluginSync"));
    actions.push(t("update.dryRun.action.refreshCompletion"));
    actions.push(
      shouldRestart
        ? t("update.dryRun.action.restartAndDoctor")
        : t("update.dryRun.action.skipRestart"),
    );

    const notes: string[] = [];
    if (opts.tag && updateInstallKind === "git") {
      notes.push(t("update.dryRun.note.tagNpmOnly"));
    }
    if (fallbackToLatest) {
      notes.push(t("update.dryRun.note.betaFallback"));
    }
    if (explicitTag && !canResolveRegistryVersionForPackageTarget(tag)) {
      notes.push(t("update.dryRun.note.nonRegistrySpec"));
    }

    printDryRunPreview(
      {
        dryRun: true,
        root,
        installKind,
        mode,
        updateInstallKind,
        switchToGit,
        switchToPackage,
        restart: shouldRestart,
        requestedChannel,
        storedChannel,
        effectiveChannel: channel,
        tag: packageInstallSpec ?? tag,
        currentVersion,
        targetVersion,
        downgradeRisk,
        actions,
        notes,
      },
      Boolean(opts.json),
    );
    return;
  }

  if (downgradeRisk && !opts.yes) {
    if (!process.stdin.isTTY || opts.json) {
      defaultRuntime.error(
        [
          t("update.error.downgradeConfirmationRequired"),
          t("update.error.downgradeRequiresTty"),
        ].join("\n"),
      );
      defaultRuntime.exit(1);
      return;
    }

    const targetLabel = targetVersion ?? `${tag} (unknown)`;
    const message = t("update.prompt.downgradeContinue", {
      currentVersion: currentVersion ?? "unknown",
      targetVersion: targetLabel,
    });
    const ok = await confirm({
      message: stylePromptMessage(message),
      initialValue: false,
    });
    if (isCancel(ok) || !ok) {
      if (!opts.json) {
        defaultRuntime.log(theme.muted(t("ui.text.updateCancelled")));
      }
      defaultRuntime.exit(0);
      return;
    }
  }

  if (updateInstallKind === "git" && opts.tag && !opts.json) {
    defaultRuntime.log(theme.muted(t("update.note.tagNpmOnly")));
  }

  if (updateInstallKind === "package") {
    const runtimePreflightError = await resolvePackageRuntimePreflightError({
      tag,
      timeoutMs,
    });
    if (runtimePreflightError) {
      defaultRuntime.error(runtimePreflightError);
      defaultRuntime.exit(1);
      return;
    }
  }

  const showProgress = !opts.json && process.stdout.isTTY;
  if (!opts.json) {
    defaultRuntime.log(theme.heading(t("update.heading.updating")));
    defaultRuntime.log("");
  }

  const { progress, stop } = createUpdateProgress(showProgress);
  const startedAt = Date.now();

  let restartScriptPath: string | null = null;
  let refreshGatewayServiceEnv = false;
  const gatewayPort = resolveGatewayPort(
    configSnapshot.valid ? configSnapshot.config : undefined,
    process.env,
  );
  if (shouldRestart) {
    try {
      const loaded = await resolveGatewayService().isLoaded({ env: process.env });
      if (loaded) {
        restartScriptPath = await prepareRestartScript(process.env, gatewayPort);
        refreshGatewayServiceEnv = true;
      }
    } catch {
      // Ignore errors during pre-check; fallback to standard restart
    }
  }

  const result =
    updateInstallKind === "package"
      ? await runPackageInstallUpdate({
          root,
          installKind,
          tag,
          timeoutMs: timeoutMs ?? 20 * 60_000,
          startedAt,
          progress,
        })
      : await runGitUpdate({
          root,
          switchToGit,
          installKind,
          timeoutMs,
          startedAt,
          progress,
          channel,
          tag,
          showProgress,
          opts,
          stop,
        });

  stop();
  printResult(result, { ...opts, hideSteps: showProgress });

  if (result.status === "error") {
    defaultRuntime.exit(1);
    return;
  }

  if (result.status === "skipped") {
    if (result.reason === "dirty") {
      defaultRuntime.log(theme.warn(t("update.skip.dirty")));
    }
    if (result.reason === "not-git-install") {
      defaultRuntime.log(
        theme.warn(
          t("update.skip.notGitInstall", {
            doctor: replaceCliName(formatCliCommand("crawclaw doctor"), CLI_NAME),
            restart: replaceCliName(formatCliCommand("crawclaw gateway restart"), CLI_NAME),
          }),
        ),
      );
      defaultRuntime.log(
        theme.muted(
          t("update.skip.examples", {
            npm: replaceCliName("npm i -g crawclaw@latest", CLI_NAME),
            pnpm: replaceCliName("pnpm add -g crawclaw@latest", CLI_NAME),
          }),
        ),
      );
    }
    defaultRuntime.exit(0);
    return;
  }

  let postUpdateConfigSnapshot = configSnapshot;
  if (requestedChannel && configSnapshot.valid && requestedChannel !== storedChannel) {
    const next = {
      ...configSnapshot.config,
      update: {
        ...configSnapshot.config.update,
        channel: requestedChannel,
      },
    };
    await replaceConfigFile({
      nextConfig: next,
      baseHash: configSnapshot.hash,
    });
    postUpdateConfigSnapshot = {
      ...configSnapshot,
      hash: undefined,
      parsed: next,
      sourceConfig: asResolvedSourceConfig(next),
      resolved: asResolvedSourceConfig(next),
      runtimeConfig: asRuntimeConfig(next),
      config: asRuntimeConfig(next),
    };
    if (!opts.json) {
      defaultRuntime.log(theme.muted(t("update.channel.set", { channel: requestedChannel })));
    }
  }

  await updatePluginsAfterCoreUpdate({
    root,
    channel,
    configSnapshot: postUpdateConfigSnapshot,
    opts,
  });

  await tryWriteCompletionCache(root, Boolean(opts.json));
  await tryInstallShellCompletion({
    jsonMode: Boolean(opts.json),
    skipPrompt: Boolean(opts.yes),
  });

  await maybeRestartService({
    shouldRestart,
    result,
    opts,
    refreshServiceEnv: refreshGatewayServiceEnv,
    gatewayPort,
    restartScriptPath,
    invocationCwd,
  });

  if (!opts.json) {
    defaultRuntime.log(theme.muted(pickUpdateQuip()));
  }
}
