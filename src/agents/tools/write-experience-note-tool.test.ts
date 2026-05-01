import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import { readExperienceIndexEntries } from "../../memory/experience/index-store.js";
import { createExperienceWriteTool } from "./write-experience-note-tool.js";

const execFileMock = vi.fn();
const previousStateDir = process.env.CRAWCLAW_STATE_DIR;
const tempDirs: string[] = [];

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-experience-note-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("createExperienceWriteTool", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    if (previousStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = previousStateDir;
    }
  });

  it("renders a Chinese experience card and writes it through the NotebookLM adapter", async () => {
    const stateDir = await createTempDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            status: "ok",
            ready: true,
            profile: "default",
            notebookId: "experience-notebook",
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
            title: "网关恢复经验",
          }),
        );
      });

    const tool = createExperienceWriteTool({
      config: {
        memory: {
          notebooklm: {
            enabled: true,
            auth: {
              profile: "default",
              cookieFile: path.join(stateDir, "cookies.txt"),
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
              notebookId: "experience-notebook",
            },
            write: {
              enabled: true,
              command: "python",
              args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
              timeoutMs: 1000,
              notebookId: "experience-notebook",
            },
            source: {
              enabled: false,
            },
          },
        },
      } satisfies CrawClawConfig,
    });

    expect(tool).not.toBeNull();
    expect(tool?.name).toBe("write_experience_note");
    const result = await tool!.execute("call_1", {
      type: "procedure",
      title: "网关恢复经验",
      summary: "在网关关闭时按顺序恢复服务。",
      context: "用户要求恢复网关或排查服务不可用。",
      trigger: "health 检查失败，或者 RPC 连接关闭。",
      action: "先检查端口，再重启进程。",
      result: "恢复后 health 检查返回 ok:true。",
      lesson: "恢复类问题应该先给可执行步骤，再解释原因。",
      appliesWhen: "适用于本地网关恢复和服务健康排查。",
      evidence: ["crawclaw health --json 返回 ok:true"],
      tags: ["网关", "恢复"],
      dedupeKey: "gateway-recovery-experience",
      confidence: "high",
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "ok",
        action: "create",
        noteId: "note-123",
        title: "网关恢复经验",
      }),
    );

    const execArgs = execFileMock.mock.calls[1];
    expect(execArgs[0]).toBe("python");
    const payloadFile = String(execArgs[1][2]);
    const payload = JSON.parse(await fs.readFile(payloadFile, "utf8")) as Record<string, unknown>;
    const content =
      typeof payload.content === "string" ? payload.content : JSON.stringify(payload.content ?? "");

    expect(payload.notebookId).toBe("experience-notebook");
    expect(content).toContain("## 场景");
    expect(content).toContain("## 触发信号");
    expect(content).toContain("## 有效做法");
    expect(content).toContain("经验类型：操作经验");
    expect(content).toContain("经验键：gateway-recovery-experience");

    const indexEntries = await readExperienceIndexEntries();
    expect(indexEntries).toEqual([
      expect.objectContaining({
        id: "experience-index:gateway-recovery-experience",
        title: "网关恢复经验",
        summary: "在网关关闭时按顺序恢复服务。",
        type: "procedure",
        noteId: "note-123",
        notebookId: "experience-notebook",
      }),
    ]);
  });

  it("rejects transient session-state style content", async () => {
    const tool = createExperienceWriteTool({
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
              args: ["/tmp/notebooklm-cli-recall.py", "{query}", "{limit}", "{notebookId}"],
              timeoutMs: 1000,
              limit: 5,
              notebookId: "experience-notebook",
            },
            write: {
              enabled: true,
              command: "python",
              args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
              timeoutMs: 1000,
              notebookId: "experience-notebook",
            },
            source: {
              enabled: false,
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
        lesson: "这只是当前会话里的临时计划。",
      }),
    ).rejects.toThrow(/experience note should not store transient session state/i);
  });

  it("stores a pending sync entry when NotebookLM writeback is not ready", async () => {
    const stateDir = await createTempDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(new Error("Authentication failed"), "", "Authentication failed");
    });

    const tool = createExperienceWriteTool({
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
              args: ["/tmp/notebooklm-cli-recall.py", "{query}", "{limit}", "{notebookId}"],
              timeoutMs: 1000,
              limit: 5,
              notebookId: "experience-notebook",
            },
            write: {
              enabled: true,
              command: "python",
              args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
              timeoutMs: 1000,
              notebookId: "experience-notebook",
            },
            source: {
              enabled: false,
            },
          },
        },
      } satisfies CrawClawConfig,
    });

    expect(tool).not.toBeNull();
    const result = await tool!.execute("call_1", {
      type: "failure_pattern",
      title: "工具缺失排查经验",
      summary: "工具没有进入模型 payload 时，先检查实际 payload 再看注册路径。",
      context: "模型回答说工具不可用，或者 tool payload 缺少目标工具。",
      trigger: "payload.tools 为空，或缺少预期工具名。",
      action: "先抓取模型可见 payload，再检查工具注册、allowlist 和 channel 分支。",
      result: "能把问题定位到注入路径，而不是误判为模型问题。",
      lesson: "工具可见性问题必须先用运行时 payload 证据定界。",
      appliesWhen: "适用于 agent 工具没有出现、allowlist 失效、特殊 agent 工具边界排查。",
      evidence: ["实际 payload 是模型能否调用工具的直接证据。"],
      dedupeKey: "missing-tool-payload-debug",
      confidence: "high",
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "ok",
        action: "upsert",
        notebookId: "local",
        syncStatus: "pending_sync",
        recommendedAction: "crawclaw memory login",
      }),
    );
    expect(execFileMock).toHaveBeenCalledTimes(1);

    const indexEntries = await readExperienceIndexEntries();
    expect(indexEntries).toEqual([
      expect.objectContaining({
        id: "experience-index:missing-tool-payload-debug",
        title: "工具缺失排查经验",
        summary: "工具没有进入模型 payload 时，先检查实际 payload 再看注册路径。",
        type: "failure_pattern",
        noteId: null,
        notebookId: "local",
        syncStatus: "pending_sync",
        lastSyncError: expect.stringContaining("Authentication failed"),
      }),
    ]);
  });

  it("archives an existing local experience note through the same tool", async () => {
    const stateDir = await createTempDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    const tool = createExperienceWriteTool();

    expect(tool).not.toBeNull();
    await tool!.execute("call_1", {
      type: "procedure",
      title: "旧发布流程经验",
      summary: "旧流程已被新的验证流程替代。",
      context: "发布流程曾经依赖旧顺序。",
      trigger: "后续验证证明旧顺序不再适用。",
      action: "归档旧流程，避免后续召回。",
      result: "旧经验不再进入召回。",
      lesson: "被否定的经验应该从后续召回中移除。",
      appliesWhen: "适用于旧经验被明确推翻时。",
      evidence: ["新的流程已经验证通过。"],
      dedupeKey: "old-release-procedure",
      confidence: "high",
    });

    const result = await tool!.execute("call_2", {
      operation: "archive",
      targetId: "old-release-procedure",
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "ok",
        action: "archive",
        indexStatus: "archived",
        targetId: "experience-index:old-release-procedure",
        remoteDeleteStatus: "skipped",
      }),
    );

    const indexEntries = await readExperienceIndexEntries();
    expect(indexEntries).toEqual([
      expect.objectContaining({
        id: "experience-index:old-release-procedure",
        status: "archived",
      }),
    ]);
  });

  it("marks an existing experience note as superseded by a replacement", async () => {
    const stateDir = await createTempDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    const tool = createExperienceWriteTool();

    expect(tool).not.toBeNull();
    await tool!.execute("call_1", {
      type: "procedure",
      title: "旧网关恢复经验",
      summary: "旧恢复流程只检查端口，覆盖不完整。",
      context: "网关恢复排查曾经只看端口。",
      trigger: "用户反馈旧流程不能覆盖实际故障。",
      action: "保留为待替换经验。",
      result: "后续需要用新的恢复流程替代。",
      lesson: "覆盖不完整的经验应该被新经验替代。",
      appliesWhen: "适用于旧经验被更完整流程替代时。",
      evidence: ["新流程覆盖 health、RPC 和日志。"],
      dedupeKey: "old-gateway-recovery",
      confidence: "medium",
    });
    await tool!.execute("call_2", {
      type: "procedure",
      title: "新网关恢复经验",
      summary: "新恢复流程按 health、RPC、日志顺序定位。",
      context: "网关恢复需要同时检查连接状态和日志。",
      trigger: "health 或 RPC 异常。",
      action: "先查 health，再查 RPC，最后查日志。",
      result: "能更准确定位恢复路径。",
      lesson: "恢复流程应该先用最直接的运行态信号定界。",
      appliesWhen: "适用于本地网关恢复。",
      evidence: ["新流程已经验证通过。"],
      dedupeKey: "new-gateway-recovery",
      confidence: "high",
    });

    const result = await tool!.execute("call_3", {
      operation: "supersede",
      targetId: "old-gateway-recovery",
      supersededBy: "new-gateway-recovery",
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "ok",
        action: "supersede",
        indexStatus: "superseded",
        targetId: "experience-index:old-gateway-recovery",
        supersededBy: "experience-index:new-gateway-recovery",
      }),
    );

    const indexEntries = await readExperienceIndexEntries();
    expect(indexEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "experience-index:old-gateway-recovery",
          status: "superseded",
          supersededBy: "experience-index:new-gateway-recovery",
        }),
        expect.objectContaining({
          id: "experience-index:new-gateway-recovery",
          status: "active",
        }),
      ]),
    );
  });
});
