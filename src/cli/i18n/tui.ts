import { EN_CLI_TRANSLATIONS } from "./en.js";
import { createCliTranslator, getActiveCliLocale } from "./text.js";
import type { CliLocale, CliTranslationParams } from "./types.js";

export function translateTuiText(
  key: string,
  params?: CliTranslationParams,
  locale: CliLocale = getActiveCliLocale(),
): string {
  return createCliTranslator(locale)(key, params);
}

export function formatTuiStateLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  const key = `tui.common.${normalized}`;
  if (key in EN_CLI_TRANSLATIONS) {
    return translateTuiText(key);
  }
  return value;
}

export function formatTuiOnOff(value: boolean): string {
  return translateTuiText(value ? "tui.common.on" : "tui.common.off");
}

export function formatTuiEnabledDisabled(value: boolean): string {
  return translateTuiText(value ? "tui.common.enabled" : "tui.common.disabled");
}
