import type { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { defaultRuntime } from "../runtime.js";
import { runSecurityAudit } from "../security/audit.js";
import { fixSecurityFootguns } from "../security/fix.js";
import { formatDocsLink } from "../terminal/links.js";
import { isRich, theme } from "../terminal/theme.js";
import { shortenHomeInString, shortenHomePath } from "../utils.js";
import { formatCliCommand } from "./command-format.js";
import { resolveCommandSecretRefsViaGateway } from "./command-secret-gateway.js";
import { getSecurityAuditCommandSecretTargetIds } from "./command-secret-targets.js";
import { formatHelpExamples } from "./help-format.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

type SecurityAuditOptions = {
  json?: boolean;
  deep?: boolean;
  fix?: boolean;
  token?: string;
  password?: string;
};

function formatSummary(summary: { critical: number; warn: number; info: number }): string {
  const rich = isRich();
  const c = summary.critical;
  const w = summary.warn;
  const i = summary.info;
  const parts: string[] = [];
  parts.push(rich ? theme.error(`${c} critical`) : `${c} critical`);
  parts.push(rich ? theme.warn(`${w} warn`) : `${w} warn`);
  parts.push(rich ? theme.muted(`${i} info`) : `${i} info`);
  return parts.join(" · ");
}

export function registerSecurityCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const security = program
    .command("security")
    .description(t("command.security.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          ["crawclaw security audit", t("command.security.example.audit")],
          ["crawclaw security audit --deep", t("command.security.example.deep")],
          ["crawclaw security audit --deep --token <token>", t("command.security.example.token")],
          [
            "crawclaw security audit --deep --password <password>",
            t("command.security.example.password"),
          ],
          ["crawclaw security audit --fix", t("command.security.example.fix")],
          ["crawclaw security audit --json", t("command.security.example.json")],
        ])}\n\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/security", "docs.crawclaw.ai/cli/security")}\n`,
    );

  security
    .command("audit")
    .description(t("command.security.audit.description"))
    .option("--deep", t("command.security.audit.option.deep"), false)
    .option("--token <token>", t("command.security.audit.option.token"))
    .option("--password <password>", t("command.security.audit.option.password"))
    .option("--fix", t("command.security.audit.option.fix"), false)
    .option("--json", t("command.security.audit.option.json"), false)
    .action(async (opts: SecurityAuditOptions) => {
      const fixResult = opts.fix ? await fixSecurityFootguns().catch((_err) => null) : null;

      const sourceConfig = loadConfig();
      const { resolvedConfig: cfg, diagnostics: secretDiagnostics } =
        await resolveCommandSecretRefsViaGateway({
          config: sourceConfig,
          commandName: "security audit",
          targetIds: getSecurityAuditCommandSecretTargetIds(),
          mode: "read_only_status",
        });
      const report = await runSecurityAudit({
        config: cfg,
        sourceConfig,
        deep: Boolean(opts.deep),
        includeFilesystem: true,
        includeChannelSecurity: true,
        deepProbeAuth:
          opts.token?.trim() || opts.password?.trim()
            ? {
                ...(opts.token?.trim() ? { token: opts.token } : {}),
                ...(opts.password?.trim() ? { password: opts.password } : {}),
              }
            : undefined,
      });

      if (opts.json) {
        defaultRuntime.writeJson(
          fixResult
            ? { fix: fixResult, report, secretDiagnostics }
            : { ...report, secretDiagnostics },
        );
        return;
      }

      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);

      const lines: string[] = [];
      lines.push(heading("CrawClaw security audit"));
      lines.push(muted(`Summary: ${formatSummary(report.summary)}`));
      lines.push(muted(`Run deeper: ${formatCliCommand("crawclaw security audit --deep")}`));
      for (const diagnostic of secretDiagnostics) {
        lines.push(muted(`[secrets] ${diagnostic}`));
      }

      if (opts.fix) {
        lines.push(muted(`Fix: ${formatCliCommand("crawclaw security audit --fix")}`));
        if (!fixResult) {
          lines.push(muted("Fixes: failed to apply (unexpected error)"));
        } else if (
          fixResult.errors.length === 0 &&
          fixResult.changes.length === 0 &&
          fixResult.actions.every((a) => !a.ok)
        ) {
          lines.push(muted("Fixes: no changes applied"));
        } else {
          lines.push("");
          lines.push(heading("FIX"));
          for (const change of fixResult.changes) {
            lines.push(muted(`  ${shortenHomeInString(change)}`));
          }
          for (const action of fixResult.actions) {
            if (action.kind === "chmod") {
              const mode = action.mode.toString(8).padStart(3, "0");
              if (action.ok) {
                lines.push(muted(`  chmod ${mode} ${shortenHomePath(action.path)}`));
              } else if (action.skipped) {
                lines.push(
                  muted(`  skip chmod ${mode} ${shortenHomePath(action.path)} (${action.skipped})`),
                );
              } else if (action.error) {
                lines.push(
                  muted(`  chmod ${mode} ${shortenHomePath(action.path)} failed: ${action.error}`),
                );
              }
              continue;
            }
            const command = shortenHomeInString(action.command);
            if (action.ok) {
              lines.push(muted(`  ${command}`));
            } else if (action.skipped) {
              lines.push(muted(`  skip ${command} (${action.skipped})`));
            } else if (action.error) {
              lines.push(muted(`  ${command} failed: ${action.error}`));
            }
          }
          if (fixResult.errors.length > 0) {
            for (const err of fixResult.errors) {
              lines.push(muted(`  error: ${shortenHomeInString(err)}`));
            }
          }
        }
      }

      const bySeverity = (sev: "critical" | "warn" | "info") =>
        report.findings.filter((f) => f.severity === sev);

      const render = (sev: "critical" | "warn" | "info") => {
        const list = bySeverity(sev);
        if (list.length === 0) {
          return;
        }
        const label =
          sev === "critical"
            ? rich
              ? theme.error("CRITICAL")
              : "CRITICAL"
            : sev === "warn"
              ? rich
                ? theme.warn("WARN")
                : "WARN"
              : rich
                ? theme.muted("INFO")
                : "INFO";
        lines.push("");
        lines.push(heading(label));
        for (const f of list) {
          lines.push(`${theme.muted(f.checkId)} ${f.title}`);
          lines.push(`  ${f.detail}`);
          if (f.remediation?.trim()) {
            lines.push(`  ${muted(`Fix: ${f.remediation.trim()}`)}`);
          }
        }
      };

      render("critical");
      render("warn");
      render("info");

      defaultRuntime.log(lines.join("\n"));
    });
}
