import { describe, expect, it } from "vitest";
import {
  buildSpecialAgentCacheEnvelope,
  buildSpecialAgentParentForkContextFromModelInput,
} from "./parent-fork-context.js";

describe("special-agent cache envelope helpers", () => {
  it("builds a stable cache envelope without persisting a run snapshot", () => {
    const envelope = buildSpecialAgentCacheEnvelope({
      systemPromptText: "system prompt",
      toolNames: ["read", "exec", "read"],
      toolPromptPayload: [{ name: "read" }, { name: "exec" }],
      thinkingConfig: {
        thinkLevel: "medium",
      },
      forkContextMessages: [{ role: "user", content: "from parent" }],
    });

    expect(envelope).toMatchObject({
      systemPromptText: "system prompt",
      toolInventoryDigest: {
        toolCount: 2,
        toolNames: ["exec", "read"],
      },
      thinkingConfig: {
        thinkLevel: "medium",
      },
      forkContextMessages: [{ role: "user", content: "from parent" }],
      cacheIdentity: {
        queryContextHash: expect.any(String),
        forkContextMessagesHash: expect.any(String),
        envelopeHash: expect.any(String),
      },
    });
  });

  it("builds the lifecycle parent fork context from model input", () => {
    const context = buildSpecialAgentParentForkContextFromModelInput({
      parentRunId: "parent-run-1",
      provider: "openai",
      modelId: "gpt-5.4",
      modelApi: "openai-responses",
      modelInput: {
        systemPrompt: "system prompt",
        queryContextHash: "query-context-hash",
        thinkingConfig: { thinkLevel: "low" },
        toolContext: {
          tools: [],
          toolNames: ["read"],
          toolPromptPayload: [{ name: "read" }],
        },
      },
      forkContextMessages: [{ role: "assistant", content: "done" }],
    });

    expect(context).toMatchObject({
      parentRunId: "parent-run-1",
      provider: "openai",
      modelId: "gpt-5.4",
      modelApi: "openai-responses",
      promptEnvelope: {
        systemPromptText: "system prompt",
        queryContextHash: "query-context-hash",
        toolPromptPayload: [{ name: "read" }],
        thinkingConfig: { thinkLevel: "low" },
        forkContextMessages: [{ role: "assistant", content: "done" }],
      },
    });
  });
});
