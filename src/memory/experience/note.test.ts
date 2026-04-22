import { describe, expect, it } from "vitest";
import {
  classifyExperienceNoteGuardIssue,
  getExperienceNoteTypeLabel,
  renderExperienceNoteMarkdown,
} from "./note.ts";

describe("experience note", () => {
  it("renders a Chinese procedure experience card", () => {
    const rendered = renderExperienceNoteMarkdown({
      type: "procedure",
      title: "本地网关异常恢复经验",
      summary: "在本地网关异常时，先恢复服务再验证健康状态。",
      context: "当 health 检查失败或 RPC 连接关闭时使用。",
      trigger: "health 返回失败，或者连接被关闭。",
      action: "先确认网关状态，再重启服务。",
      result: "恢复后 health 检查返回 ok:true。",
      lesson: "操作类问题要先给可执行步骤，再补充原因。",
      appliesWhen: "用户要求恢复服务或排查本地网关异常。",
      evidence: ["之前的网关恢复任务中，该步骤顺序能减少来回确认。"],
      dedupeKey: "gateway-recovery-experience",
      confidence: "high",
      tags: ["网关", "恢复"],
    });

    expect(getExperienceNoteTypeLabel("procedure")).toBe("操作经验");
    expect(rendered).toContain("# 本地网关异常恢复经验");
    expect(rendered).toContain("> 经验类型：操作经验");
    expect(rendered).toContain("## 场景");
    expect(rendered).toContain("## 触发信号");
    expect(rendered).toContain("## 有效做法");
    expect(rendered).toContain("## 经验结论");
    expect(rendered).toContain("经验键：gateway-recovery-experience");
  });

  it("renders failure and workflow experience labels", () => {
    expect(getExperienceNoteTypeLabel("failure_pattern")).toBe("失败经验");
    expect(getExperienceNoteTypeLabel("workflow_pattern")).toBe("协作经验");
  });

  it("rejects non-Chinese-first experience notes", () => {
    expect(
      classifyExperienceNoteGuardIssue({
        type: "decision",
        title: "Use NotebookLM for recall",
        summary: "Use NotebookLM as the main experience recall source.",
        lesson: "中文经验结论。",
      }),
    ).toMatch(/Chinese-first/);
  });

  it("rejects English-heavy structured sections even when title and summary are Chinese", () => {
    expect(
      classifyExperienceNoteGuardIssue({
        type: "procedure",
        title: "本地网关恢复",
        summary: "用于恢复本地网关服务。",
        context: "Use this when the gateway is unhealthy.",
        action: "Restart the service",
      }),
    ).toMatch(/Chinese-readable/);
  });

  it("rejects durable-memory style feedback content", () => {
    expect(
      classifyExperienceNoteGuardIssue({
        type: "reference",
        title: "回答风格偏好",
        summary: "用户要求回答操作类问题时先给步骤再讲原理。",
      }),
    ).toMatch(/durable-memory style user or feedback context/);
  });

  it("rejects unvalidated guesses", () => {
    expect(
      classifyExperienceNoteGuardIssue({
        type: "failure_pattern",
        title: "网关失败猜测",
        summary: "未经验证的报错原因不应该沉淀为经验。",
        context: "这只是未经验证的猜测。",
      }),
    ).toMatch(/validated experience/);
  });
});
