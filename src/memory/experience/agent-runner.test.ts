import { describe, expect, it } from "vitest";
import {
  EXPERIENCE_AGENT_DEFINITION,
  buildExperienceExtractionSystemPrompt,
  buildExperienceExtractionTaskPrompt,
  parseExperienceExtractionResult,
} from "./agent-runner.js";

describe("experience extraction agent", () => {
  it("uses only the experience write tool", () => {
    expect(EXPERIENCE_AGENT_DEFINITION.toolPolicy?.allowlist).toEqual(["write_experience_note"]);
  });

  it("instructs the background agent to extract reusable experience only", () => {
    const prompt = buildExperienceExtractionSystemPrompt();

    expect(prompt).toContain("Do NOT write durable memory");
    expect(prompt).toContain("Do NOT store user preferences");
    expect(prompt).toContain("write_experience_note");
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
          updatedAt: 1,
        },
      ],
      maxNotes: 2,
    });

    expect(prompt).toContain("Scope: main:feishu:user-1");
    expect(prompt).toContain("Session summary:");
    expect(prompt).toContain("gateway 发布顺序");
    expect(prompt).toContain("Existing experience index:");
    expect(prompt).toContain("dedupeKey=gateway-deploy");
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
});
