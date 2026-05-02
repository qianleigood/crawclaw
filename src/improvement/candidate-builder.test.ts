import { describe, expect, it } from "vitest";
import {
  readExperienceOutboxEntries,
  upsertExperienceOutboxEntryFromNote,
} from "../memory/experience/outbox-store.ts";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { buildPromotionCandidateAssessments } from "./candidate-builder.js";

describe("buildPromotionCandidateAssessments", () => {
  it("clusters repeated reusable experiences into a promotion-ready candidate", async () => {
    await withStateDirEnv("crawclaw-improvement-candidates-", async () => {
      await upsertExperienceOutboxEntryFromNote({
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

      await upsertExperienceOutboxEntryFromNote({
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

      const assessments = await buildPromotionCandidateAssessments({
        entries: await readExperienceOutboxEntries(),
      });

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
      await upsertExperienceOutboxEntryFromNote({
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

      await upsertExperienceOutboxEntryFromNote({
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

      const assessments = await buildPromotionCandidateAssessments({
        entries: await readExperienceOutboxEntries(),
      });

      expect(assessments).toEqual([]);
    });
  });

  it("marks candidates without enough evidence as needs_more_evidence", async () => {
    await withStateDirEnv("crawclaw-improvement-candidates-", async () => {
      await upsertExperienceOutboxEntryFromNote({
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

      const assessments = await buildPromotionCandidateAssessments({
        entries: await readExperienceOutboxEntries(),
      });

      expect(assessments).toHaveLength(1);
      expect(assessments[0]?.candidate.observedFrequency).toBe(1);
      expect(assessments[0]?.baselineDecision).toBe("needs_more_evidence");
      expect(assessments[0]?.blockers).toEqual(
        expect.arrayContaining(["missing_result_or_validation_evidence"]),
      );
    });
  });

  it("builds promotion candidates from NotebookLM before using local outbox entries", async () => {
    await withStateDirEnv("crawclaw-improvement-candidates-", async () => {
      const assessments = await buildPromotionCandidateAssessments({
        config: {
          memory: {
            notebooklm: {
              enabled: true,
              auth: {
                profile: "default",
                cookieFile: "",
                statusTtlMs: 60_000,
                degradedCooldownMs: 120_000,
                refreshCooldownMs: 180_000,
              },
              cli: {
                enabled: true,
                command: "python",
                args: ["/tmp/notebooklm-query.py", "{query}", "{limit}", "{notebookId}"],
                timeoutMs: 1_000,
                limit: 5,
                notebookId: "experience-notebook",
              },
              write: {
                command: "python",
                args: ["/tmp/notebooklm-write.py", "{payloadFile}", "{notebookId}"],
                timeoutMs: 1_000,
                notebookId: "experience-notebook",
              },
            },
          },
        },
        searchNotebookLm: async () => [
          {
            id: "notebooklm-hit-1",
            source: "notebooklm",
            title: "自进化候选",
            summary: "NotebookLM 返回的结构化候选。",
            content: JSON.stringify({
              candidates: [
                {
                  id: "notebooklm-candidate:workflow-debug-order",
                  sourceRefs: [{ kind: "experience", ref: "note-workflow-debug-order" }],
                  signalSummary:
                    "workflow 排查反复使用 registry -> operations -> executions 的顺序。",
                  observedFrequency: 3,
                  currentReuseLevel: "experience",
                  triggerPattern: "workflow 执行异常或更新异常",
                  repeatedActions: ["先查 registry，再查 operations，再看 executions。"],
                  validationEvidence: ["三次排障都按这个顺序定位问题。"],
                  evidenceKinds: ["trigger", "action", "result", "validation"],
                  baselineDecision: "ready",
                  score: 42,
                },
              ],
            }),
          },
        ],
      });

      expect(assessments).toHaveLength(1);
      expect(assessments[0]).toMatchObject({
        baselineDecision: "ready",
        score: 42,
        evidenceKinds: ["trigger", "action", "result", "validation"],
        candidate: {
          id: "notebooklm-candidate:workflow-debug-order",
          observedFrequency: 3,
          currentReuseLevel: "experience",
          repeatedActions: ["先查 registry，再查 operations，再看 executions。"],
          validationEvidence: ["三次排障都按这个顺序定位问题。"],
        },
      });
    });
  });

  it("does not build runtime candidates from the local outbox without NotebookLM config", async () => {
    await withStateDirEnv("crawclaw-improvement-candidates-", async () => {
      await upsertExperienceOutboxEntryFromNote({
        note: {
          type: "workflow_pattern",
          title: "本地 outbox 经验",
          summary: "以后都这样做：这个本地 pending 条目不应直接晋升为自进化候选。",
          context: "NotebookLM 尚未配置。",
          trigger: "自进化扫描。",
          action: "不要读取本地 outbox 做候选来源。",
          result: "等待 NotebookLM 返回结构化候选。",
          lesson: "自进化候选来源应是 NotebookLM。",
          evidence: ["本地 outbox 只用于待同步。"],
          confidence: "high",
          dedupeKey: "local-outbox-runtime-candidate",
        },
        notebookId: "local",
        syncStatus: "pending_sync",
      });

      await expect(buildPromotionCandidateAssessments()).resolves.toEqual([]);
    });
  });

  it("does not build runtime candidates from the local outbox when NotebookLM is disabled", async () => {
    await withStateDirEnv("crawclaw-improvement-candidates-", async () => {
      await upsertExperienceOutboxEntryFromNote({
        note: {
          type: "workflow_pattern",
          title: "禁用 NotebookLM 时的本地 outbox 经验",
          summary: "以后都这样做：NotebookLM disabled 时也不应回退到本地 outbox。",
          context: "NotebookLM disabled。",
          trigger: "自进化扫描。",
          action: "返回 no_candidate。",
          result: "没有从本地 outbox 产生候选。",
          lesson: "自进化候选来源应是 NotebookLM。",
          evidence: ["本地 outbox 只用于待同步。"],
          confidence: "high",
          dedupeKey: "disabled-notebooklm-local-candidate",
        },
        notebookId: "local",
        syncStatus: "pending_sync",
      });

      await expect(
        buildPromotionCandidateAssessments({
          config: {
            memory: {
              notebooklm: {
                enabled: false,
              },
            },
          },
        }),
      ).resolves.toEqual([]);
    });
  });
});
