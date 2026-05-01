import { describe, expect, it } from "vitest";
import { renderAgentMemoryRoutingContract } from "../memory/context/render-routing-guidance.ts";
import { createCrawClawTools } from "./crawclaw-tools.ts";
import { buildAgentSystemPrompt } from "./system-prompt.ts";

describe("agent memory routing guidance", () => {
  it("renders durable-memory routing rules in the agent memory routing contract", () => {
    const contract = renderAgentMemoryRoutingContract();

    expect(contract.text).toContain(
      "Durable memory 用来保存未来仍然有用、但不能从当前代码、当前任务状态或当前临时上下文直接推导出来的协作信息。",
    );
    expect(contract.text).toContain(
      "写入前先判断当前 scope 中是否已经有表达同一条长期信息的 durable memory note；如果有，优先更新，不要重复创建。",
    );
    expect(contract.text).toContain(
      "当用户明确要求记住或忘记某条 durable memory，且当前可用 scoped memory file tools 时，优先在当前回合显式调用这些工具。",
    );
    expect(contract.text).toContain(
      "保存 durable memory 是两步过程：先维护对应的 durable memory Markdown 文件，再同步更新当前 scope 的 MEMORY.md 索引；MEMORY.md 是索引，不是正文，也不应带 frontmatter。",
    );
    expect(contract.text).toContain(
      "MEMORY.md 的每条索引应尽量保持一行、约 150 个字符以内，用短 hook 指向 note 文件；不要把细节正文塞进索引。",
    );
    expect(contract.text).toContain(
      "如果用户要求忽略或不要使用某条 durable memory，就按该条记忆不存在来处理；不要引用它、比较它，或借它继续推断。",
    );
    expect(contract.text).toContain(
      "feedback 不只记录纠错；当用户明确确认某种非显然但有效的协作方式以后应继续沿用时，也可以写成 feedback。",
    );
    expect(contract.text).toContain(
      "不要把代码模式、架构、文件路径、git 历史、调试解法、CLAUDE/CrawClaw 文档里已有的内容、当前任务进度、临时计划、短期调试状态或活动日志写入 Durable memory。",
    );
    expect(contract.text).toContain(
      "凡是可以通过当前代码、git 历史、文档或运行态重新发现的内容，都不应写入 Durable memory。",
    );
    expect(contract.text).toContain(
      "如果用户即将根据某条 durable memory 采取行动，而不是只是在问历史背景，先验证再建议。",
    );
    expect(contract.text).toContain("把运行态与经验回忆信号当作时间敏感信息，它们可能已经过时。");
    expect(contract.text).not.toContain("runtime signals");
  });

  it("renders durable-memory guardrails in the base prompt when scoped tools are available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/crawclaw",
      toolNames: [
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
      ],
    });

    expect(prompt).toContain("## Durable Memory");
    expect(prompt).toContain(
      "Use scoped durable memory tools only for stable, future-useful collaboration information.",
    );
    expect(prompt).toContain(
      "Do not save task progress, temporary plans, code structure, file paths, git history, debugging fixes, or activity logs as durable memory.",
    );
    expect(prompt).toContain(
      "When writing durable memory, first read the scoped manifest, prefer updating an existing note, and keep MEMORY.md as a short index.",
    );
    expect(prompt).toContain(
      "Current code, docs, git state, runtime state, and user instructions override stale durable memory.",
    );
  });

  it("lets the memory runtime own durable-memory routing when it is active", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/crawclaw",
      memoryRuntimeActive: true,
      toolNames: [
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
      ],
    });

    expect(prompt).not.toContain("## Durable Memory");
    expect(prompt).not.toContain(
      "Use scoped durable memory tools only for stable, future-useful collaboration information.",
    );
  });

  it("exposes scoped memory file tools to the agent toolset with anti-pollution guidance", () => {
    const tools = createCrawClawTools({
      agentSessionKey: "agent:main:feishu:user-1",
      agentChannel: "feishu",
      requesterSenderId: "user-1",
    });

    const manifestTool = tools.find((tool) => tool.name === "memory_manifest_read");
    const readNoteTool = tools.find((tool) => tool.name === "memory_note_read");
    const writeNoteTool = tools.find((tool) => tool.name === "memory_note_write");
    const editNoteTool = tools.find((tool) => tool.name === "memory_note_edit");
    const deleteNoteTool = tools.find((tool) => tool.name === "memory_note_delete");

    expect(manifestTool).toBeDefined();
    expect(readNoteTool).toBeDefined();
    expect(writeNoteTool).toBeDefined();
    expect(editNoteTool).toBeDefined();
    expect(deleteNoteTool).toBeDefined();
    expect(manifestTool?.description).toContain("Read the scoped durable memory manifest");
    expect(readNoteTool?.description).toContain("Read a specific durable memory file");
    expect(writeNoteTool?.description).toContain("Write a complete durable memory Markdown file");
    expect(editNoteTool?.description).toContain(
      "Edit a scoped durable memory file by replacing exact text",
    );
    expect(deleteNoteTool?.description).toContain("Delete a scoped durable memory Markdown file");
  });
});
