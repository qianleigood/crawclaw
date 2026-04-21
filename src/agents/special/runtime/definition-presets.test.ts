import { describe, expect, it } from "vitest";
import {
  createEmbeddedMemorySpecialAgentDefinition,
  createRuntimeDenyToolPolicy,
  createShortMemoryCachePolicy,
} from "./definition-presets.js";

describe("special agent definition presets", () => {
  it("creates runtime-deny tool policies from allowlists", () => {
    expect(createRuntimeDenyToolPolicy(["read", "exec"])).toEqual({
      allowlist: ["read", "exec"],
      enforcement: "runtime_deny",
    });
  });

  it("creates the shared short memory cache policy", () => {
    expect(createShortMemoryCachePolicy()).toEqual({
      cacheRetention: "short",
      skipWrite: true,
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
