import type { CrawClawConfig } from "../../config/config.js";
import {
  coerceImageAssistantText,
  decodeDataUrl,
  type ImageModelConfig,
} from "./image-tool.helpers.js";
import type { AnyAgentTool, ToolFsPolicy } from "./tool-runtime.helpers.js";

export const __testing = {
  decodeDataUrl,
  coerceImageAssistantText,
  resolveImageToolMaxTokens,
} as const;

function resolveImageToolMaxTokens(modelMaxTokens: number | undefined, requestedMaxTokens = 4096) {
  if (
    typeof modelMaxTokens !== "number" ||
    !Number.isFinite(modelMaxTokens) ||
    modelMaxTokens <= 0
  ) {
    return requestedMaxTokens;
  }
  return Math.min(requestedMaxTokens, modelMaxTokens);
}

export function resolveImageModelConfigForTool(_params: {
  cfg?: CrawClawConfig;
  agentDir: string;
}): ImageModelConfig | null {
  return null;
}

export function createImageTool(_options?: {
  config?: CrawClawConfig;
  agentDir?: string;
  workspaceDir?: string;
  fsPolicy?: ToolFsPolicy;
  modelHasVision?: boolean;
}): AnyAgentTool | null {
  return null;
}
