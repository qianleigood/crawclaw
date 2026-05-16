import type { CrawClawConfig } from "../../../config/config.js";
import {
  collectBundledPluginLoadPathWarnings,
  scanBundledPluginLoadPathMigrations,
} from "./bundled-plugin-load-paths.js";
import {
  collectExecSafeBinCoverageWarnings,
  collectExecSafeBinTrustedDirHintWarnings,
  scanExecSafeBinCoverage,
  scanExecSafeBinTrustedDirHints,
} from "./exec-safe-bins.js";
import {
  collectLegacyToolsBySenderWarnings,
  scanLegacyToolsBySenderKeys,
} from "./legacy-tools-by-sender.js";
import {
  collectStalePluginConfigWarnings,
  isStalePluginAutoRepairBlocked,
  scanStalePluginConfig,
} from "./stale-plugin-config.js";

export function collectDoctorPreviewWarnings(params: {
  cfg: CrawClawConfig;
  doctorFixCommand: string;
}): string[] {
  const warnings: string[] = [];

  const stalePluginHits = scanStalePluginConfig(params.cfg, process.env);
  if (stalePluginHits.length > 0) {
    warnings.push(
      collectStalePluginConfigWarnings({
        hits: stalePluginHits,
        doctorFixCommand: params.doctorFixCommand,
        autoRepairBlocked: isStalePluginAutoRepairBlocked(params.cfg, process.env),
      }).join("\n"),
    );
  }

  const bundledPluginLoadPathHits = scanBundledPluginLoadPathMigrations(params.cfg, process.env);
  if (bundledPluginLoadPathHits.length > 0) {
    warnings.push(
      collectBundledPluginLoadPathWarnings({
        hits: bundledPluginLoadPathHits,
        doctorFixCommand: params.doctorFixCommand,
      }).join("\n"),
    );
  }

  const toolsBySenderHits = scanLegacyToolsBySenderKeys(params.cfg);
  if (toolsBySenderHits.length > 0) {
    warnings.push(
      collectLegacyToolsBySenderWarnings({
        hits: toolsBySenderHits,
        doctorFixCommand: params.doctorFixCommand,
      }).join("\n"),
    );
  }

  const safeBinCoverage = scanExecSafeBinCoverage(params.cfg);
  if (safeBinCoverage.length > 0) {
    warnings.push(
      collectExecSafeBinCoverageWarnings({
        hits: safeBinCoverage,
        doctorFixCommand: params.doctorFixCommand,
      }).join("\n"),
    );
  }

  const safeBinTrustedDirHints = scanExecSafeBinTrustedDirHints(params.cfg);
  if (safeBinTrustedDirHints.length > 0) {
    warnings.push(collectExecSafeBinTrustedDirHintWarnings(safeBinTrustedDirHints).join("\n"));
  }

  return warnings;
}
