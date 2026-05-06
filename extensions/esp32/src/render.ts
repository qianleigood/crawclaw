import {
  ESP32_AFFECT_STATES,
  type Esp32Affect,
  type Esp32AffectState,
  type Esp32RenderedReply,
  type Esp32RendererConfig,
} from "./types.js";

const DEFAULT_MAX_SPOKEN_CHARS = 40;
const DEFAULT_MAX_DISPLAY_CHARS = 72;
const AFFECT_STATES = new Set<string>(ESP32_AFFECT_STATES);

export type Esp32ReplyRenderer = (prompt: string) => Promise<string>;

type RenderEsp32ReplyParams = {
  text: string;
  renderer?: Esp32ReplyRenderer;
  config?: Esp32RendererConfig;
};

function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return chars.slice(0, maxChars).join("").trimEnd();
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/([\p{Script=Han}。，！？；：])\s+([\p{Script=Han}])/gu, "$1$2")
    .trim();
}

function stripTechnicalText(text: string): string {
  const withoutFences = text.replace(/```[\s\S]*?```/g, " ");
  const withoutInlineCode = withoutFences.replace(/`[^`]*`/g, " ");
  const withoutPaths = withoutInlineCode.replace(
    /(?:^|\s)(?:[A-Za-z]:\\|\/)[^\s:]+(?:[\\/][^\s:]+)+(?:\:\d+)?/g,
    " ",
  );
  const withoutJsonBlocks = withoutPaths.replace(/\{(?:[^{}]|\{[^{}]*\}){8,}\}/g, " ");
  const lines = withoutJsonBlocks
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(?:[-*]|\d+[.)]|[$>#])\s+/.test(line))
    .filter((line) => !/^(?:stdout|stderr|error|warn|info)\b/i.test(line));
  return normalizeWhitespace(lines.join(" "));
}

function inferAffect(text: string): Esp32Affect {
  const normalized = text.trim().toLowerCase();
  if (/抱歉|不好意思|sorry|apolog/i.test(normalized)) {
    return { state: "apologetic" };
  }
  if (/离线|offline|失败|错误|error|failed|crash/i.test(normalized)) {
    return { state: "error" };
  }
  if (/^(?:完成|已完成|成功|ok\b|done\b|success\b)/i.test(normalized)) {
    return { state: "success" };
  }
  return { state: "neutral" };
}

function coerceAffect(value: unknown, fallback: Esp32Affect): Esp32Affect {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const raw = value as Record<string, unknown>;
  const state = typeof raw.state === "string" ? raw.state : "";
  if (!AFFECT_STATES.has(state)) {
    return fallback;
  }
  return {
    state: state as Esp32AffectState,
    ...(typeof raw.expression === "string" && raw.expression.trim()
      ? { expression: raw.expression.trim() }
      : {}),
    ...(typeof raw.intensity === "number" && Number.isFinite(raw.intensity)
      ? { intensity: Math.max(0, Math.min(1, raw.intensity)) }
      : {}),
    ...(typeof raw.led === "string" && raw.led.trim() ? { led: raw.led.trim() } : {}),
    ...(typeof raw.chime === "string" && raw.chime.trim() ? { chime: raw.chime.trim() } : {}),
  };
}

function hardGateReply(
  value: Esp32RenderedReply,
  config: Esp32RendererConfig | undefined,
): Esp32RenderedReply {
  const maxSpokenChars = config?.maxSpokenChars ?? DEFAULT_MAX_SPOKEN_CHARS;
  const maxDisplayChars = config?.maxDisplayChars ?? DEFAULT_MAX_DISPLAY_CHARS;
  const spokenText = truncateChars(
    stripTechnicalText(value.spokenText) || "我处理好了，完整内容已保留在 CrawClaw。",
    maxSpokenChars,
  );
  const displayText = truncateChars(
    stripTechnicalText(value.displayText) || spokenText,
    maxDisplayChars,
  );
  return {
    spokenText,
    displayText,
    affect: coerceAffect(value.affect, inferAffect(spokenText)),
  };
}

function parseRendererJson(text: string): Esp32RenderedReply | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const record = raw as Record<string, unknown>;
    if (typeof record.spokenText !== "string") {
      return null;
    }
    return {
      spokenText: record.spokenText,
      displayText: typeof record.displayText === "string" ? record.displayText : record.spokenText,
      affect: coerceAffect(record.affect, inferAffect(record.spokenText)),
    };
  } catch {
    return null;
  }
}

export function buildEsp32RendererPrompt(text: string, config?: Esp32RendererConfig): string {
  const maxSpokenChars = config?.maxSpokenChars ?? DEFAULT_MAX_SPOKEN_CHARS;
  const maxDisplayChars = config?.maxDisplayChars ?? DEFAULT_MAX_DISPLAY_CHARS;
  return [
    "Render this CrawClaw assistant reply for an ESP32-S3-BOX-3 desktop assistant.",
    'Return strict JSON only: {"spokenText": string, "displayText": string, "affect": {"state": string, "expression"?: string}}.',
    `spokenText must be <= ${maxSpokenChars} characters for Chinese or very short English.`,
    `displayText must be <= ${maxDisplayChars} characters.`,
    "Do not include code, logs, paths, JSON payloads, markdown tables, or long lists.",
    `Allowed affect.state values: ${ESP32_AFFECT_STATES.join(", ")}.`,
    "",
    text,
  ].join("\n");
}

export async function renderEsp32Reply(
  params: RenderEsp32ReplyParams,
): Promise<Esp32RenderedReply> {
  const fallback: Esp32RenderedReply = {
    spokenText: params.text,
    displayText: params.text,
    affect: inferAffect(params.text),
  };

  if (!params.renderer) {
    return hardGateReply(fallback, params.config);
  }

  try {
    const raw = await params.renderer(buildEsp32RendererPrompt(params.text, params.config));
    const parsed = parseRendererJson(raw);
    if (parsed) {
      return hardGateReply(parsed, params.config);
    }
  } catch {
    // Fall through to deterministic rendering. The ESP32 channel should never
    // block a user reply because the optional renderer model failed.
  }

  return hardGateReply(fallback, params.config);
}
