import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import { resolveDurableMemoryScope } from "../../memory/durable/scope.js";
import { readExperienceOutboxEntries } from "../../memory/experience/outbox-store.js";

const notebookLmWriteMock = vi.hoisted(() => vi.fn());
const notebookLmDeleteMock = vi.hoisted(() => vi.fn());
const previousStateDir = process.env.CRAWCLAW_STATE_DIR;
const tempDirs: string[] = [];
let createExperienceWriteTool: typeof import("./write-experience-note-tool.js").createExperienceWriteTool;

vi.mock("../../memory/notebooklm/notebooklm-write.ts", () => ({
  writeNotebookLmExperienceNoteViaCli: (...args: unknown[]) => notebookLmWriteMock(...args),
  deleteNotebookLmExperienceNoteViaCli: (...args: unknown[]) => notebookLmDeleteMock(...args),
}));

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-experience-note-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("createExperienceWriteTool", () => {
  beforeEach(async () => {
    vi.resetModules();
    notebookLmWriteMock.mockReset();
    notebookLmDeleteMock.mockReset();
    ({ createExperienceWriteTool } = await import("./write-experience-note-tool.js"));
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
    notebookLmWriteMock.mockResolvedValueOnce({
      status: "ok",
      action: "create",
      noteId: "note-123",
      notebookId: "experience-notebook",
      title: "网关恢复经验",
      payloadFile: path.join(stateDir, "payload.json"),
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
              command: "python",
              args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
              timeoutMs: 1000,
              notebookId: "experience-notebook",
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

    expect(notebookLmWriteMock).toHaveBeenCalledTimes(1);
    expect(notebookLmWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        note: expect.objectContaining({
          title: "网关恢复经验",
          context: "用户要求恢复网关或排查服务不可用。",
          trigger: "health 检查失败，或者 RPC 连接关闭。",
          action: "先检查端口，再重启进程。",
          result: "恢复后 health 检查返回 ok:true。",
          lesson: "恢复类问题应该先给可执行步骤，再解释原因。",
          dedupeKey: "gateway-recovery-experience",
        }),
      }),
    );

    await expect(readExperienceOutboxEntries()).resolves.toEqual([]);
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
              command: "python",
              args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
              timeoutMs: 1000,
              notebookId: "experience-notebook",
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
    notebookLmWriteMock.mockRejectedValueOnce(new Error("Authentication failed"));
    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    expect(scope).not.toBeNull();

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
              command: "python",
              args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
              timeoutMs: 1000,
              notebookId: "experience-notebook",
            },
          },
        },
      } satisfies CrawClawConfig,
      scope: scope!,
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
    expect(notebookLmWriteMock).toHaveBeenCalledTimes(1);

    const outboxEntries = await readExperienceOutboxEntries();
    expect(outboxEntries).toEqual([
      expect.objectContaining({
        id: "experience-outbox:main-feishu-user-1-missing-tool-payload-debug",
        title: "工具缺失排查经验",
        summary: "工具没有进入模型 payload 时，先检查实际 payload 再看注册路径。",
        type: "failure_pattern",
        noteId: null,
        notebookId: "local",
        syncStatus: "pending_sync",
        lastSyncError: expect.stringContaining("Authentication failed"),
        scope: expect.objectContaining({
          scopeKey: scope!.scopeKey,
        }),
      }),
    ]);
  });

  it("archives an existing local experience note through the same tool", async () => {
    const stateDir = await createTempDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    const tool = createExperienceWriteTool({
      config: {
        memory: {
          notebooklm: {
            enabled: false,
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
              command: "python",
              args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
              timeoutMs: 1000,
              notebookId: "experience-notebook",
            },
          },
        },
      } satisfies CrawClawConfig,
    });

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
        outboxStatus: "archived",
        targetId: "experience-outbox:old-release-procedure",
        remoteDeleteStatus: "skipped",
      }),
    );
    expect(notebookLmWriteMock).not.toHaveBeenCalled();
    expect(notebookLmDeleteMock).not.toHaveBeenCalled();

    const outboxEntries = await readExperienceOutboxEntries();
    expect(outboxEntries).toEqual([
      expect.objectContaining({
        id: "experience-outbox:old-release-procedure",
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
        outboxStatus: "superseded",
        targetId: "experience-outbox:old-gateway-recovery",
        supersededBy: "experience-outbox:new-gateway-recovery",
      }),
    );

    const outboxEntries = await readExperienceOutboxEntries();
    expect(outboxEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "experience-outbox:old-gateway-recovery",
          status: "superseded",
          supersededBy: "experience-outbox:new-gateway-recovery",
        }),
        expect.objectContaining({
          id: "experience-outbox:new-gateway-recovery",
          status: "active",
        }),
      ]),
    );
  });
});
