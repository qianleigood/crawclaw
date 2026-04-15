import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { SpawnAgentSessionParams } from "../runtime/spawn-session.js";
import type { SpawnedToolContext } from "../spawned-context.js";
import { jsonResult, readStringParam } from "./common.js";

export type SessionsSpawnRuntime = "subagent" | "acp";
export type SessionsSpawnSandboxMode = "inherit" | "require";
export type SessionsSpawnCleanupMode = "delete" | "keep";
export type SessionsSpawnStreamTarget = "parent";

type SessionsSpawnToolParams = {
  task: string;
  label?: string;
  runtime: SessionsSpawnRuntime;
  requestedAgentId?: string;
  resumeSessionId?: string;
  modelOverride?: string;
  thinkingOverrideRaw?: string;
  cwd?: string;
  runTimeoutSeconds?: number;
  thread: boolean;
  mode?: "run" | "session";
  cleanup: SessionsSpawnCleanupMode;
  sandbox: SessionsSpawnSandboxMode;
  streamTo?: SessionsSpawnStreamTarget;
  attachments?: Array<{
    name: string;
    content: string;
    encoding?: "utf8" | "base64";
    mimeType?: string;
  }>;
  attachMountPath?: string;
};

export function buildSessionsSpawnError(message: string) {
  return jsonResult({
    status: "error",
    error: message,
  });
}

export function parseSessionsSpawnToolParams(
  params: Record<string, unknown>,
): SessionsSpawnToolParams {
  const task = readStringParam(params, "task", { required: true });
  const label = typeof params.label === "string" ? params.label.trim() : "";
  const runtime: SessionsSpawnRuntime = params.runtime === "acp" ? "acp" : "subagent";
  const requestedAgentId = readStringParam(params, "agentId");
  const resumeSessionId = readStringParam(params, "resumeSessionId");
  const modelOverride = readStringParam(params, "model");
  const thinkingOverrideRaw = readStringParam(params, "thinking");
  const cwd = readStringParam(params, "cwd");
  const mode = params.mode === "run" || params.mode === "session" ? params.mode : undefined;
  const cleanup: SessionsSpawnCleanupMode =
    params.cleanup === "keep" || params.cleanup === "delete" ? params.cleanup : "keep";
  const sandbox: SessionsSpawnSandboxMode = params.sandbox === "require" ? "require" : "inherit";
  const streamTo: SessionsSpawnStreamTarget | undefined =
    params.streamTo === "parent" ? "parent" : undefined;
  const timeoutSecondsCandidate =
    typeof params.runTimeoutSeconds === "number"
      ? params.runTimeoutSeconds
      : typeof params.timeoutSeconds === "number"
        ? params.timeoutSeconds
        : undefined;
  const runTimeoutSeconds =
    typeof timeoutSecondsCandidate === "number" && Number.isFinite(timeoutSecondsCandidate)
      ? Math.max(0, Math.floor(timeoutSecondsCandidate))
      : undefined;
  const thread = params.thread === true;
  const attachments = Array.isArray(params.attachments)
    ? (params.attachments as SessionsSpawnToolParams["attachments"])
    : undefined;
  const attachMountPath =
    params.attachAs && typeof params.attachAs === "object"
      ? readStringParam(params.attachAs as Record<string, unknown>, "mountPath")
      : undefined;

  return {
    task,
    ...(label ? { label } : {}),
    runtime,
    ...(requestedAgentId ? { requestedAgentId } : {}),
    ...(resumeSessionId ? { resumeSessionId } : {}),
    ...(modelOverride ? { modelOverride } : {}),
    ...(thinkingOverrideRaw ? { thinkingOverrideRaw } : {}),
    ...(cwd ? { cwd } : {}),
    ...(typeof runTimeoutSeconds === "number" ? { runTimeoutSeconds } : {}),
    thread,
    ...(mode ? { mode } : {}),
    cleanup,
    sandbox,
    ...(streamTo ? { streamTo } : {}),
    ...(attachments ? { attachments } : {}),
    ...(attachMountPath ? { attachMountPath } : {}),
  };
}

export function validateSessionsSpawnToolParams(
  parsed: SessionsSpawnToolParams,
): ReturnType<typeof buildSessionsSpawnError> | null {
  if (parsed.streamTo && parsed.runtime !== "acp") {
    return buildSessionsSpawnError(
      `streamTo is only supported for runtime=acp; got runtime=${parsed.runtime}`,
    );
  }

  if (parsed.resumeSessionId && parsed.runtime !== "acp") {
    return buildSessionsSpawnError(
      `resumeSessionId is only supported for runtime=acp; got runtime=${parsed.runtime}`,
    );
  }

  if (
    parsed.runtime === "acp" &&
    Array.isArray(parsed.attachments) &&
    parsed.attachments.length > 0
  ) {
    return buildSessionsSpawnError(
      "attachments are currently unsupported for runtime=acp; use runtime=subagent or remove attachments",
    );
  }

  return null;
}

export function buildSessionsSpawnRequest(parsed: SessionsSpawnToolParams): SpawnAgentSessionParams {
  return {
    runtime: parsed.runtime,
    task: parsed.task,
    ...(parsed.label ? { label: parsed.label } : {}),
    ...(parsed.requestedAgentId ? { agentId: parsed.requestedAgentId } : {}),
    ...(parsed.resumeSessionId ? { resumeSessionId: parsed.resumeSessionId } : {}),
    ...(parsed.modelOverride ? { model: parsed.modelOverride } : {}),
    ...(parsed.thinkingOverrideRaw ? { thinking: parsed.thinkingOverrideRaw } : {}),
    ...(parsed.cwd ? { cwd: parsed.cwd } : {}),
    ...(typeof parsed.runTimeoutSeconds === "number"
      ? { runTimeoutSeconds: parsed.runTimeoutSeconds }
      : {}),
    ...(parsed.thread ? { thread: true } : {}),
    ...(parsed.mode ? { mode: parsed.mode } : {}),
    cleanup: parsed.cleanup,
    sandbox: parsed.sandbox,
    ...(parsed.streamTo ? { streamTo: parsed.streamTo } : {}),
    ...(parsed.attachments ? { attachments: parsed.attachments } : {}),
    ...(parsed.attachMountPath ? { attachMountPath: parsed.attachMountPath } : {}),
  };
}

export function buildSessionsSpawnContext(
  opts:
    | ({
        agentSessionKey?: string;
        agentChannel?: GatewayMessageChannel;
        agentAccountId?: string;
        agentTo?: string;
        agentThreadId?: string | number;
        sandboxed?: boolean;
        requesterAgentIdOverride?: string;
      } & SpawnedToolContext)
    | undefined,
) {
  return {
    agentSessionKey: opts?.agentSessionKey,
    agentChannel: opts?.agentChannel,
    agentAccountId: opts?.agentAccountId,
    agentTo: opts?.agentTo,
    agentThreadId: opts?.agentThreadId,
    agentGroupId: opts?.agentGroupId,
    agentGroupChannel: opts?.agentGroupChannel,
    agentGroupSpace: opts?.agentGroupSpace,
    requesterAgentIdOverride: opts?.requesterAgentIdOverride,
    sandboxed: opts?.sandboxed,
    workspaceDir: opts?.workspaceDir,
  };
}
