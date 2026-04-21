import type {
  QueryContextSection,
  QueryContextSectionSchema,
  QueryContextSectionType,
} from "../../agents/query-context/types.js";
import { searchNotebookLmViaCli } from "../notebooklm/notebooklm-cli.ts";
import type { NotebookLmConfig } from "../types/config.ts";
import type { UnifiedRecallItem } from "../types/orchestration.ts";
import { cleanPrompt } from "../util/prompt.ts";
import type { RuntimeLogger } from "./context-memory-runtime-deps.ts";

export type DurableRecallSource = "sync" | "sync_error";

export function resolveMemoryRecallHitReason(params: {
  selectedDurableCount: number;
  selectedKnowledgeCount: number;
  selectedTotalCount: number;
  durableRecallSource: DurableRecallSource;
}): string {
  if (params.selectedDurableCount > 0) {
    return `durable_selected:${params.durableRecallSource}`;
  }
  if (params.selectedKnowledgeCount > 0) {
    return "knowledge_selected";
  }
  if (params.durableRecallSource === "sync_error") {
    return `durable_unavailable:${params.durableRecallSource}`;
  }
  return "no_recall_items";
}

export function resolveMemoryRecallEvictionReason(params: {
  omittedDurableCount: number;
  omittedKnowledgeCount: number;
}): string | undefined {
  if (params.omittedDurableCount > 0 && params.omittedKnowledgeCount > 0) {
    return "token_budget:durable_and_knowledge";
  }
  if (params.omittedDurableCount > 0) {
    return "token_budget:durable";
  }
  if (params.omittedKnowledgeCount > 0) {
    return "token_budget:knowledge";
  }
  return undefined;
}

export function createMemorySystemContextSection(params: {
  id: string;
  text: string;
  estimatedTokens?: number;
  sectionType?: QueryContextSectionType;
  schema?: QueryContextSectionSchema;
  metadata?: Record<string, unknown>;
}): QueryContextSection | null {
  const text = params.text.trim();
  if (!text) {
    return null;
  }
  return {
    id: params.id,
    role: "system_context",
    sectionType: params.sectionType ?? "other",
    ...(params.schema ? { schema: params.schema } : {}),
    content: text,
    source: "memory-context",
    cacheable: true,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

export function getMessageRole(message: unknown): string {
  if (typeof message !== "object" || !message) {
    return "unknown";
  }
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" && role.trim() ? role : "unknown";
}

export function resolvePromptContext(params: { prompt?: string; messages?: unknown[] }): {
  prompt?: string;
  recentMessages?: string[];
} {
  const promptCandidates = [
    typeof params.prompt === "string" ? params.prompt : "",
    Array.isArray(params.messages)
      ? (params.messages
          .slice()
          .toReversed()
          .map((message) => {
            const content =
              typeof message === "object" && message && "content" in message
                ? (message as { content?: unknown }).content
                : undefined;
            return typeof content === "string" ? content : "";
          })
          .find((value) => Boolean(cleanPrompt(value))) ?? "")
      : "",
  ];
  const prompt = promptCandidates
    .map((value) => cleanPrompt(value))
    .find((value) => Boolean(value));
  if (!prompt) {
    return {};
  }

  const recentMessages = Array.isArray(params.messages)
    ? params.messages
        .slice(-6)
        .map((message) => {
          const content =
            typeof message === "object" && message && "content" in message
              ? (message as { content?: unknown }).content
              : undefined;
          return typeof content === "string" ? cleanPrompt(content) : "";
        })
        .filter((value) => value && value !== prompt)
        .slice(-3)
    : undefined;

  return { prompt, recentMessages };
}

export async function recallNotebookLm(params: {
  config: NotebookLmConfig | undefined;
  logger: RuntimeLogger;
  prompt: string;
  notificationScope?: {
    agentId?: string | null;
    channel?: string | null;
    userId?: string | null;
  };
}): Promise<UnifiedRecallItem[]> {
  if (!params.config?.enabled || !params.config.cli.enabled) {
    return [];
  }
  return await searchNotebookLmViaCli({
    config: params.config,
    query: params.prompt,
    limit: params.config.cli.limit,
    logger: params.logger,
    notificationScope: params.notificationScope,
  });
}

function normalizeSkillDiscoveryText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenizeSkillDiscoveryText(value: string | null | undefined): string[] {
  return normalizeSkillDiscoveryText(value)
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((token) => token.length >= 2);
}

function scoreSkillDiscoveryCandidate(params: {
  query: string;
  loadedSkillNames: string[];
  surfacedSkillNames: string[];
  skill: { name: string; description?: string };
}): number {
  const queryTokens = new Set(tokenizeSkillDiscoveryText(params.query));
  const skillHaystack = new Set(
    tokenizeSkillDiscoveryText(`${params.skill.name} ${params.skill.description ?? ""}`),
  );
  const overlap = [...queryTokens].filter((token) => skillHaystack.has(token)).length;
  const loadedHints = normalizeSkillDiscoveryText(params.loadedSkillNames.join(" "));
  const surfacedHints = normalizeSkillDiscoveryText(params.surfacedSkillNames.join(" "));
  const skillText = normalizeSkillDiscoveryText(
    `${params.skill.name} ${params.skill.description ?? ""}`,
  );
  const adjacencyBoost =
    (loadedHints && skillText.includes(loadedHints) ? 0.1 : 0) +
    (surfacedHints && skillText.includes(surfacedHints) ? 0.05 : 0);
  return overlap + adjacencyBoost;
}

export function buildSkillDiscoveryCandidates(params: {
  prompt: string;
  loadedSkillNames: string[];
  surfacedSkillNames: string[];
  availableSkills: Array<{ name: string; description?: string; location: string }>;
}): Array<{ name: string; description?: string; location: string }> {
  const excluded = new Set([...params.loadedSkillNames, ...params.surfacedSkillNames]);
  const candidates = params.availableSkills.filter((skill) => !excluded.has(skill.name));
  if (candidates.length <= 16) {
    return candidates;
  }
  return candidates
    .map((skill) => ({
      skill,
      score: scoreSkillDiscoveryCandidate({
        query: params.prompt,
        loadedSkillNames: params.loadedSkillNames,
        surfacedSkillNames: params.surfacedSkillNames,
        skill,
      }),
    }))
    .toSorted(
      (left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name),
    )
    .slice(0, 16)
    .map((entry) => entry.skill);
}
