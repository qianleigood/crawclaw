import { MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST } from "../../memory/special-agent-toollists.js";

type ToolChoice =
  | "required"
  | { type: "function"; function: { name: string } }
  | { type: "tool"; name: string };

const DURABLE_MEMORY_FILE_TOOL_NAME_SET = new Set<string>(MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST);

const EXPLICIT_DURABLE_REMEMBER_RE =
  /(记住这个|记一下|以后都按这个|默认就这样|长期按这个|后面都这样|以后按这个来|默认这样|记住这条|remember this|default to this|from now on)/i;

const EXPLICIT_DURABLE_FORGET_RE =
  /(忘掉这个|不要再记这个|移除这条记忆|删掉这条记忆|forget this|don't remember this|remove this memory)/i;

const IMPLICIT_DURABLE_FEEDBACK_RE =
  /(以后回答|今后回答|后续回答|默认回答|回复.*时|回答.*时|回答.*问题时).{0,80}(先|优先|默认|不要|必须).{0,80}(再|解释|步骤|说明)/i;

const HOST_DURABLE_TOOL_PROMPT_PREFIX =
  "The host detected an explicit durable-memory request this turn.";

function buildPinnedToolChoice(params: { toolName: string; modelApi?: string | null }): ToolChoice {
  if (params.modelApi === "openai-completions" || params.modelApi === "openai-responses") {
    return { type: "function", function: { name: params.toolName } };
  }
  return { type: "tool", name: params.toolName };
}

function resolveForcedDurableToolCall(params: {
  intent: "remember" | "forget";
  toolsAllow?: string[];
  modelApi?: string | null;
}): { toolName: string; toolChoice: ToolChoice } | null {
  const preferredTools = MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST;
  const toolName = params.toolsAllow?.length
    ? preferredTools.find((name) => params.toolsAllow?.includes(name))
    : preferredTools[0];
  if (!toolName) {
    return null;
  }
  return {
    toolName,
    toolChoice: buildPinnedToolChoice({
      toolName,
      modelApi: params.modelApi,
    }),
  };
}

export function detectExplicitDurableIntent(
  prompt: string | null | undefined,
): "remember" | "forget" | null {
  const text = prompt?.trim() ?? "";
  if (!text) {
    return null;
  }
  if (EXPLICIT_DURABLE_FORGET_RE.test(text)) {
    return "forget";
  }
  if (EXPLICIT_DURABLE_REMEMBER_RE.test(text) || IMPLICIT_DURABLE_FEEDBACK_RE.test(text)) {
    return "remember";
  }
  return null;
}

function canUseDurableToolForIntent(params: {
  intent: "remember" | "forget";
  disableTools?: boolean;
  toolsAllow?: string[];
}): boolean {
  if (params.disableTools) {
    return false;
  }
  if (!params.toolsAllow?.length) {
    return true;
  }
  return params.toolsAllow.some((toolName) => DURABLE_MEMORY_FILE_TOOL_NAME_SET.has(toolName));
}

export async function maybeRunExplicitDurableIntentGate(params: {
  prompt: string;
  trigger?: "cron" | "heartbeat" | "manual" | "memory" | "overflow" | "user";
  disableTools?: boolean;
  toolsAllow?: string[];
  modelApi?: string | null;
  specialAgentSpawnSource?: string | null;
}): Promise<{
  applied: boolean;
  intent: "remember" | "forget" | null;
  notesSaved: number;
  reason?: string;
  systemPromptInstruction?: string;
  forcedToolName?: string;
  toolChoice?: ToolChoice;
  runtimeToolAlsoAllow?: string[];
}> {
  const intent = detectExplicitDurableIntent(params.prompt);
  if (!intent) {
    return {
      applied: false,
      intent,
      notesSaved: 0,
    };
  }
  if (params.specialAgentSpawnSource?.trim()) {
    return {
      applied: false,
      intent,
      notesSaved: 0,
      reason: "explicit_durable_gate_skipped_special_agent",
    };
  }
  if (params.trigger && params.trigger !== "user" && params.trigger !== "manual") {
    return {
      applied: false,
      intent,
      notesSaved: 0,
      reason: "explicit_durable_gate_skipped_non_user_trigger",
    };
  }
  if (!canUseDurableToolForIntent({ ...params, intent })) {
    return {
      applied: false,
      intent,
      notesSaved: 0,
      reason:
        intent === "forget"
          ? "explicit_durable_gate_missing_delete_tool"
          : "explicit_durable_gate_missing_write_tool",
    };
  }
  const forcedToolCall = resolveForcedDurableToolCall({
    intent,
    toolsAllow: params.toolsAllow,
    modelApi: params.modelApi,
  });
  if (!forcedToolCall) {
    return {
      applied: false,
      intent,
      notesSaved: 0,
      reason:
        intent === "forget"
          ? "explicit_durable_gate_missing_delete_tool"
          : "explicit_durable_gate_missing_write_tool",
    };
  }
  return {
    applied: false,
    intent,
    notesSaved: 0,
    reason: "explicit_durable_gate_force_tool_call",
    forcedToolName: forcedToolCall.toolName,
    toolChoice: forcedToolCall.toolChoice,
    ...(!params.toolsAllow?.length
      ? { runtimeToolAlsoAllow: [...MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST] }
      : {}),
    systemPromptInstruction:
      `${HOST_DURABLE_TOOL_PROMPT_PREFIX} ` +
      `Before replying, you must start the durable-memory workflow with the ${forcedToolCall.toolName} tool, then use the scoped memory file tools to update notes and MEMORY.md as needed. ` +
      "Do not only acknowledge it verbally. If the tools reject the request, explain that outcome instead of claiming it succeeded.",
  };
}
