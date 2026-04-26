import { describe, expect, it } from "vitest";
import { upsertExperienceIndexEntryFromNote } from "../memory/experience/index-store.ts";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { buildPromotionCandidateAssessments } from "./candidate-builder.js";

describe("buildPromotionCandidateAssessments", () => {
  it("clusters repeated reusable experiences into a promotion-ready candidate", async () => {
    await withStateDirEnv("crawclaw-improvement-candidates-", async () => {
      await upsertExperienceIndexEntryFromNote({
        note: {
          type: "failure_pattern",
          title: "网关回滚顺序经验 A",
          summary: "网关发布失败时先回滚 service，再检查 secret 和探针。",
          context: "gateway 发布后 probe 失败。",
          trigger: "gateway 发布失败且 probe unhealthy。",
          action: "先回滚 service，再检查 secret。",
          result: "回滚后 probe 恢复 healthy。",
          lesson: "先保护可恢复路径，再查配置。",
          evidence: ["这轮排障验证了该顺序。"],
          confidence: "high",
          dedupeKey: "gateway-order-a",
          aliases: ["gateway 发布失败顺序"],
          tags: ["gateway", "release"],
        },
        notebookId: "local",
      });

      await upsertExperienceIndexEntryFromNote({
        note: {
          type: "failure_pattern",
          title: "网关回滚顺序经验 B",
          summary: "服务发布失败时先回滚 service，再检查 secret 和探针。",
          context: "service 发布后健康检查失败。",
          trigger: "发布后 unhealthy。",
          action: "先回滚 service，再检查 secret。",
          result: "回滚后健康检查恢复。",
          lesson: "先回滚再查配置。",
          evidence: ["另一次任务复现了同样的修复顺序。"],
          confidence: "high",
          dedupeKey: "gateway-order-b",
          aliases: ["发布失败顺序"],
          tags: ["gateway", "release"],
        },
        notebookId: "local",
      });

      const assessments = await buildPromotionCandidateAssessments();

      expect(assessments).toHaveLength(1);
      expect(assessments[0]?.candidate.observedFrequency).toBe(2);
      expect(assessments[0]?.baselineDecision).toBe("ready");
      expect(assessments[0]?.evidenceKinds).toEqual(
        expect.arrayContaining(["trigger", "action", "result", "validation"]),
      );
      expect(assessments[0]?.candidate.repeatedActions).toContain(
        "先回滚 service，再检查 secret。",
      );
    });
  });

  it("filters durable preference and temporary workaround notes", async () => {
    await withStateDirEnv("crawclaw-improvement-candidates-", async () => {
      await upsertExperienceIndexEntryFromNote({
        note: {
          type: "decision",
          title: "回答风格偏好",
          summary: "记住用户喜欢简短回答。",
          context: "用户明确提出回答要简短。",
          action: "记住这个偏好。",
          result: "后续回答更简短。",
          lesson: "这是 durable memory，不是可晋升经验。",
          evidence: ["用户明确要求记住这个偏好。"],
          confidence: "high",
          dedupeKey: "reply-style-pref",
        },
        notebookId: "local",
      });

      await upsertExperienceIndexEntryFromNote({
        note: {
          type: "failure_pattern",
          title: "临时热修经验",
          summary: "这是一次性 hotfix only 的临时 workaround。",
          context: "线上临时止血。",
          trigger: "紧急故障。",
          action: "临时修复，之后删除。",
          result: "暂时恢复。",
          lesson: "一次性 workaround 不应晋升。",
          evidence: ["只在这一次任务中使用。"],
          confidence: "medium",
          dedupeKey: "temporary-hotfix",
        },
        notebookId: "local",
      });

      const assessments = await buildPromotionCandidateAssessments();

      expect(assessments).toEqual([]);
    });
  });

  it("marks candidates without enough evidence as needs_more_evidence", async () => {
    await withStateDirEnv("crawclaw-improvement-candidates-", async () => {
      await upsertExperienceIndexEntryFromNote({
        note: {
          type: "procedure",
          title: "workflow 排查入口顺序",
          summary: "以后都这样做：先查 registry，再查 operations。",
          context: "workflow 相关问题排查。",
          trigger: "workflow 执行异常。",
          action: "先看 registry，再看 operations。",
          lesson: "排查入口要稳定。",
          confidence: "medium",
          dedupeKey: "workflow-entry-order",
        },
        notebookId: "local",
      });

      const assessments = await buildPromotionCandidateAssessments();

      expect(assessments).toHaveLength(1);
      expect(assessments[0]?.candidate.observedFrequency).toBe(1);
      expect(assessments[0]?.baselineDecision).toBe("needs_more_evidence");
      expect(assessments[0]?.blockers).toEqual(
        expect.arrayContaining(["missing_result_or_validation_evidence"]),
      );
    });
  });
});
