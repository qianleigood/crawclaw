import { translateActiveCliText } from "../cli/i18n/text.js";
import { isRich, theme } from "./theme.js";

export const stylePromptMessage = (message: string): string => {
  const translated = translateActiveCliText(message);
  return isRich() ? theme.accent(translated) : translated;
};

export const stylePromptTitle = (title?: string): string | undefined =>
  title && isRich() ? theme.heading(translateActiveCliText(title)) : translateOptional(title);

export const stylePromptHint = (hint?: string): string | undefined =>
  hint && isRich() ? theme.muted(translateActiveCliText(hint)) : translateOptional(hint);

function translateOptional(value?: string): string | undefined {
  return value === undefined ? undefined : translateActiveCliText(value);
}
