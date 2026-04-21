import fs from "node:fs";
import { confirm } from "@clack/prompts";
import type { Command } from "commander";
import { danger } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { runSecretsApply } from "../secrets/apply.js";
import { resolveSecretsAuditExitCode, runSecretsAudit } from "../secrets/audit.js";
import { runSecretsConfigureInteractive } from "../secrets/configure.js";
import { isSecretsApplyPlan, type SecretsApplyPlan } from "../secrets/plan.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { addGatewayClientOptions, callGatewayFromCli, type GatewayRpcOpts } from "./gateway-rpc.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

type SecretsReloadOptions = GatewayRpcOpts & { json?: boolean };
type SecretsAuditOptions = {
  check?: boolean;
  json?: boolean;
  allowExec?: boolean;
};
type SecretsConfigureOptions = {
  apply?: boolean;
  yes?: boolean;
  planOut?: string;
  providersOnly?: boolean;
  skipProviderSetup?: boolean;
  agent?: string;
  allowExec?: boolean;
  json?: boolean;
};
type SecretsApplyOptions = {
  from: string;
  dryRun?: boolean;
  allowExec?: boolean;
  json?: boolean;
};

function readPlanFile(pathname: string): SecretsApplyPlan {
  const raw = fs.readFileSync(pathname, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isSecretsApplyPlan(parsed)) {
    throw new Error(`Invalid secrets plan file: ${pathname}`);
  }
  return parsed;
}

export function registerSecretsCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const secrets = program
    .command("secrets")
    .description(t("command.secrets.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/gateway/security", "docs.crawclaw.ai/gateway/security")}\n`,
    );

  addGatewayClientOptions(
    secrets
      .command("reload")
      .description(t("command.secrets.reload.description"))
      .option("--json", t("command.secrets.option.json"), false),
  ).action(async (opts: SecretsReloadOptions) => {
    try {
      const result = await callGatewayFromCli("secrets.reload", opts, undefined, {
        expectFinal: false,
      });
      if (opts.json) {
        defaultRuntime.writeJson(result);
        return;
      }
      const warningCount = Number(
        (result as { warningCount?: unknown } | undefined)?.warningCount ?? 0,
      );
      if (Number.isFinite(warningCount) && warningCount > 0) {
        defaultRuntime.log(`Secrets reloaded with ${warningCount} warning(s).`);
        return;
      }
      defaultRuntime.log("Secrets reloaded.");
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  secrets
    .command("audit")
    .description(t("command.secrets.audit.description"))
    .option("--check", t("command.secrets.audit.option.check"), false)
    .option("--allow-exec", t("command.secrets.audit.option.allowExec"), false)
    .option("--json", t("command.secrets.option.json"), false)
    .action(async (opts: SecretsAuditOptions) => {
      try {
        const report = await runSecretsAudit({
          allowExec: Boolean(opts.allowExec),
        });
        if (opts.json) {
          defaultRuntime.writeJson(report);
        } else {
          defaultRuntime.log(
            `Secrets audit: ${report.status}. plaintext=${report.summary.plaintextCount}, unresolved=${report.summary.unresolvedRefCount}, shadowed=${report.summary.shadowedRefCount}, legacy=${report.summary.legacyResidueCount}.`,
          );
          if (report.findings.length > 0) {
            for (const finding of report.findings.slice(0, 20)) {
              defaultRuntime.log(
                `- [${finding.code}] ${finding.file}:${finding.jsonPath} ${finding.message}`,
              );
            }
            if (report.findings.length > 20) {
              defaultRuntime.log(`... ${report.findings.length - 20} more finding(s).`);
            }
          }
          if (report.resolution.skippedExecRefs > 0) {
            defaultRuntime.log(
              `Audit note: skipped ${report.resolution.skippedExecRefs} exec SecretRef resolvability check(s). Re-run with --allow-exec to execute exec providers during audit.`,
            );
          }
        }
        const exitCode = resolveSecretsAuditExitCode(report, Boolean(opts.check));
        if (exitCode !== 0) {
          defaultRuntime.exit(exitCode);
        }
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(2);
      }
    });

  secrets
    .command("configure")
    .description(t("command.secrets.configure.description"))
    .option("--apply", t("command.secrets.configure.option.apply"), false)
    .option("--yes", t("command.secrets.configure.option.yes"), false)
    .option("--providers-only", t("command.secrets.configure.option.providersOnly"), false)
    .option("--skip-provider-setup", t("command.secrets.configure.option.skipProviderSetup"), false)
    .option("--agent <id>", t("command.secrets.configure.option.agent"))
    .option("--allow-exec", t("command.secrets.configure.option.allowExec"), false)
    .option("--plan-out <path>", t("command.secrets.configure.option.planOut"))
    .option("--json", t("command.secrets.option.json"), false)
    .action(async (opts: SecretsConfigureOptions) => {
      try {
        const configured = await runSecretsConfigureInteractive({
          providersOnly: Boolean(opts.providersOnly),
          skipProviderSetup: Boolean(opts.skipProviderSetup),
          agentId: typeof opts.agent === "string" ? opts.agent : undefined,
          allowExecInPreflight: Boolean(opts.allowExec),
        });
        if (opts.planOut) {
          fs.writeFileSync(opts.planOut, `${JSON.stringify(configured.plan, null, 2)}\n`, "utf8");
        }
        if (opts.json) {
          defaultRuntime.writeJson({
            plan: configured.plan,
            preflight: configured.preflight,
          });
        } else {
          defaultRuntime.log(
            `Preflight: changed=${configured.preflight.changed}, files=${configured.preflight.changedFiles.length}, warnings=${configured.preflight.warningCount}.`,
          );
          if (configured.preflight.warningCount > 0) {
            for (const warning of configured.preflight.warnings) {
              defaultRuntime.log(`- warning: ${warning}`);
            }
          }
          if (
            !configured.preflight.checks.resolvabilityComplete &&
            configured.preflight.skippedExecRefs > 0
          ) {
            defaultRuntime.log(
              `Preflight note: skipped ${configured.preflight.skippedExecRefs} exec SecretRef resolvability check(s). Re-run with --allow-exec to execute exec providers during preflight.`,
            );
          }
          const providerUpserts = Object.keys(configured.plan.providerUpserts ?? {}).length;
          const providerDeletes = configured.plan.providerDeletes?.length ?? 0;
          defaultRuntime.log(
            `Plan: targets=${configured.plan.targets.length}, providerUpserts=${providerUpserts}, providerDeletes=${providerDeletes}.`,
          );
          if (opts.planOut) {
            defaultRuntime.log(`Plan written to ${opts.planOut}`);
          }
        }

        let shouldApply = Boolean(opts.apply);
        if (!shouldApply && !opts.json) {
          const approved = await confirm({
            message: t("command.secrets.configure.prompt.applyNow"),
            initialValue: true,
          });
          if (typeof approved === "boolean") {
            shouldApply = approved;
          }
        }
        if (shouldApply) {
          const needsIrreversiblePrompt = Boolean(opts.apply);
          if (needsIrreversiblePrompt && !opts.yes && !opts.json) {
            const confirmed = await confirm({
              message: t("command.secrets.configure.prompt.oneWayMigration"),
              initialValue: true,
            });
            if (confirmed !== true) {
              defaultRuntime.log(t("command.secrets.configure.applyCancelled"));
              return;
            }
          }
          const result = await runSecretsApply({
            plan: configured.plan,
            write: true,
            allowExec: Boolean(opts.allowExec),
          });
          if (opts.json) {
            defaultRuntime.writeJson(result);
            return;
          }
          defaultRuntime.log(
            result.changed
              ? `Secrets applied. Updated ${result.changedFiles.length} file(s).`
              : "Secrets apply: no changes.",
          );
        }
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  secrets
    .command("apply")
    .description(t("command.secrets.apply.description"))
    .requiredOption("--from <path>", t("command.secrets.apply.option.from"))
    .option("--dry-run", t("command.secrets.apply.option.dryRun"), false)
    .option("--allow-exec", t("command.secrets.apply.option.allowExec"), false)
    .option("--json", t("command.secrets.option.json"), false)
    .action(async (opts: SecretsApplyOptions) => {
      try {
        const plan = readPlanFile(opts.from);
        const result = await runSecretsApply({
          plan,
          write: !opts.dryRun,
          allowExec: Boolean(opts.allowExec),
        });
        if (opts.json) {
          defaultRuntime.writeJson(result);
          return;
        }
        if (opts.dryRun) {
          defaultRuntime.log(
            result.changed
              ? `Secrets apply dry run: ${result.changedFiles.length} file(s) would change.`
              : "Secrets apply dry run: no changes.",
          );
          if (!result.checks.resolvabilityComplete && result.skippedExecRefs > 0) {
            defaultRuntime.log(
              `Secrets apply dry-run note: skipped ${result.skippedExecRefs} exec SecretRef resolvability check(s). Re-run with --allow-exec to execute exec providers during dry-run.`,
            );
          }
          return;
        }
        defaultRuntime.log(
          result.changed
            ? `Secrets applied. Updated ${result.changedFiles.length} file(s).`
            : "Secrets apply: no changes.",
        );
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });
}
