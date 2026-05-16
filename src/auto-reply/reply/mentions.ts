import { resolveAgentConfig } from "../../agents/agent-scope.js";
import type { CrawClawConfig } from "../../config/config.js";
import { compileConfigRegexes } from "../../security/config-regex.js";
import { escapeRegExp } from "../../utils.js";
import type { MsgContext } from "../templating.js";

export const CURRENT_MESSAGE_MARKER = "[Current message - respond to this]";

function deriveMentionPatterns(identity?: { name?: string; emoji?: string }) {
  const patterns: string[] = [];
  const name = identity?.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean).map(escapeRegExp);
    patterns.push(
      String.raw`\b@?${parts.length ? parts.join(String.raw`\s+`) : escapeRegExp(name)}\b`,
    );
  }
  const emoji = identity?.emoji?.trim();
  if (emoji) {
    patterns.push(escapeRegExp(emoji));
  }
  return patterns;
}

function resolveMentionPatterns(cfg: CrawClawConfig | undefined, agentId?: string): string[] {
  if (!cfg) {
    return [];
  }
  const agentConfig = agentId ? resolveAgentConfig(cfg, agentId) : undefined;
  const agentGroupChat = agentConfig?.groupChat;
  if (agentGroupChat && Object.hasOwn(agentGroupChat, "mentionPatterns")) {
    return agentGroupChat.mentionPatterns ?? [];
  }
  const globalGroupChat = cfg.messages?.groupChat;
  if (globalGroupChat && Object.hasOwn(globalGroupChat, "mentionPatterns")) {
    return globalGroupChat.mentionPatterns ?? [];
  }
  return deriveMentionPatterns(agentConfig?.identity);
}

export function buildMentionRegexes(cfg: CrawClawConfig | undefined, agentId?: string): RegExp[] {
  const compiled = compileConfigRegexes(resolveMentionPatterns(cfg, agentId), "i");
  return compiled.regexes;
}

export function normalizeMentionText(text: string): string {
  return (text ?? "").replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "").toLowerCase();
}

export function matchesMentionPatterns(text: string, mentionRegexes: RegExp[]): boolean {
  const cleaned = normalizeMentionText(text ?? "");
  return Boolean(cleaned) && mentionRegexes.some((re) => re.test(cleaned));
}

export type ExplicitMentionSignal = {
  hasAnyMention: boolean;
  isExplicitlyMentioned: boolean;
  canResolveExplicit: boolean;
};

export function matchesMentionWithExplicit(params: {
  text: string;
  mentionRegexes: RegExp[];
  explicit?: ExplicitMentionSignal;
  transcript?: string;
}): boolean {
  const cleaned = normalizeMentionText(params.text ?? "");
  const transcriptCleaned = params.transcript ? normalizeMentionText(params.transcript) : "";
  const textToCheck = cleaned || transcriptCleaned;
  const explicit = params.explicit?.isExplicitlyMentioned === true;
  const explicitAvailable = params.explicit?.canResolveExplicit === true;
  const hasAnyMention = params.explicit?.hasAnyMention === true;
  if (hasAnyMention && explicitAvailable) {
    return explicit || params.mentionRegexes.some((re) => re.test(textToCheck));
  }
  if (!textToCheck) {
    return explicit;
  }
  return explicit || params.mentionRegexes.some((re) => re.test(textToCheck));
}

export function stripStructuralPrefixes(text: string): string {
  if (!text) {
    return "";
  }
  const afterMarker = text.includes(CURRENT_MESSAGE_MARKER)
    ? text.slice(text.indexOf(CURRENT_MESSAGE_MARKER) + CURRENT_MESSAGE_MARKER.length).trimStart()
    : text;

  return afterMarker
    .replace(/\[[^\]]+\]\s*/g, "")
    .replace(/^[ \t]*[A-Za-z0-9+()\-_. ]+:\s*/gm, "")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripMentions(
  text: string,
  _ctx: MsgContext,
  cfg: CrawClawConfig | undefined,
  agentId?: string,
): string {
  let result = text;
  const compiled = compileConfigRegexes(resolveMentionPatterns(cfg, agentId), "gi");
  for (const re of compiled.regexes) {
    result = result.replace(re, " ");
  }
  return result
    .replace(/@[0-9+]{5,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
