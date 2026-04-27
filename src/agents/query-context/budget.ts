import type { ModelContextBudget } from "../context-window-guard.js";
import { normalizeQueryContextSections, summarizeQueryContextSectionTokenUsage } from "./render.js";
import type {
  QueryContext,
  QueryContextBudgetDiagnostics,
  QueryContextBudgetPruningAction,
  QueryContextSection,
  QueryContextSectionBudget,
  QueryContextSectionRole,
  QueryContextSectionType,
  QueryContextToolContext,
} from "./types.js";

type SectionLocation = "systemPromptSections" | "systemContextSections" | "userContextSections";

type BudgetCandidate = {
  section: QueryContextSection;
  location: SectionLocation;
  beforeTokens: number;
  priority: NonNullable<QueryContextSectionBudget["priority"]>;
  eviction: NonNullable<QueryContextSectionBudget["eviction"]>;
};

const PRIORITY_RANK: Record<NonNullable<QueryContextSectionBudget["priority"]>, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

const ROLE_RANK: Record<QueryContextSectionRole, number> = {
  system_context: 0,
  user_context: 1,
  system_prompt: 2,
};

function normalizeSectionContent(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function estimateTokens(text: string): number {
  const normalized = normalizeSectionContent(text);
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export function estimateQueryContextToolSchemaTokens(
  toolContext: Pick<QueryContextToolContext, "toolNames" | "toolPromptPayload">,
): number {
  const payloadTokens = estimateTokens(JSON.stringify(toolContext.toolPromptPayload ?? []));
  const nameTokens = estimateTokens((toolContext.toolNames ?? []).join("\n"));
  return payloadTokens + nameTokens;
}

function resolveBudgetPriority(
  budget: QueryContextSectionBudget | undefined,
): NonNullable<QueryContextSectionBudget["priority"]> {
  return budget?.priority ?? "normal";
}

function resolveBudgetEviction(
  budget: QueryContextSectionBudget | undefined,
): NonNullable<QueryContextSectionBudget["eviction"]> {
  return budget?.eviction ?? "drop";
}

function resolveSectionType(section: QueryContextSection): QueryContextSectionType {
  if (section.sectionType) {
    return section.sectionType;
  }
  const schemaKind = section.schema?.kind;
  if (
    schemaKind === "durable_memory" ||
    schemaKind === "experience" ||
    schemaKind === "routing" ||
    schemaKind === "hook" ||
    schemaKind === "bootstrap" ||
    schemaKind === "skills" ||
    schemaKind === "inherited"
  ) {
    return schemaKind;
  }
  const source = section.source?.trim().toLowerCase() ?? "";
  if (source.startsWith("hook:")) {
    return "hook";
  }
  if (section.id.includes("bootstrap")) {
    return "bootstrap";
  }
  return "other";
}

function isBudgetedStructuredSection(section: QueryContextSection): boolean {
  if (section.role === "user_context") {
    return true;
  }
  const sectionType = resolveSectionType(section);
  return (
    sectionType === "durable_memory" ||
    sectionType === "experience" ||
    sectionType === "bootstrap" ||
    sectionType === "hook"
  );
}

function truncateToEstimatedTokens(text: string, maxTokens: number): string {
  const normalized = normalizeSectionContent(text);
  const maxChars = Math.max(0, Math.floor(maxTokens) * 4);
  if (maxChars <= 0) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return normalized.slice(0, maxChars).trimEnd();
}

function totalEstimatedTokens(context: QueryContext): number {
  return (
    summarizeQueryContextSectionTokenUsage(context).totalEstimatedTokens +
    estimateTokens(context.userPrompt)
  );
}

function buildCandidates(context: QueryContext): BudgetCandidate[] {
  const locations: SectionLocation[] = [
    "systemPromptSections",
    "systemContextSections",
    "userContextSections",
  ];
  const candidates: BudgetCandidate[] = [];
  for (const location of locations) {
    const sections = context[location];
    for (const section of sections) {
      const priority = resolveBudgetPriority(section.budget);
      if (priority === "critical" || !isBudgetedStructuredSection(section)) {
        continue;
      }
      candidates.push({
        section,
        location,
        beforeTokens: estimateTokens(section.content),
        priority,
        eviction: resolveBudgetEviction(section.budget),
      });
    }
  }
  return candidates.toSorted((a, b) => {
    const priorityDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    const roleDelta = ROLE_RANK[a.section.role] - ROLE_RANK[b.section.role];
    if (roleDelta !== 0) {
      return roleDelta;
    }
    return b.beforeTokens - a.beforeTokens;
  });
}

function applySectionUpdate(
  context: QueryContext,
  candidate: BudgetCandidate,
  nextSection: QueryContextSection | null,
): QueryContext {
  const sections = context[candidate.location];
  const nextSections =
    nextSection === null
      ? sections.filter((section) => section.id !== candidate.section.id)
      : sections.map((section) => (section.id === candidate.section.id ? nextSection : section));
  return {
    ...context,
    [candidate.location]: normalizeQueryContextSections(nextSections),
  };
}

function buildDiagnostics(params: {
  budget: ModelContextBudget;
  originalEstimatedTokens: number;
  remainingEstimatedTokens: number;
  pruningActions: QueryContextBudgetPruningAction[];
}): QueryContextBudgetDiagnostics {
  return {
    windowTokens: params.budget.windowTokens,
    usableInputTokens: params.budget.usableInputTokens,
    outputReserveTokens: params.budget.outputReserveTokens,
    providerOverheadTokens: params.budget.providerOverheadTokens,
    toolSchemaTokens: params.budget.toolSchemaTokens,
    memoryBudgetTokens: params.budget.memoryBudgetTokens,
    source: params.budget.source,
    confidence: params.budget.confidence,
    originalEstimatedTokens: params.originalEstimatedTokens,
    remainingEstimatedTokens: params.remainingEstimatedTokens,
    pruningActions: params.pruningActions,
  };
}

export function compileQueryContextBudget(params: {
  context: QueryContext;
  budget: ModelContextBudget;
}): {
  context: QueryContext;
  diagnostics: QueryContextBudgetDiagnostics;
} {
  let context: QueryContext = {
    ...params.context,
    systemPromptSections: normalizeQueryContextSections(params.context.systemPromptSections),
    systemContextSections: normalizeQueryContextSections(params.context.systemContextSections),
    userContextSections: normalizeQueryContextSections(params.context.userContextSections),
  };
  const originalEstimatedTokens = totalEstimatedTokens(context);
  const previousActions = context.diagnostics?.contextBudget?.pruningActions ?? [];
  const pruningActions: QueryContextBudgetPruningAction[] = [];
  let remainingEstimatedTokens = originalEstimatedTokens;

  if (remainingEstimatedTokens > params.budget.usableInputTokens) {
    for (const candidate of buildCandidates(context)) {
      if (remainingEstimatedTokens <= params.budget.usableInputTokens) {
        break;
      }

      const maxTokens = candidate.section.budget?.maxTokens;
      if (candidate.eviction === "truncate" && typeof maxTokens === "number") {
        const content = truncateToEstimatedTokens(candidate.section.content, maxTokens);
        const afterTokens = estimateTokens(content);
        if (afterTokens < candidate.beforeTokens) {
          const nextSection = { ...candidate.section, content };
          context = applySectionUpdate(context, candidate, nextSection);
          remainingEstimatedTokens =
            remainingEstimatedTokens - candidate.beforeTokens + afterTokens;
          pruningActions.push({
            sectionId: candidate.section.id,
            role: candidate.section.role,
            sectionType: resolveSectionType(candidate.section),
            action: "truncate",
            priority: candidate.priority,
            beforeTokens: candidate.beforeTokens,
            afterTokens,
            reason: "query_context_budget",
          });
          continue;
        }
      }

      context = applySectionUpdate(context, candidate, null);
      remainingEstimatedTokens -= candidate.beforeTokens;
      pruningActions.push({
        sectionId: candidate.section.id,
        role: candidate.section.role,
        sectionType: resolveSectionType(candidate.section),
        action: "drop",
        priority: candidate.priority,
        beforeTokens: candidate.beforeTokens,
        afterTokens: 0,
        reason: "query_context_budget",
      });
    }
  }

  const diagnostics = buildDiagnostics({
    budget: params.budget,
    originalEstimatedTokens,
    remainingEstimatedTokens,
    pruningActions: [...previousActions, ...pruningActions],
  });

  return {
    context: {
      ...context,
      diagnostics: {
        ...context.diagnostics,
        contextBudget: diagnostics,
      },
    },
    diagnostics,
  };
}
