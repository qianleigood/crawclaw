import { formatCliCommand } from "../cli/command-format.js";
import { runPluginRuntimeInstall } from "../plugins/plugin-runtimes.js";
import {
  formatPluginRuntimeDoctorLines,
  getPluginRuntimeManifestHealth,
  readPluginRuntimeManifest,
  resolvePluginRuntimeManifestPath,
} from "../plugins/plugin-runtimes.js";
import type { RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";
import type { DoctorPrompter } from "./doctor-prompter.js";

function hasUnhealthyRuntimeState(): boolean {
  const manifest = readPluginRuntimeManifest();
  const plugins = manifest.plugins ?? {};
  const health = getPluginRuntimeManifestHealth();
  return (
    Boolean(health.mismatchReason) ||
    Object.values(plugins).some((entry) => entry.state !== "healthy")
  );
}

export async function maybeRepairSharedPluginRuntimes(params: {
  runtime: RuntimeEnv;
  prompter: DoctorPrompter;
}): Promise<void> {
  const manifestPath = resolvePluginRuntimeManifestPath();
  const lines = formatPluginRuntimeDoctorLines();
  if (lines.length === 0) {
    note(
      [
        "Shared bundled plugin runtime manifest is missing or empty.",
        `Expected: ${manifestPath}`,
        `Fix: run ${formatCliCommand("crawclaw doctor --fix")} or ${formatCliCommand("crawclaw runtimes install")}.`,
      ].join("\n"),
      "Plugin runtimes",
    );
  } else {
    note(
      [`Manifest: ${manifestPath}`, ...lines.map((line) => `- ${line}`)].join("\n"),
      "Plugin runtimes",
    );
  }

  if (lines.length > 0 && !hasUnhealthyRuntimeState()) {
    return;
  }

  const shouldRepair =
    params.prompter.shouldRepair ||
    (await params.prompter.confirmAutoFix({
      message: "Install or repair shared plugin runtimes now?",
      initialValue: true,
    }));
  if (!shouldRepair) {
    return;
  }

  try {
    await runPluginRuntimeInstall({ stdio: "inherit" });
    const repairedLines = formatPluginRuntimeDoctorLines();
    note(
      [
        "Shared plugin runtimes repaired.",
        `Manifest: ${resolvePluginRuntimeManifestPath()}`,
        ...repairedLines.map((line) => `- ${line}`),
      ].join("\n"),
      "Plugin runtimes",
    );
  } catch (error) {
    params.runtime.error(`Failed to repair shared plugin runtimes: ${String(error)}`);
  }
}
