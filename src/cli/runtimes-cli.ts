import type { Command } from "commander";
import {
  formatPluginRuntimeDoctorLines,
  readPluginRuntimeManifest,
  resolvePluginRuntimeManifestPath,
  runPluginRuntimeInstall,
} from "../plugins/plugin-runtimes.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

type RuntimeListOptions = {
  json?: boolean;
};

type RuntimeInstallOptions = {
  json?: boolean;
};

async function installAndReport(opts: RuntimeInstallOptions, action: "install" | "repair") {
  await runPluginRuntimeInstall();
  const manifest = readPluginRuntimeManifest();
  if (opts.json) {
    defaultRuntime.writeJson({
      ok: true,
      action,
      manifestPath: resolvePluginRuntimeManifestPath(),
      manifest,
    });
    return;
  }
  defaultRuntime.log(
    `${theme.success("Runtime install complete.")} ${theme.muted(resolvePluginRuntimeManifestPath())}`,
  );
  for (const line of formatPluginRuntimeDoctorLines()) {
    defaultRuntime.log(`- ${line}`);
  }
}

export function registerRuntimesCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const runtimes = program
    .command("runtimes")
    .description(t("command.runtimes.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/plugins", "docs.crawclaw.ai/cli/plugins")}\n`,
    );

  runtimes
    .command("list")
    .description(t("command.runtimes.list.description"))
    .option("--json", t("command.runtimes.option.json"))
    .action((opts: RuntimeListOptions) => {
      const manifestPath = resolvePluginRuntimeManifestPath();
      const manifest = readPluginRuntimeManifest();
      if (opts.json) {
        defaultRuntime.writeJson({ manifestPath, manifest });
        return;
      }
      defaultRuntime.log(theme.heading("Plugin Runtimes"));
      defaultRuntime.log(theme.muted(manifestPath));
      const lines = formatPluginRuntimeDoctorLines();
      if (lines.length === 0) {
        defaultRuntime.log(theme.muted("No runtime manifest entries found."));
        return;
      }
      for (const line of lines) {
        defaultRuntime.log(`- ${line}`);
      }
    });

  runtimes
    .command("doctor")
    .description(t("command.runtimes.doctor.description"))
    .option("--json", t("command.runtimes.option.json"))
    .action((opts: RuntimeListOptions) => {
      const manifestPath = resolvePluginRuntimeManifestPath();
      const manifest = readPluginRuntimeManifest();
      const lines = formatPluginRuntimeDoctorLines();
      if (opts.json) {
        defaultRuntime.writeJson({
          manifestPath,
          manifest,
          healthy: lines.every((line) => line.includes(": healthy ")),
        });
        return;
      }
      defaultRuntime.log(theme.heading("Runtime Doctor"));
      defaultRuntime.log(theme.muted(manifestPath));
      if (lines.length === 0) {
        defaultRuntime.log(theme.warn("No plugin runtime manifest entries found."));
        return;
      }
      for (const line of lines) {
        defaultRuntime.log(`- ${line}`);
      }
    });

  runtimes
    .command("install")
    .description(t("command.runtimes.install.description"))
    .option("--json", t("command.runtimes.option.json"))
    .action(async (opts: RuntimeInstallOptions) => {
      await installAndReport(opts, "install");
    });

  runtimes
    .command("repair")
    .description(t("command.runtimes.repair.description"))
    .option("--json", t("command.runtimes.option.json"))
    .action(async (opts: RuntimeInstallOptions) => {
      await installAndReport(opts, "repair");
    });
}
