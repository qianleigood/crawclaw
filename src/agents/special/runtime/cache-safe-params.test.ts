import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readSpecialAgentCacheSafeParamsSnapshot,
  resolveSpecialAgentCacheSafeParamsPath,
  writeSpecialAgentCacheSafeParamsSnapshot,
} from "./cache-safe-params.js";

describe("special-agent cacheSafeParams snapshot store", () => {
  const tempDirs: string[] = [];
  const previousStateDir = process.env.CRAWCLAW_STATE_DIR;
  const previousTtlMs = process.env.CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_TTL_MS;
  const previousMaxFiles = process.env.CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_MAX_FILES;

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    if (previousStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = previousStateDir;
    }
    if (previousTtlMs === undefined) {
      delete process.env.CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_TTL_MS;
    } else {
      process.env.CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_TTL_MS = previousTtlMs;
    }
    if (previousMaxFiles === undefined) {
      delete process.env.CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_MAX_FILES;
    } else {
      process.env.CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_MAX_FILES = previousMaxFiles;
    }
  });

  it("stores snapshots under the special-agent runtime state directory", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-special-cache-safe-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    expect(resolveSpecialAgentCacheSafeParamsPath("run-123")).toBe(
      path.join(stateDir, "agents", "special", "cache-safe-params", "run-123.json"),
    );
  });

  it("round-trips a cacheSafeParams snapshot", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-special-cache-safe-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    await writeSpecialAgentCacheSafeParamsSnapshot({
      runId: "run-cache-1",
      sessionId: "session-1",
      sessionKey: "agent:main:main",
      agentId: "main",
      provider: "openai",
      modelId: "gpt-5.4",
      modelApi: "openai-responses",
      systemPromptText: "system prompt",
      queryContextHash: "query-context-hash-1",
      prompt: "user prompt",
      toolNames: ["read", "exec", "read"],
      userContext: {
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        workspaceDir: "/workspace",
      },
      systemContext: {
        runtimeInfo: {
          host: "localhost",
          shell: "zsh",
        },
        promptMode: "full",
        effectivePromptMode: "full",
      },
      toolPromptPayload: [
        {
          name: "read",
          description: "Read files",
          parameters: {
            type: "object",
          },
        },
      ],
      thinkingConfig: {
        thinkLevel: "medium",
        fastMode: false,
      },
      forkContextMessages: [
        {
          type: "assistant",
          uuid: "message-1",
          message: {
            role: "assistant",
            content: [],
          },
        } as never,
      ],
      transcriptLeafId: "leaf-1",
      messageCount: 12,
      streamParams: {
        cacheRetention: "short",
        promptCacheKey: "parent:agent:main:main",
        promptCacheRetention: "24h",
      },
      capturedAt: 123,
    });

    await expect(readSpecialAgentCacheSafeParamsSnapshot("run-cache-1")).resolves.toMatchObject({
      version: 5,
      runId: "run-cache-1",
      sessionId: "session-1",
      sessionKey: "agent:main:main",
      agentId: "main",
      provider: "openai",
      modelId: "gpt-5.4",
      modelApi: "openai-responses",
      systemPromptText: "system prompt",
      queryContextHash: "query-context-hash-1",
      promptLength: "user prompt".length,
      toolNames: ["exec", "read"],
      userContext: {
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        workspaceDir: "/workspace",
      },
      systemContext: {
        promptMode: "full",
        effectivePromptMode: "full",
        runtimeInfo: {
          host: "localhost",
          shell: "zsh",
        },
      },
      toolPromptPayload: [
        {
          description: "Read files",
          name: "read",
          parameters: {
            type: "object",
          },
        },
      ],
      toolInventoryDigest: {
        toolCount: 2,
        toolNames: ["exec", "read"],
        toolNamesHash: expect.any(String),
        toolPayloadHash: expect.any(String),
      },
      cacheIdentity: {
        queryContextHash: "query-context-hash-1",
        forkContextMessagesHash: expect.any(String),
        envelopeHash: expect.any(String),
      },
      thinkingConfig: {
        fastMode: false,
        thinkLevel: "medium",
      },
      forkContextMessages: [
        {
          type: "assistant",
          uuid: "message-1",
          message: {
            role: "assistant",
            content: [],
          },
        },
      ],
      transcriptLeafId: "leaf-1",
      messageCount: 12,
      streamParams: {
        cacheRetention: "short",
        promptCacheKey: "parent:agent:main:main",
        promptCacheRetention: "24h",
      },
      capturedAt: 123,
    });
  });

  it("reads legacy v1 snapshots with defaulted cache envelope fields", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-special-cache-safe-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    const snapshotPath = resolveSpecialAgentCacheSafeParamsPath("run-legacy-1");
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(
        {
          version: 1,
          runId: "run-legacy-1",
          sessionId: "session-legacy",
          provider: "anthropic",
          modelId: "claude-3",
          capturedAt: 456,
          systemPromptText: "system prompt",
          systemPromptHash: "hash-1",
          promptHash: "hash-2",
          promptLength: 11,
          toolNames: ["read"],
          messageCount: 4,
          streamParams: {
            cacheRetention: "long",
            promptCacheKey: "legacy:cache",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(readSpecialAgentCacheSafeParamsSnapshot("run-legacy-1")).resolves.toMatchObject({
      version: 5,
      runId: "run-legacy-1",
      sessionId: "session-legacy",
      provider: "anthropic",
      modelId: "claude-3",
      capturedAt: 456,
      systemPromptText: "system prompt",
      systemPromptHash: "hash-1",
      queryContextHash: expect.any(String),
      promptHash: "hash-2",
      promptLength: 11,
      toolNames: ["read"],
      userContext: {},
      systemContext: {},
      toolPromptPayload: [],
      toolInventoryDigest: {
        toolCount: 1,
        toolNames: ["read"],
      },
      cacheIdentity: {
        queryContextHash: expect.any(String),
        forkContextMessagesHash: expect.any(String),
        envelopeHash: expect.any(String),
      },
      thinkingConfig: {},
      forkContextMessages: [],
      messageCount: 4,
      streamParams: {
        cacheRetention: "long",
        promptCacheKey: "legacy:cache",
      },
    });
  });

  it("prunes stale snapshots by TTL while keeping the current run snapshot", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-special-cache-safe-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    process.env.CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_TTL_MS = "1";

    const stalePath = resolveSpecialAgentCacheSafeParamsPath("run-stale-1");
    await fs.mkdir(path.dirname(stalePath), { recursive: true });
    await fs.writeFile(
      stalePath,
      JSON.stringify({
        version: 5,
        runId: "run-stale-1",
        sessionId: "session-stale",
        provider: "openai",
        modelId: "gpt-5.4",
        capturedAt: 10,
        systemPromptText: "stale prompt",
        systemPromptHash: "hash-a",
        queryContextHash: "hash-q",
        promptHash: "hash-p",
        promptLength: 5,
        toolNames: [],
        userContext: {},
        systemContext: {},
        toolPromptPayload: [],
        toolInventoryDigest: {
          toolCount: 0,
          toolNames: [],
          toolNamesHash: "hash-tool",
          toolPayloadHash: "hash-payload",
        },
        thinkingConfig: {},
        forkContextMessages: [],
        cacheIdentity: {
          queryContextHash: "hash-q",
          forkContextMessagesHash: "hash-fork",
          envelopeHash: "hash-envelope",
        },
        messageCount: 0,
        streamParams: {},
      }),
      "utf8",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    await writeSpecialAgentCacheSafeParamsSnapshot({
      runId: "run-fresh-1",
      sessionId: "session-fresh",
      provider: "openai",
      modelId: "gpt-5.4",
      systemPromptText: "fresh prompt",
      prompt: "fresh user prompt",
      capturedAt: 999,
    });

    await expect(fs.stat(stalePath)).rejects.toThrow();
    await expect(readSpecialAgentCacheSafeParamsSnapshot("run-fresh-1")).resolves.toMatchObject({
      runId: "run-fresh-1",
      sessionId: "session-fresh",
    });
  });

  it("prunes oldest snapshots when exceeding max file count", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-special-cache-safe-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    process.env.CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_TTL_MS = "99999999";
    process.env.CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_MAX_FILES = "20";

    for (let index = 0; index < 25; index += 1) {
      await writeSpecialAgentCacheSafeParamsSnapshot({
        runId: `run-max-${index}`,
        sessionId: `session-${index}`,
        provider: "openai",
        modelId: "gpt-5.4",
        systemPromptText: `prompt-${index}`,
        prompt: `user-${index}`,
        capturedAt: index,
      });
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    const storeDir = path.dirname(resolveSpecialAgentCacheSafeParamsPath("run-max-24"));
    const files = await fs.readdir(storeDir);
    const jsonFiles = files.filter((entry) => entry.endsWith(".json"));
    expect(jsonFiles.length).toBe(20);
    expect(jsonFiles).toContain("run-max-24.json");
    expect(jsonFiles).not.toContain("run-max-0.json");
  });
});
