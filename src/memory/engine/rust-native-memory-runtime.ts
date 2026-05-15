import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { runCrawClawRuntimeTool } from "../../agents/runtime-tools/native.js";
import type {
  MemoryAssembleResult,
  MemoryBootstrapResult,
  MemoryCompactResult,
  MemoryIngestBatchResult,
  MemoryIngestResult,
  MemoryRuntime,
} from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function callMemory(
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return asRecord(await runCrawClawRuntimeTool(method, params));
}

export function createRustNativeMemoryRuntime(): MemoryRuntime {
  return {
    info: {
      id: "rust-native-memory",
      name: "Rust native memory runtime",
      ownsCompaction: true,
    },

    async bootstrap(params): Promise<MemoryBootstrapResult> {
      const result = await callMemory("memory.bootstrap", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
      });
      return {
        bootstrapped: booleanValue(result.bootstrapped, false),
        importedMessages: numberValue(result.importedMessages, 0),
        ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
      };
    },

    async ingest(params): Promise<MemoryIngestResult> {
      await callMemory("memory.ingestBatch", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        messages: [params.message],
      });
      return { ingested: true };
    },

    async ingestBatch(params): Promise<MemoryIngestBatchResult> {
      const result = await callMemory("memory.ingestBatch", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        messages: params.messages,
      });
      return { ingestedCount: numberValue(result.ingestedCount, params.messages.length) };
    },

    async afterTurn(params): Promise<void> {
      await callMemory("memory.afterTurn", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        messages: params.messages,
        prePromptMessageCount: params.prePromptMessageCount,
      });
    },

    async assemble(params): Promise<MemoryAssembleResult> {
      const result = await callMemory("memory.assemble", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        messages: params.messages,
        prompt: params.prompt,
      });
      return {
        messages: arrayValue(result.messages) as AgentMessage[],
        estimatedTokens: numberValue(result.estimatedTokens, 0),
        systemContextSections: arrayValue(
          result.systemContextSections,
        ) as MemoryAssembleResult["systemContextSections"],
        diagnostics: asRecord(result.diagnostics) as MemoryAssembleResult["diagnostics"],
      };
    },

    async compact(params): Promise<MemoryCompactResult> {
      const result = await callMemory("memory.compact", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        force: params.force ?? true,
      });
      return {
        ok: booleanValue(result.ok, false),
        compacted: booleanValue(result.compacted, false),
        ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
        result: asRecord(result.result) as MemoryCompactResult["result"],
      };
    },

    async prepareSubagentSpawn(params) {
      await callMemory("memory.prepareSubagentSpawn", {
        parentSessionKey: params.parentSessionKey,
        childSessionKey: params.childSessionKey,
        ttlMs: params.ttlMs,
      });
      return { rollback: async () => {} };
    },

    async onSubagentEnded(params): Promise<void> {
      await callMemory("memory.onSubagentEnded", {
        childSessionKey: params.childSessionKey,
        reason: params.reason,
      });
    },
  };
}
