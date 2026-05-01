import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSpecialAgentCacheEnvelope } from "../../agents/special/runtime/parent-fork-context.js";
import { resolveDurableMemoryScope } from "../durable/scope.js";
import {
  __testing,
  EXPERIENCE_AGENT_DEFINITION,
  buildExperienceExtractionSystemPrompt,
  buildExperienceExtractionTaskPrompt,
  parseExperienceExtractionResult,
  runExperienceExtractionAgentOnce,
} from "./agent-runner.js";

describe("experience extraction agent", () => {
  const previousStateRoot = process.env.CRAWCLAW_STATE_DIR;

  afterEach(() => {
    __testing.setDepsForTest();
    if (previousStateRoot === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = previousStateRoot;
    }
  });

  it("uses only the experience write tool", () => {
    expect(EXPERIENCE_AGENT_DEFINITION.executionMode).toBe("embedded_fork");
    expect(EXPERIENCE_AGENT_DEFINITION.toolPolicy).toMatchObject({
      allowlist: ["write_experience_note"],
      enforcement: "runtime_deny",
      modelVisibility: "allowlist",
    });
  });

  it("instructs the background agent to extract reusable experience only", () => {
    const prompt = buildExperienceExtractionSystemPrompt();

    expect(prompt).toContain("## Types of experience memory");
    expect(prompt).toContain("## What NOT to save");
    expect(prompt).toContain("## How to maintain experience memory");
    expect(prompt).toContain(
      "Prefer updating an existing experience note over creating a duplicate",
    );
    expect(prompt).toContain("Do NOT write durable memory");
    expect(prompt).toContain("Do NOT store user preferences");
    expect(prompt).toContain("write_experience_note");
    expect(prompt).toContain("- decision: a decision with its reason");
    expect(prompt).not.toContain("decision_record");
    expect(prompt).toContain("operation=archive");
    expect(prompt).toContain("operation=supersede");
    expect(prompt).toContain("Return STATUS: NO_CHANGE");
    expect(prompt).toContain("STATUS: WRITTEN | SKIPPED | NO_CHANGE | FAILED");
    expect(prompt).toContain("TOUCHED_NOTES");
  });

  it("builds a task prompt from recent messages, summaries, and existing experience entries", () => {
    const prompt = buildExperienceExtractionTaskPrompt({
      scopeKey: "main:feishu:user-1",
      recentMessages: [
        { role: "user", content: "这次发布失败是因为先改了 service 再改 secret。", timestamp: 1 },
        { role: "user", content: "已验证：以后先更新 secret，再滚动 service。", timestamp: 2 },
      ],
      sessionSummary: "本轮验证了 gateway 发布顺序。",
      existingEntries: [
        {
          id: "experience-index:gateway-deploy",
          title: "网关发布顺序",
          summary: "发布 gateway 时先处理 secret。",
          content: "## 经验结论\n先 secret 后 service。",
          type: "failure_pattern",
          layer: "runtime_signals",
          memoryKind: "runtime_pattern",
          noteId: "note-1",
          notebookId: "nb-1",
          dedupeKey: "gateway-deploy",
          aliases: [],
          tags: [],
          status: "active",
          supersededBy: null,
          archivedAt: null,
          updatedAt: 1,
        },
      ],
      maxNotes: 2,
    });

    expect(prompt).toContain("Scope: main:feishu:user-1");
    expect(prompt).toContain("Session summary:");
    expect(prompt).toContain("gateway 发布顺序");
    expect(prompt).toContain("Existing experience index:");
    expect(prompt).toContain("status=active");
    expect(prompt).toContain("dedupeKey=gateway-deploy");
  });

  it("adds foreground experience writes as item-level constraints, not a window skip", () => {
    const prompt = buildExperienceExtractionTaskPrompt({
      scopeKey: "main:feishu:user-1",
      recentMessages: [
        { role: "user", content: "A 已经写入，但后面又验证出 B。", timestamp: 1 },
        { role: "user", content: "B 是独立的可复用经验。", timestamp: 2 },
      ],
      sessionSummary: null,
      foregroundExperienceWrites: [
        {
          cursor: 4,
          action: "upsert",
          toolCallId: "toolcall-a",
          noteId: "note-a",
          dedupeKey: "experience-a",
          title: "经验 A",
          summary: "A 已由主 Agent 主动写入。",
          type: "workflow_pattern",
        },
      ],
      existingEntries: [],
      maxNotes: 2,
    });

    expect(prompt).toContain(
      "Foreground experience writes already made in this unprocessed session window:",
    );
    expect(prompt).toContain("cursor=4");
    expect(prompt).toContain("dedupeKey=experience-a");
    expect(prompt).toContain("Treat these as already covered experience items");
    expect(prompt).toContain("not as proof the whole window is processed");
    expect(prompt).toContain("Do not count already written foreground items");
    expect(prompt).toContain("Continue extracting other independent validated experience");
    expect(prompt).toContain("archive or supersede it");
  });

  it("parses the fixed final report shape", () => {
    expect(
      parseExperienceExtractionResult(
        [
          "STATUS: WRITTEN",
          "SUMMARY: 提炼了一个发布失败经验",
          "WRITTEN_COUNT: 1",
          "UPDATED_COUNT: 2",
          "DELETED_COUNT: 0",
          "TOUCHED_NOTES: gateway-deploy | release-order",
        ].join("\n"),
      ),
    ).toEqual({
      status: "written",
      summary: "提炼了一个发布失败经验",
      writtenCount: 1,
      updatedCount: 2,
      deletedCount: 0,
      touchedNotes: ["gateway-deploy", "release-order"],
    });
  });

  it("runs with only the experience write tool visible and no parent prompt envelope", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-experience-agent-"));
    process.env.CRAWCLAW_STATE_DIR = dir;
    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
      rootDir: path.join(dir, "durable-memory"),
    });
    expect(scope).not.toBeNull();
    const runEmbeddedPiAgent = vi.fn().mockResolvedValue({
      payloads: [
        {
          text: [
            "STATUS: NO_CHANGE",
            "SUMMARY: no reusable experience",
            "WRITTEN_COUNT: 0",
            "UPDATED_COUNT: 0",
            "DELETED_COUNT: 0",
            "TOUCHED_NOTES:",
          ].join("\n"),
        },
      ],
      meta: { durationMs: 1, agentMeta: { usage: { input: 1, output: 1, total: 2 } } },
    });
    __testing.setDepsForTest({
      runEmbeddedPiAgent,
    });

    const parentForkContext = {
      parentRunId: "parent-run-experience-1",
      provider: "openai",
      modelId: "gpt-5.4",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "parent system prompt",
        toolNames: ["read"],
        toolPromptPayload: [{ name: "read" }],
        thinkingConfig: {},
        forkContextMessages: [{ role: "user", content: "older parent context" }],
      }),
    };

    const result = await runExperienceExtractionAgentOnce({
      runId: "experience-run-1",
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:user-1",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: dir,
      scope: scope!,
      parentForkContext,
      messageCursor: 1,
      recentMessages: [
        { role: "user", content: "已验证：先更新 secret，再滚动 service。", timestamp: 1 },
      ],
      recentMessageLimit: 24,
      maxNotes: 2,
    });

    expect(result).toMatchObject({
      status: "no_change",
      advanceCursor: true,
    });
    expect(runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        specialAgentSpawnSource: "experience",
        provider: "openai",
        model: "gpt-5.4",
        toolsAllow: ["write_experience_note"],
      }),
    );
    const embeddedParams = runEmbeddedPiAgent.mock.calls[0]?.[0] as
      | { specialParentPromptEnvelope?: unknown }
      | undefined;
    expect(embeddedParams?.specialParentPromptEnvelope).toBeUndefined();
  });
});
