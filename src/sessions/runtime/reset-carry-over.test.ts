import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";
import { pickResetCarryOverFields } from "./reset-carry-over.js";

describe("pickResetCarryOverFields", () => {
  const entry = {
    sessionId: "session-1",
    updatedAt: 1_700_000_000_000,
    thinkingLevel: "high",
    fastMode: true,
    verboseLevel: "full",
    reasoningLevel: "medium",
    elevatedLevel: "auto",
    ttsAuto: "always",
    execHost: "remote",
    responseUsage: "full",
    providerOverride: "openai",
    modelOverride: "gpt-5.4",
    authProfileOverride: "owner",
    authProfileOverrideSource: "user",
    authProfileOverrideCompactionCount: 3,
    queueMode: "collect",
    queueDebounceMs: 250,
    queueCap: 8,
    queueDrop: "summarize",
    cliSessionIds: { claude: "cli-session" },
    cliSessionBindings: {
      claude: {
        sessionId: "cli-session",
        authProfileId: "anthropic:default",
      },
    },
    claudeCliSessionId: "cli-session",
    label: "Pinned",
    displayName: "Pinned Display",
    spawnedBy: "agent:main:main",
    spawnedWorkspaceDir: "/tmp/workspace",
    parentSessionKey: "agent:main:main",
    forkedFromParent: true,
    spawnDepth: 2,
    subagentRole: "orchestrator",
    subagentControlScope: "children",
    channel: "telegram",
    lastChannel: "telegram",
    lastTo: "telegram:user",
    lastAccountId: "acc-1",
    lastThreadId: "topic-1",
    origin: { provider: "telegram", from: "telegram:user" },
    acp: {
      backend: "local",
      agent: "main",
      runtimeSessionName: "acp-session",
      mode: "persistent",
      state: "idle",
      lastActivityAt: 1_700_000_000_000,
    },
  } as SessionEntry;

  it("keeps only the command reset carry-over fields for /new-style resets", () => {
    const carryOver = pickResetCarryOverFields(entry, "command-reset");

    expect(carryOver).toMatchObject({
      thinkingLevel: "high",
      verboseLevel: "full",
      reasoningLevel: "medium",
      ttsAuto: "always",
      providerOverride: "openai",
      modelOverride: "gpt-5.4",
      authProfileOverride: "owner",
      authProfileOverrideSource: "user",
      authProfileOverrideCompactionCount: 3,
      cliSessionIds: { claude: "cli-session" },
      cliSessionBindings: {
        claude: {
          sessionId: "cli-session",
          authProfileId: "anthropic:default",
        },
      },
      claudeCliSessionId: "cli-session",
      label: "Pinned",
      displayName: "Pinned Display",
      spawnedBy: "agent:main:main",
      spawnedWorkspaceDir: "/tmp/workspace",
      parentSessionKey: "agent:main:main",
      forkedFromParent: true,
      spawnDepth: 2,
      subagentRole: "orchestrator",
      subagentControlScope: "children",
    });
    expect(carryOver.fastMode).toBeUndefined();
    expect(carryOver.queueMode).toBeUndefined();
    expect(carryOver.channel).toBeUndefined();
    expect(carryOver.acp).toBeUndefined();
  });

  it("keeps the broader gateway reset carry-over fields for sessions.reset", () => {
    const carryOver = pickResetCarryOverFields(entry, "gateway-reset");

    expect(carryOver).toMatchObject({
      thinkingLevel: "high",
      fastMode: true,
      verboseLevel: "full",
      reasoningLevel: "medium",
      elevatedLevel: "auto",
      ttsAuto: "always",
      execHost: "remote",
      responseUsage: "full",
      providerOverride: "openai",
      modelOverride: "gpt-5.4",
      authProfileOverride: "owner",
      queueMode: "collect",
      queueDebounceMs: 250,
      queueCap: 8,
      queueDrop: "summarize",
      spawnedBy: "agent:main:main",
      label: "Pinned",
      displayName: "Pinned Display",
      channel: "telegram",
      lastChannel: "telegram",
      lastTo: "telegram:user",
      lastAccountId: "acc-1",
      lastThreadId: "topic-1",
      origin: { provider: "telegram", from: "telegram:user" },
      acp: expect.objectContaining({ backend: "local" }),
    });
  });

  it("returns an empty patch when there is no entry to carry over", () => {
    expect(pickResetCarryOverFields(undefined, "command-reset")).toEqual({});
    expect(pickResetCarryOverFields(undefined, "gateway-reset")).toEqual({});
  });
});
