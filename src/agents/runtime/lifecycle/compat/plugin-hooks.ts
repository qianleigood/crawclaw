import { createSubsystemLogger } from "../../../../logging/subsystem.js";
import { getGlobalHookRunner } from "../../../../plugins/hook-runner-global.js";

const log = createSubsystemLogger("runtime-lifecycle-compat");

export type CompactionHookRunner = {
  hasHooks?: (hookName?: string) => boolean;
  runBeforeCompaction?: (
    metrics: { messageCount: number; tokenCount?: number; sessionFile?: string },
    context: {
      sessionId: string;
      agentId: string;
      sessionKey: string;
      workspaceDir: string;
      messageProvider?: string;
    },
  ) => Promise<void> | void;
  runAfterCompaction?: (
    metrics: {
      messageCount: number;
      tokenCount?: number;
      compactedCount: number;
      sessionFile: string;
    },
    context: {
      sessionId: string;
      agentId: string;
      sessionKey: string;
      workspaceDir: string;
      messageProvider?: string;
    },
  ) => Promise<void> | void;
};

export function getCompactionHookRunner(): CompactionHookRunner | null {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner) {
    return null;
  }
  return {
    hasHooks: (hookName?: string) => hookRunner.hasHooks?.(hookName as never) ?? false,
    runBeforeCompaction: hookRunner.runBeforeCompaction?.bind(hookRunner),
    runAfterCompaction: hookRunner.runAfterCompaction?.bind(hookRunner),
  };
}

export async function runBeforeCompactionPluginHooks(params: {
  hookRunner?: CompactionHookRunner | null;
  sessionId: string;
  sessionAgentId: string;
  hookSessionKey: string;
  workspaceDir: string;
  messageProvider?: string;
  messageCountBefore: number;
  tokenCountBefore?: number;
  sessionFile?: string;
}): Promise<void> {
  if (!params.hookRunner?.hasHooks?.("before_compaction")) {
    return;
  }
  try {
    await params.hookRunner.runBeforeCompaction?.(
      {
        messageCount: params.messageCountBefore,
        tokenCount: params.tokenCountBefore,
        ...(params.sessionFile ? { sessionFile: params.sessionFile } : {}),
      },
      {
        sessionId: params.sessionId,
        agentId: params.sessionAgentId,
        sessionKey: params.hookSessionKey,
        workspaceDir: params.workspaceDir,
        messageProvider: params.messageProvider,
      },
    );
  } catch (err) {
    log.warn("before_compaction hook failed", {
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
    });
  }
}

export async function runAfterCompactionPluginHooks(params: {
  hookRunner?: CompactionHookRunner | null;
  sessionId: string;
  sessionAgentId: string;
  hookSessionKey: string;
  workspaceDir: string;
  messageProvider?: string;
  messageCountAfter: number;
  tokensAfter?: number;
  compactedCount: number;
  sessionFile: string;
}): Promise<void> {
  if (!params.hookRunner?.hasHooks?.("after_compaction")) {
    return;
  }
  try {
    await params.hookRunner.runAfterCompaction?.(
      {
        messageCount: params.messageCountAfter,
        tokenCount: params.tokensAfter,
        compactedCount: params.compactedCount,
        sessionFile: params.sessionFile,
      },
      {
        sessionId: params.sessionId,
        agentId: params.sessionAgentId,
        sessionKey: params.hookSessionKey,
        workspaceDir: params.workspaceDir,
        messageProvider: params.messageProvider,
      },
    );
  } catch (err) {
    log.warn("after_compaction hook failed", {
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
    });
  }
}
