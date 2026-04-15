import { describe, expect, it } from "vitest";
import {
  classifyKnowledgeNoteGuardIssue,
  getKnowledgeNoteTypeLabel,
  renderKnowledgeNoteMarkdown,
} from "./knowledge-note.ts";

describe("knowledge-note", () => {
  it("renders a Chinese procedure knowledge card", () => {
    const rendered = renderKnowledgeNoteMarkdown({
      type: "procedure",
      title: "本地网关异常恢复步骤",
      summary: "在本地网关异常时，按顺序恢复服务并验证健康状态。",
      body: "当 health 检查失败或 RPC 连接关闭时使用。",
      steps: ["检查网关状态", "确认安装路径", "重启网关服务"],
      validation: ["确认 crawclaw health --json 返回 ok:true"],
      references: ["NotebookLM: 网关运维笔记"],
      dedupeKey: "gateway-recovery-procedure",
      tags: ["网关", "恢复"],
    });

    expect(getKnowledgeNoteTypeLabel("procedure")).toBe("操作流程");
    expect(rendered).toContain("# 本地网关异常恢复步骤");
    expect(rendered).toContain("> 类型：操作流程");
    expect(rendered).toContain("## 适用场景");
    expect(rendered).toContain("## 操作步骤");
    expect(rendered).toContain("## 验证方法");
    expect(rendered).toContain("知识键：gateway-recovery-procedure");
  });

  it("rejects non-Chinese-first knowledge notes", () => {
    expect(
      classifyKnowledgeNoteGuardIssue({
        type: "decision",
        title: "Use NotebookLM for recall",
        summary: "Use NotebookLM as the main knowledge recall source.",
      }),
    ).toMatch(/Chinese-first/);
  });

  it("rejects English-heavy body sections even when title and summary are Chinese", () => {
    expect(
      classifyKnowledgeNoteGuardIssue({
        type: "procedure",
        title: "本地网关恢复",
        summary: "用于恢复本地网关服务。",
        body: "Use this when the gateway is unhealthy.",
        steps: ["Restart the service", "Check the health endpoint"],
      }),
    ).toMatch(/Chinese-readable/);
  });

  it("rejects durable-memory style feedback content", () => {
    expect(
      classifyKnowledgeNoteGuardIssue({
        type: "reference",
        title: "回答风格偏好",
        summary: "用户要求回答操作类问题时先给步骤再讲原理。",
      }),
    ).toMatch(/durable-memory style user or feedback context/);
  });
});
