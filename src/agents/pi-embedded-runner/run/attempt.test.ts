import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../../../config/config.js";
import { buildAfterTurnRuntimeContext, decodeHtmlEntitiesInObject } from "./attempt.js";

describe("decodeHtmlEntitiesInObject", () => {
  it("decodes HTML entities in string values", () => {
    const result = decodeHtmlEntitiesInObject(
      "source .env &amp;&amp; psql &quot;$DB&quot; -c &lt;query&gt;",
    );
    expect(result).toBe('source .env && psql "$DB" -c <query>');
  });

  it("recursively decodes nested objects", () => {
    const input = {
      command: "cd ~/dev &amp;&amp; npm run build",
      args: ["--flag=&quot;value&quot;", "&lt;input&gt;"],
      nested: { deep: "a &amp; b" },
    };
    const result = decodeHtmlEntitiesInObject(input) as Record<string, unknown>;
    expect(result.command).toBe("cd ~/dev && npm run build");
    expect((result.args as string[])[0]).toBe('--flag="value"');
    expect((result.args as string[])[1]).toBe("<input>");
    expect((result.nested as Record<string, string>).deep).toBe("a & b");
  });

  it("passes through non-string primitives unchanged", () => {
    expect(decodeHtmlEntitiesInObject(42)).toBe(42);
    expect(decodeHtmlEntitiesInObject(null)).toBe(null);
    expect(decodeHtmlEntitiesInObject(true)).toBe(true);
    expect(decodeHtmlEntitiesInObject(undefined)).toBe(undefined);
  });

  it("returns strings without entities unchanged", () => {
    const input = "plain string with no entities";
    expect(decodeHtmlEntitiesInObject(input)).toBe(input);
  });

  it("decodes numeric character references", () => {
    expect(decodeHtmlEntitiesInObject("&#39;hello&#39;")).toBe("'hello'");
    expect(decodeHtmlEntitiesInObject("&#x27;world&#x27;")).toBe("'world'");
  });
});
describe("buildAfterTurnRuntimeContext", () => {
  it("uses primary model when compaction.model is not set", () => {
    const legacy = buildAfterTurnRuntimeContext({
      attempt: {
        sessionKey: "agent:main:session:abc",
        messageChannel: "ddingtalk",
        messageProvider: "ddingtalk",
        agentAccountId: "acct-1",
        authProfileId: "openai:p1",
        config: {} as CrawClawConfig,
        senderIsOwner: true,
        provider: "openai-codex",
        modelId: "gpt-5.4",
        thinkLevel: "off",
        reasoningLevel: "on",
        extraSystemPrompt: "extra",
        ownerNumbers: ["+15555550123"],
      },
      workspaceDir: "/tmp/workspace",
      agentDir: "/tmp/agent",
    });

    expect(legacy).toMatchObject({
      provider: "openai-codex",
      model: "gpt-5.4",
    });
  });

  it("resolves compaction.model override in runtime context so all memory runtimes use the correct model", () => {
    const legacy = buildAfterTurnRuntimeContext({
      attempt: {
        sessionKey: "agent:main:session:abc",
        messageChannel: "ddingtalk",
        messageProvider: "ddingtalk",
        agentAccountId: "acct-1",
        authProfileId: "openai:p1",
        config: {
          agents: {
            defaults: {
              compaction: {
                model: "openrouter/anthropic/claude-sonnet-4-5",
              },
            },
          },
        } as CrawClawConfig,
        senderIsOwner: true,
        provider: "openai-codex",
        modelId: "gpt-5.4",
        thinkLevel: "off",
        reasoningLevel: "on",
        extraSystemPrompt: "extra",
        ownerNumbers: ["+15555550123"],
      },
      workspaceDir: "/tmp/workspace",
      agentDir: "/tmp/agent",
    });

    // buildEmbeddedCompactionRuntimeContext now resolves the override eagerly
    // so that memory runtimes, including adapted third-party engines, receive
    // the correct compaction model in the runtime context.
    expect(legacy).toMatchObject({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4-5",
      // Auth profile dropped because provider changed from openai-codex to openrouter
      authProfileId: undefined,
    });
  });
  it("includes resolved auth profile fields for memory-runtime afterTurn compaction", () => {
    const legacy = buildAfterTurnRuntimeContext({
      attempt: {
        sessionKey: "agent:main:session:abc",
        messageChannel: "ddingtalk",
        messageProvider: "ddingtalk",
        agentAccountId: "acct-1",
        authProfileId: "openai:p1",
        config: {} as CrawClawConfig,
        senderIsOwner: true,
        provider: "openai-codex",
        modelId: "gpt-5.4",
        thinkLevel: "off",
        reasoningLevel: "on",
        extraSystemPrompt: "extra",
        ownerNumbers: ["+15555550123"],
      },
      workspaceDir: "/tmp/workspace",
      agentDir: "/tmp/agent",
    });

    expect(legacy).toMatchObject({
      authProfileId: "openai:p1",
      provider: "openai-codex",
      model: "gpt-5.4",
      workspaceDir: "/tmp/workspace",
      agentDir: "/tmp/agent",
    });
  });

  it("preserves sender and channel routing context for scoped compaction discovery", () => {
    const legacy = buildAfterTurnRuntimeContext({
      attempt: {
        sessionKey: "agent:main:session:abc",
        messageChannel: "ddingtalk",
        messageProvider: "ddingtalk",
        agentAccountId: "acct-1",
        currentChannelId: "C123",
        currentThreadTs: "thread-9",
        currentMessageId: "msg-42",
        authProfileId: "openai:p1",
        config: {} as CrawClawConfig,
        senderIsOwner: true,
        senderId: "user-123",
        provider: "openai-codex",
        modelId: "gpt-5.4",
        thinkLevel: "off",
        reasoningLevel: "on",
        extraSystemPrompt: "extra",
        ownerNumbers: ["+15555550123"],
      },
      workspaceDir: "/tmp/workspace",
      agentDir: "/tmp/agent",
    });

    expect(legacy).toMatchObject({
      senderId: "user-123",
      currentChannelId: "C123",
      currentThreadTs: "thread-9",
      currentMessageId: "msg-42",
    });
  });

  it("preserves special memory agent routing context", () => {
    const legacy = buildAfterTurnRuntimeContext({
      attempt: {
        sessionKey: "agent:main:session:abc",
        config: {} as CrawClawConfig,
        provider: "openai-codex",
        modelId: "gpt-5.4",
        specialAgentSpawnSource: "session-summary",
        specialSessionSummaryTarget: {
          agentId: "main",
          sessionId: "session-abc",
        },
      },
      workspaceDir: "/tmp/workspace",
      agentDir: "/tmp/agent",
    });

    expect(legacy).toMatchObject({
      specialAgentSpawnSource: "session-summary",
      specialSessionSummaryTarget: {
        agentId: "main",
        sessionId: "session-abc",
      },
    });
  });
});
