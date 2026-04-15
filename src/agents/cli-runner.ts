import type { ImageContent } from "@mariozechner/pi-ai";
import type { ThinkLevel } from "../auto-reply/thinking.js";
import type { CrawClawConfig } from "../config/config.js";
import { executePreparedCliRun } from "./cli-runner/execute.js";
import { prepareCliRunContext } from "./cli-runner/prepare.js";
import type { RunCliAgentParams } from "./cli-runner/types.js";
import { captureModelVisibleContext } from "./context-archive/turn-capture.js";
import { FailoverError, resolveFailoverStatus } from "./failover-error.js";
import { classifyFailoverReason, isFailoverErrorMessage } from "./pi-embedded-helpers.js";
import type { EmbeddedPiRunResult } from "./pi-embedded-runner.js";
import {
  buildQueryContextProviderRequest,
  createQueryContextToolContext,
  materializeQueryContextProviderRequest,
} from "./query-context/render.js";
import type { QueryContext, QueryContextDiagnostics } from "./query-context/types.js";
import { emitRunLoopLifecycleEvent } from "./runtime/lifecycle/bus.js";
import { ensureSharedRunLoopLifecycleSubscribers } from "./runtime/lifecycle/shared-subscribers.js";

function buildCliQueryContext(params: {
  prompt: string;
  systemPrompt: string;
  thinkLevel?: ThinkLevel;
  bootstrapFiles?: string[];
}): QueryContext {
  return {
    messages: [],
    userPrompt: params.prompt,
    userContextSections: [],
    systemPromptSections: [
      {
        id: "cli:system_prompt",
        role: "system_prompt",
        content: params.systemPrompt,
        source: "cli-runner",
        sectionType: "bootstrap",
      },
    ],
    systemContextSections: [],
    toolContext: createQueryContextToolContext([]),
    thinkingConfig: {
      mode: "cli",
      ...(params.thinkLevel ? { thinkLevel: params.thinkLevel } : {}),
    },
    diagnostics: {
      bootstrapFiles: params.bootstrapFiles,
    },
  };
}

export async function runCliAgent(params: RunCliAgentParams): Promise<EmbeddedPiRunResult> {
  const context = await prepareCliRunContext(params);
  const queryContext = buildCliQueryContext({
    prompt: params.prompt,
    systemPrompt: context.systemPrompt,
    thinkLevel: params.thinkLevel,
    bootstrapFiles: context.systemPromptReport.injectedWorkspaceFiles.map((file) => file.path),
  });
  const providerRequest = buildQueryContextProviderRequest(queryContext);
  const modelInput = materializeQueryContextProviderRequest(providerRequest);
  const queryContextDiagnostics: QueryContextDiagnostics = {
    ...modelInput.diagnostics,
    queryContextHash: modelInput.queryContextHash,
    sectionTokenUsage: providerRequest.snapshot.sectionTokenUsage,
    providerRequestSnapshot: providerRequest.snapshot,
  };

  ensureSharedRunLoopLifecycleSubscribers();
  await emitRunLoopLifecycleEvent({
    phase: "turn_started",
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    isTopLevel: true,
    sessionFile: params.sessionFile,
    turnIndex: 1,
    metadata: {
      provider: params.provider,
      model: context.modelId,
      workspaceDir: context.workspaceDir,
      taskRuntime: "cli",
    },
  });
  await captureModelVisibleContext({
    config: params.config,
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    prompt: modelInput.prompt,
    systemPrompt: modelInput.systemPrompt,
    systemContextSections: queryContext.systemContextSections,
    messages: modelInput.messages,
    tools: [],
    provider: params.provider,
    model: context.modelId,
    systemPromptReport: context.systemPromptReport,
    queryContextDiagnostics,
    providerRequestSnapshot: providerRequest.snapshot,
  });

  const buildCliRunResult = (resultParams: {
    output: Awaited<ReturnType<typeof executePreparedCliRun>>;
    effectiveCliSessionId?: string;
  }): EmbeddedPiRunResult => {
    const text = resultParams.output.text?.trim();
    const payloads = text ? [{ text }] : undefined;

    return {
      payloads,
      meta: {
        durationMs: Date.now() - context.started,
        systemPromptReport: context.systemPromptReport,
        agentMeta: {
          sessionId: resultParams.effectiveCliSessionId ?? params.sessionId ?? "",
          provider: params.provider,
          model: context.modelId,
          usage: resultParams.output.usage,
          ...(resultParams.effectiveCliSessionId
            ? {
                cliSessionBinding: {
                  sessionId: resultParams.effectiveCliSessionId,
                  ...(params.authProfileId ? { authProfileId: params.authProfileId } : {}),
                  ...(context.extraSystemPromptHash
                    ? { extraSystemPromptHash: context.extraSystemPromptHash }
                    : {}),
                  ...(context.preparedBackend.mcpConfigHash
                    ? { mcpConfigHash: context.preparedBackend.mcpConfigHash }
                    : {}),
                },
              }
            : {}),
        },
      },
    };
  };

  // Try with the provided CLI session ID first
  try {
    try {
      const output = await executePreparedCliRun(context, context.reusableCliSession.sessionId);
      await emitRunLoopLifecycleEvent({
        phase: "post_sampling",
        runId: params.runId,
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        agentId: params.agentId,
        isTopLevel: true,
        sessionFile: params.sessionFile,
        turnIndex: 1,
        metadata: {
          provider: params.provider,
          model: context.modelId,
          taskRuntime: "cli",
        },
      });
      const effectiveCliSessionId = output.sessionId ?? context.reusableCliSession.sessionId;
      await emitRunLoopLifecycleEvent({
        phase: "settled_turn",
        runId: params.runId,
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        agentId: params.agentId,
        isTopLevel: true,
        sessionFile: params.sessionFile,
        turnIndex: 1,
        metadata: {
          provider: params.provider,
          model: context.modelId,
          taskRuntime: "cli",
        },
      });
      await emitRunLoopLifecycleEvent({
        phase: "stop",
        runId: params.runId,
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        agentId: params.agentId,
        isTopLevel: true,
        sessionFile: params.sessionFile,
        stopReason: "completed",
        metadata: {
          provider: params.provider,
          model: context.modelId,
          taskRuntime: "cli",
        },
      });
      return buildCliRunResult({ output, effectiveCliSessionId });
    } catch (err) {
      if (err instanceof FailoverError) {
        // Check if this is a session expired error and we have a session to clear
        if (
          err.reason === "session_expired" &&
          context.reusableCliSession.sessionId &&
          params.sessionKey
        ) {
          // Clear the expired session ID from the session entry
          // This requires access to the session store, which we don't have here
          // We'll need to modify the caller to handle this case

          // For now, retry without the session ID to create a new session
          const output = await executePreparedCliRun(context, undefined);
          const effectiveCliSessionId = output.sessionId;
          await emitRunLoopLifecycleEvent({
            phase: "post_sampling",
            runId: params.runId,
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            agentId: params.agentId,
            isTopLevel: true,
            sessionFile: params.sessionFile,
            turnIndex: 1,
            metadata: {
              provider: params.provider,
              model: context.modelId,
              taskRuntime: "cli",
            },
          });
          await emitRunLoopLifecycleEvent({
            phase: "settled_turn",
            runId: params.runId,
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            agentId: params.agentId,
            isTopLevel: true,
            sessionFile: params.sessionFile,
            turnIndex: 1,
            metadata: {
              provider: params.provider,
              model: context.modelId,
              taskRuntime: "cli",
            },
          });
          await emitRunLoopLifecycleEvent({
            phase: "stop",
            runId: params.runId,
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            agentId: params.agentId,
            isTopLevel: true,
            sessionFile: params.sessionFile,
            stopReason: "completed",
            metadata: {
              provider: params.provider,
              model: context.modelId,
              taskRuntime: "cli",
            },
          });
          return buildCliRunResult({ output, effectiveCliSessionId });
        }
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (isFailoverErrorMessage(message)) {
        const reason = classifyFailoverReason(message) ?? "unknown";
        const status = resolveFailoverStatus(reason);
        throw new FailoverError(message, {
          reason,
          provider: params.provider,
          model: context.modelId,
          status,
        });
      }
      throw err;
    }
  } catch (err) {
    await emitRunLoopLifecycleEvent({
      phase: "stop_failure",
      runId: params.runId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      agentId: params.agentId,
      isTopLevel: true,
      sessionFile: params.sessionFile,
      error: err instanceof Error ? err.message : String(err),
      metadata: {
        provider: params.provider,
        model: context.modelId,
        taskRuntime: "cli",
      },
    });
    throw err;
  } finally {
    await context.preparedBackend.cleanup?.();
  }
}

export async function runClaudeCliAgent(params: {
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  sessionFile: string;
  workspaceDir: string;
  config?: CrawClawConfig;
  prompt: string;
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  timeoutMs: number;
  runId: string;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  claudeSessionId?: string;
  images?: ImageContent[];
}): Promise<EmbeddedPiRunResult> {
  return runCliAgent({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    sessionFile: params.sessionFile,
    workspaceDir: params.workspaceDir,
    config: params.config,
    prompt: params.prompt,
    provider: params.provider ?? "claude-cli",
    model: params.model ?? "opus",
    thinkLevel: params.thinkLevel,
    timeoutMs: params.timeoutMs,
    runId: params.runId,
    extraSystemPrompt: params.extraSystemPrompt,
    ownerNumbers: params.ownerNumbers,
    cliSessionId: params.claudeSessionId,
    images: params.images,
  });
}
