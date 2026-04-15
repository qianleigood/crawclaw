import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { normalizeToolName } from "../../tool-policy.js";

const MINIMAX_TOOL_CALL_SECTION_RE = /<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/gi;
const MINIMAX_INVOKE_RE = /<invoke\b[^>]*name=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/invoke>/gi;
const MINIMAX_PARAMETER_RE = /<parameter\b[^>]*name=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/parameter>/gi;

type ToolCallLikeBlock = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

function decodeXmlText(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function normalizeInvokeArgumentKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) {
    return trimmed;
  }
  const camelized = trimmed.replace(/[-_]+([a-zA-Z0-9])/g, (_, next: string) => next.toUpperCase());
  return camelized.charAt(0).toLowerCase() + camelized.slice(1);
}

function resolveAllowedToolName(rawName: string, allowedToolNames?: Set<string>): string | null {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeToolName(trimmed);
  if (!allowedToolNames || allowedToolNames.size === 0) {
    return normalized || trimmed;
  }
  if (allowedToolNames.has(trimmed)) {
    return trimmed;
  }
  if (allowedToolNames.has(normalized)) {
    return normalized;
  }
  const folded = normalized.toLowerCase();
  for (const allowed of allowedToolNames) {
    if (allowed.toLowerCase() === folded) {
      return allowed;
    }
  }
  return null;
}

function normalizeInvokeArguments(
  toolName: string,
  rawArguments: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawArguments)) {
    const normalizedKey = normalizeInvokeArgumentKey(key);
    if (!normalizedKey) {
      continue;
    }
    normalized[normalizedKey] = value;
  }
  return normalized;
}

function extractInvokeArguments(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const match of body.matchAll(MINIMAX_PARAMETER_RE)) {
    const key = decodeXmlText(match[2] ?? "").trim();
    const value = decodeXmlText(match[3] ?? "").trim();
    if (!key || !value) {
      continue;
    }
    args[key] = value;
  }
  return args;
}

function extractMinimaxXmlToolCalls(
  text: string,
  allowedToolNames?: Set<string>,
): ToolCallLikeBlock[] {
  const toolCalls: ToolCallLikeBlock[] = [];
  let nextIndex = 1;
  for (const section of text.matchAll(MINIMAX_TOOL_CALL_SECTION_RE)) {
    const block = section[0] ?? "";
    for (const invokeMatch of block.matchAll(MINIMAX_INVOKE_RE)) {
      const rawName = decodeXmlText(invokeMatch[2] ?? "");
      const toolName = resolveAllowedToolName(rawName, allowedToolNames);
      if (!toolName) {
        continue;
      }
      const argumentsRecord = normalizeInvokeArguments(
        toolName,
        extractInvokeArguments(invokeMatch[3] ?? ""),
      );
      toolCalls.push({
        type: "toolCall",
        id: `call_minimax_xml_${nextIndex++}`,
        name: toolName,
        arguments: argumentsRecord,
      });
    }
  }
  return toolCalls;
}

export function convertMinimaxXmlToolCallsInMessage(
  message: unknown,
  allowedToolNames?: Set<string>,
): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const typedMessage = message as {
    role?: unknown;
    stopReason?: unknown;
    content?: unknown;
  };
  if (typedMessage.role !== "assistant" || !Array.isArray(typedMessage.content)) {
    return false;
  }

  const nextContent: unknown[] = [];
  let changed = false;
  let foundToolCall = false;

  for (const block of typedMessage.content) {
    if (!block || typeof block !== "object") {
      nextContent.push(block);
      continue;
    }
    const typedBlock = block as { type?: unknown; text?: unknown };
    if (typedBlock.type !== "text" || typeof typedBlock.text !== "string") {
      nextContent.push(block);
      continue;
    }
    if (!/minimax:tool_call/i.test(typedBlock.text)) {
      nextContent.push(block);
      continue;
    }
    const toolCalls = extractMinimaxXmlToolCalls(typedBlock.text, allowedToolNames);
    if (!toolCalls.length) {
      nextContent.push(block);
      continue;
    }
    nextContent.push(...toolCalls);
    changed = true;
    foundToolCall = true;
  }

  if (!changed) {
    return false;
  }

  typedMessage.content = nextContent;
  if (foundToolCall) {
    typedMessage.stopReason = "toolUse";
  }
  return true;
}

function wrapMinimaxXmlToolCalls(
  stream: ReturnType<typeof streamSimple>,
  allowedToolNames?: Set<string>,
): ReturnType<typeof streamSimple> {
  const originalResult = stream.result.bind(stream);
  stream.result = async () => {
    const message = await originalResult();
    convertMinimaxXmlToolCallsInMessage(message, allowedToolNames);
    return message;
  };

  const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
  (stream as { [Symbol.asyncIterator]: typeof originalAsyncIterator })[Symbol.asyncIterator] =
    function () {
      const iterator = originalAsyncIterator();
      return {
        async next() {
          const result = await iterator.next();
          if (!result.done && result.value && typeof result.value === "object") {
            const event = result.value as {
              partial?: unknown;
              message?: unknown;
            };
            convertMinimaxXmlToolCallsInMessage(event.partial, allowedToolNames);
            convertMinimaxXmlToolCallsInMessage(event.message, allowedToolNames);
          }
          return result;
        },
        async return(value?: unknown) {
          return iterator.return?.(value) ?? { done: true as const, value: undefined };
        },
        async throw(error?: unknown) {
          return iterator.throw?.(error) ?? { done: true as const, value: undefined };
        },
      };
    };

  return stream;
}

export function wrapStreamFnConvertMinimaxXmlToolCalls(
  baseFn: StreamFn,
  allowedToolNames?: Set<string>,
): StreamFn {
  return (model, context, options) => {
    const maybeStream = baseFn(model, context, options);
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then((stream) =>
        wrapMinimaxXmlToolCalls(stream, allowedToolNames),
      );
    }
    return wrapMinimaxXmlToolCalls(maybeStream, allowedToolNames);
  };
}
