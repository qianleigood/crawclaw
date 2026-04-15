import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { SessionCompactionStateRow } from "../types/runtime.ts";

export async function appendAssemblyAudit(params: {
  runtimeStore: RuntimeStore;
  sessionId: string;
  prompt?: string | null;
  rawMessageCount: number;
  compactedMessageCount: number;
  rawMessageTokens: number;
  compactedMessageTokens: number;
  sessionMemoryTokens?: number | null;
  recallTokens?: number | null;
  systemContextTokens?: number | null;
  compactionState?: SessionCompactionStateRow | null;
  details: Record<string, unknown>;
}) {
  const {
    runtimeStore,
    sessionId,
    prompt,
    rawMessageCount,
    compactedMessageCount,
    rawMessageTokens,
    compactedMessageTokens,
    sessionMemoryTokens,
    recallTokens,
    systemContextTokens,
    compactionState,
    details,
  } = params;

  await runtimeStore.appendContextAssemblyAudit({
    sessionId,
    prompt: prompt || null,
    rawMessageCount,
    compactedMessageCount,
    rawMessageTokens,
    compactedMessageTokens,
    sessionMemoryTokens: sessionMemoryTokens ?? null,
    recallTokens: recallTokens ?? null,
    systemContextTokens: systemContextTokens ?? null,
    preservedTailStartTurn: compactionState?.preservedTailStartTurn ?? null,
    compactionStatePresent: Boolean(compactionState),
    compactionMode: compactionState?.mode ?? null,
    detailsJson: JSON.stringify({
      ...details,
      preservedTailMessageId: compactionState?.preservedTailMessageId ?? null,
    }),
  });
}
