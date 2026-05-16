import type { ImageContent, Message, streamSimple, TextContent } from "@mariozechner/pi-ai";
import type { TSchema as LegacyTypeBoxSchema } from "@sinclair/typebox";
import type { TSchema as PiTypeBoxSchema } from "typebox";

export type StreamFn = (
  ...args: Parameters<typeof streamSimple>
) => ReturnType<typeof streamSimple> | Promise<ReturnType<typeof streamSimple>>;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type CompactionSummaryMessage = {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number | string;
  tokensAfter?: number;
  firstKeptEntryId?: string;
  postCompactArtifacts?: unknown;
  details?: unknown;
};

export type AgentMessage = Message | CompactionSummaryMessage;

export type AgentToolResult<T = unknown> = {
  content: Array<TextContent | ImageContent>;
  details: T;
  isError?: boolean;
  terminate?: boolean;
};

export type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void;

export type ToolExecutionMode = "sequential" | "parallel";

type AgentToolSchema = LegacyTypeBoxSchema | PiTypeBoxSchema | Record<string, unknown>;

export type AgentTool<TParameters = AgentToolSchema, TDetails = unknown> = {
  name: string;
  label: string;
  description: string;
  parameters?: TParameters;
  prepareArguments?: (args: unknown) => unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
  executionMode?: ToolExecutionMode;
};
