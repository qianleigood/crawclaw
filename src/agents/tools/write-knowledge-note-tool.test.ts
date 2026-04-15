import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import { createKnowledgeWriteTool } from "./write-knowledge-note-tool.js";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-knowledge-note-test-"));
}

describe("createKnowledgeWriteTool", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
  });

  it("renders a Chinese procedure card and writes it through the NotebookLM adapter", async () => {
    const stateDir = await createTempDir();
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            status: "ok",
            ready: true,
            profile: "default",
            notebookId: "knowledge-notebook",
            refreshAttempted: false,
            refreshSucceeded: false,
          }),
        );
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            status: "ok",
            action: "create",
            noteId: "note-123",
            title: "网关恢复步骤",
          }),
        );
      });

    const tool = createKnowledgeWriteTool({
      config: {
        memory: {
          notebooklm: {
            enabled: true,
            auth: {
              profile: "default",
              cookieFile: path.join(stateDir, "cookies.txt"),
              autoRefresh: true,
              statusTtlMs: 60_000,
              degradedCooldownMs: 120_000,
              refreshCooldownMs: 180_000,
            },
            cli: {
              enabled: true,
              command: "python",
              args: ["/tmp/notebooklm-cli-recall.py", "{query}", "{limit}", "{notebookId}"],
              timeoutMs: 1000,
              limit: 5,
              notebookId: "knowledge-notebook",
            },
            write: {
              enabled: true,
              command: "python",
              args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
              timeoutMs: 1000,
              notebookId: "knowledge-notebook",
            },
          },
        },
      } satisfies CrawClawConfig,
    });

    expect(tool).not.toBeNull();
    const result = await tool!.execute("call_1", {
      type: "procedure",
      title: "网关恢复步骤",
      summary: "在网关关闭时按顺序恢复服务。",
      body: "先检查端口，再重启进程。",
      steps: ["检查网关状态", "重启 LaunchAgent", "重新验证 health"],
      validation: ["crawclaw health --json 返回 ok:true"],
      tags: ["网关", "恢复"],
      dedupeKey: "gateway-recovery-procedure",
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "ok",
        action: "create",
        noteId: "note-123",
        title: "网关恢复步骤",
      }),
    );

    const execArgs = execFileMock.mock.calls[1];
    expect(execArgs[0]).toBe("python");
    const payloadFile = String(execArgs[1][2]);
    const payload = JSON.parse(await fs.readFile(payloadFile, "utf8")) as Record<string, unknown>;
    const content =
      typeof payload.content === "string" ? payload.content : JSON.stringify(payload.content ?? "");

    expect(payload.notebookId).toBe("knowledge-notebook");
    expect(content).toContain("## 适用场景");
    expect(content).toContain("## 操作步骤");
    expect(content).toContain("## 验证方法");
    expect(content).toContain("知识类型：操作流程");
    expect(content).toContain("知识键：gateway-recovery-procedure");
  });

  it("rejects transient session-state style content", async () => {
    const tool = createKnowledgeWriteTool({
      config: {
        memory: {
          notebooklm: {
            enabled: true,
            auth: {
              profile: "default",
              cookieFile: "",
              autoRefresh: true,
              statusTtlMs: 60_000,
              degradedCooldownMs: 120_000,
              refreshCooldownMs: 180_000,
            },
            cli: {
              enabled: true,
              command: "python",
              args: ["/tmp/notebooklm-cli-recall.py", "{query}", "{limit}", "{notebookId}"],
              timeoutMs: 1000,
              limit: 5,
              notebookId: "knowledge-notebook",
            },
            write: {
              enabled: true,
              command: "python",
              args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
              timeoutMs: 1000,
              notebookId: "knowledge-notebook",
            },
          },
        },
      } satisfies CrawClawConfig,
    });

    expect(tool).not.toBeNull();
    await expect(
      tool!.execute("call_1", {
        type: "decision",
        title: "当前任务状态",
        summary: "当前任务仍在进行中，还没有形成稳定结论。",
        why: "这只是当前会话里的临时计划。",
      }),
    ).rejects.toThrow(/knowledge note should not store transient session state/i);
  });
});
