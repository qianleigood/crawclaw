import { EN_CLI_TRANSLATIONS } from "./en.js";
import type { CliLocale, CliTranslationParams, CliTranslations, CliTranslator } from "./types.js";
import { ZH_CN_CLI_TRANSLATIONS } from "./zh-CN.js";

let activeCliLocale: CliLocale = "en";
let englishTextToKey: Map<string, string> | undefined;

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

function getEnglishTextToKey(): Map<string, string> {
  if (englishTextToKey) {
    return englishTextToKey;
  }
  const next = new Map<string, string>();
  for (const [key, value] of Object.entries(EN_CLI_TRANSLATIONS)) {
    if (!next.has(value)) {
      next.set(value, key);
    }
  }
  englishTextToKey = next;
  return next;
}

export function setActiveCliLocale(locale: CliLocale): void {
  activeCliLocale = locale;
}

export function getActiveCliLocale(): CliLocale {
  return activeCliLocale;
}

export function translateCliText(locale: CliLocale, text: string): string {
  if (locale === "en" || text.trim().length === 0) {
    return text;
  }
  const key = getEnglishTextToKey().get(text);
  if (!key) {
    return text;
  }
  return createCliTranslator(locale)(key);
}

export function translateActiveCliText(text: string): string {
  return translateCliText(activeCliLocale, text);
}
