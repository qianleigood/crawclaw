import { createHash } from "node:crypto";
import { resolvePromptCacheDecisionCodes } from "../../shared/decision-codes.js";
import {
  buildQueryLayerCacheEnvelopeFromModelInput,
  buildQueryLayerCacheToolPromptPayload,
} from "./cache-contract.js";
import type {
  QueryContext,
  QueryContextHookSectionDiff,
  QueryContextProviderRequest,
  QueryContextProviderRequestSnapshot,
  QueryContextModelInput,
  QueryContextPatch,
  QueryContextSection,
  QueryContextSectionRole,
  QueryContextSectionTokenUsage,
  QueryContextSectionType,
  QueryContextToolContext,
} from "./types.js";

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

function roundPercent(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function computePercentages(map: Record<string, number>, total: number): Record<string, number> {
  if (total <= 0) {
    return Object.fromEntries(Object.keys(map).map((key) => [key, 0]));
  }
  return Object.fromEntries(
    Object.entries(map).map(([key, value]) => [key, roundPercent((value / total) * 100)]),
  );
}

function resolveSectionTypeFromSchema(
  schema: QueryContextSection["schema"] | undefined,
): QueryContextSectionType | undefined {
  const kind = schema?.kind;
  if (!kind) {
    return undefined;
  }
  if (
    kind === "session_memory" ||
    kind === "durable_memory" ||
    kind === "knowledge" ||
    kind === "routing" ||
    kind === "hook" ||
    kind === "bootstrap" ||
    kind === "skills" ||
    kind === "inherited"
  ) {
    return kind;
  }
  return "other";
}

function resolveSectionType(section: QueryContextSection): QueryContextSectionType {
  if (section.sectionType) {
    return section.sectionType;
  }
  const schemaType = resolveSectionTypeFromSchema(section.schema);
  if (schemaType) {
    return schemaType;
  }
  const metadataKind =
    typeof section.metadata?.kind === "string" ? section.metadata.kind.trim().toLowerCase() : "";
  if (metadataKind === "session") {
    return "session_memory";
  }
  if (metadataKind === "durable") {
    return "durable_memory";
  }
  if (metadataKind === "knowledge") {
    return "knowledge";
  }
  if (metadataKind === "routing" || metadataKind === "context_routing") {
    return "routing";
  }
  const source = section.source?.trim().toLowerCase() ?? "";
  if (source.startsWith("hook:")) {
    return "hook";
  }
  if (source === "special-agent") {
    return "inherited";
  }
  if (section.id.includes("bootstrap")) {
    return "bootstrap";
  }
  if (section.id.includes("skill")) {
    return "skills";
  }
  return "other";
}

export function normalizeQueryContextSections(
  sections: QueryContextSection[] | undefined | null,
): QueryContextSection[] {
  if (!Array.isArray(sections)) {
    return [];
  }
  return sections
    .map((section) => ({
      ...section,
      content: normalizeSectionContent(section.content),
    }))
    .filter(
      (section): section is QueryContextSection =>
        Boolean(section.id?.trim()) && section.content.length > 0,
    );
}

export function renderQueryContextSections(
  sections: QueryContextSection[] | undefined | null,
  separator = "\n\n",
): string {
  return normalizeQueryContextSections(sections)
    .map((section) => section.content)
    .join(separator);
}

export function renderQueryContextSystemPrompt(
  context: Pick<QueryContext, "systemPromptSections" | "systemContextSections">,
): string {
  const systemContext = renderQueryContextSections(context.systemContextSections, "\n\n");
  const systemPrompt = renderQueryContextSections(context.systemPromptSections, "\n");
  return [systemContext, systemPrompt].filter(Boolean).join("\n\n");
}

export function renderQueryContextUserPrompt(
  context: Pick<QueryContext, "userPrompt" | "userContextSections">,
): string {
  const userContext = renderQueryContextSections(context.userContextSections, "\n\n");
  const userPrompt = normalizeSectionContent(context.userPrompt) || context.userPrompt;
  return [userContext, userPrompt].filter(Boolean).join("\n\n");
}

export function summarizeQueryContextSectionTokenUsage(
  context: Pick<
    QueryContext,
    "systemPromptSections" | "systemContextSections" | "userContextSections"
  >,
): QueryContextSectionTokenUsage {
  const byRole: Record<QueryContextSectionRole, number> = {
    system_prompt: 0,
    system_context: 0,
    user_context: 0,
  };
  const byType: Record<string, number> = {};
  const sections = [
    ...normalizeQueryContextSections(context.systemContextSections),
    ...normalizeQueryContextSections(context.systemPromptSections),
    ...normalizeQueryContextSections(context.userContextSections),
  ];
  let totalEstimatedTokens = 0;
  for (const section of sections) {
    const estimatedTokens = estimateTokens(section.content);
    totalEstimatedTokens += estimatedTokens;
    byRole[section.role] += estimatedTokens;
    const sectionType = resolveSectionType(section);
    byType[sectionType] = (byType[sectionType] ?? 0) + estimatedTokens;
  }
  return {
    totalEstimatedTokens,
    byRole,
    byType,
    byRolePercent: computePercentages(byRole, totalEstimatedTokens) as Record<
      QueryContextSectionRole,
      number
    >,
    byTypePercent: computePercentages(byType, totalEstimatedTokens),
  };
}

function buildHookSectionDiffs(context: QueryContext): QueryContextHookSectionDiff[] | undefined {
  const hookMutations = context.diagnostics?.hookMutations ?? [];
  if (hookMutations.length === 0) {
    return undefined;
  }
  const activeByHook = new Map<string, QueryContextHookSectionDiff["activeSectionIds"]>();
  const allSections = [
    ...normalizeQueryContextSections(context.systemContextSections),
    ...normalizeQueryContextSections(context.systemPromptSections),
    ...normalizeQueryContextSections(context.userContextSections),
  ];
  for (const section of allSections) {
    const source = section.source?.trim() ?? "";
    if (!source.startsWith("hook:")) {
      continue;
    }
    const hook = source.slice("hook:".length).trim();
    if (!hook) {
      continue;
    }
    let active = activeByHook.get(hook);
    if (!active) {
      active = {
        system_prompt: [],
        system_context: [],
        user_context: [],
      };
      activeByHook.set(hook, active);
    }
    active[section.role].push(section.id);
  }
  return hookMutations.map((mutation) => ({
    hook: mutation.hook,
    mutation,
    activeSectionIds: activeByHook.get(mutation.hook) ?? {
      system_prompt: [],
      system_context: [],
      user_context: [],
    },
  }));
}

export function buildQueryContextProviderRequestSnapshot(
  context: QueryContext,
): QueryContextProviderRequestSnapshot {
  const modelInput = materializeQueryContext(context);
  const cacheEnvelope = buildQueryLayerCacheEnvelopeFromModelInput({
    modelInput,
    forkContextMessages: context.messages,
  });
  const systemContextSections = normalizeQueryContextSections(context.systemContextSections);
  const systemPromptSections = normalizeQueryContextSections(context.systemPromptSections);
  const userContextSections = normalizeQueryContextSections(context.userContextSections);
  const sectionOrder = [
    ...systemContextSections,
    ...systemPromptSections,
    ...userContextSections,
  ].map((section) => ({
    id: section.id,
    role: section.role,
    sectionType: resolveSectionType(section),
    estimatedTokens: estimateTokens(section.content),
    ...(section.source ? { source: section.source } : {}),
  }));
  const hookSectionDiffs = buildHookSectionDiffs(context);
  return {
    queryContextHash: modelInput.queryContextHash,
    cacheIdentity: cacheEnvelope.cacheIdentity,
    promptChars: modelInput.prompt.length,
    systemPromptChars: modelInput.systemPrompt.length,
    sectionTokenUsage: summarizeQueryContextSectionTokenUsage(context),
    ...(hookSectionDiffs ? { hookSectionDiffs } : {}),
    decisionCodes: resolvePromptCacheDecisionCodes({
      hasInheritedPromptEnvelope: false,
      canReuseParentPrefix: false,
      mismatchCount: 0,
      skipCacheWrite: false,
      hasCacheIdentity: Boolean(cacheEnvelope.cacheIdentity),
    }),
    sectionOrder,
  };
}

export function applyQueryContextPatch(
  context: QueryContext,
  patch: QueryContextPatch | undefined,
): QueryContext {
  if (!patch) {
    return context;
  }
  return {
    ...context,
    userPrompt:
      typeof patch.replaceUserPrompt === "string" ? patch.replaceUserPrompt : context.userPrompt,
    systemPromptSections:
      Array.isArray(patch.replaceSystemPromptSections) &&
      normalizeQueryContextSections(patch.replaceSystemPromptSections).length > 0
        ? normalizeQueryContextSections(patch.replaceSystemPromptSections)
        : context.systemPromptSections,
    userContextSections: normalizeQueryContextSections([
      ...(patch.prependUserContextSections ?? []),
      ...context.userContextSections,
      ...(patch.appendUserContextSections ?? []),
    ]),
    systemContextSections: normalizeQueryContextSections([
      ...(patch.prependSystemContextSections ?? []),
      ...(patch.clearSystemContextSections ? [] : context.systemContextSections),
      ...(patch.appendSystemContextSections ?? []),
    ]),
  };
}

export function buildQueryContextIdentityHash(
  context: Pick<
    QueryContext,
    "systemPromptSections" | "systemContextSections" | "thinkingConfig" | "toolContext"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        systemPrompt: normalizeQueryContextSections(context.systemPromptSections).map(
          ({ id, content }) => ({ id, content }),
        ),
        systemContext: normalizeQueryContextSections(context.systemContextSections).map(
          ({ id, content }) => ({ id, content }),
        ),
        thinkingConfig: context.thinkingConfig,
        toolNames: context.toolContext.toolNames,
        toolPromptPayload: context.toolContext.toolPromptPayload,
      }),
    )
    .digest("hex");
}

export function buildQueryContextToolPromptPayload(
  tools: Array<Record<string, unknown>>,
): Record<string, unknown>[] {
  return buildQueryLayerCacheToolPromptPayload(tools);
}

export function createQueryContextToolContext(
  tools: QueryContextToolContext["tools"],
): QueryContextToolContext {
  return {
    tools,
    toolNames: tools
      .map((tool) => (typeof tool?.name === "string" ? tool.name.trim() : ""))
      .filter(Boolean),
    toolPromptPayload: buildQueryContextToolPromptPayload(
      tools as unknown as Array<Record<string, unknown>>,
    ),
  };
}

export function materializeQueryContext(context: QueryContext): QueryContextModelInput {
  return {
    messages: context.messages,
    prompt: renderQueryContextUserPrompt(context),
    systemPrompt: renderQueryContextSystemPrompt(context),
    toolContext: context.toolContext,
    thinkingConfig: context.thinkingConfig,
    diagnostics: context.diagnostics,
    queryContextHash: buildQueryContextIdentityHash(context),
  };
}

export function buildQueryContextProviderRequest(
  context: QueryContext,
): QueryContextProviderRequest {
  return {
    queryContext: context,
    snapshot: buildQueryContextProviderRequestSnapshot(context),
  };
}

export function materializeQueryContextProviderRequest(
  request: QueryContextProviderRequest,
): QueryContextModelInput {
  return materializeQueryContext(request.queryContext);
}
