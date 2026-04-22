import { loadConfig } from "../../config/config.js";
import { setActiveCliLocale } from "./text.js";
import type { CliLocale } from "./types.js";

export {
  createCliTranslator,
  getActiveCliLocale,
  setActiveCliLocale,
  translateActiveCliText,
  translateCliText,
} from "./text.js";

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

export function resolveCliLocaleFromRuntime(argv: readonly string[]): CliLocale {
  let configLanguage: string | undefined;
  try {
    configLanguage = loadConfig().cli?.language;
  } catch {
    // Locale resolution must never block CLI startup or test doubles that only
    // mock the config reads they exercise. Fall back to env/flag/default.
    configLanguage = undefined;
  }
  const locale = resolveCliLocale({
    argv,
    config: configLanguage,
    env: process.env.CRAWCLAW_LANG,
  });
  setActiveCliLocale(locale);
  return locale;
}
