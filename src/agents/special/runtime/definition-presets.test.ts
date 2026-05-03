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
        id: "durable_memory",
        label: "durable-memory",
        spawnSource: "durable-memory",
        allowlist: ["memory_note_read", "memory_note_write"],
        parentContextPolicy: "fork_messages_only",
        defaultRunTimeoutSeconds: 90,
        defaultMaxTurns: 5,
      }),
    ).toEqual({
      id: "durable_memory",
      label: "durable-memory",
      spawnSource: "durable-memory",
      executionMode: "embedded_fork",
      isolatedContext: true,
      transcriptPolicy: "isolated",
      parentContextPolicy: "fork_messages_only",
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

  it("allows embedded memory definitions to rely on timeout without a turn cap", () => {
    const definition = createEmbeddedMemorySpecialAgentDefinition({
      id: "dream",
      label: "dream",
      spawnSource: "dream",
      allowlist: ["memory_note_read"],
      parentContextPolicy: "none",
      defaultRunTimeoutSeconds: 120,
    });

    expect(definition.defaultRunTimeoutSeconds).toBe(120);
    expect(definition).not.toHaveProperty("defaultMaxTurns");
    expect(definition.isolatedContext).toBe(true);
  });
});
