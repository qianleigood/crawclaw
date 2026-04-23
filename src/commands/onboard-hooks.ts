import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { formatCliCommand } from "../cli/command-format.js";
import { createCliTranslator, getActiveCliLocale } from "../cli/i18n/text.js";
import type { CrawClawConfig } from "../config/config.js";
import { buildWorkspaceHookStatus } from "../hooks/hooks-status.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

export async function setupInternalHooks(
  cfg: CrawClawConfig,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<CrawClawConfig> {
  const t = createCliTranslator(getActiveCliLocale());
  await prompter.note(t("wizard.hooks.intro"), t("wizard.hooks.title"));

  // Discover available hooks using the hook discovery system
  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  const report = buildWorkspaceHookStatus(workspaceDir, { config: cfg });

  // Show every eligible hook so users can opt in during setup.
  const eligibleHooks = report.hooks.filter((h) => h.loadable);

  if (eligibleHooks.length === 0) {
    await prompter.note(t("wizard.hooks.none"), t("wizard.hooks.noneTitle"));
    return cfg;
  }

  const toEnable = await prompter.multiselect({
    message: t("ui.text.enableHooks"),
    options: [
      { value: "__skip__", label: t("ui.text.skipForNow") },
      ...eligibleHooks.map((hook) => ({
        value: hook.name,
        label: `${hook.emoji ?? "🔗"} ${hook.name}`,
        hint: hook.description,
      })),
    ],
  });

  const selected = toEnable.filter((name) => name !== "__skip__");
  if (selected.length === 0) {
    return cfg;
  }

  // Enable selected hooks using the new entries config format
  const entries = { ...cfg.hooks?.internal?.entries };
  for (const name of selected) {
    entries[name] = { enabled: true };
  }

  const next: CrawClawConfig = {
    ...cfg,
    hooks: {
      ...cfg.hooks,
      internal: {
        enabled: true,
        entries,
      },
    },
  };

  await prompter.note(
    t("wizard.hooks.configured", {
      count: selected.length,
      noun: t(selected.length > 1 ? "wizard.hooks.noun.many" : "wizard.hooks.noun.one"),
      names: selected.join(", "),
      list: formatCliCommand("crawclaw hooks list"),
      enable: formatCliCommand("crawclaw hooks enable <name>"),
      disable: formatCliCommand("crawclaw hooks disable <name>"),
    }),
    t("wizard.hooks.configuredTitle"),
  );

  return next;
}
