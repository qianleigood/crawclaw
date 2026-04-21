import type {
  QueryContextSection,
  QueryContextSectionSchema,
} from "../../agents/query-context/types.js";
import {
  buildExperienceCardSummary,
  getExperienceItemLabel,
  getExperienceLayerHeading,
  getExperienceSourceLabel,
  EXPERIENCE_DISPLAY_HEADING,
} from "../experience/display.ts";
import { estimateTokenCount } from "../recall/token-estimate.ts";
import type {
  DurableMemoryItem,
  MemoryPromptAssemblyInput,
  MemoryPromptAssemblyResult,
  MemoryPromptSection,
  UnifiedQueryClassification,
  UnifiedContextAssemblyInput,
  UnifiedContextAssemblyResult,
  UnifiedRankedItem,
  UnifiedRecallLayer,
} from "../types/orchestration.ts";

const EXPERIENCE_LAYER_ORDER: UnifiedRecallLayer[] = [
  "key_decisions",
  "sop",
  "preferences",
  "runtime_signals",
  "sources",
];

const DURABLE_HEADING = "## Durable memory";
const EXPERIENCE_HEADING = EXPERIENCE_DISPLAY_HEADING;

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

function experienceLabel(item: UnifiedRankedItem): string {
  return `${getExperienceItemLabel(item)}${item.title}`;
}

function formatDurableItemLine(item: DurableMemoryItem): string {
  const summary = truncate(item.summary || item.content || item.title, 160);
  const freshness =
    typeof item.metadata?.freshnessText === "string" && item.metadata.freshnessText.trim()
      ? ` Freshness: ${truncate(item.metadata.freshnessText, 140)}`
      : "";
  return `- ${durableLabel(item)}: ${summary}${freshness} ${citation(item)}`;
}

function formatExperienceItemLine(item: UnifiedRankedItem): string {
  const summary = buildExperienceCardSummary(item, item.layer === "runtime_signals" ? 120 : 160);
  return `- ${experienceLabel(item)} ${summary} ${citation(item)}`;
}

function formatSourceLine(item: UnifiedRankedItem): string {
  const support =
    item.supportingSources.length > 1 ? ` supports=${item.supportingSources.join(",")}` : "";
  return `- ${getExperienceSourceLabel(item)}${citation(item)} ${item.title}${support}`;
}

function readDurableRecallScore(item: DurableMemoryItem): number {
  const breakdown = item.metadata?.scoreBreakdown;
  if (!breakdown || typeof breakdown !== "object") {
    return item.score;
  }
  const final = (breakdown as Record<string, unknown>).final;
  return typeof final === "number" && Number.isFinite(final) ? final : item.score;
}

function durableSignalStrength(items: DurableMemoryItem[]): number {
  return items.reduce((max, item) => Math.max(max, readDurableRecallScore(item)), 0);
}

function classificationPrefersDurable(
  classification: UnifiedQueryClassification | undefined,
): boolean {
  if (!classification) {
    return false;
  }
  return (
    classification.intent === "preference" ||
    classification.intent === "history" ||
    classification.targetLayers.includes("preferences") ||
    classification.routeWeights.nativeMemory >= 0.34
  );
}

function classificationPrefersExperience(
  classification: UnifiedQueryClassification | undefined,
): boolean {
  if (!classification) {
    return false;
  }
  return (
    classification.intent === "decision" ||
    classification.intent === "sop" ||
    classification.intent === "runtime" ||
    classification.targetLayers.includes("key_decisions") ||
    classification.targetLayers.includes("sop") ||
    classification.targetLayers.includes("runtime_signals")
  );
}

function allocateBudgets(params: {
  tokenBudget: number;
  durableItems: DurableMemoryItem[];
  classification?: UnifiedQueryClassification;
}): {
  durable: number;
  experience: number;
  experienceLayers: Record<UnifiedRecallLayer, number>;
} {
  const signal = durableSignalStrength(params.durableItems);
  const durablePreferred = classificationPrefersDurable(params.classification);
  const experiencePreferred = classificationPrefersExperience(params.classification);
  let ratio = 0.28;
  let minDurable = 96;
  let maxDurable = 320;

  if (durablePreferred && signal >= 1.5) {
    ratio = 0.4;
    minDurable = 120;
    maxDurable = 560;
  } else if (durablePreferred) {
    ratio = 0.34;
    minDurable = 112;
    maxDurable = 480;
  } else if (experiencePreferred && signal < 1.5) {
    ratio = 0.2;
    minDurable = 72;
    maxDurable = 240;
  } else if (signal >= 2.5) {
    ratio = 0.34;
    minDurable = 112;
    maxDurable = 420;
  }

  const durable = Math.min(
    maxDurable,
    Math.max(minDurable, Math.floor(params.tokenBudget * ratio)),
  );
  const experience = Math.max(0, params.tokenBudget - durable);
  return {
    durable,
    experience,
    experienceLayers: {
      key_decisions: Math.floor(experience * 0.3),
      sop: Math.floor(experience * 0.24),
      preferences: Math.floor(experience * 0.18),
      runtime_signals: Math.floor(experience * 0.18),
      sources: Math.floor(experience * 0.1),
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
    section.kind === "durable"
      ? "durable_memory"
      : section.kind === "experience"
        ? "experience"
        : "other";
  const schema: QueryContextSectionSchema =
    sectionType === "durable_memory" || sectionType === "experience"
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
  const hardCap = Math.max(1, Math.min(budget >= 420 ? 7 : budget >= 240 ? 6 : 5, items.length));

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

function layerForExperienceItem(item: UnifiedRankedItem): UnifiedRecallLayer {
  return item.layer ?? "runtime_signals";
}

function assembleExperienceSection(
  items: UnifiedRankedItem[],
  budget: number,
  layerBudgets: Record<UnifiedRecallLayer, number>,
): MemoryPromptSection | null {
  if (!items.length) {
    return null;
  }

  const experienceLines: string[] = [];
  const experienceItemIds = new Set<string>();
  let experienceOmitted = 0;
  let totalUsed = estimateTokens(EXPERIENCE_HEADING);

  for (const layer of EXPERIENCE_LAYER_ORDER) {
    const candidates = items.filter((item) => layerForExperienceItem(item) === layer);
    if (!candidates.length && layer !== "sources") {
      continue;
    }

    const layerLines: string[] = [];
    const layerHeading = getExperienceLayerHeading(layer);
    const layerHeadingTokens = estimateTokens(layerHeading);
    let used = estimateTokens(layerHeading);
    const layerBudget = Math.max(1, layerBudgets[layer] ?? budget);
    const hardCap =
      layer === "sources"
        ? Math.max(1, Math.min(6, candidates.length))
        : Math.max(1, Math.min(3, candidates.length));

    for (const item of candidates) {
      if (layerLines.length >= hardCap) {
        experienceOmitted += 1;
        continue;
      }
      const line = layer === "sources" ? formatSourceLine(item) : formatExperienceItemLine(item);
      const nextUsed = used + estimateTokens(line);
      const nextTotalUsed =
        totalUsed + (layerLines.length === 0 ? layerHeadingTokens : 0) + estimateTokens(line);
      if (nextTotalUsed > budget) {
        experienceOmitted += 1;
        continue;
      }
      if (nextUsed > layerBudget && layerLines.length > 0) {
        experienceOmitted += 1;
        continue;
      }
      layerLines.push(line);
      used = nextUsed;
      experienceItemIds.add(item.id);
      totalUsed = nextTotalUsed;
    }

    if (!layerLines.length && layer === "sources" && items.length) {
      const fallbackLines: string[] = [];
      for (const item of items.slice(0, Math.min(4, items.length))) {
        const line = formatSourceLine(item);
        const nextTotalUsed =
          totalUsed + (fallbackLines.length === 0 ? layerHeadingTokens : 0) + estimateTokens(line);
        if (nextTotalUsed > budget) {
          experienceOmitted += 1;
          continue;
        }
        fallbackLines.push(line);
        experienceItemIds.add(item.id);
        totalUsed = nextTotalUsed;
      }
      if (fallbackLines.length) {
        experienceLines.push(layerHeading, ...fallbackLines);
      }
      continue;
    }

    if (layerLines.length) {
      experienceLines.push(layerHeading, ...layerLines);
    }
  }

  if (!experienceLines.length) {
    return null;
  }
  return createSection(
    "experience",
    EXPERIENCE_HEADING,
    experienceLines,
    [...experienceItemIds],
    experienceOmitted,
  );
}

export function assembleMemoryPrompt(input: MemoryPromptAssemblyInput): MemoryPromptAssemblyResult {
  const tokenBudget = clamp(input.tokenBudget ?? 1100, 240, 2400);
  const durableItems = input.durableItems ?? [];
  const budgets = allocateBudgets({
    tokenBudget,
    durableItems,
    classification: input.classification,
  });
  const sections: MemoryPromptSection[] = [];
  const includedItemIds = new Set<string>();

  const durableSection = assembleDurableSection(durableItems, budgets.durable);
  const experienceItems = input.experienceItems ?? [];
  const experienceSection = assembleExperienceSection(
    experienceItems,
    budgets.experience,
    budgets.experienceLayers,
  );

  if (durableSection) {
    sections.push(durableSection);
    for (const itemId of durableSection.itemIds) {
      includedItemIds.add(itemId);
    }
  }
  if (experienceSection) {
    sections.push(experienceSection);
    for (const itemId of experienceSection.itemIds) {
      includedItemIds.add(itemId);
    }
  }

  const text = sections.flatMap((section) => [section.heading, ...section.lines]).join("\n");
  const estimatedTokens = estimateTokens(text);
  const allItems = [...durableItems, ...experienceItems];
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
