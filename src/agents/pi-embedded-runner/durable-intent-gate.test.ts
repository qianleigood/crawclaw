import { describe, expect, it } from "vitest";
import {
  detectExplicitDurableIntent,
  maybeRunExplicitDurableIntentGate,
} from "./durable-intent-gate.js";

describe("explicit durable intent gate", () => {
  it("detects explicit remember and forget cues", () => {
    expect(detectExplicitDurableIntent("记住这个：以后回答操作类问题先给步骤。")).toBe("remember");
    expect(detectExplicitDurableIntent("以后回答操作类问题时，先给步骤，再补充解释。")).toBe(
      "remember",
    );
    expect(detectExplicitDurableIntent("忘掉这个偏好，不要再记了。")).toBe("forget");
    expect(detectExplicitDurableIntent("帮我解释一下这个实现。")).toBeNull();
  });

  it("skips gating when durable write tools are unavailable", async () => {
    const result = await maybeRunExplicitDurableIntentGate({
      prompt: "记住这个：以后回答操作类问题先给步骤。",
      toolsAllow: ["read"],
    });

    expect(result).toMatchObject({
      applied: false,
      intent: "remember",
      notesSaved: 0,
      reason: "explicit_durable_gate_missing_write_tool",
    });
  });

  it("skips gating inside special-agent runs", async () => {
    const result = await maybeRunExplicitDurableIntentGate({
      prompt: "记住这个：以后回答操作类问题先给步骤。",
      toolsAllow: ["memory_manifest_read", "memory_note_write"],
      specialAgentSpawnSource: "memory-extraction",
    });

    expect(result).toMatchObject({
      applied: false,
      intent: "remember",
      notesSaved: 0,
      reason: "explicit_durable_gate_skipped_special_agent",
    });
    expect(result.forcedToolName).toBeUndefined();
    expect(result.toolChoice).toBeUndefined();
  });

  it("forces a main-agent durable tool call for explicit remember cues", async () => {
    const result = await maybeRunExplicitDurableIntentGate({
      prompt: "记住这个：以后回答操作类问题先给步骤。",
      trigger: "user",
      toolsAllow: ["memory_manifest_read", "read"],
      modelApi: "anthropic-messages",
    });

    expect(result).toMatchObject({
      applied: false,
      intent: "remember",
      notesSaved: 0,
      reason: "explicit_durable_gate_force_tool_call",
      forcedToolName: "memory_manifest_read",
      toolChoice: { type: "tool", name: "memory_manifest_read" },
    });
    expect(result.systemPromptInstruction).toContain(
      "must start the durable-memory workflow with the memory_manifest_read tool",
    );
  });

  it("forces a delete tool call for explicit forget cues", async () => {
    const result = await maybeRunExplicitDurableIntentGate({
      prompt: "忘掉这个偏好，不要再记了。",
      trigger: "user",
      toolsAllow: ["memory_manifest_read", "memory_note_delete", "read"],
      modelApi: "anthropic-messages",
    });

    expect(result).toMatchObject({
      applied: false,
      intent: "forget",
      notesSaved: 0,
      reason: "explicit_durable_gate_force_tool_call",
      forcedToolName: "memory_manifest_read",
      toolChoice: { type: "tool", name: "memory_manifest_read" },
    });
    expect(result.systemPromptInstruction).toContain(
      "must start the durable-memory workflow with the memory_manifest_read tool",
    );
  });
});
