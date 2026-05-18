import { callGateway } from "../../gateway/call.js";
import type { SpawnSubagentParams, SpawnSubagentResult } from "../subagents/spawn-types.js";
import type { AgentStreamParams } from "./stream-params.js";
import { normalizeAgentSpawnContext, type AgentSpawnToolContext } from "./subagent-context.js";

export type SpawnSessionRuntime = "subagent" | "acp";

export type SpawnAgentSessionParams = {
  runtime?: SpawnSessionRuntime;
  task: string;
  label?: string;
  agentId?: string;
  resumeSessionId?: string;
  model?: string;
  thinking?: string;
  cwd?: string;
  runTimeoutSeconds?: number;
  maxTurns?: number;
  thread?: boolean;
  mode?: "run" | "session";
  cleanup?: "delete" | "keep";
  streamTo?: "parent";
  extraSystemPrompt?: string;
  spawnSource?: string;
  durableMemoryScope?: SpawnSubagentParams["durableMemoryScope"];
  expectsCompletionMessage?: boolean;
  attachments?: SpawnSubagentParams["attachments"];
  attachMountPath?: string;
  streamParams?: AgentStreamParams;
};

export type SpawnAgentSessionResult = SpawnSubagentResult | SpawnAcpResult;

type SpawnAcpResult =
  | {
      status: "accepted";
      childSessionKey?: string;
      runId?: string;
      mode?: "run" | "session";
    }
  | {
      status: "error";
      error: string;
      childSessionKey?: string;
      runId?: string;
      mode?: "run" | "session";
    };

type RustSpawnResponse = {
  ok?: boolean;
  status?: string;
  sessionKey?: string;
  runId?: string;
  assistantText?: string;
  error?: string;
};

function spawnError(error: unknown): SpawnAgentSessionResult {
  return {
    status: "error",
    error: error instanceof Error ? error.message : String(error),
  };
}

function acceptedSpawnResult(params: {
  response: RustSpawnResponse;
  mode?: "run" | "session";
  modelApplied?: boolean;
}): SpawnSubagentResult {
  const status = params.response.status;
  if (params.response.ok === false || status === "error") {
    return {
      status: "error",
      error: params.response.error ?? "Rust subagent spawn failed.",
    };
  }
  return {
    status: "accepted",
    childSessionKey: params.response.sessionKey,
    runId: params.response.runId,
    mode: params.mode,
    modelApplied: params.modelApplied,
  };
}

export async function spawnAgentSessionDirect(
  params: SpawnAgentSessionParams,
  rawCtx?: AgentSpawnToolContext,
): Promise<SpawnAgentSessionResult> {
  const runtime = params.runtime === "acp" ? "acp" : "subagent";
  const ctx = normalizeAgentSpawnContext(rawCtx);
  const parentSessionKey = ctx.agentSessionKey || "main";
  try {
    if (runtime === "acp") {
      const created = await callGateway<RustSpawnResponse>({
        method: "acp.session.new",
        params: {
          sessionKey: params.resumeSessionId,
          label: params.label,
          model: params.model,
        },
        timeoutMs: 10_000,
      });
      const sessionKey = created.sessionKey;
      if (!sessionKey) {
        return { status: "error", error: "Rust ACP session did not return a session key." };
      }
      const prompted = await callGateway<RustSpawnResponse>({
        method: "acp.session.prompt",
        params: {
          sessionKey,
          message: params.task,
          agentId: params.agentId,
          model: params.model,
          cwd: params.cwd,
          idempotencyKey: params.spawnSource,
        },
        timeoutMs:
          typeof params.runTimeoutSeconds === "number" && params.runTimeoutSeconds > 0
            ? params.runTimeoutSeconds * 1000
            : undefined,
      });
      return {
        status: "accepted",
        childSessionKey: sessionKey,
        runId: prompted.runId,
        mode: params.mode,
      };
    }

    const response = await callGateway<RustSpawnResponse>({
      method: "subagents.spawnRun",
      params: {
        task: params.task,
        label: params.label,
        parentSessionKey,
        agentId: params.agentId,
        model: params.model,
        thinking: params.thinking,
        runTimeoutSeconds: params.runTimeoutSeconds,
        maxTurns: params.maxTurns,
        mode: params.mode,
        cleanup: params.cleanup,
        spawnSource: params.spawnSource,
        durableMemoryScope: params.durableMemoryScope,
        expectsCompletionMessage: params.expectsCompletionMessage !== false,
        attachments: params.attachments,
        attachMountPath: params.attachMountPath,
        streamParams: params.streamParams,
        run: true,
      },
      timeoutMs:
        typeof params.runTimeoutSeconds === "number" && params.runTimeoutSeconds > 0
          ? params.runTimeoutSeconds * 1000
          : undefined,
    });
    return acceptedSpawnResult({
      response,
      mode: params.mode,
      modelApplied: Boolean(params.model),
    });
  } catch (error) {
    return spawnError(error);
  }
}
