import type { FrontmatterMap } from "../markdown/frontmatter.ts";
import type { DurableMemoryType } from "../types/orchestration.ts";

export const DURABLE_MEMORY_FOLDERS: Record<DurableMemoryType, string> = {
  user: "30 People",
  feedback: "60 Preferences",
  project: "20 Projects",
  reference: "80 References",
};

export type DurableMemoryNoteInput = {
  type: DurableMemoryType;
  title: string;
  description?: string;
  body?: string;
  why?: string;
  howToApply?: string;
  dedupeKey?: string;
  aliases?: string[];
  tags?: string[];
};

export type DurableMemoryWriteInput = DurableMemoryNoteInput & {
  summary?: string;
};

export function normalizeDurableMemoryType(
  value: string | null | undefined,
): DurableMemoryType | null {
  return value === "user" || value === "feedback" || value === "project" || value === "reference"
    ? value
    : null;
}

export function slugifyDurableMemoryValue(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "") || "memory"
  );
}

export function deriveDurableMemoryFilename(
  input: Pick<DurableMemoryWriteInput, "type" | "title" | "dedupeKey">,
): string {
  const stem = slugifyDurableMemoryValue(input.dedupeKey?.trim() || input.title);
  return `${stem}.md`;
}

export function deriveDurableMemoryNotePath(
  input: Pick<DurableMemoryWriteInput, "type" | "title" | "dedupeKey">,
): string {
  return `${DURABLE_MEMORY_FOLDERS[input.type]}/${deriveDurableMemoryFilename(input)}`;
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  );
}

export function resolveDurableMemoryDescription(
  input: Pick<DurableMemoryWriteInput, "description" | "summary" | "title">,
): string {
  return input.description?.trim() || input.summary?.trim() || input.title.trim();
}

export function normalizeDurableMemoryWriteInput(
  input: DurableMemoryWriteInput,
): DurableMemoryWriteInput {
  return {
    ...input,
    title: input.title.trim(),
    description: resolveDurableMemoryDescription(input),
    body: input.body?.trim() || undefined,
    why: input.why?.trim() || undefined,
    howToApply: input.howToApply?.trim() || undefined,
    dedupeKey: input.dedupeKey?.trim() || undefined,
    aliases: uniqueStrings(input.aliases ?? []),
    tags: uniqueStrings(input.tags ?? []),
  };
}

export function buildDurableMemoryFrontmatterLines(input: DurableMemoryWriteInput): string[] {
  const normalized = normalizeDurableMemoryWriteInput(input);
  const timestamp = new Date().toISOString();
  const aliases = uniqueStrings([...(normalized.aliases ?? []), normalized.dedupeKey?.trim()]);
  const tags = uniqueStrings([...(normalized.tags ?? []), "durable-memory", normalized.type]);
  const lines = [
    "---",
    `name: ${slugifyDurableMemoryValue(normalized.dedupeKey?.trim() || normalized.title)}`,
    `title: ${normalized.title}`,
    `description: ${resolveDurableMemoryDescription(normalized)}`,
    `type: ${normalized.type}`,
    `updated_at: ${timestamp}`,
    "source: crawclaw-durable-memory",
  ];
  if (normalized.dedupeKey?.trim()) {
    lines.push(`dedupe_key: ${normalized.dedupeKey.trim()}`);
  }
  if (aliases.length > 0) {
    lines.push(`aliases: [${aliases.map((item) => JSON.stringify(item)).join(", ")}]`);
  }
  if (tags.length > 0) {
    lines.push(`tags: [${tags.map((item) => JSON.stringify(item)).join(", ")}]`);
  }
  lines.push("---");
  return lines;
}

export function buildDurableMemoryFrontmatter(
  input: DurableMemoryWriteInput,
  scope?: {
    agentId: string;
    channel: string;
    userId: string;
    scopeKey?: string;
  } | null,
): FrontmatterMap {
  const normalized = normalizeDurableMemoryWriteInput(input);
  const timestamp = new Date().toISOString();
  const aliases = uniqueStrings([...(normalized.aliases ?? []), normalized.dedupeKey?.trim()]);
  const tags = uniqueStrings([...(normalized.tags ?? []), "durable-memory", normalized.type]);
  return {
    name: slugifyDurableMemoryValue(normalized.dedupeKey?.trim() || normalized.title),
    title: normalized.title,
    description: resolveDurableMemoryDescription(normalized),
    type: normalized.type,
    updated_at: timestamp,
    source: "crawclaw-durable-memory",
    ...(scope
      ? {
          scope_agent_id: scope.agentId,
          scope_channel: scope.channel,
          scope_user_id: scope.userId,
          scope_key: scope.scopeKey ?? scope.agentId,
        }
      : {}),
    ...(normalized.dedupeKey?.trim() ? { dedupe_key: normalized.dedupeKey.trim() } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

export function buildDurableMemoryBody(input: DurableMemoryWriteInput): string {
  const normalized = normalizeDurableMemoryWriteInput(input);
  const description = resolveDurableMemoryDescription(normalized);
  const sections: string[] = [`# ${normalized.title}`, "", "## Summary", description];
  if (normalized.why?.trim()) {
    sections.push("", "## Why", normalized.why.trim());
  }
  if (normalized.howToApply?.trim()) {
    sections.push("", "## How to apply", normalized.howToApply.trim());
  }
  if (normalized.body?.trim() && normalized.body.trim() !== description) {
    sections.push("", "## Details", normalized.body.trim());
  }
  return sections.join("\n\n").trim();
}

export function renderDurableMemoryNote(input: DurableMemoryWriteInput): string {
  return [...buildDurableMemoryFrontmatterLines(input), "", buildDurableMemoryBody(input)].join(
    "\n",
  );
}
