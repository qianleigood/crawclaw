import { installSkill } from "../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../agents/skills-status.js";
import { formatCliCommand } from "../cli/command-format.js";
import { createCliTranslator, getActiveCliLocale } from "../cli/i18n/text.js";
import type { CrawClawConfig } from "../config/config.js";
import { openUrl } from "../infra/browser-open.js";
import type { RuntimeEnv } from "../runtime.js";
import { normalizeSecretInput } from "../utils/normalize-secret-input.js";
import { type WizardPrompter } from "../wizard/prompts.js";
import { detectBinary, resolveNodeManagerOptions } from "./onboard-helpers.js";

const OLLAMA_EMBEDDING_BASE_URL = "http://127.0.0.1:11434";
const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";
const OLLAMA_EMBEDDING_MODELS = [
  {
    value: "nomic-embed-text",
    labelKey: "wizard.skills.semanticModel.nomic.label",
    hintKey: "wizard.skills.semanticModel.nomic.hint",
  },
  {
    value: "qwen3-embedding:0.6b",
    labelKey: "wizard.skills.semanticModel.qwen3Small.label",
    hintKey: "wizard.skills.semanticModel.qwen3Small.hint",
  },
  {
    value: "mxbai-embed-large",
    labelKey: "wizard.skills.semanticModel.mxbai.label",
    hintKey: "wizard.skills.semanticModel.mxbai.hint",
  },
];

type OllamaEmbeddingSetupAction = "download" | "retry" | "continue" | "skip";

function summarizeInstallFailure(message: string): string | undefined {
  const cleaned = message.replace(/^Install failed(?:\s*\([^)]*\))?\s*:?\s*/i, "").trim();
  if (!cleaned) {
    return undefined;
  }
  const maxLen = 140;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

function upsertSkillEntry(
  cfg: CrawClawConfig,
  skillKey: string,
  patch: { apiKey?: string },
): CrawClawConfig {
  const entries = { ...cfg.skills?.entries };
  const existing = (entries[skillKey] as { apiKey?: string } | undefined) ?? {};
  entries[skillKey] = { ...existing, ...patch };
  return {
    ...cfg,
    skills: {
      ...cfg.skills,
      entries,
    },
  };
}

function isSemanticSkillDiscoveryConfigured(cfg: CrawClawConfig): boolean {
  const semantic = cfg.skills?.discovery?.semantic;
  return Boolean(semantic?.enabled === true && semantic.provider?.trim() && semantic.model?.trim());
}

function applyOllamaSemanticSkillDiscovery(cfg: CrawClawConfig, model: string): CrawClawConfig {
  return {
    ...cfg,
    skills: {
      ...cfg.skills,
      discovery: {
        ...cfg.skills?.discovery,
        semantic: {
          ...cfg.skills?.discovery?.semantic,
          enabled: true,
          provider: "ollama",
          model,
        },
      },
    },
  };
}

async function isOllamaReachableForEmbeddings(): Promise<boolean> {
  try {
    await fetch(`${OLLAMA_EMBEDDING_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

function formatOllamaEmbeddingInstallGuidance(t: ReturnType<typeof createCliTranslator>): string {
  return t("wizard.skills.semanticOllamaInstall", {
    url: OLLAMA_DOWNLOAD_URL,
    linuxCommand: "curl -fsSL https://ollama.com/install.sh | sh",
    serveCommand: "ollama serve",
  });
}

async function ensureOllamaEmbeddingRuntime(
  prompter: WizardPrompter,
  t: ReturnType<typeof createCliTranslator>,
): Promise<boolean> {
  for (;;) {
    if (await isOllamaReachableForEmbeddings()) {
      return true;
    }
    await prompter.note(formatOllamaEmbeddingInstallGuidance(t), t("wizard.skills.semanticTitle"));
    const action = (await prompter.select({
      message: t("wizard.skills.semanticOllamaUnavailable"),
      options: [
        {
          value: "download",
          label: t("wizard.skills.semanticOllamaOpenDownload"),
          hint: t("wizard.skills.semanticOllamaOpenDownloadHint"),
        },
        {
          value: "retry",
          label: t("wizard.skills.semanticOllamaRetry"),
          hint: t("wizard.skills.semanticOllamaRetryHint"),
        },
        {
          value: "continue",
          label: t("wizard.skills.semanticOllamaContinue"),
          hint: t("wizard.skills.semanticOllamaContinueHint"),
        },
        {
          value: "skip",
          label: t("wizard.skills.semanticOllamaSkip"),
        },
      ],
      initialValue: "download",
    })) as OllamaEmbeddingSetupAction;

    if (action === "download") {
      const opened = await openUrl(OLLAMA_DOWNLOAD_URL);
      if (!opened) {
        await prompter.note(OLLAMA_DOWNLOAD_URL, t("wizard.skills.semanticOllamaDownloadTitle"));
      }
      const retry = await prompter.confirm({
        message: t("wizard.skills.semanticOllamaRetryAfterInstall"),
        initialValue: true,
      });
      if (retry) {
        continue;
      }
      return false;
    }
    if (action === "retry") {
      continue;
    }
    return action === "continue";
  }
}

async function setupSemanticSkillDiscovery(
  cfg: CrawClawConfig,
  prompter: WizardPrompter,
  t: ReturnType<typeof createCliTranslator>,
): Promise<CrawClawConfig> {
  if (isSemanticSkillDiscoveryConfigured(cfg)) {
    return cfg;
  }
  const enabled = await prompter.confirm({
    message: t("wizard.skills.semanticPrompt"),
    initialValue: true,
  });
  if (!enabled) {
    return cfg;
  }
  if (!(await ensureOllamaEmbeddingRuntime(prompter, t))) {
    return cfg;
  }
  const model = await prompter.select({
    message: t("wizard.skills.semanticModelPrompt"),
    options: OLLAMA_EMBEDDING_MODELS.map((model) => ({
      value: model.value,
      label: t(model.labelKey),
      hint: t(model.hintKey),
    })),
    initialValue: "nomic-embed-text",
  });
  return applyOllamaSemanticSkillDiscovery(cfg, model);
}

export async function setupSkills(
  cfg: CrawClawConfig,
  workspaceDir: string,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<CrawClawConfig> {
  const t = createCliTranslator(getActiveCliLocale());
  const report = buildWorkspaceSkillStatus(workspaceDir, { config: cfg });
  const eligible = report.skills.filter((s) => s.eligible);
  const unsupportedOs = report.skills.filter(
    (s) => !s.disabled && !s.blockedByAllowlist && s.missing.os.length > 0,
  );
  const missing = report.skills.filter(
    (s) => !s.eligible && !s.disabled && !s.blockedByAllowlist && s.missing.os.length === 0,
  );
  const blocked = report.skills.filter((s) => s.blockedByAllowlist);

  await prompter.note(
    t("wizard.skills.status", {
      eligible: eligible.length,
      missing: missing.length,
      unsupported: unsupportedOs.length,
      blocked: blocked.length,
    }),
    t("wizard.skills.statusTitle"),
  );

  const installable = missing.filter(
    (skill) => skill.install.length > 0 && skill.missing.bins.length > 0,
  );
  let next: CrawClawConfig = cfg;
  if (installable.length > 0) {
    const shouldInstall = await prompter.confirm({
      message: t("wizard.skills.installPrompt"),
      initialValue: true,
    });
    const selectedSkills = shouldInstall ? installable : [];

    const needsBrewPrompt =
      process.platform !== "win32" &&
      selectedSkills.some((skill) => skill.install.some((option) => option.kind === "brew")) &&
      !(await detectBinary("brew"));

    if (needsBrewPrompt) {
      await prompter.note(
        t("wizard.skills.homebrewRecommended"),
        t("wizard.skills.homebrewRecommendedTitle"),
      );
      const showBrewInstall = await prompter.confirm({
        message: t("ui.text.showHomebrewInstall"),
        initialValue: true,
      });
      if (showBrewInstall) {
        await prompter.note(
          t("wizard.skills.homebrewInstall", {
            command:
              '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
          }),
          t("wizard.skills.homebrewInstallTitle"),
        );
      }
    }

    const needsNodeManagerPrompt = selectedSkills.some((skill) =>
      skill.install.some((option) => option.kind === "node"),
    );
    if (needsNodeManagerPrompt) {
      const nodeManager = (await prompter.select({
        message: t("ui.text.preferredNodeManager"),
        options: resolveNodeManagerOptions(),
      })) as "npm" | "pnpm" | "bun";
      next = {
        ...next,
        skills: {
          ...next.skills,
          install: {
            ...next.skills?.install,
            nodeManager,
          },
        },
      };
    }

    for (const target of selectedSkills) {
      if (target.install.length === 0) {
        continue;
      }
      const installId = target.install[0]?.id;
      if (!installId) {
        continue;
      }
      const spin = prompter.progress(t("wizard.skills.installing", { name: target.name }));
      const result = await installSkill({
        workspaceDir,
        skillName: target.name,
        installId,
        config: next,
      });
      const warnings = result.warnings ?? [];
      if (result.ok) {
        spin.stop(
          warnings.length > 0
            ? t("wizard.skills.installedWithWarnings", { name: target.name })
            : t("wizard.skills.installed", { name: target.name }),
        );
        for (const warning of warnings) {
          runtime.log(warning);
        }
        continue;
      }
      const code = result.code == null ? "" : ` (exit ${result.code})`;
      const codeText =
        result.code == null ? "" : t("wizard.skills.exitCode", { code: result.code });
      const detail = summarizeInstallFailure(result.message);
      spin.stop(
        t("wizard.skills.installFailed", {
          name: target.name,
          code: codeText || code,
          detail: detail ? t("wizard.skills.failureDetail", { detail }) : "",
        }),
      );
      for (const warning of warnings) {
        runtime.log(warning);
      }
      if (result.stderr) {
        runtime.log(result.stderr.trim());
      } else if (result.stdout) {
        runtime.log(result.stdout.trim());
      }
      runtime.log(t("wizard.skills.doctorTip", { doctor: formatCliCommand("crawclaw doctor") }));
      runtime.log(t("wizard.skills.docs"));
    }
  }

  for (const skill of missing) {
    if (!skill.primaryEnv || skill.missing.env.length === 0) {
      continue;
    }
    const wantsKey = await prompter.confirm({
      message: t("wizard.skills.setEnv", { env: skill.primaryEnv, skill: skill.name }),
      initialValue: false,
    });
    if (!wantsKey) {
      continue;
    }
    const apiKey = await prompter.text({
      message: t("wizard.skills.enterEnv", { env: skill.primaryEnv }),
      validate: (value) => (value?.trim() ? undefined : t("wizard.required")),
    });
    next = upsertSkillEntry(next, skill.skillKey, { apiKey: normalizeSecretInput(apiKey) });
  }

  next = await setupSemanticSkillDiscovery(next, prompter, t);

  return next;
}
