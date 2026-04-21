import type { Command } from "commander";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import {
  installSkillFromClawHub,
  readTrackedClawHubSkillSlugs,
  searchSkillsFromClawHub,
  updateSkillsFromClawHub,
} from "../agents/skills-clawhub.js";
import { loadConfig } from "../config/config.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";
import { formatSkillInfo, formatSkillsCheck, formatSkillsList } from "./skills-cli.format.js";

export type {
  SkillInfoOptions,
  SkillsCheckOptions,
  SkillsListOptions,
} from "./skills-cli.format.js";
export { formatSkillInfo, formatSkillsCheck, formatSkillsList } from "./skills-cli.format.js";

type SkillStatusReport = Awaited<
  ReturnType<(typeof import("../agents/skills-status.js"))["buildWorkspaceSkillStatus"]>
>;

async function loadSkillsStatusReport(): Promise<SkillStatusReport> {
  const config = loadConfig();
  const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
  const { buildWorkspaceSkillStatus } = await import("../agents/skills-status.js");
  return buildWorkspaceSkillStatus(workspaceDir, { config });
}

async function runSkillsAction(render: (report: SkillStatusReport) => string): Promise<void> {
  try {
    const report = await loadSkillsStatusReport();
    defaultRuntime.log(render(report));
  } catch (err) {
    defaultRuntime.error(String(err));
    defaultRuntime.exit(1);
  }
}

function resolveActiveWorkspaceDir(): string {
  const config = loadConfig();
  return resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
}

/**
 * Register the skills CLI commands
 */
export function registerSkillsCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const skills = program
    .command("skills")
    .description(t("command.skills.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/skills", "docs.crawclaw.ai/cli/skills")}\n`,
    );

  skills
    .command("search")
    .description(t("command.skills.search.description"))
    .argument("[query...]", t("command.skills.search.argument.query"))
    .option("--limit <n>", t("command.skills.search.option.limit"), (value) =>
      Number.parseInt(value, 10),
    )
    .option("--json", t("command.skills.option.json"), false)
    .action(async (queryParts: string[], opts: { limit?: number; json?: boolean }) => {
      try {
        const results = await searchSkillsFromClawHub({
          query: queryParts.join(" ").trim() || undefined,
          limit: opts.limit,
        });
        if (opts.json) {
          defaultRuntime.writeJson({ results });
          return;
        }
        if (results.length === 0) {
          defaultRuntime.log("No ClawHub skills found.");
          return;
        }
        for (const entry of results) {
          const version = entry.version ? ` v${entry.version}` : "";
          const summary = entry.summary ? `  ${entry.summary}` : "";
          defaultRuntime.log(`${entry.slug}${version}  ${entry.displayName}${summary}`);
        }
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  skills
    .command("install")
    .description(t("command.skills.install.description"))
    .argument("<slug>", t("command.skills.argument.slug"))
    .option("--version <version>", t("command.skills.install.option.version"))
    .option("--force", t("command.skills.install.option.force"), false)
    .action(async (slug: string, opts: { version?: string; force?: boolean }) => {
      try {
        const workspaceDir = resolveActiveWorkspaceDir();
        const result = await installSkillFromClawHub({
          workspaceDir,
          slug,
          version: opts.version,
          force: Boolean(opts.force),
          logger: {
            info: (message) => defaultRuntime.log(message),
          },
        });
        if (!result.ok) {
          defaultRuntime.error(result.error);
          defaultRuntime.exit(1);
          return;
        }
        defaultRuntime.log(`Installed ${result.slug}@${result.version} -> ${result.targetDir}`);
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  skills
    .command("update")
    .description(t("command.skills.update.description"))
    .argument("[slug]", t("command.skills.update.argument.slug"))
    .option("--all", t("command.skills.update.option.all"), false)
    .action(async (slug: string | undefined, opts: { all?: boolean }) => {
      try {
        if (!slug && !opts.all) {
          defaultRuntime.error("Provide a skill slug or use --all.");
          defaultRuntime.exit(1);
          return;
        }
        if (slug && opts.all) {
          defaultRuntime.error("Use either a skill slug or --all.");
          defaultRuntime.exit(1);
          return;
        }
        const workspaceDir = resolveActiveWorkspaceDir();
        const tracked = await readTrackedClawHubSkillSlugs(workspaceDir);
        if (opts.all && tracked.length === 0) {
          defaultRuntime.log("No tracked ClawHub skills to update.");
          return;
        }
        const results = await updateSkillsFromClawHub({
          workspaceDir,
          slug,
          logger: {
            info: (message) => defaultRuntime.log(message),
          },
        });
        for (const result of results) {
          if (!result.ok) {
            defaultRuntime.error(result.error);
            continue;
          }
          if (result.changed) {
            defaultRuntime.log(
              `Updated ${result.slug}: ${result.previousVersion ?? "unknown"} -> ${result.version}`,
            );
            continue;
          }
          defaultRuntime.log(`${result.slug} already at ${result.version}`);
        }
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  skills
    .command("list")
    .description(t("command.skills.list.description"))
    .option("--json", t("command.skills.option.json"), false)
    .option("--eligible", t("command.skills.list.option.eligible"), false)
    .option("-v, --verbose", t("command.skills.list.option.verbose"), false)
    .action(async (opts) => {
      await runSkillsAction((report) => formatSkillsList(report, opts));
    });

  skills
    .command("info")
    .description(t("command.skills.info.description"))
    .argument("<name>", t("command.skills.info.argument.name"))
    .option("--json", t("command.skills.option.json"), false)
    .action(async (name, opts) => {
      await runSkillsAction((report) => formatSkillInfo(report, name, opts));
    });

  skills
    .command("check")
    .description(t("command.skills.check.description"))
    .option("--json", t("command.skills.option.json"), false)
    .action(async (opts) => {
      await runSkillsAction((report) => formatSkillsCheck(report, opts));
    });

  // Default action (no subcommand) - show list
  skills.action(async () => {
    await runSkillsAction((report) => formatSkillsList(report, {}));
  });
}
