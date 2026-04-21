import type { Command } from "commander";
import {
  modelsAliasesAddCommand,
  modelsAliasesListCommand,
  modelsAliasesRemoveCommand,
  modelsAuthAddCommand,
  modelsAuthLoginCommand,
  modelsAuthOrderClearCommand,
  modelsAuthOrderGetCommand,
  modelsAuthOrderSetCommand,
  modelsAuthPasteTokenCommand,
  modelsAuthSetupTokenCommand,
  modelsFallbacksAddCommand,
  modelsFallbacksClearCommand,
  modelsFallbacksListCommand,
  modelsFallbacksRemoveCommand,
  modelsImageFallbacksAddCommand,
  modelsImageFallbacksClearCommand,
  modelsImageFallbacksListCommand,
  modelsImageFallbacksRemoveCommand,
  modelsListCommand,
  modelsScanCommand,
  modelsSetCommand,
  modelsSetImageCommand,
  modelsStatusCommand,
} from "../commands/models.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { resolveOptionFromCommand, runCommandWithRuntime } from "./cli-utils.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

function runModelsCommand(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

export function registerModelsCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const models = program
    .command("models")
    .description(t("command.models.description"))
    .option("--status-json", t("command.models.option.statusJson"), false)
    .option("--status-plain", t("command.models.option.statusPlain"), false)
    .option("--agent <id>", t("command.models.option.agent"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/models", "docs.crawclaw.ai/cli/models")}\n`,
    );

  models
    .command("list")
    .description(t("command.models.list.description"))
    .option("--all", t("command.models.list.option.all"), false)
    .option("--local", t("command.models.list.option.local"), false)
    .option("--provider <name>", t("command.models.option.provider"))
    .option("--json", t("command.models.option.json"), false)
    .option("--plain", t("command.models.list.option.plain"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsListCommand(opts, defaultRuntime);
      });
    });

  models
    .command("status")
    .description(t("command.models.status.description"))
    .option("--json", t("command.models.option.json"), false)
    .option("--plain", t("command.models.option.plain"), false)
    .option("--check", t("command.models.status.option.check"), false)
    .option("--probe", t("command.models.status.option.probe"), false)
    .option("--probe-provider <name>", t("command.models.status.option.probeProvider"))
    .option(
      "--probe-profile <id>",
      t("command.models.status.option.probeProfile"),
      (value, previous) => {
        const next = Array.isArray(previous) ? previous : previous ? [previous] : [];
        next.push(value);
        return next;
      },
    )
    .option("--probe-timeout <ms>", t("command.models.status.option.probeTimeout"))
    .option("--probe-concurrency <n>", t("command.models.status.option.probeConcurrency"))
    .option("--probe-max-tokens <n>", t("command.models.status.option.probeMaxTokens"))
    .option("--agent <id>", t("command.models.option.agent"))
    .action(async (opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsStatusCommand(
          {
            json: Boolean(opts.json),
            plain: Boolean(opts.plain),
            check: Boolean(opts.check),
            probe: Boolean(opts.probe),
            probeProvider: opts.probeProvider as string | undefined,
            probeProfile: opts.probeProfile as string | string[] | undefined,
            probeTimeout: opts.probeTimeout as string | undefined,
            probeConcurrency: opts.probeConcurrency as string | undefined,
            probeMaxTokens: opts.probeMaxTokens as string | undefined,
            agent,
          },
          defaultRuntime,
        );
      });
    });

  models
    .command("set")
    .description(t("command.models.set.description"))
    .argument("<model>", t("command.models.argument.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsSetCommand(model, defaultRuntime);
      });
    });

  models
    .command("set-image")
    .description(t("command.models.setImage.description"))
    .argument("<model>", t("command.models.argument.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsSetImageCommand(model, defaultRuntime);
      });
    });

  const aliases = models.command("aliases").description(t("command.models.aliases.description"));

  aliases
    .command("list")
    .description(t("command.models.aliases.list.description"))
    .option("--json", t("command.models.option.json"), false)
    .option("--plain", t("command.models.option.plain"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAliasesListCommand(opts, defaultRuntime);
      });
    });

  aliases
    .command("add")
    .description(t("command.models.aliases.add.description"))
    .argument("<alias>", t("command.models.aliases.argument.alias"))
    .argument("<model>", t("command.models.argument.model"))
    .action(async (alias: string, model: string) => {
      await runModelsCommand(async () => {
        await modelsAliasesAddCommand(alias, model, defaultRuntime);
      });
    });

  aliases
    .command("remove")
    .description(t("command.models.aliases.remove.description"))
    .argument("<alias>", t("command.models.aliases.argument.alias"))
    .action(async (alias: string) => {
      await runModelsCommand(async () => {
        await modelsAliasesRemoveCommand(alias, defaultRuntime);
      });
    });

  const fallbacks = models
    .command("fallbacks")
    .description(t("command.models.fallbacks.description"));

  fallbacks
    .command("list")
    .description(t("command.models.fallbacks.list.description"))
    .option("--json", t("command.models.option.json"), false)
    .option("--plain", t("command.models.option.plain"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsFallbacksListCommand(opts, defaultRuntime);
      });
    });

  fallbacks
    .command("add")
    .description(t("command.models.fallbacks.add.description"))
    .argument("<model>", t("command.models.argument.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsFallbacksAddCommand(model, defaultRuntime);
      });
    });

  fallbacks
    .command("remove")
    .description(t("command.models.fallbacks.remove.description"))
    .argument("<model>", t("command.models.argument.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsFallbacksRemoveCommand(model, defaultRuntime);
      });
    });

  fallbacks
    .command("clear")
    .description(t("command.models.fallbacks.clear.description"))
    .action(async () => {
      await runModelsCommand(async () => {
        await modelsFallbacksClearCommand(defaultRuntime);
      });
    });

  const imageFallbacks = models
    .command("image-fallbacks")
    .description(t("command.models.imageFallbacks.description"));

  imageFallbacks
    .command("list")
    .description(t("command.models.imageFallbacks.list.description"))
    .option("--json", t("command.models.option.json"), false)
    .option("--plain", t("command.models.option.plain"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksListCommand(opts, defaultRuntime);
      });
    });

  imageFallbacks
    .command("add")
    .description(t("command.models.imageFallbacks.add.description"))
    .argument("<model>", t("command.models.argument.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksAddCommand(model, defaultRuntime);
      });
    });

  imageFallbacks
    .command("remove")
    .description(t("command.models.imageFallbacks.remove.description"))
    .argument("<model>", t("command.models.argument.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksRemoveCommand(model, defaultRuntime);
      });
    });

  imageFallbacks
    .command("clear")
    .description(t("command.models.imageFallbacks.clear.description"))
    .action(async () => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksClearCommand(defaultRuntime);
      });
    });

  models
    .command("scan")
    .description(t("command.models.scan.description"))
    .option("--min-params <b>", t("command.models.scan.option.minParams"))
    .option("--max-age-days <days>", t("command.models.scan.option.maxAgeDays"))
    .option("--provider <name>", t("command.models.scan.option.provider"))
    .option("--max-candidates <n>", t("command.models.scan.option.maxCandidates"), "6")
    .option("--timeout <ms>", t("command.models.scan.option.timeout"))
    .option("--concurrency <n>", t("command.models.scan.option.concurrency"))
    .option("--no-probe", t("command.models.scan.option.noProbe"))
    .option("--yes", t("command.models.scan.option.yes"), false)
    .option("--no-input", t("command.models.scan.option.noInput"))
    .option("--set-default", t("command.models.scan.option.setDefault"), false)
    .option("--set-image", t("command.models.scan.option.setImage"), false)
    .option("--json", t("command.models.option.json"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsScanCommand(opts, defaultRuntime);
      });
    });

  models.action(async (opts) => {
    await runModelsCommand(async () => {
      await modelsStatusCommand(
        {
          json: Boolean(opts?.statusJson),
          plain: Boolean(opts?.statusPlain),
          agent: opts?.agent as string | undefined,
        },
        defaultRuntime,
      );
    });
  });

  const auth = models.command("auth").description(t("command.models.auth.description"));
  auth.option("--agent <id>", t("command.models.auth.option.agent"));
  auth.action(() => {
    auth.help();
  });

  auth
    .command("add")
    .description(t("command.models.auth.add.description"))
    .action(async () => {
      await runModelsCommand(async () => {
        await modelsAuthAddCommand({}, defaultRuntime);
      });
    });

  auth
    .command("login")
    .description(t("command.models.auth.login.description"))
    .option("--provider <id>", t("command.models.auth.login.option.provider"))
    .option("--method <id>", t("command.models.auth.login.option.method"))
    .option("--set-default", t("command.models.auth.login.option.setDefault"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAuthLoginCommand(
          {
            provider: opts.provider as string | undefined,
            method: opts.method as string | undefined,
            setDefault: Boolean(opts.setDefault),
          },
          defaultRuntime,
        );
      });
    });

  auth
    .command("setup-token")
    .description(t("command.models.auth.setupToken.description"))
    .option("--provider <name>", t("command.models.auth.setupToken.option.provider"))
    .option("--yes", t("command.models.auth.option.yes"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAuthSetupTokenCommand(
          {
            provider: opts.provider as string | undefined,
            yes: Boolean(opts.yes),
          },
          defaultRuntime,
        );
      });
    });

  auth
    .command("paste-token")
    .description(t("command.models.auth.pasteToken.description"))
    .requiredOption("--provider <name>", t("command.models.auth.pasteToken.option.provider"))
    .option("--profile-id <id>", t("command.models.auth.pasteToken.option.profileId"))
    .option("--expires-in <duration>", t("command.models.auth.pasteToken.option.expiresIn"))
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAuthPasteTokenCommand(
          {
            provider: opts.provider as string | undefined,
            profileId: opts.profileId as string | undefined,
            expiresIn: opts.expiresIn as string | undefined,
          },
          defaultRuntime,
        );
      });
    });

  auth
    .command("login-github-copilot")
    .description(t("command.models.auth.loginGithubCopilot.description"))
    .option("--yes", t("command.models.auth.loginGithubCopilot.option.yes"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAuthLoginCommand(
          {
            provider: "github-copilot",
            method: "device",
            yes: Boolean(opts.yes),
          },
          defaultRuntime,
        );
      });
    });

  const order = auth.command("order").description(t("command.models.auth.order.description"));

  order
    .command("get")
    .description(t("command.models.auth.order.get.description"))
    .requiredOption("--provider <name>", t("command.models.auth.order.option.provider"))
    .option("--agent <id>", t("command.models.auth.order.option.agent"))
    .option("--json", t("command.models.option.json"), false)
    .action(async (opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsAuthOrderGetCommand(
          {
            provider: opts.provider as string,
            agent,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  order
    .command("set")
    .description(t("command.models.auth.order.set.description"))
    .requiredOption("--provider <name>", t("command.models.auth.order.option.provider"))
    .option("--agent <id>", t("command.models.auth.order.option.agent"))
    .argument("<profileIds...>", t("command.models.auth.order.argument.profileIds"))
    .action(async (profileIds: string[], opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsAuthOrderSetCommand(
          {
            provider: opts.provider as string,
            agent,
            order: profileIds,
          },
          defaultRuntime,
        );
      });
    });

  order
    .command("clear")
    .description(t("command.models.auth.order.clear.description"))
    .requiredOption("--provider <name>", t("command.models.auth.order.option.provider"))
    .option("--agent <id>", t("command.models.auth.order.option.agent"))
    .action(async (opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsAuthOrderClearCommand(
          {
            provider: opts.provider as string,
            agent,
          },
          defaultRuntime,
        );
      });
    });
}
