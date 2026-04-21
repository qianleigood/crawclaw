import { loadConfig } from "../../config/config.js";
import { EN_CLI_TRANSLATIONS } from "./en.js";
import type { CliLocale, CliTranslationParams, CliTranslations, CliTranslator } from "./types.js";
import { ZH_CN_CLI_TRANSLATIONS } from "./zh-CN.js";

const SUPPORTED_CLI_LOCALES = new Set<CliLocale>(["en", "zh-CN"]);

function normalizeCliLocale(value: string | undefined): CliLocale | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (SUPPORTED_CLI_LOCALES.has(normalized as CliLocale)) {
    return normalized as CliLocale;
  }
  return undefined;
}

export function parseCliLocaleFlag(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg === "--lang") {
      return argv[index + 1];
    }
    if (arg.startsWith("--lang=")) {
      return arg.slice("--lang=".length);
    }
  }
  return undefined;
}

export function resolveCliLocale(params?: {
  argv?: readonly string[];
  config?: string;
  env?: string;
}): CliLocale {
  const flag = normalizeCliLocale(parseCliLocaleFlag(params?.argv ?? []));
  const config = normalizeCliLocale(params?.config);
  const env = normalizeCliLocale(params?.env);
  return flag ?? config ?? env ?? "en";
}

function applyParams(template: string, params?: CliTranslationParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`));
}

export function createCliTranslator(locale: CliLocale): CliTranslator {
  const primary: CliTranslations =
    locale === "zh-CN" ? ZH_CN_CLI_TRANSLATIONS : EN_CLI_TRANSLATIONS;
  return (key, params) => applyParams(primary[key] ?? EN_CLI_TRANSLATIONS[key] ?? key, params);
}

export function resolveCliLocaleFromRuntime(argv: readonly string[]): CliLocale {
  let configLanguage: string | undefined;
  try {
    configLanguage = loadConfig().cli?.language;
  } catch {
    // Locale resolution must never block CLI startup or test doubles that only
    // mock the config reads they exercise. Fall back to env/flag/default.
    configLanguage = undefined;
  }
  return resolveCliLocale({
    argv,
    config: configLanguage,
    env: process.env.CRAWCLAW_LANG,
  });
}
