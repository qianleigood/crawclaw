import type { CrawClawConfig } from "../../../../config/config.js";
import { registerRunLoopLifecycleHandler, unregisterRunLoopLifecycleHandler } from "../bus.js";
import type { RunLoopLifecycleEvent } from "../types.js";
import {
  resolveCompatHookSessionKey,
  runAfterCompactionInternalHooks,
  runBeforeCompactionInternalHooks,
} from "./internal-hooks.js";
import {
  getCompactionHookRunner,
  runAfterCompactionPluginHooks,
  runBeforeCompactionPluginHooks,
} from "./plugin-hooks.js";
import { runPostCompactionSideEffects } from "./post-compaction.js";

type CompactionLifecycleMetadata = {
  workspaceDir?: string;
  messageProvider?: string;
  config?: CrawClawConfig;
  messageCountOriginal?: number;
  tokenCountOriginal?: number;
  compactedCount?: number;
  summaryLength?: number;
  tokensBefore?: number;
  firstKeptEntryId?: string;
  postCompactSummaryMessages?: number;
  postCompactKeptMessages?: number;
  postCompactAttachments?: number;
  postCompactDiscoveredTools?: number;
  postCompactHasPreservedSegment?: boolean;
  skipLegacyHooks?: boolean;
  skipPostCompactionSideEffects?: boolean;
};

function resolveLifecycleMetadata(event: RunLoopLifecycleEvent): CompactionLifecycleMetadata {
  return (
    typeof event.metadata === "object" && event.metadata ? event.metadata : {}
  ) as CompactionLifecycleMetadata;
}

function resolveLifecycleSessionAgentId(event: RunLoopLifecycleEvent): string {
  return typeof event.agentId === "string" && event.agentId.trim() ? event.agentId.trim() : "main";
}

function resolveLifecycleWorkspaceDir(event: RunLoopLifecycleEvent): string {
  const metadata = resolveLifecycleMetadata(event);
  return typeof metadata.workspaceDir === "string" ? metadata.workspaceDir : "";
}

function resolveLifecycleMessageProvider(event: RunLoopLifecycleEvent): string | undefined {
  const metadata = resolveLifecycleMetadata(event);
  return typeof metadata.messageProvider === "string" && metadata.messageProvider.trim()
    ? metadata.messageProvider
    : undefined;
}

function resolveLifecycleConfig(event: RunLoopLifecycleEvent): CrawClawConfig | undefined {
  const metadata = resolveLifecycleMetadata(event);
  return typeof metadata.config === "object" && metadata.config ? metadata.config : undefined;
}

function resolveFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

async function handlePreCompactionLifecycleEvent(event: RunLoopLifecycleEvent): Promise<void> {
  const metadata = resolveLifecycleMetadata(event);
  const hookRunner = getCompactionHookRunner();
  const { hookSessionKey } = await runBeforeCompactionInternalHooks({
    sessionId: event.sessionId,
    sessionKey: event.sessionKey,
    messageCountBefore: event.messageCount ?? -1,
    tokenCountBefore: resolveFiniteNumber(event.tokenCount),
    messageCountOriginal:
      resolveFiniteNumber(metadata.messageCountOriginal) ?? event.messageCount ?? -1,
    tokenCountOriginal: resolveFiniteNumber(metadata.tokenCountOriginal),
  });
  await runBeforeCompactionPluginHooks({
    hookRunner,
    sessionId: event.sessionId,
    sessionAgentId: resolveLifecycleSessionAgentId(event),
    hookSessionKey,
    workspaceDir: resolveLifecycleWorkspaceDir(event),
    messageProvider: resolveLifecycleMessageProvider(event),
    sessionFile: typeof event.sessionFile === "string" ? event.sessionFile : undefined,
    messageCountBefore: event.messageCount ?? -1,
    tokenCountBefore: resolveFiniteNumber(event.tokenCount),
  });
}

async function handlePostCompactionLifecycleEvent(event: RunLoopLifecycleEvent): Promise<void> {
  const metadata = resolveLifecycleMetadata(event);
  const sessionFile = typeof event.sessionFile === "string" ? event.sessionFile : "";
  if (sessionFile.trim() && metadata.skipPostCompactionSideEffects !== true) {
    await runPostCompactionSideEffects({
      config: resolveLifecycleConfig(event),
      sessionKey: event.sessionKey,
      sessionFile,
    });
  }
  if (metadata.skipLegacyHooks === true) {
    return;
  }
  const { hookSessionKey, missingSessionKey } = resolveCompatHookSessionKey({
    sessionId: event.sessionId,
    sessionKey: event.sessionKey,
  });
  const hookRunner = getCompactionHookRunner();
  await runAfterCompactionInternalHooks({
    sessionId: event.sessionId,
    hookSessionKey,
    missingSessionKey,
    messageCountAfter: event.messageCount ?? -1,
    tokensAfter: resolveFiniteNumber(event.tokenCount),
    compactedCount: resolveFiniteNumber(metadata.compactedCount) ?? -1,
    summaryLength: resolveFiniteNumber(metadata.summaryLength),
    tokensBefore: resolveFiniteNumber(metadata.tokensBefore),
    firstKeptEntryId: resolveString(metadata.firstKeptEntryId),
    postCompactSummaryMessages: resolveFiniteNumber(metadata.postCompactSummaryMessages),
    postCompactKeptMessages: resolveFiniteNumber(metadata.postCompactKeptMessages),
    postCompactAttachments: resolveFiniteNumber(metadata.postCompactAttachments),
    postCompactDiscoveredTools: resolveFiniteNumber(metadata.postCompactDiscoveredTools),
    postCompactHasPreservedSegment: metadata.postCompactHasPreservedSegment === true,
  });
  await runAfterCompactionPluginHooks({
    hookRunner,
    sessionId: event.sessionId,
    sessionAgentId: resolveLifecycleSessionAgentId(event),
    hookSessionKey,
    workspaceDir: resolveLifecycleWorkspaceDir(event),
    messageProvider: resolveLifecycleMessageProvider(event),
    messageCountAfter: event.messageCount ?? -1,
    tokensAfter: resolveFiniteNumber(event.tokenCount),
    compactedCount: resolveFiniteNumber(metadata.compactedCount) ?? -1,
    sessionFile,
  });
}

export class RunLoopLifecycleCompatSubscriber {
  private registered = false;
  private readonly handler = (event: RunLoopLifecycleEvent) => this.handleEvent(event);

  ensureRegistered(): void {
    if (this.registered) {
      return;
    }
    registerRunLoopLifecycleHandler("pre_compact", this.handler);
    registerRunLoopLifecycleHandler("post_compact", this.handler);
    this.registered = true;
  }

  dispose(): void {
    if (!this.registered) {
      return;
    }
    unregisterRunLoopLifecycleHandler("pre_compact", this.handler);
    unregisterRunLoopLifecycleHandler("post_compact", this.handler);
    this.registered = false;
  }

  private async handleEvent(event: RunLoopLifecycleEvent): Promise<void> {
    if (event.phase === "pre_compact") {
      await handlePreCompactionLifecycleEvent(event);
      return;
    }
    if (event.phase === "post_compact") {
      await handlePostCompactionLifecycleEvent(event);
    }
  }
}

let sharedRunLoopLifecycleCompatSubscriber: RunLoopLifecycleCompatSubscriber | null = null;

export function getSharedRunLoopLifecycleCompatSubscriber(): RunLoopLifecycleCompatSubscriber {
  if (!sharedRunLoopLifecycleCompatSubscriber) {
    sharedRunLoopLifecycleCompatSubscriber = new RunLoopLifecycleCompatSubscriber();
  }
  sharedRunLoopLifecycleCompatSubscriber.ensureRegistered();
  return sharedRunLoopLifecycleCompatSubscriber;
}

export const __testing = {
  resetSharedRunLoopLifecycleCompatSubscriber(): void {
    sharedRunLoopLifecycleCompatSubscriber?.dispose();
    sharedRunLoopLifecycleCompatSubscriber = null;
  },
};
