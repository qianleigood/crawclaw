import type {
  SkillMetadata,
  UnifiedRecallIntent,
  UnifiedRecallLayer,
  UnifiedSkillFamily,
} from "../types/orchestration.ts";

export const SKILL_FAMILIES = [
  "architecture",
  "operations",
  "workspace-defaults",
  "incident",
  "multimodal",
  "other",
] as const satisfies UnifiedSkillFamily[];

export const SKILL_INTENTS = [
  "decision",
  "sop",
  "preference",
  "runtime",
  "history",
  "entity_lookup",
  "broad",
] as const satisfies UnifiedRecallIntent[];

export const SKILL_LAYERS = [
  "key_decisions",
  "sop",
  "preferences",
  "runtime_signals",
  "sources",
] as const satisfies UnifiedRecallLayer[];

export type SkillFrontmatterDeclaration = Partial<Pick<
  SkillMetadata,
  "name" | "description" | "family" | "intents" | "layers" | "tags" | "workspaceScope" | "priority" | "disableModelInvocation"
>>;

type SkillFrontmatterNamespace = {
  crawclaw?: Record<string, unknown>;
};

export type SkillFrontmatterValidation =
  | { ok: true; value: SkillFrontmatterDeclaration; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeEnumArray<T extends readonly string[]>(value: unknown, allowed: T): T[number][] {
  const allowedSet = new Set<string>(allowed);
  return normalizeStringArray(value).filter((item): item is T[number] => allowedSet.has(item));
}

function normalizePriority(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function resolveRoutingNamespace(record: Record<string, unknown>): Record<string, unknown> {
  const namespaced = record.crawclaw;
  if (namespaced && typeof namespaced === "object" && !Array.isArray(namespaced)) {
    return namespaced as Record<string, unknown>;
  }
  return record;
}

export function validateSkillFrontmatter(record: Record<string, unknown> & SkillFrontmatterNamespace): SkillFrontmatterValidation {
  const warnings: string[] = [];
  const errors: string[] = [];
  const name = normalizeString(record.name);
  const description = normalizeString(record.description);
  const routing = resolveRoutingNamespace(record);
  const usingLegacyFlatFields = !record.crawclaw && (
    "family" in record
    || "intents" in record
    || "layers" in record
    || "tags" in record
    || "workspaceScope" in record
    || "priority" in record
    || "disableModelInvocation" in record
  );
  const family = normalizeString(routing.family) as UnifiedSkillFamily;
  const intents = normalizeEnumArray(routing.intents, SKILL_INTENTS);
  const layers = normalizeEnumArray(routing.layers, SKILL_LAYERS);
  const tags = normalizeStringArray(routing.tags);
  const workspaceScope = normalizeStringArray(routing.workspaceScope);
  const priority = normalizePriority(routing.priority);
  const disableModelInvocation = normalizeBoolean(routing.disableModelInvocation);

  if (routing.family != null && !SKILL_FAMILIES.includes(family)) {
    errors.push(`family must be one of: ${SKILL_FAMILIES.join(", ")}`);
  }
  if (routing.intents != null && intents.length === 0) {
    errors.push(`intents must contain values from: ${SKILL_INTENTS.join(", ")}`);
  }
  if (routing.layers != null && layers.length === 0) {
    errors.push(`layers must contain values from: ${SKILL_LAYERS.join(", ")}`);
  }
  if (priority != null && (priority < 0 || priority > 1)) {
    errors.push("priority must be between 0 and 1");
  }
  if (!name && record.name != null) {
    warnings.push("name was provided but normalized to empty");
  }
  if (!description && record.description != null) {
    warnings.push("description was provided but normalized to empty");
  }
  if (usingLegacyFlatFields) {
    warnings.push("routing metadata should move under the `crawclaw` frontmatter namespace");
  }

  if (errors.length) {
    return { ok: false, errors, warnings };
  }

  return {
    ok: true,
    value: {
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      ...(family ? { family } : {}),
      ...(intents.length ? { intents } : {}),
      ...(layers.length ? { layers } : {}),
      ...(tags.length ? { tags } : {}),
      ...(workspaceScope.length ? { workspaceScope } : {}),
      ...(priority != null ? { priority } : {}),
      ...(disableModelInvocation != null ? { disableModelInvocation } : {}),
    },
    warnings,
  };
}
