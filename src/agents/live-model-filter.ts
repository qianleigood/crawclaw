import { normalizeProviderId } from "./provider-id.js";

export type ModelRef = {
  provider?: string | null;
  id?: string | null;
};

function isHighSignalClaudeModelId(id: string): boolean {
  const normalized = id.replace(/[_.]/g, "-");
  if (!/\bclaude\b/i.test(normalized)) {
    return true;
  }
  if (/\bhaiku\b/i.test(normalized)) {
    return false;
  }
  if (/\bclaude-3(?:[-.]5|[-.]7)\b/i.test(normalized)) {
    return false;
  }
  const versionMatch = normalized.match(/\bclaude-[a-z0-9-]*?-(\d+)(?:-(\d+))?(?:\b|[-])/i);
  if (!versionMatch) {
    return false;
  }
  const major = Number.parseInt(versionMatch[1] ?? "0", 10);
  const minor = Number.parseInt(versionMatch[2] ?? "0", 10);
  if (major > 4) {
    return true;
  }
  if (major < 4) {
    return false;
  }
  return minor >= 6;
}

export function isModernModelRef(ref: ModelRef): boolean {
  const provider = normalizeProviderId(ref.provider ?? "");
  const id = ref.id?.trim().toLowerCase() ?? "";
  if (!provider || !id) {
    return false;
  }

  return provider === "anthropic" && isHighSignalClaudeModelId(id);
}

export function isHighSignalLiveModelRef(ref: ModelRef): boolean {
  const id = ref.id?.trim().toLowerCase() ?? "";
  if (!isModernModelRef(ref) || !id) {
    return false;
  }
  return isHighSignalClaudeModelId(id);
}
