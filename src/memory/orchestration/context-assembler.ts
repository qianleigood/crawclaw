import type {
  QueryContextSection,
  QueryContextSectionSchema,
} from "../../agents/query-context/types.js";
import {
  buildKnowledgeCardSummary,
  getKnowledgeItemLabel,
  getKnowledgeLayerHeading,
  getKnowledgeSourceLabel,
  KNOWLEDGE_DISPLAY_HEADING,
} from "../knowledge/knowledge-display.ts";
import { estimateTokenCount } from "../recall/token-estimate.ts";
import { renderSessionSummaryPromptSection } from "../session-summary/sections.ts";
import type {
  DurableMemoryItem,
  MemoryPromptAssemblyInput,
  MemoryPromptAssemblyResult,
  MemoryPromptSection,
  UnifiedContextAssemblyInput,
  UnifiedContextAssemblyResult,
  UnifiedRankedItem,
  UnifiedRecallLayer,
} from "../types/orchestration.ts";

const KNOWLEDGE_LAYER_ORDER: UnifiedRecallLayer[] = [
  "key_decisions",
  "sop",
  "preferences",
  "runtime_signals",
  "sources",
];

const DURABLE_HEADING = "## Durable memory";
const KNOWLEDGE_HEADING = KNOWLEDGE_DISPLAY_HEADING;

function estimateTokens(text: string): number {
  return estimateTokenCount(text);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function citation(item: UnifiedRankedItem): string {
  return `[${item.source}:${item.sourceRef ?? item.id}]`;
}

function durableLabel(item: DurableMemoryItem): string {
  if (item.durableKind === "user") {
    return `User memory: ${item.title}`;
  }
  if (item.durableKind === "feedback") {
    return `Feedback memory: ${item.title}`;
  }
  if (item.durableKind === "project") {
    return `Project memory: ${item.title}`;
  }
  if (item.durableKind === "reference") {
    return `Reference memory: ${item.title}`;
  }
  return item.title;
}

function knowledgeLabel(item: UnifiedRankedItem): string {
  return `${getKnowledgeItemLabel(item)}${item.title}`;
}

function formatDurableItemLine(item: DurableMemoryItem): string {
  const summary = truncate(item.summary || item.content || item.title, 160);
  const freshness =
    typeof item.metadata?.freshnessText === "string" && item.metadata.freshnessText.trim()
      ? ` Freshness: ${truncate(item.metadata.freshnessText, 140)}`
      : "";
  return `- ${durableLabel(item)}: ${summary}${freshness} ${citation(item)}`;
}

function formatKnowledgeItemLine(item: UnifiedRankedItem): string {
  const summary = buildKnowledgeCardSummary(item, item.layer === "runtime_signals" ? 120 : 160);
  return `- ${knowledgeLabel(item)} ${summary} ${citation(item)}`;
}

function formatSourceLine(item: UnifiedRankedItem): string {
  const support =
    item.supportingSources.length > 1 ? ` supports=${item.supportingSources.join(",")}` : "";
  return `- ${getKnowledgeSourceLabel(item)}${citation(item)} ${item.title}${support}`;
}

function allocateBudgets(
  tokenBudget: number,
  hasSession: boolean,
): {
  session: number;
  durable: number;
  knowledge: number;
  knowledgeLayers: Record<UnifiedRecallLayer, number>;
} {
  const session = hasSession ? Math.min(240, Math.max(80, Math.floor(tokenBudget * 0.25))) : 0;
  const remaining = Math.max(0, tokenBudget - session);
  const durable = hasSession
    ? Math.min(240, Math.max(72, Math.floor(remaining * 0.28)))
    : Math.min(320, Math.max(96, Math.floor(tokenBudget * 0.28)));
  const knowledge = Math.max(0, (hasSession ? remaining : tokenBudget) - durable);
  return {
    session,
    durable,
    knowledge,
    knowledgeLayers: {
      key_decisions: Math.floor(knowledge * 0.3),
      sop: Math.floor(knowledge * 0.24),
      preferences: Math.floor(knowledge * 0.18),
      runtime_signals: Math.floor(knowledge * 0.18),
      sources: Math.floor(knowledge * 0.1),
    },
  };
}

function createSection(
  kind: MemoryPromptSection["kind"],
  heading: string,
  lines: string[],
  itemIds: string[],
  omittedCount: number,
): MemoryPromptSection {
  const content = [heading, ...lines].join("\n");
  return {
    kind,
    heading,
    lines,
    estimatedTokens: estimateTokens(content),
    itemIds,
    omittedCount,
  };
}

function toQueryContextSection(section: MemoryPromptSection): QueryContextSection {
  const sectionType =
    section.kind === "session"
      ? "session_memory"
      : section.kind === "durable"
        ? "durable_memory"
        : section.kind === "knowledge"
          ? "knowledge"
          : "other";
  const schema: QueryContextSectionSchema =
    sectionType === "session_memory" ||
    sectionType === "durable_memory" ||
    sectionType === "knowledge"
      ? {
          kind: sectionType,
          itemIds: [...section.itemIds],
          omittedCount: section.omittedCount,
        }
      : {
          kind: "other",
          detail: {
            memoryKind: section.kind,
          },
        };
  return {
    id: `memory:${section.kind}`,
    role: "system_context",
    sectionType,
    schema,
    title: section.heading,
    content: [section.heading, ...section.lines].join("\n"),
    source: "memory-context",
    cacheable: true,
    metadata: {
      kind: section.kind,
      sectionType,
      estimatedTokens: section.estimatedTokens,
      itemIds: section.itemIds,
      omittedCount: section.omittedCount,
    },
  };
}

function assembleSessionSection(
  summaryText: string | null | undefined,
  budget: number,
): MemoryPromptSection | null {
  if (!summaryText) {
    return null;
  }
  const built = renderSessionSummaryPromptSection(summaryText, budget);
  if (!built) {
    return null;
  }
  const lines = built.text.split("\n").slice(1);
  return {
    kind: "session",
    heading: "## Session memory",
    lines,
    estimatedTokens: built.estimatedTokens,
    itemIds: [],
    omittedCount: 0,
  };
}

function assembleDurableSection(
  items: DurableMemoryItem[],
  budget: number,
): MemoryPromptSection | null {
  if (!items.length) {
    return null;
  }
  const lines: string[] = [];
  const itemIds: string[] = [];
  let used = estimateTokens(DURABLE_HEADING);
  let omittedCount = 0;
  const hardCap = Math.max(1, Math.min(5, items.length));

  for (const item of items) {
    if (itemIds.length >= hardCap) {
      omittedCount += 1;
      continue;
    }
    const line = formatDurableItemLine(item);
    const nextUsed = used + estimateTokens(line);
    if (nextUsed > budget && lines.length > 0) {
      omittedCount += 1;
      continue;
    }
    lines.push(line);
    used = nextUsed;
    itemIds.push(item.id);
  }

  if (!lines.length) {
    return null;
  }
  return createSection("durable", DURABLE_HEADING, lines, itemIds, omittedCount);
}

function layerForKnowledgeItem(item: UnifiedRankedItem): UnifiedRecallLayer {
  return item.layer ?? "runtime_signals";
}

function assembleKnowledgeSection(
  items: UnifiedRankedItem[],
  budget: number,
): MemoryPromptSection | null {
  if (!items.length) {
    return null;
  }

  const knowledgeLines: string[] = [];
  const knowledgeItemIds: string[] = [];
  let knowledgeOmitted = 0;

  for (const layer of KNOWLEDGE_LAYER_ORDER) {
    const candidates = items.filter((item) => layerForKnowledgeItem(item) === layer);
    if (!candidates.length && layer !== "sources") {
      continue;
    }

    const layerLines: string[] = [];
    const layerHeading = getKnowledgeLayerHeading(layer);
    let used = estimateTokens(layerHeading);
    const hardCap =
      layer === "sources"
        ? Math.max(1, Math.min(6, candidates.length))
        : Math.max(1, Math.min(3, candidates.length));

    for (const item of candidates) {
      if (layerLines.length >= hardCap) {
        knowledgeOmitted += 1;
        continue;
      }
      const line = layer === "sources" ? formatSourceLine(item) : formatKnowledgeItemLine(item);
      const nextUsed = used + estimateTokens(line);
      if (nextUsed > budget && layerLines.length > 0) {
        knowledgeOmitted += 1;
        continue;
      }
      layerLines.push(line);
      used = nextUsed;
      knowledgeItemIds.push(item.id);
    }

    if (!layerLines.length && layer === "sources" && items.length) {
      const fallback = items.slice(0, Math.min(4, items.length)).map(formatSourceLine);
      knowledgeLines.push(layerHeading, ...fallback);
      for (const item of items.slice(0, Math.min(4, items.length))) {
        knowledgeItemIds.push(item.id);
      }
      continue;
    }

    if (layerLines.length) {
      knowledgeLines.push(layerHeading, ...layerLines);
    }
  }

  if (!knowledgeLines.length) {
    return null;
  }
  return createSection(
    "knowledge",
    KNOWLEDGE_HEADING,
    knowledgeLines,
    knowledgeItemIds,
    knowledgeOmitted,
  );
}

export function assembleMemoryPrompt(input: MemoryPromptAssemblyInput): MemoryPromptAssemblyResult {
  const tokenBudget = clamp(input.tokenBudget ?? 1100, 240, 2400);
  const budgets = allocateBudgets(tokenBudget, Boolean(input.sessionMemoryText));
  const sections: MemoryPromptSection[] = [];
  const includedItemIds = new Set<string>();

  const sessionSection = assembleSessionSection(input.sessionMemoryText, budgets.session);
  if (sessionSection) {
    sections.push(sessionSection);
  }

  const durableItems = input.durableItems ?? [];
  const durableSection = assembleDurableSection(durableItems, budgets.durable);
  if (durableSection) {
    sections.push(durableSection);
    for (const itemId of durableSection.itemIds) {
      includedItemIds.add(itemId);
    }
  }

  const knowledgeItems = input.knowledgeItems ?? [];
  const knowledgeSection = assembleKnowledgeSection(knowledgeItems, budgets.knowledge);
  if (knowledgeSection) {
    sections.push(knowledgeSection);
    for (const itemId of knowledgeSection.itemIds) {
      includedItemIds.add(itemId);
    }
  }

  const text = sections.flatMap((section) => [section.heading, ...section.lines]).join("\n");
  const estimatedTokens = estimateTokens(text);
  const allItems = [...durableItems, ...knowledgeItems];
  const omittedItemIds = allItems
    .filter((item) => !includedItemIds.has(item.id))
    .map((item) => item.id);

  return {
    text,
    estimatedTokens,
    selectedItemIds: [...includedItemIds],
    sections,
    queryContextSections: sections.map((section) => toQueryContextSection(section)),
    omittedItemIds,
  };
}

export function assembleUnifiedContext(
  input: UnifiedContextAssemblyInput,
): UnifiedContextAssemblyResult {
  return assembleMemoryPrompt(input);
}

export class UnifiedContextAssembler {
  assemble(input: MemoryPromptAssemblyInput): MemoryPromptAssemblyResult {
    return assembleMemoryPrompt(input);
  }
}
