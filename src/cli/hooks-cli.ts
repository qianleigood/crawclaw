import type { Command } from "commander";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { CrawClawConfig } from "../config/config.js";
import { loadConfig, readConfigFileSnapshot, replaceConfigFile } from "../config/config.js";
import {
  buildWorkspaceHookStatus,
  type HookStatusEntry,
  type HookStatusReport,
} from "../hooks/hooks-status.js";
import { resolveHookEntries } from "../hooks/policy.js";
import type { HookEntry } from "../hooks/types.js";
import { loadWorkspaceHookEntries } from "../hooks/workspace.js";
import { buildPluginDiagnosticsReport } from "../plugins/status.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { getTerminalTableWidth, renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { shortenHomePath } from "../utils.js";
import { formatCliCommand } from "./command-format.js";
import { createCliTranslator, getActiveCliLocale } from "./i18n/index.js";
import { runPluginInstallCommand } from "./plugins-install-command.js";
import { runPluginUpdateCommand } from "./plugins-update-command.js";
import { getProgramContext } from "./program/program-context.js";

export type HooksListOptions = {
  json?: boolean;
  eligible?: boolean;
  verbose?: boolean;
};

export type HookInfoOptions = {
  json?: boolean;
};

export type HooksCheckOptions = {
  json?: boolean;
};

export type HooksUpdateOptions = {
  all?: boolean;
  dryRun?: boolean;
};

function mergeHookEntries(pluginEntries: HookEntry[], workspaceEntries: HookEntry[]): HookEntry[] {
  return resolveHookEntries([...pluginEntries, ...workspaceEntries]);
}

function buildHooksReport(config: CrawClawConfig): HookStatusReport {
  const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
  const workspaceEntries = loadWorkspaceHookEntries(workspaceDir, { config });
  const pluginReport = buildPluginDiagnosticsReport({ config, workspaceDir });
  const pluginEntries = pluginReport.hooks.map((hook) => hook.entry);
  const entries = mergeHookEntries(pluginEntries, workspaceEntries);
  return buildWorkspaceHookStatus(workspaceDir, { config, entries });
}

function getHooksTranslator() {
  return createCliTranslator(getActiveCliLocale());
}

function resolveHookForToggle(
  report: HookStatusReport,
  hookName: string,
  opts?: { requireEligible?: boolean },
): HookStatusEntry {
  const t = getHooksTranslator();
  const hook = report.hooks.find((h) => h.name === hookName);
  if (!hook) {
    throw new Error(t("hooks.runtime.error.notFound", { hook: hookName }));
  }
  if (hook.managedByPlugin) {
    throw new Error(
      t("hooks.runtime.error.managedByPlugin", {
        hook: hookName,
        pluginId: hook.pluginId ?? "unknown",
      }),
    );
  }
  if (opts?.requireEligible && !hook.requirementsSatisfied) {
    throw new Error(t("hooks.runtime.error.notEligible", { hook: hookName }));
  }
  return hook;
}

function buildConfigWithHookEnabled(params: {
  config: CrawClawConfig;
  hookName: string;
  enabled: boolean;
  ensureHooksEnabled?: boolean;
}): CrawClawConfig {
  const entries = { ...params.config.hooks?.internal?.entries };
  entries[params.hookName] = { ...entries[params.hookName], enabled: params.enabled };

  const internal = {
    ...params.config.hooks?.internal,
    ...(params.ensureHooksEnabled ? { enabled: true } : {}),
    entries,
  };

  return {
    ...params.config,
    hooks: {
      ...params.config.hooks,
      internal,
    },
  };
}

function formatHookStatus(hook: HookStatusEntry): string {
  const t = getHooksTranslator();
  if (hook.loadable) {
    return theme.success(`✓ ${t("hooks.runtime.status.ready")}`);
  }
  if (!hook.enabledByConfig) {
    return theme.warn(`⏸ ${t("hooks.runtime.status.disabled")}`);
  }
  return theme.error(`✗ ${t("hooks.runtime.status.missing")}`);
}

function formatHookName(hook: HookStatusEntry): string {
  const emoji = hook.emoji ?? "🔗";
  return `${emoji} ${theme.command(hook.name)}`;
}

function formatHookSource(hook: HookStatusEntry): string {
  if (!hook.managedByPlugin) {
    return hook.source;
  }
  return `plugin:${hook.pluginId ?? "unknown"}`;
}

function formatHookMissingSummary(hook: HookStatusEntry): string {
  const missing: string[] = [];
  if (hook.missing.bins.length > 0) {
    missing.push(`bins: ${hook.missing.bins.join(", ")}`);
  }
  if (hook.missing.anyBins.length > 0) {
    missing.push(`anyBins: ${hook.missing.anyBins.join(", ")}`);
  }
  if (hook.missing.env.length > 0) {
    missing.push(`env: ${hook.missing.env.join(", ")}`);
  }
  if (hook.missing.config.length > 0) {
    missing.push(`config: ${hook.missing.config.join(", ")}`);
  }
  if (hook.missing.os.length > 0) {
    missing.push(`os: ${hook.missing.os.join(", ")}`);
  }
  if (hook.missing.arch.length > 0) {
    missing.push(`arch: ${hook.missing.arch.join(", ")}`);
  }
  return missing.join("; ");
}

function exitHooksCliWithError(err: unknown): never {
  const t = getHooksTranslator();
  defaultRuntime.error(
    `${theme.error(t("hooks.runtime.label.error"))} ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

function writeHooksOutput(value: string, json: boolean | undefined): void {
  if (json) {
    defaultRuntime.writeStdout(value);
    return;
  }
  defaultRuntime.log(value);
}

async function runHooksCliAction(action: () => Promise<void> | void): Promise<void> {
  try {
    await action();
  } catch (err) {
    exitHooksCliWithError(err);
  }
}

/**
 * Format the hooks list output
 */
export function formatHooksList(report: HookStatusReport, opts: HooksListOptions): string {
  const t = getHooksTranslator();
  const hooks = opts.eligible ? report.hooks.filter((h) => h.loadable) : report.hooks;

  if (opts.json) {
    const jsonReport = {
      workspaceDir: report.workspaceDir,
      managedHooksDir: report.managedHooksDir,
      hooks: hooks.map((h) => ({
        name: h.name,
        description: h.description,
        emoji: h.emoji,
        eligible: h.loadable,
        disabled: !h.enabledByConfig,
        enabledByConfig: h.enabledByConfig,
        requirementsSatisfied: h.requirementsSatisfied,
        loadable: h.loadable,
        blockedReason: h.blockedReason,
        source: h.source,
        pluginId: h.pluginId,
        events: h.events,
        homepage: h.homepage,
        missing: h.missing,
        managedByPlugin: h.managedByPlugin,
      })),
    };
    return JSON.stringify(jsonReport, null, 2);
  }

  if (hooks.length === 0) {
    const message = opts.eligible
      ? t("hooks.runtime.empty.eligible", {
          command: formatCliCommand("crawclaw hooks list"),
        })
      : t("hooks.runtime.empty.all");
    return message;
  }

  const eligible = hooks.filter((h) => h.loadable);
  const tableWidth = getTerminalTableWidth();
  const rows = hooks.map((hook) => {
    const missing = formatHookMissingSummary(hook);
    return {
      status: formatHookStatus(hook),
      hook: formatHookName(hook),
      description: theme.muted(hook.description),
      source: formatHookSource(hook),
      missing: missing ? theme.warn(missing) : "",
    };
  });

  const columns = [
    { key: "status", header: t("table.header.status"), minWidth: 10 },
    { key: "hook", header: t("table.header.hook"), minWidth: 18, flex: true },
    { key: "description", header: t("table.header.description"), minWidth: 24, flex: true },
    { key: "source", header: t("table.header.source"), minWidth: 12, flex: true },
  ];
  if (opts.verbose) {
    columns.push({ key: "missing", header: t("table.header.missing"), minWidth: 18, flex: true });
  }

  const lines: string[] = [];
  lines.push(
    `${theme.heading(t("table.header.hooks"))} ${theme.muted(
      t("hooks.runtime.summary.readyCount", {
        ready: eligible.length,
        total: hooks.length,
      }),
    )}`,
  );
  lines.push(
    renderTable({
      width: tableWidth,
      columns,
      rows,
    }).trimEnd(),
  );
  return lines.join("\n");
}

/**
 * Format detailed info for a single hook
 */
export function formatHookInfo(
  report: HookStatusReport,
  hookName: string,
  opts: HookInfoOptions,
): string {
  const t = getHooksTranslator();
  const hook = report.hooks.find((h) => h.name === hookName || h.hookKey === hookName);

  if (!hook) {
    if (opts.json) {
      return JSON.stringify({ error: "not found", hook: hookName }, null, 2);
    }
    return t("hooks.runtime.error.notFoundWithList", {
      hook: hookName,
      command: formatCliCommand("crawclaw hooks list"),
    });
  }

  if (opts.json) {
    return JSON.stringify(
      {
        ...hook,
        eligible: hook.loadable,
        disabled: !hook.enabledByConfig,
      },
      null,
      2,
    );
  }

  const lines: string[] = [];
  const emoji = hook.emoji ?? "🔗";
  const status = hook.loadable
    ? theme.success(`✓ ${t("hooks.runtime.status.infoReady")}`)
    : !hook.enabledByConfig
      ? theme.warn(`⏸ ${t("hooks.runtime.status.infoDisabled")}`)
      : theme.error(`✗ ${t("hooks.runtime.status.infoMissingRequirements")}`);

  lines.push(`${emoji} ${theme.heading(hook.name)} ${status}`);
  lines.push("");
  lines.push(hook.description);
  lines.push("");

  // Details
  lines.push(theme.heading(t("hooks.runtime.section.details")));
  if (hook.managedByPlugin) {
    lines.push(
      `${theme.muted(`  ${t("table.header.source")}:`)} ${hook.source} (${hook.pluginId ?? "unknown"})`,
    );
  } else {
    lines.push(`${theme.muted(`  ${t("table.header.source")}:`)} ${hook.source}`);
  }
  lines.push(
    `${theme.muted(`  ${t("hooks.runtime.label.path")}:`)} ${shortenHomePath(hook.filePath)}`,
  );
  lines.push(
    `${theme.muted(`  ${t("hooks.runtime.label.handler")}:`)} ${shortenHomePath(hook.handlerPath)}`,
  );
  if (hook.homepage) {
    lines.push(`${theme.muted(`  ${t("hooks.runtime.label.homepage")}:`)} ${hook.homepage}`);
  }
  if (hook.events.length > 0) {
    lines.push(`${theme.muted(`  ${t("hooks.runtime.label.events")}:`)} ${hook.events.join(", ")}`);
  }
  if (hook.managedByPlugin) {
    lines.push(theme.muted(`  ${t("hooks.runtime.info.managedByPlugin")}`));
  }
  if (hook.blockedReason) {
    lines.push(
      `${theme.muted(`  ${t("hooks.runtime.label.blockedReason")}:`)} ${hook.blockedReason}`,
    );
  }

  // Requirements
  const hasRequirements =
    hook.requirements.bins.length > 0 ||
    hook.requirements.anyBins.length > 0 ||
    hook.requirements.env.length > 0 ||
    hook.requirements.config.length > 0 ||
    hook.requirements.os.length > 0 ||
    hook.requirements.arch.length > 0;

  if (hasRequirements) {
    lines.push("");
    lines.push(theme.heading(t("hooks.runtime.section.requirements")));
    if (hook.requirements.bins.length > 0) {
      const binsStatus = hook.requirements.bins.map((bin) => {
        const missing = hook.missing.bins.includes(bin);
        return missing ? theme.error(`✗ ${bin}`) : theme.success(`✓ ${bin}`);
      });
      lines.push(
        `${theme.muted(`  ${t("hooks.runtime.label.binaries")}:`)} ${binsStatus.join(", ")}`,
      );
    }
    if (hook.requirements.anyBins.length > 0) {
      const anyBinsStatus =
        hook.missing.anyBins.length > 0
          ? theme.error(
              `✗ (${t("hooks.runtime.label.anyOf")}: ${hook.requirements.anyBins.join(", ")})`,
            )
          : theme.success(
              `✓ (${t("hooks.runtime.label.anyOf")}: ${hook.requirements.anyBins.join(", ")})`,
            );
      lines.push(`${theme.muted(`  ${t("hooks.runtime.label.anyBinary")}:`)} ${anyBinsStatus}`);
    }
    if (hook.requirements.env.length > 0) {
      const envStatus = hook.requirements.env.map((env) => {
        const missing = hook.missing.env.includes(env);
        return missing ? theme.error(`✗ ${env}`) : theme.success(`✓ ${env}`);
      });
      lines.push(
        `${theme.muted(`  ${t("hooks.runtime.label.environment")}:`)} ${envStatus.join(", ")}`,
      );
    }
    if (hook.requirements.config.length > 0) {
      const configStatus = hook.configChecks.map((check) => {
        return check.satisfied ? theme.success(`✓ ${check.path}`) : theme.error(`✗ ${check.path}`);
      });
      lines.push(
        `${theme.muted(`  ${t("hooks.runtime.label.config")}:`)} ${configStatus.join(", ")}`,
      );
    }
    if (hook.requirements.os.length > 0) {
      const osStatus =
        hook.missing.os.length > 0
          ? theme.error(`✗ (${hook.requirements.os.join(", ")})`)
          : theme.success(`✓ (${hook.requirements.os.join(", ")})`);
      lines.push(`${theme.muted(`  ${t("hooks.runtime.label.os")}:`)} ${osStatus}`);
    }
    if (hook.requirements.arch.length > 0) {
      const archStatus =
        hook.missing.arch.length > 0
          ? theme.error(`✗ (${hook.requirements.arch.join(", ")})`)
          : theme.success(`✓ (${hook.requirements.arch.join(", ")})`);
      lines.push(`${theme.muted("  Arch:")} ${archStatus}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format check output
 */
export function formatHooksCheck(report: HookStatusReport, opts: HooksCheckOptions): string {
  const t = getHooksTranslator();
  if (opts.json) {
    const eligible = report.hooks.filter((h) => h.loadable);
    const notEligible = report.hooks.filter((h) => !h.loadable);
    return JSON.stringify(
      {
        total: report.hooks.length,
        eligible: eligible.length,
        notEligible: notEligible.length,
        hooks: {
          eligible: eligible.map((h) => h.name),
          notEligible: notEligible.map((h) => ({
            name: h.name,
            blockedReason: h.blockedReason,
            missing: h.missing,
          })),
        },
      },
      null,
      2,
    );
  }

  const eligible = report.hooks.filter((h) => h.loadable);
  const notEligible = report.hooks.filter((h) => !h.loadable);

  const lines: string[] = [];
  lines.push(theme.heading(t("hooks.runtime.heading.status")));
  lines.push("");
  lines.push(`${theme.muted(`${t("hooks.runtime.label.totalHooks")}:`)} ${report.hooks.length}`);
  lines.push(`${theme.success(`${t("hooks.runtime.label.ready")}:`)} ${eligible.length}`);
  lines.push(`${theme.warn(`${t("hooks.runtime.label.notReady")}:`)} ${notEligible.length}`);

  if (notEligible.length > 0) {
    lines.push("");
    lines.push(theme.heading(t("hooks.runtime.heading.notReady")));
    for (const hook of notEligible) {
      const reasons = [];
      if (hook.blockedReason && hook.blockedReason !== "missing requirements") {
        reasons.push(hook.blockedReason);
      }
      if (hook.missing.bins.length > 0) {
        reasons.push(`bins: ${hook.missing.bins.join(", ")}`);
      }
      if (hook.missing.anyBins.length > 0) {
        reasons.push(`anyBins: ${hook.missing.anyBins.join(", ")}`);
      }
      if (hook.missing.env.length > 0) {
        reasons.push(`env: ${hook.missing.env.join(", ")}`);
      }
      if (hook.missing.config.length > 0) {
        reasons.push(`config: ${hook.missing.config.join(", ")}`);
      }
      if (hook.missing.os.length > 0) {
        reasons.push(`os: ${hook.missing.os.join(", ")}`);
      }
      if (hook.missing.arch.length > 0) {
        reasons.push(`arch: ${hook.missing.arch.join(", ")}`);
      }
      lines.push(`  ${hook.emoji ?? "🔗"} ${hook.name} - ${reasons.join("; ")}`);
    }
  }

  return lines.join("\n");
}

export async function enableHook(hookName: string): Promise<void> {
  const t = getHooksTranslator();
  const snapshot = await readConfigFileSnapshot();
  const config = (snapshot.sourceConfig ?? snapshot.runtimeConfig) as CrawClawConfig;
  const hook = resolveHookForToggle(buildHooksReport(config), hookName, { requireEligible: true });
  const nextConfig = buildConfigWithHookEnabled({
    config,
    hookName,
    enabled: true,
    ensureHooksEnabled: true,
  });

  await replaceConfigFile({
    nextConfig,
    ...(snapshot.hash !== undefined ? { baseHash: snapshot.hash } : {}),
  });
  defaultRuntime.log(
    `${theme.success("✓")} ${t("hooks.runtime.action.enabled")}: ${hook.emoji ?? "🔗"} ${theme.command(hookName)}`,
  );
}

export async function disableHook(hookName: string): Promise<void> {
  const t = getHooksTranslator();
  const snapshot = await readConfigFileSnapshot();
  const config = (snapshot.sourceConfig ?? snapshot.runtimeConfig) as CrawClawConfig;
  const hook = resolveHookForToggle(buildHooksReport(config), hookName);
  const nextConfig = buildConfigWithHookEnabled({ config, hookName, enabled: false });

  await replaceConfigFile({
    nextConfig,
    ...(snapshot.hash !== undefined ? { baseHash: snapshot.hash } : {}),
  });
  defaultRuntime.log(
    `${theme.warn("⏸")} ${t("hooks.runtime.action.disabled")}: ${hook.emoji ?? "🔗"} ${theme.command(hookName)}`,
  );
}

export function registerHooksCli(program: Command): void {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const hooks = program
    .command("hooks")
    .description(t("command.hooks.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/hooks", "docs.crawclaw.ai/cli/hooks")}\n`,
    );

  hooks
    .command("list")
    .description(t("command.hooks.list.description"))
    .option("--eligible", t("command.hooks.list.option.eligible"), false)
    .option("--json", t("command.hooks.option.json"), false)
    .option("-v, --verbose", t("command.hooks.list.option.verbose"), false)
    .action(async (opts) =>
      runHooksCliAction(async () => {
        const config = loadConfig();
        const report = buildHooksReport(config);
        writeHooksOutput(formatHooksList(report, opts), opts.json);
      }),
    );

  hooks
    .command("info <name>")
    .description(t("command.hooks.info.description"))
    .option("--json", t("command.hooks.option.json"), false)
    .action(async (name, opts) =>
      runHooksCliAction(async () => {
        const config = loadConfig();
        const report = buildHooksReport(config);
        writeHooksOutput(formatHookInfo(report, name, opts), opts.json);
      }),
    );

  hooks
    .command("check")
    .description(t("command.hooks.check.description"))
    .option("--json", t("command.hooks.option.json"), false)
    .action(async (opts) =>
      runHooksCliAction(async () => {
        const config = loadConfig();
        const report = buildHooksReport(config);
        writeHooksOutput(formatHooksCheck(report, opts), opts.json);
      }),
    );

  hooks
    .command("enable <name>")
    .description(t("command.hooks.enable.description"))
    .action(async (name) =>
      runHooksCliAction(async () => {
        await enableHook(name);
      }),
    );

  hooks
    .command("disable <name>")
    .description(t("command.hooks.disable.description"))
    .action(async (name) =>
      runHooksCliAction(async () => {
        await disableHook(name);
      }),
    );

  hooks
    .command("install")
    .description(t("command.hooks.install.description"))
    .argument("<path-or-spec>", t("command.hooks.install.argument.pathOrSpec"))
    .option("-l, --link", t("command.hooks.install.option.link"), false)
    .option("--pin", t("command.hooks.install.option.pin"), false)
    .action(async (raw: string, opts: { link?: boolean; pin?: boolean }) => {
      defaultRuntime.log(theme.warn(getHooksTranslator()("hooks.runtime.deprecated.install")));
      await runPluginInstallCommand({ raw, opts });
    });

  hooks
    .command("update")
    .description(t("command.hooks.update.description"))
    .argument("[id]", t("command.hooks.update.argument.id"))
    .option("--all", t("command.hooks.update.option.all"), false)
    .option("--dry-run", t("command.hooks.update.option.dryRun"), false)
    .action(async (id: string | undefined, opts: HooksUpdateOptions) => {
      defaultRuntime.log(theme.warn(t("hooks.runtime.deprecated.update")));
      await runPluginUpdateCommand({ id, opts });
    });

  hooks.action(async () =>
    runHooksCliAction(async () => {
      const config = loadConfig();
      const report = buildHooksReport(config);
      defaultRuntime.log(formatHooksList(report, {}));
    }),
  );
}
