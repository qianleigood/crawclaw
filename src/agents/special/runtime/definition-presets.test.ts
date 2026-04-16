import { describe, expect, it } from "vitest";
import {
  createEmbeddedMemorySpecialAgentDefinition,
  createRuntimeDenyToolPolicy,
  createShortParentSessionCachePolicy,
} from "./definition-presets.js";

describe("special agent definition presets", () => {
  it("creates runtime-deny tool policies from allowlists", () => {
    expect(createRuntimeDenyToolPolicy(["read", "exec"])).toEqual({
      allowlist: ["read", "exec"],
      enforcement: "runtime_deny",
    });
  });

  it("creates the shared short parent-session cache policy", () => {
    expect(createShortParentSessionCachePolicy()).toEqual({
      cacheRetention: "short",
      skipWrite: true,
      promptCache: {
        scope: "parent_session",
        retention: "24h",
      },
    });
  });

  it("creates embedded memory definitions with shared substrate defaults", () => {
    expect(
      createEmbeddedMemorySpecialAgentDefinition({
        id: "memory_extractor",
        label: "memory-extraction",
        spawnSource: "memory-extraction",
        allowlist: ["memory_note_read", "memory_note_write"],
        defaultRunTimeoutSeconds: 90,
        defaultMaxTurns: 5,
      }),
    ).toEqual({
      id: "memory_extractor",
      label: "memory-extraction",
      spawnSource: "memory-extraction",
      executionMode: "embedded_fork",
      transcriptPolicy: "isolated",
      toolPolicy: {
        allowlist: ["memory_note_read", "memory_note_write"],
        enforcement: "runtime_deny",
      },
      cachePolicy: {
        cacheRetention: "short",
        skipWrite: true,
        promptCache: {
          scope: "parent_session",
          retention: "24h",
        },
      },
      mode: "run",
      cleanup: "keep",
      sandbox: "inherit",
      expectsCompletionMessage: false,
      defaultRunTimeoutSeconds: 90,
      defaultMaxTurns: 5,
    });
  });
});
