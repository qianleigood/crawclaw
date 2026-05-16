import type { SkillCommandSpec } from "../agents/skills.js";
import type { CrawClawConfig } from "../config/config.js";
import { formatTokenCount as formatTokenCountShared } from "../utils/usage-format.js";
import { listChatCommandsForConfig, type ChatCommandDefinition } from "./commands-registry.js";

type QueueStatus = {
  mode?: string;
  depth?: number;
  debounceMs?: number;
  cap?: number;
  dropPolicy?: string;
  showDetails?: boolean;
};

type StatusArgs = {
  config?: CrawClawConfig;
  agent: {
    model?: unknown;
    contextTokens?: number;
    thinkingDefault?: unknown;
    verboseDefault?: unknown;
    elevatedDefault?: unknown;
  };
  agentId?: string;
  sessionKey?: string;
  explicitConfiguredContextTokens?: number;
  groupActivation?: "mention" | "always";
  resolvedThink?: string;
  resolvedFast?: boolean;
  resolvedVerbose?: string;
  resolvedReasoning?: string;
  resolvedElevated?: string;
  modelAuth?: string;
  activeModelAuth?: string;
  usageLine?: string;
  timeLine?: string;
  queue?: QueueStatus;
  subagentsLine?: string;
  taskLine?: string;
  [key: string]: unknown;
};

type EffectiveToolInventoryResult = {
  tools?: Array<{ name?: string; description?: string }>;
};

export const formatTokenCount = formatTokenCountShared;

function formatTokens(total: number | null | undefined, contextTokens: number | null | undefined) {
  if (total == null) {
    return `?/${contextTokens ? formatTokenCount(contextTokens) : "?"}`;
  }
  const totalLabel = formatTokenCount(total);
  const contextLabel = contextTokens ? formatTokenCount(contextTokens) : "?";
  const pct = contextTokens
    ? ` (${Math.min(999, Math.round((total / contextTokens) * 100))}%)`
    : "";
  return `${totalLabel}/${contextLabel}${pct}`;
}

export function formatContextUsageShort(
  total: number | null | undefined,
  contextTokens: number | null | undefined,
): string {
  return `Context ${formatTokens(total, contextTokens)}`;
}

function modelLabel(model: unknown): string | undefined {
  if (typeof model === "string") {
    return model.trim() || undefined;
  }
  if (model && typeof model === "object") {
    const primary = (model as { primary?: unknown }).primary;
    if (typeof primary === "string" && primary.trim()) {
      return primary.trim();
    }
  }
  return undefined;
}

function formatQueue(queue?: QueueStatus): string | undefined {
  if (!queue) {
    return undefined;
  }
  const parts = [
    queue.mode ? `mode ${queue.mode}` : undefined,
    typeof queue.depth === "number" ? `depth ${queue.depth}` : undefined,
    queue.showDetails && typeof queue.debounceMs === "number"
      ? `debounce ${queue.debounceMs}ms`
      : undefined,
    queue.showDetails && typeof queue.cap === "number" ? `cap ${queue.cap}` : undefined,
    queue.showDetails && queue.dropPolicy ? `drop ${queue.dropPolicy}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? `Queue: ${parts.join(" · ")}` : undefined;
}

export function buildStatusMessage(args: StatusArgs): string {
  const lines = ["CrawClaw status"];
  const model = modelLabel(args.agent.model);
  if (model) {
    lines.push(`Model: ${model}${args.modelAuth ? ` (${args.modelAuth})` : ""}`);
  }
  if (args.activeModelAuth && args.activeModelAuth !== args.modelAuth) {
    lines.push(`Active auth: ${args.activeModelAuth}`);
  }
  if (args.agentId) {
    lines.push(`Agent: ${args.agentId}`);
  }
  if (args.sessionKey) {
    lines.push(`Session: ${args.sessionKey}`);
  }
  if (typeof args.agent.contextTokens === "number") {
    lines.push(formatContextUsageShort(undefined, args.agent.contextTokens));
  }
  if (args.groupActivation) {
    lines.push(`Group activation: ${args.groupActivation}`);
  }
  if (args.resolvedThink) {
    lines.push(`Think: ${args.resolvedThink}`);
  }
  if (typeof args.resolvedFast === "boolean") {
    lines.push(`Fast: ${args.resolvedFast ? "on" : "off"}`);
  }
  if (args.resolvedVerbose) {
    lines.push(`Verbose: ${args.resolvedVerbose}`);
  }
  if (args.resolvedReasoning) {
    lines.push(`Reasoning: ${args.resolvedReasoning}`);
  }
  if (args.resolvedElevated) {
    lines.push(`Elevated: ${args.resolvedElevated}`);
  }
  const queue = formatQueue(args.queue);
  if (queue) {
    lines.push(queue);
  }
  for (const line of [args.usageLine, args.timeLine, args.subagentsLine, args.taskLine]) {
    if (line?.trim()) {
      lines.push(line.trim());
    }
  }
  return lines.join("\n");
}

function formatCommand(command: ChatCommandDefinition): string {
  const alias = command.textAliases[0] ?? `/${command.key}`;
  return `${alias} - ${command.description}`;
}

export function buildHelpMessage(cfg?: CrawClawConfig): string {
  return buildCommandsMessage(cfg);
}

export function buildToolsMessage(
  inventory?: EffectiveToolInventoryResult,
  options?: { maxTools?: number },
): string {
  const tools = inventory?.tools ?? [];
  if (tools.length === 0) {
    return "No tools are currently enabled.";
  }
  const max = options?.maxTools ?? 12;
  const lines = tools.slice(0, max).map((tool: { name?: string; description?: string }) => {
    const name = tool.name ?? "tool";
    const summary = tool.description ? ` - ${tool.description}` : "";
    return `${name}${summary}`;
  });
  if (tools.length > max) {
    lines.push(`...and ${tools.length - max} more.`);
  }
  return lines.join("\n");
}

export function buildCommandsMessage(
  cfg?: CrawClawConfig,
  skillCommands?: SkillCommandSpec[],
  options?: { page?: number; pageSize?: number },
): string {
  return buildCommandsMessagePaginated(cfg, skillCommands, options).text;
}

export function buildCommandsMessagePaginated(
  cfg?: CrawClawConfig,
  skillCommands?: SkillCommandSpec[],
  options?: { page?: number; pageSize?: number },
): { text: string; page: number; totalPages: number } {
  const commands = listChatCommandsForConfig(cfg ?? {}, { skillCommands });
  const pageSize = Math.max(1, options?.pageSize ?? (commands.length || 1));
  const totalPages = Math.max(1, Math.ceil(commands.length / pageSize));
  const page = Math.min(Math.max(1, options?.page ?? 1), totalPages);
  const start = (page - 1) * pageSize;
  const selected = commands.slice(start, start + pageSize);
  return {
    text: selected.map(formatCommand).join("\n") || "No commands are currently enabled.",
    page,
    totalPages,
  };
}
