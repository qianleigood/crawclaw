import type { CliLocale } from "./types.js";

const SUPPORTED_CLI_LOCALES = new Set<CliLocale>(["en", "zh-CN"]);

function normalizeCliLocale(value: string | undefined): CliLocale | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (SUPPORTED_CLI_LOCALES.has(normalized as CliLocale)) {
    return normalized as CliLocale;
  }
  const canonical = normalized.split(".")[0]?.replaceAll("_", "-").toLowerCase();
  if (canonical?.startsWith("zh")) {
    return "zh-CN";
  }
  if (canonical?.startsWith("en")) {
    return "en";
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
  systemEnv?: string | readonly (string | undefined)[];
}): CliLocale {
  const flag = normalizeCliLocale(parseCliLocaleFlag(params?.argv ?? []));
  const config = normalizeCliLocale(params?.config);
  const env = normalizeCliLocale(params?.env);
  const systemEnvValues = Array.isArray(params?.systemEnv) ? params.systemEnv : [params?.systemEnv];
  const systemEnv = systemEnvValues
    .map((value) => normalizeCliLocale(value))
    .find((value) => value !== undefined);
  return flag ?? config ?? env ?? systemEnv ?? "en";
}
