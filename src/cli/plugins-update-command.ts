import { loadConfig, readConfigFileSnapshot, replaceConfigFile } from "../config/config.js";
import type { HookInstallRecord } from "../config/types.hooks.js";
import type { PluginInstallRecord } from "../config/types.plugins.js";
import { updateNpmInstalledHookPacks } from "../hooks/update.js";
import { parseRegistryNpmSpec } from "../infra/npm-registry-spec.js";
import { updatePluginsWithRustLifecycle } from "../plugins/rust-lifecycle.js";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import { createCliTranslator, getActiveCliLocale } from "./i18n/index.js";
import {
  extractInstalledNpmHookPackageName,
  extractInstalledNpmPackageName,
} from "./plugins-command-helpers.js";
import { promptYesNo } from "./prompt.js";

type PluginUpdateOutcome = {
  status?: string;
  message?: string;
};

type PluginUpdateResult = {
  changed: boolean;
  config: ReturnType<typeof loadConfig>;
  outcomes: PluginUpdateOutcome[];
};

function resolvePluginUpdateSelection(params: {
  installs: Record<string, PluginInstallRecord>;
  rawId?: string;
  all?: boolean;
}): { pluginIds: string[]; specOverrides?: Record<string, string> } {
  if (params.all) {
    return { pluginIds: Object.keys(params.installs) };
  }
  if (!params.rawId) {
    return { pluginIds: [] };
  }

  const parsedSpec = parseRegistryNpmSpec(params.rawId);
  if (!parsedSpec || parsedSpec.selectorKind === "none") {
    return { pluginIds: [params.rawId] };
  }

  const matches = Object.entries(params.installs).filter(([, install]) => {
    return extractInstalledNpmPackageName(install) === parsedSpec.name;
  });
  if (matches.length !== 1) {
    return { pluginIds: [params.rawId] };
  }

  const [pluginId] = matches[0];
  if (!pluginId) {
    return { pluginIds: [params.rawId] };
  }
  return {
    pluginIds: [pluginId],
    specOverrides: {
      [pluginId]: parsedSpec.raw,
    },
  };
}

function resolveHookPackUpdateSelection(params: {
  installs: Record<string, HookInstallRecord>;
  rawId?: string;
  all?: boolean;
}): { hookIds: string[]; specOverrides?: Record<string, string> } {
  if (params.all) {
    return { hookIds: Object.keys(params.installs) };
  }
  if (!params.rawId) {
    return { hookIds: [] };
  }
  if (params.rawId in params.installs) {
    return { hookIds: [params.rawId] };
  }

  const parsedSpec = parseRegistryNpmSpec(params.rawId);
  if (!parsedSpec || parsedSpec.selectorKind === "none") {
    return { hookIds: [] };
  }

  const matches = Object.entries(params.installs).filter(([, install]) => {
    return extractInstalledNpmHookPackageName(install) === parsedSpec.name;
  });
  if (matches.length !== 1) {
    return { hookIds: [] };
  }

  const [hookId] = matches[0];
  if (!hookId) {
    return { hookIds: [] };
  }
  return {
    hookIds: [hookId],
    specOverrides: {
      [hookId]: parsedSpec.raw,
    },
  };
}

export async function runPluginUpdateCommand(params: {
  id?: string;
  opts: { all?: boolean; dryRun?: boolean };
}) {
  const t = createCliTranslator(getActiveCliLocale());
  const sourceSnapshotPromise = readConfigFileSnapshot().catch(() => null);
  const cfg = loadConfig();
  const logger = {
    info: (msg: string) => defaultRuntime.log(msg),
    warn: (msg: string) => defaultRuntime.log(theme.warn(msg)),
  };
  const pluginSelection = resolvePluginUpdateSelection({
    installs: cfg.plugins?.installs ?? {},
    rawId: params.id,
    all: params.opts.all,
  });
  const hookSelection = resolveHookPackUpdateSelection({
    installs: cfg.hooks?.internal?.installs ?? {},
    rawId: params.id,
    all: params.opts.all,
  });

  if (pluginSelection.pluginIds.length === 0 && hookSelection.hookIds.length === 0) {
    if (params.opts.all) {
      defaultRuntime.log(t("plugins.update.noTracked"));
      return;
    }
    defaultRuntime.error(t("plugins.update.provideIdOrAll"));
    return defaultRuntime.exit(1);
  }

  const pluginResult: PluginUpdateResult = {
    changed: false,
    config: cfg,
    outcomes: [],
  };
  if (pluginSelection.pluginIds.length > 0) {
    const rustResults = [];
    if (params.opts.all) {
      rustResults.push(
        await updatePluginsWithRustLifecycle({
          all: true,
          dryRun: params.opts.dryRun,
          config: cfg,
        }),
      );
    } else {
      for (const id of pluginSelection.pluginIds) {
        rustResults.push(
          await updatePluginsWithRustLifecycle({
            id,
            dryRun: params.opts.dryRun,
            config: pluginResult.config,
          }),
        );
      }
    }
    for (const result of rustResults) {
      if (!result.ok) {
        pluginResult.outcomes.push({
          status: "error",
          message: result.error,
        });
        continue;
      }
      pluginResult.config = result.config ?? pluginResult.config;
      pluginResult.changed =
        pluginResult.changed ||
        result.value.changed === true ||
        result.value.requiresRestart === true;
      const outcomes = result.value.outcomes;
      if (Array.isArray(outcomes)) {
        pluginResult.outcomes.push(
          ...outcomes.filter((outcome): outcome is PluginUpdateOutcome => {
            return Boolean(outcome && typeof outcome === "object");
          }),
        );
      }
    }
  }
  const hookResult = await updateNpmInstalledHookPacks({
    config: pluginResult.config,
    hookIds: hookSelection.hookIds,
    specOverrides: hookSelection.specOverrides,
    dryRun: params.opts.dryRun,
    logger,
    onIntegrityDrift: async (drift) => {
      const specLabel = drift.resolvedSpec ?? drift.spec;
      defaultRuntime.log(
        theme.warn(
          t("plugins.update.integrityDrift.hook", {
            hookId: drift.hookId,
            spec: specLabel,
          }) +
            `\n${t("plugins.update.expected")}: ${drift.expectedIntegrity}` +
            `\n${t("plugins.update.actual")}:   ${drift.actualIntegrity}`,
        ),
      );
      if (drift.dryRun) {
        return true;
      }
      return await promptYesNo(t("plugins.update.continueHook", { hookId: drift.hookId }));
    },
  });

  for (const outcome of pluginResult.outcomes) {
    if (outcome.status === "error") {
      defaultRuntime.log(theme.error(outcome.message));
      continue;
    }
    if (outcome.status === "skipped") {
      defaultRuntime.log(theme.warn(outcome.message));
      continue;
    }
    defaultRuntime.log(outcome.message);
  }

  for (const outcome of hookResult.outcomes) {
    if (outcome.status === "error") {
      defaultRuntime.log(theme.error(outcome.message));
      continue;
    }
    if (outcome.status === "skipped") {
      defaultRuntime.log(theme.warn(outcome.message));
      continue;
    }
    defaultRuntime.log(outcome.message);
  }

  if (!params.opts.dryRun && (pluginResult.changed || hookResult.changed)) {
    await replaceConfigFile({
      nextConfig: hookResult.config,
      baseHash: (await sourceSnapshotPromise)?.hash,
    });
    defaultRuntime.log(t("plugins.update.restartTip"));
  }
}
