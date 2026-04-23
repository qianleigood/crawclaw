import { loadConfig } from "../../config/config.js";
import { resolveCliLocale } from "./locale.js";
import { setActiveCliLocale } from "./text.js";
import type { CliLocale } from "./types.js";

export {
  createCliTranslator,
  getActiveCliLocale,
  setActiveCliLocale,
  translateActiveCliText,
  translateCliText,
} from "./text.js";
export { parseCliLocaleFlag, resolveCliLocale } from "./locale.js";
export {
  formatTuiEnabledDisabled,
  formatTuiOnOff,
  formatTuiStateLabel,
  translateTuiText,
} from "./tui.js";

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
    systemEnv: [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG],
  });
  setActiveCliLocale(locale);
  return locale;
}
