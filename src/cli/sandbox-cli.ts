import type { Command } from "commander";
import { sandboxExplainCommand } from "../commands/sandbox-explain.js";
import { sandboxListCommand, sandboxRecreateCommand } from "../commands/sandbox.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { formatHelpExamples, type HelpExample } from "./help-format.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

// --- Types ---

type CommandOptions = Record<string, unknown>;

// --- Helpers ---

const SANDBOX_EXAMPLES = {
  main: [
    ["crawclaw sandbox list", "List all sandbox containers."],
    ["crawclaw sandbox list --browser", "List only browser containers."],
    ["crawclaw sandbox recreate --all", "Recreate all containers."],
    ["crawclaw sandbox recreate --session main", "Recreate a specific session."],
    ["crawclaw sandbox recreate --agent mybot", "Recreate agent containers."],
    ["crawclaw sandbox explain", "Explain effective sandbox config."],
  ],
  list: [
    ["crawclaw sandbox list", "List all sandbox containers."],
    ["crawclaw sandbox list --browser", "List only browser containers."],
    ["crawclaw sandbox list --json", "JSON output."],
  ],
  recreate: [
    ["crawclaw sandbox recreate --all", "Recreate all containers."],
    ["crawclaw sandbox recreate --session main", "Recreate a specific session."],
    ["crawclaw sandbox recreate --agent mybot", "Recreate a specific agent (includes sub-agents)."],
    ["crawclaw sandbox recreate --browser --all", "Recreate only browser containers."],
    ["crawclaw sandbox recreate --all --force", "Skip confirmation."],
  ],
  explain: [
    ["crawclaw sandbox explain", "Show effective sandbox config."],
    ["crawclaw sandbox explain --session agent:main:main", "Explain a specific session."],
    ["crawclaw sandbox explain --agent work", "Explain an agent sandbox."],
    ["crawclaw sandbox explain --json", "JSON output."],
  ],
} as const;

function createRunner(
  commandFn: (opts: CommandOptions, runtime: typeof defaultRuntime) => Promise<void>,
) {
  return async (opts: CommandOptions) => {
    try {
      await commandFn(opts, defaultRuntime);
    } catch (err) {
      defaultRuntime.error(String(err));
      defaultRuntime.exit(1);
    }
  };
}

// --- Registration ---

export function registerSandboxCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const localizeExamples = (
    examples: ReadonlyArray<readonly [string, string]>,
    keys: readonly string[],
  ): HelpExample[] =>
    examples.map(([cmd], index) => [cmd, t(keys[index] ?? keys[0] ?? "cli.help.examplesHeading")]);
  const sandboxExamples = {
    main: localizeExamples(SANDBOX_EXAMPLES.main, [
      "command.sandbox.example.list",
      "command.sandbox.example.listBrowser",
      "command.sandbox.example.recreateAll",
      "command.sandbox.example.recreateSession",
      "command.sandbox.example.recreateAgent",
      "command.sandbox.example.explain",
    ]),
    list: localizeExamples(SANDBOX_EXAMPLES.list, [
      "command.sandbox.example.list",
      "command.sandbox.example.listBrowser",
      "command.sandbox.example.json",
    ]),
    recreate: localizeExamples(SANDBOX_EXAMPLES.recreate, [
      "command.sandbox.example.recreateAll",
      "command.sandbox.example.recreateSession",
      "command.sandbox.example.recreateAgentSpecific",
      "command.sandbox.example.recreateBrowser",
      "command.sandbox.example.force",
    ]),
    explain: localizeExamples(SANDBOX_EXAMPLES.explain, [
      "command.sandbox.example.explainConfig",
      "command.sandbox.example.explainSession",
      "command.sandbox.example.explainAgent",
      "command.sandbox.example.json",
    ]),
  } as const;
  const sandbox = program
    .command("sandbox")
    .description(t("command.sandbox.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples(sandboxExamples.main)}\n`,
    )
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/sandbox", "docs.crawclaw.ai/cli/sandbox")}\n`,
    )
    .action(() => {
      sandbox.help({ error: true });
    });

  // --- List Command ---

  sandbox
    .command("list")
    .description(t("command.sandbox.list.description"))
    .option("--json", t("command.sandbox.option.json"), false)
    .option("--browser", t("command.sandbox.list.option.browser"), false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples(sandboxExamples.list)}\n\n${theme.heading(
          t("command.sandbox.help.outputIncludes"),
        )}\n${theme.muted("- Container name and status (running/stopped)")}\n${theme.muted(
          "- Docker image and whether it matches current config",
        )}\n${theme.muted("- Age (time since creation)")}\n${theme.muted(
          "- Idle time (time since last use)",
        )}\n${theme.muted("- Associated session/agent ID")}`,
    )
    .action(
      createRunner((opts) =>
        sandboxListCommand(
          {
            browser: Boolean(opts.browser),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        ),
      ),
    );

  // --- Recreate Command ---

  sandbox
    .command("recreate")
    .description(t("command.sandbox.recreate.description"))
    .option("--all", t("command.sandbox.recreate.option.all"), false)
    .option("--session <key>", t("command.sandbox.recreate.option.session"))
    .option("--agent <id>", t("command.sandbox.recreate.option.agent"))
    .option("--browser", t("command.sandbox.recreate.option.browser"), false)
    .option("--force", t("command.sandbox.recreate.option.force"), false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples(sandboxExamples.recreate)}\n\n${theme.heading(
          t("command.sandbox.help.whyUseThis"),
        )}\n${theme.muted(
          "After updating Docker images or sandbox configuration, existing containers continue running with old settings.",
        )}\n${theme.muted(
          "This command removes them so they'll be recreated automatically with current config when next needed.",
        )}\n\n${theme.heading(t("command.sandbox.help.filterOptions"))}\n${theme.muted(
          "  --all          Remove all sandbox containers",
        )}\n${theme.muted(
          "  --session      Remove container for specific session key",
        )}\n${theme.muted(
          "  --agent        Remove containers for agent (includes agent:id:* variants)",
        )}\n\n${theme.heading(t("command.sandbox.help.modifiers"))}\n${theme.muted(
          "  --browser      Only affect browser containers (not regular sandbox)",
        )}\n${theme.muted("  --force        Skip confirmation prompt")}`,
    )
    .action(
      createRunner((opts) =>
        sandboxRecreateCommand(
          {
            all: Boolean(opts.all),
            session: opts.session as string | undefined,
            agent: opts.agent as string | undefined,
            browser: Boolean(opts.browser),
            force: Boolean(opts.force),
          },
          defaultRuntime,
        ),
      ),
    );

  // --- Explain Command ---

  sandbox
    .command("explain")
    .description(t("command.sandbox.explain.description"))
    .option("--session <key>", t("command.sandbox.explain.option.session"))
    .option("--agent <id>", t("command.sandbox.explain.option.agent"))
    .option("--json", t("command.sandbox.option.json"), false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples(sandboxExamples.explain)}\n`,
    )
    .action(
      createRunner((opts) =>
        sandboxExplainCommand(
          {
            session: opts.session as string | undefined,
            agent: opts.agent as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        ),
      ),
    );
}
