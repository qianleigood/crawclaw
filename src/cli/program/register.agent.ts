import type { Command } from "commander";
import { agentCliCommand } from "../../commands/agent-via-gateway.js";
import { agentExportContextCommand } from "../../commands/agent.export-context.js";
import { agentInspectCommand } from "../../commands/agent.inspect.js";
import {
  agentsAddCommand,
  agentsBindingsCommand,
  agentsBindCommand,
  agentsDeleteCommand,
  agentsHarnessPromoteCheckCommand,
  agentsHarnessReportCommand,
  agentsListCommand,
  agentsSetIdentityCommand,
  agentsStatusCommand,
  agentsUnbindCommand,
} from "../../commands/agents.js";
import { setVerbose } from "../../globals.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { hasExplicitOptions } from "../command-options.js";
import { createDefaultDeps } from "../deps.js";
import { formatHelpExamples } from "../help-format.js";
import { createCliTranslator } from "../i18n/index.js";
import { collectOption } from "./helpers.js";
import { getProgramContext } from "./program-context.js";

export function registerAgentCommands(program: Command, args: { agentChannelOptions: string }) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const agent = program
    .command("agent")
    .description(t("command.agent.description"))
    .option("-m, --message <text>", t("command.agent.option.message"))
    .option("-t, --to <number>", t("command.agent.option.to"))
    .option("--session-id <id>", t("command.agent.option.sessionId"))
    .option("--agent <id>", t("command.agent.option.agent"))
    .option("--thinking <level>", t("command.agent.option.thinking"))
    .option("--verbose <on|off>", t("command.agent.option.verbose"))
    .option(
      "--channel <channel>",
      t("command.agent.option.channel", { channels: args.agentChannelOptions }),
    )
    .option("--reply-to <target>", t("command.agent.option.replyTo"))
    .option("--reply-channel <channel>", t("command.agent.option.replyChannel"))
    .option("--reply-account <id>", t("command.agent.option.replyAccount"))
    .option("--local", t("command.agent.option.local"), false)
    .option("--deliver", t("command.agent.option.deliver"), false)
    .option("--json", t("command.agent.option.json"), false)
    .option("--timeout <seconds>", t("command.agent.option.timeout"))
    .addHelpText(
      "after",
      () =>
        `
${theme.heading(t("cli.help.examplesHeading"))}
${formatHelpExamples([
  ['crawclaw agent --to +15555550123 --message "status update"', t("command.agent.example.start")],
  ['crawclaw agent --agent ops --message "Summarize logs"', t("command.agent.example.specific")],
  [
    'crawclaw agent --session-id 1234 --message "Summarize inbox" --thinking medium',
    t("command.agent.example.thinking"),
  ],
  [
    'crawclaw agent --to +15555550123 --message "Trace logs" --verbose on --json',
    t("command.agent.example.verbose"),
  ],
  [
    'crawclaw agent --to +15555550123 --message "Summon reply" --deliver',
    t("command.agent.example.deliver"),
  ],
  [
    'crawclaw agent --agent ops --message "Generate report" --deliver --reply-channel slack --reply-to "#reports"',
    t("command.agent.example.replyOverride"),
  ],
])}

${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/agent", "docs.crawclaw.ai/cli/agent")}`,
    )
    .action(async (opts) => {
      const verboseLevel = typeof opts.verbose === "string" ? opts.verbose.toLowerCase() : "";
      setVerbose(verboseLevel === "on");
      // Build default deps (keeps parity with other commands; future-proofing).
      const deps = createDefaultDeps();
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentCliCommand(opts, defaultRuntime, deps);
      });
    });

  agent
    .command("inspect")
    .description(t("command.agent.inspect.description"))
    .option("--run-id <id>", t("command.agent.inspect.option.runId"))
    .option("--task-id <id>", t("command.agent.inspect.option.taskId"))
    .option("--json", t("command.agent.inspect.option.json"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentInspectCommand(
          {
            runId: opts.runId as string | undefined,
            taskId: opts.taskId as string | undefined,
            json: Boolean(opts.json || agent.opts().json),
          },
          defaultRuntime,
        );
      });
    });

  agent
    .command("export-context")
    .description(t("command.agent.exportContext.description"))
    .option("--run-id <id>", t("command.agent.exportContext.option.runId"))
    .option("--task-id <id>", t("command.agent.exportContext.option.taskId"))
    .option("--session-id <id>", t("command.agent.exportContext.option.sessionId"))
    .option("--agent-id <id>", t("command.agent.exportContext.option.agentId"))
    .option("--out <path>", t("command.agent.exportContext.option.out"))
    .option("--json", t("command.agent.exportContext.option.json"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentExportContextCommand(
          {
            runId: opts.runId as string | undefined,
            taskId: opts.taskId as string | undefined,
            sessionId: opts.sessionId as string | undefined,
            agentId: opts.agentId as string | undefined,
            out: opts.out as string | undefined,
            json: Boolean(opts.json || agent.opts().json),
          },
          defaultRuntime,
        );
      });
    });

  const agents = program
    .command("agents")
    .description(t("command.agents.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/agents", "docs.crawclaw.ai/cli/agents")}\n`,
    );

  agents
    .command("list")
    .description(t("command.agents.list.description"))
    .option("--json", t("command.agents.list.option.json"), false)
    .option("--bindings", t("command.agents.list.option.bindings"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentsListCommand(
          { json: Boolean(opts.json), bindings: Boolean(opts.bindings) },
          defaultRuntime,
        );
      });
    });

  agents
    .command("status")
    .description(t("command.agents.status.description"))
    .option("--json", t("command.agents.status.option.json"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentsStatusCommand(
          {
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  agents
    .command("bindings")
    .description(t("command.agents.bindings.description"))
    .option("--agent <id>", t("command.agents.bindings.option.agent"))
    .option("--json", t("command.agents.bindings.option.json"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentsBindingsCommand(
          {
            agent: opts.agent as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  agents
    .command("bind")
    .description(t("command.agents.bind.description"))
    .option("--agent <id>", t("command.agents.bind.option.agent"))
    .option("--bind <channel[:accountId]>", t("command.agents.bind.option.bind"), collectOption, [])
    .option("--json", t("command.agents.bind.option.json"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentsBindCommand(
          {
            agent: opts.agent as string | undefined,
            bind: Array.isArray(opts.bind) ? (opts.bind as string[]) : undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  agents
    .command("unbind")
    .description(t("command.agents.unbind.description"))
    .option("--agent <id>", t("command.agents.unbind.option.agent"))
    .option(
      "--bind <channel[:accountId]>",
      t("command.agents.unbind.option.bind"),
      collectOption,
      [],
    )
    .option("--all", t("command.agents.unbind.option.all"), false)
    .option("--json", t("command.agents.unbind.option.json"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentsUnbindCommand(
          {
            agent: opts.agent as string | undefined,
            bind: Array.isArray(opts.bind) ? (opts.bind as string[]) : undefined,
            all: Boolean(opts.all),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  agents
    .command("add [name]")
    .description(t("command.agents.add.description"))
    .option("--workspace <dir>", t("command.agents.add.option.workspace"))
    .option("--model <id>", t("command.agents.add.option.model"))
    .option("--agent-dir <dir>", t("command.agents.add.option.agentDir"))
    .option("--bind <channel[:accountId]>", t("command.agents.add.option.bind"), collectOption, [])
    .option("--non-interactive", t("command.agents.add.option.nonInteractive"), false)
    .option("--json", t("command.agents.add.option.json"), false)
    .action(async (name, opts, command) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const hasFlags = hasExplicitOptions(command, [
          "workspace",
          "model",
          "agentDir",
          "bind",
          "nonInteractive",
        ]);
        await agentsAddCommand(
          {
            name: typeof name === "string" ? name : undefined,
            workspace: opts.workspace as string | undefined,
            model: opts.model as string | undefined,
            agentDir: opts.agentDir as string | undefined,
            bind: Array.isArray(opts.bind) ? (opts.bind as string[]) : undefined,
            nonInteractive: Boolean(opts.nonInteractive),
            json: Boolean(opts.json),
          },
          defaultRuntime,
          { hasFlags },
        );
      });
    });

  agents
    .command("set-identity")
    .description(t("command.agents.setIdentity.description"))
    .option("--agent <id>", t("command.agents.setIdentity.option.agent"))
    .option("--workspace <dir>", t("command.agents.setIdentity.option.workspace"))
    .option("--identity-file <path>", t("command.agents.setIdentity.option.identityFile"))
    .option("--from-identity", t("command.agents.setIdentity.option.fromIdentity"), false)
    .option("--name <name>", t("command.agents.setIdentity.option.name"))
    .option("--theme <theme>", t("command.agents.setIdentity.option.theme"))
    .option("--emoji <emoji>", t("command.agents.setIdentity.option.emoji"))
    .option("--avatar <value>", t("command.agents.setIdentity.option.avatar"))
    .option("--json", t("command.agents.setIdentity.option.json"), false)
    .addHelpText(
      "after",
      () =>
        `
${theme.heading(t("cli.help.examplesHeading"))}
${formatHelpExamples([
  [
    'crawclaw agents set-identity --agent main --name "CrawClaw" --emoji "🦞"',
    t("command.agents.setIdentity.example.nameEmoji"),
  ],
  [
    "crawclaw agents set-identity --agent main --avatar avatars/crawclaw.png",
    t("command.agents.setIdentity.example.avatar"),
  ],
  [
    "crawclaw agents set-identity --workspace ~/.crawclaw/workspace --from-identity",
    t("command.agents.setIdentity.example.fromIdentity"),
  ],
  [
    "crawclaw agents set-identity --identity-file ~/.crawclaw/workspace/IDENTITY.md --agent main",
    t("command.agents.setIdentity.example.identityFile"),
  ],
])}
`,
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentsSetIdentityCommand(
          {
            agent: opts.agent as string | undefined,
            workspace: opts.workspace as string | undefined,
            identityFile: opts.identityFile as string | undefined,
            fromIdentity: Boolean(opts.fromIdentity),
            name: opts.name as string | undefined,
            theme: opts.theme as string | undefined,
            emoji: opts.emoji as string | undefined,
            avatar: opts.avatar as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  const harness = agents
    .command("harness")
    .description(t("command.agents.harness.description"))
    .addHelpText(
      "after",
      () =>
        `
${theme.heading(t("cli.help.examplesHeading"))}
${formatHelpExamples([
  ["crawclaw agents harness report", t("command.agents.harness.example.report")],
  [
    "crawclaw agents harness report --scenario fix-complete",
    t("command.agents.harness.example.scenario"),
  ],
  ["crawclaw agents harness report --json", t("command.agents.harness.example.json")],
  [
    "crawclaw agents harness promote-check --baseline baseline.json --candidate candidate.json",
    t("command.agents.harness.example.promote"),
  ],
  [
    "crawclaw agents harness promote-check --baseline baseline.json --candidate candidate.json --json",
    t("command.agents.harness.example.promoteJson"),
  ],
])}
`,
    );

  harness
    .command("report")
    .description(t("command.agents.harness.report.description"))
    .option(
      "--scenario <name>",
      t("command.agents.harness.report.option.scenario"),
      collectOption,
      [],
    )
    .option("--json", t("command.agents.harness.report.option.json"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentsHarnessReportCommand(
          {
            scenario: Array.isArray(opts.scenario) ? (opts.scenario as string[]) : undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  harness
    .command("promote-check")
    .description(t("command.agents.harness.promoteCheck.description"))
    .requiredOption("--baseline <path>", t("command.agents.harness.promoteCheck.option.baseline"))
    .requiredOption("--candidate <path>", t("command.agents.harness.promoteCheck.option.candidate"))
    .option("--json", t("command.agents.harness.promoteCheck.option.json"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentsHarnessPromoteCheckCommand(
          {
            baseline: opts.baseline as string,
            candidate: opts.candidate as string,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  agents
    .command("delete <id>")
    .description(t("command.agents.delete.description"))
    .option("--force", t("command.agents.delete.option.force"), false)
    .option("--json", t("command.agents.delete.option.json"), false)
    .action(async (id, opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await agentsDeleteCommand(
          {
            id: String(id),
            force: Boolean(opts.force),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  agents.action(async () => {
    await runCommandWithRuntime(defaultRuntime, async () => {
      await agentsListCommand({}, defaultRuntime);
    });
  });
}
