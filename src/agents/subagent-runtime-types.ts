import type { CrawClawConfig } from "../config/config.js";
import type { ObservationContext } from "../infra/observation/types.js";
import type { ResolvedProviderAuth } from "./model-auth.js";

export type SubagentRunParams = {
  sessionKey: string;
  message: string;
  provider?: string;
  model?: string;
  toolsAllow?: string[];
  skillsAllow?: string[];
  extraSystemPrompt?: string;
  lane?: string;
  deliver?: boolean;
  idempotencyKey?: string;
  observation?: ObservationContext;
};

export type SubagentRunResult = {
  runId: string;
};

export type SubagentWaitParams = {
  runId: string;
  timeoutMs?: number;
};

export type SubagentWaitResult = {
  status: "ok" | "error" | "timeout";
  error?: string;
};

export type SubagentGetSessionMessagesParams = {
  sessionKey: string;
  limit?: number;
};

export type SubagentGetSessionMessagesResult = {
  messages: unknown[];
};

export type SubagentDeleteSessionParams = {
  sessionKey: string;
  deleteTranscript?: boolean;
};

export type SubagentRuntime = {
  run: (params: SubagentRunParams) => Promise<SubagentRunResult>;
  waitForRun: (params: SubagentWaitParams) => Promise<SubagentWaitResult>;
  getSessionMessages: (
    params: SubagentGetSessionMessagesParams,
  ) => Promise<SubagentGetSessionMessagesResult>;
  deleteSession: (params: SubagentDeleteSessionParams) => Promise<void>;
};

export type ModelAuthRuntime = {
  config: {
    loadConfig: () => CrawClawConfig;
  };
  modelAuth: {
    resolveApiKeyForProvider: (params: {
      provider: string;
      cfg?: CrawClawConfig;
    }) => Promise<ResolvedProviderAuth>;
  };
};
