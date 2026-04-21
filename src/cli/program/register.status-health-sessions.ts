import type { Command } from "commander";
import { flowsCancelCommand, flowsListCommand, flowsShowCommand } from "../../commands/flows.js";
import { healthCommand } from "../../commands/health.js";
import { sessionsCleanupCommand } from "../../commands/sessions-cleanup.js";
import { sessionsCommand } from "../../commands/sessions.js";
import { statusCommand } from "../../commands/status.js";
import {
  tasksAuditCommand,
  tasksCancelCommand,
  tasksListCommand,
  tasksMaintenanceCommand,
  tasksNotifyCommand,
  tasksShowCommand,
} from "../../commands/tasks.js";
import { setVerbose } from "../../globals.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";
import { createCliTranslator } from "../i18n/index.js";
import { parsePositiveIntOrUndefined } from "./helpers.js";
import { getProgramContext } from "./program-context.js";

function resolveVerbose(opts: { verbose?: boolean; debug?: boolean }): boolean {
  return Boolean(opts.verbose || opts.debug);
}

function parseTimeoutMs(timeout: unknown): number | null | undefined {
  const parsed = parsePositiveIntOrUndefined(timeout);
  if (timeout !== undefined && parsed === undefined) {
    defaultRuntime.error("--timeout must be a positive integer (milliseconds)");
    defaultRuntime.exit(1);
    return null;
  }
  return parsed;
}

async function runWithVerboseAndTimeout(
  opts: { verbose?: boolean; debug?: boolean; timeout?: unknown },
  action: (params: { verbose: boolean; timeoutMs: number | undefined }) => Promise<void>,
): Promise<void> {
  const verbose = resolveVerbose(opts);
  setVerbose(verbose);
  const timeoutMs = parseTimeoutMs(opts.timeout);
  if (timeoutMs === null) {
    return;
  }
  await runCommandWithRuntime(defaultRuntime, async () => {
    await action({ verbose, timeoutMs });
  });
}

export function registerStatusHealthSessionsCommands(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  program
    .command("status")
    .description(t("command.status.description"))
    .option("--json", t("command.status.option.json"), false)
    .option("--all", t("command.status.option.all"), false)
    .option("--usage", t("command.status.option.usage"), false)
    .option("--deep", t("command.status.option.deep"), false)
    .option("--timeout <ms>", t("command.status.option.timeout"), "10000")
    .option("--verbose", t("command.status.option.verbose"), false)
    .option("--debug", t("command.status.option.debug"), false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          ["crawclaw status", t("command.status.example.summary")],
          ["crawclaw status --all", t("command.status.example.all")],
          ["crawclaw status --json", t("command.status.example.json")],
          ["crawclaw status --usage", t("command.status.example.usage")],
          ["crawclaw status --deep", t("command.status.example.deep")],
          ["crawclaw status --deep --timeout 5000", t("command.status.example.deepTimeout")],
        ])}`,
    )
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/status", "docs.crawclaw.ai/cli/status")}\n`,
    )
    .action(async (opts) => {
      await runWithVerboseAndTimeout(opts, async ({ verbose, timeoutMs }) => {
        await statusCommand(
          {
            json: Boolean(opts.json),
            all: Boolean(opts.all),
            deep: Boolean(opts.deep),
            usage: Boolean(opts.usage),
            timeoutMs,
            verbose,
          },
          defaultRuntime,
        );
      });
    });

  program
    .command("health")
    .description(t("command.health.description"))
    .option("--json", t("command.health.option.json"), false)
    .option("--timeout <ms>", t("command.health.option.timeout"), "10000")
    .option("--verbose", t("command.health.option.verbose"), false)
    .option("--debug", t("command.health.option.debug"), false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/health", "docs.crawclaw.ai/cli/health")}\n`,
    )
    .action(async (opts) => {
      await runWithVerboseAndTimeout(opts, async ({ verbose, timeoutMs }) => {
        await healthCommand(
          {
            json: Boolean(opts.json),
            timeoutMs,
            verbose,
          },
          defaultRuntime,
        );
      });
    });

  const sessionsCmd = program
    .command("sessions")
    .description(t("command.sessions.description"))
    .option("--json", t("command.sessions.option.json"), false)
    .option("--verbose", t("command.sessions.option.verbose"), false)
    .option("--store <path>", t("command.sessions.option.store"))
    .option("--agent <id>", t("command.sessions.option.agent"))
    .option("--all-agents", t("command.sessions.option.allAgents"), false)
    .option("--active <minutes>", t("command.sessions.option.active"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          ["crawclaw sessions", t("command.sessions.example.list")],
          ["crawclaw sessions --agent work", t("command.sessions.example.agent")],
          ["crawclaw sessions --all-agents", t("command.sessions.example.allAgents")],
          ["crawclaw sessions --active 120", t("command.sessions.example.active")],
          ["crawclaw sessions --json", t("command.sessions.example.json")],
          ["crawclaw sessions --store ./tmp/sessions.json", t("command.sessions.example.store")],
        ])}\n\n${theme.muted(t("command.sessions.help.tokenUsage"))}`,
    )
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/sessions", "docs.crawclaw.ai/cli/sessions")}\n`,
    )
    .action(async (opts) => {
      setVerbose(Boolean(opts.verbose));
      await sessionsCommand(
        {
          json: Boolean(opts.json),
          store: opts.store as string | undefined,
          agent: opts.agent as string | undefined,
          allAgents: Boolean(opts.allAgents),
          active: opts.active as string | undefined,
        },
        defaultRuntime,
      );
    });
  sessionsCmd.enablePositionalOptions();

  sessionsCmd
    .command("cleanup")
    .description(t("command.sessions.cleanup.description"))
    .option("--store <path>", t("command.sessions.cleanup.option.store"))
    .option("--agent <id>", t("command.sessions.cleanup.option.agent"))
    .option("--all-agents", t("command.sessions.cleanup.option.allAgents"), false)
    .option("--dry-run", t("command.sessions.cleanup.option.dryRun"), false)
    .option("--enforce", t("command.sessions.cleanup.option.enforce"), false)
    .option("--fix-missing", t("command.sessions.cleanup.option.fixMissing"), false)
    .option("--active-key <key>", t("command.sessions.cleanup.option.activeKey"))
    .option("--json", t("command.sessions.cleanup.option.json"), false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          ["crawclaw sessions cleanup --dry-run", t("command.sessions.cleanup.example.dryRun")],
          [
            "crawclaw sessions cleanup --dry-run --fix-missing",
            t("command.sessions.cleanup.example.fixMissing"),
          ],
          ["crawclaw sessions cleanup --enforce", t("command.sessions.cleanup.example.enforce")],
          [
            "crawclaw sessions cleanup --agent work --dry-run",
            t("command.sessions.cleanup.example.agent"),
          ],
          [
            "crawclaw sessions cleanup --all-agents --dry-run",
            t("command.sessions.cleanup.example.allAgents"),
          ],
          [
            "crawclaw sessions cleanup --enforce --store ./tmp/sessions.json",
            t("command.sessions.cleanup.example.store"),
          ],
        ])}`,
    )
    .action(async (opts, command) => {
      const parentOpts = command.parent?.opts() as
        | {
            store?: string;
            agent?: string;
            allAgents?: boolean;
            json?: boolean;
          }
        | undefined;
      await runCommandWithRuntime(defaultRuntime, async () => {
        await sessionsCleanupCommand(
          {
            store: (opts.store as string | undefined) ?? parentOpts?.store,
            agent: (opts.agent as string | undefined) ?? parentOpts?.agent,
            allAgents: Boolean(opts.allAgents || parentOpts?.allAgents),
            dryRun: Boolean(opts.dryRun),
            enforce: Boolean(opts.enforce),
            fixMissing: Boolean(opts.fixMissing),
            activeKey: opts.activeKey as string | undefined,
            json: Boolean(opts.json || parentOpts?.json),
          },
          defaultRuntime,
        );
      });
    });

  const tasksCmd = program
    .command("tasks")
    .description(t("command.tasks.description"))
    .option("--json", t("command.tasks.option.json"), false)
    .option("--runtime <name>", t("command.tasks.option.runtime"))
    .option("--status <name>", t("command.tasks.option.status"))
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await tasksListCommand(
          {
            json: Boolean(opts.json),
            runtime: opts.runtime as string | undefined,
            status: opts.status as string | undefined,
          },
          defaultRuntime,
        );
      });
    });
  tasksCmd.enablePositionalOptions();

  tasksCmd
    .command("list")
    .description(t("command.tasks.list.description"))
    .option("--json", t("command.tasks.option.json"), false)
    .option("--runtime <name>", t("command.tasks.option.runtime"))
    .option("--status <name>", t("command.tasks.option.status"))
    .action(async (opts, command) => {
      const parentOpts = command.parent?.opts() as
        | {
            json?: boolean;
            runtime?: string;
            status?: string;
          }
        | undefined;
      await runCommandWithRuntime(defaultRuntime, async () => {
        await tasksListCommand(
          {
            json: Boolean(opts.json || parentOpts?.json),
            runtime: (opts.runtime as string | undefined) ?? parentOpts?.runtime,
            status: (opts.status as string | undefined) ?? parentOpts?.status,
          },
          defaultRuntime,
        );
      });
    });

  tasksCmd
    .command("audit")
    .description(t("command.tasks.audit.description"))
    .option("--json", t("command.tasks.option.json"), false)
    .option("--severity <level>", t("command.tasks.audit.option.severity"))
    .option("--code <name>", t("command.tasks.audit.option.code"))
    .option("--limit <n>", t("command.tasks.audit.option.limit"))
    .action(async (opts, command) => {
      const parentOpts = command.parent?.opts() as { json?: boolean } | undefined;
      await runCommandWithRuntime(defaultRuntime, async () => {
        await tasksAuditCommand(
          {
            json: Boolean(opts.json || parentOpts?.json),
            severity: opts.severity as "warn" | "error" | undefined,
            code: opts.code as
              | "stale_queued"
              | "stale_running"
              | "lost"
              | "delivery_failed"
              | "missing_cleanup"
              | "inconsistent_timestamps"
              | "restore_failed"
              | "stale_waiting"
              | "stale_blocked"
              | "cancel_stuck"
              | "missing_linked_tasks"
              | "blocked_task_missing"
              | undefined,
            limit: parsePositiveIntOrUndefined(opts.limit),
          },
          defaultRuntime,
        );
      });
    });

  tasksCmd
    .command("maintenance")
    .description(t("command.tasks.maintenance.description"))
    .option("--json", t("command.tasks.option.json"), false)
    .option("--apply", t("command.tasks.maintenance.option.apply"), false)
    .action(async (opts, command) => {
      const parentOpts = command.parent?.opts() as { json?: boolean } | undefined;
      await runCommandWithRuntime(defaultRuntime, async () => {
        await tasksMaintenanceCommand(
          {
            json: Boolean(opts.json || parentOpts?.json),
            apply: Boolean(opts.apply),
          },
          defaultRuntime,
        );
      });
    });

  tasksCmd
    .command("show")
    .description(t("command.tasks.show.description"))
    .argument("<lookup>", t("command.tasks.argument.lookup"))
    .option("--json", t("command.tasks.option.json"), false)
    .action(async (lookup, opts, command) => {
      const parentOpts = command.parent?.opts() as { json?: boolean } | undefined;
      await runCommandWithRuntime(defaultRuntime, async () => {
        await tasksShowCommand(
          {
            lookup,
            json: Boolean(opts.json || parentOpts?.json),
          },
          defaultRuntime,
        );
      });
    });

  tasksCmd
    .command("notify")
    .description(t("command.tasks.notify.description"))
    .argument("<lookup>", t("command.tasks.argument.lookup"))
    .argument("<notify>", t("command.tasks.notify.argument.notify"))
    .action(async (lookup, notify) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await tasksNotifyCommand(
          {
            lookup,
            notify: notify as "done_only" | "state_changes" | "silent",
          },
          defaultRuntime,
        );
      });
    });

  tasksCmd
    .command("cancel")
    .description(t("command.tasks.cancel.description"))
    .argument("<lookup>", t("command.tasks.argument.lookup"))
    .action(async (lookup) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await tasksCancelCommand(
          {
            lookup,
          },
          defaultRuntime,
        );
      });
    });

  const tasksFlowCmd = tasksCmd.command("flow").description(t("command.tasks.flow.description"));

  tasksFlowCmd
    .command("list")
    .description(t("command.tasks.flow.list.description"))
    .option("--json", t("command.tasks.option.json"), false)
    .option("--status <name>", t("command.tasks.flow.option.status"))
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await flowsListCommand(
          {
            json: Boolean(opts.json),
            status: opts.status as string | undefined,
          },
          defaultRuntime,
        );
      });
    });

  tasksFlowCmd
    .command("show")
    .description(t("command.tasks.flow.show.description"))
    .argument("<lookup>", t("command.tasks.flow.argument.lookup"))
    .option("--json", t("command.tasks.option.json"), false)
    .action(async (lookup, opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await flowsShowCommand(
          {
            lookup,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  tasksFlowCmd
    .command("cancel")
    .description(t("command.tasks.flow.cancel.description"))
    .argument("<lookup>", t("command.tasks.flow.argument.lookup"))
    .action(async (lookup) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await flowsCancelCommand(
          {
            lookup,
          },
          defaultRuntime,
        );
      });
    });
}
