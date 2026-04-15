import type { CrawClawConfig } from "../../config/config.js";
import { resolveBuiltInMemoryRuntime } from "../engine/memory-runtime.js";
import type { MemoryRuntime } from "../engine/types.js";
import type { CompleteFn } from "../extraction/llm.js";
import type { LlmConfig } from "../types/config.js";

/**
 * Bootstrap entry for the host memory subsystem.
 *
 * CrawClaw now resolves memory through the built-in memory runtime only.
 * When the primary runtime is unavailable, it falls back to a minimal
 * built-in runtime configuration instead of reviving any removed legacy
 * plugin-selected memory path.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function withMinimalBuiltInMemoryConfig(config?: CrawClawConfig): CrawClawConfig {
  const notebooklm = asRecord(config?.memory?.notebooklm);
  const notebooklmCli = asRecord(notebooklm.cli);
  const notebooklmWrite = asRecord(notebooklm.write);
  const durableExtraction = asRecord(config?.memory?.durableExtraction);
  const dreaming = asRecord(config?.memory?.dreaming);
  const sessionSummary = asRecord(config?.memory?.sessionSummary);
  return {
    ...config,
    memory: {
      ...config?.memory,
      notebooklm: {
        ...notebooklm,
        enabled: false,
        cli: {
          ...notebooklmCli,
          enabled: false,
        },
        write: {
          ...notebooklmWrite,
          enabled: false,
        },
      },
      durableExtraction: {
        ...durableExtraction,
        enabled: false,
      },
      dreaming: {
        ...dreaming,
        enabled: false,
      },
      sessionSummary: {
        ...sessionSummary,
        enabled: false,
      },
      contextArchive: {
        ...config?.memory?.contextArchive,
        mode: "off",
      },
    },
  };
}

export async function resolveMemoryRuntime(
  config?: CrawClawConfig,
  overrides?: { llm?: LlmConfig; complete?: CompleteFn },
): Promise<MemoryRuntime> {
  const builtIn = await resolveBuiltInMemoryRuntime(config, overrides);
  if (builtIn) {
    return builtIn;
  }
  const minimalBuiltIn = await resolveBuiltInMemoryRuntime(
    withMinimalBuiltInMemoryConfig(config),
    overrides,
  );
  if (minimalBuiltIn) {
    return minimalBuiltIn;
  }
  throw new Error("Failed to resolve built-in memory runtime.");
}
