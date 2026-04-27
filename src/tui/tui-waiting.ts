import { createCliTranslator } from "../cli/i18n/index.js";
import { translateTuiText } from "../cli/i18n/tui.js";

type MinimalTheme = {
  dim: (s: string) => string;
  bold: (s: string) => string;
  accentSoft: (s: string) => string;
};

const en = createCliTranslator("en");

function parseWaitingPhrases(value: string): string[] {
  return value
    .split("|")
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

function getDefaultWaitingPhrases() {
  return parseWaitingPhrases(en("tui.waiting.phrases"));
}

export function pickWaitingPhrase(tick: number, phrases = getDefaultWaitingPhrases()) {
  const idx = Math.floor(tick / 10) % phrases.length;
  return phrases[idx] ?? phrases[0] ?? en("tui.common.waiting");
}

export function getLocalizedWaitingPhrases(): string[] {
  const translated = parseWaitingPhrases(translateTuiText("tui.waiting.phrases"));
  if (translated.length > 0 && translated[0] !== "tui.waiting.phrases") {
    return translated;
  }
  const fallback = getDefaultWaitingPhrases();
  return fallback.length > 0 ? fallback : [en("tui.common.waiting")];
}

export function shimmerText(theme: MinimalTheme, text: string, tick: number) {
  const width = 6;
  const hi = (ch: string) => theme.bold(theme.accentSoft(ch));

  const pos = tick % (text.length + width);
  const start = Math.max(0, pos - width);
  const end = Math.min(text.length - 1, pos);

  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out += i >= start && i <= end ? hi(ch) : theme.dim(ch);
  }
  return out;
}

export function buildWaitingStatusMessage(params: {
  theme: MinimalTheme;
  tick: number;
  elapsed: string;
  connectionStatus: string;
  phrases?: string[];
}) {
  const phrase = pickWaitingPhrase(params.tick, params.phrases ?? getLocalizedWaitingPhrases());
  const cute = shimmerText(params.theme, `${phrase}…`, params.tick);
  return `${cute} • ${params.elapsed} | ${params.connectionStatus}`;
}
