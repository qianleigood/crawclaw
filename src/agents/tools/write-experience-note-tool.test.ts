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

  it("writes to the local experience index when NotebookLM writeback is not configured", async () => {
    const stateDir = await createTempDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    const tool = createExperienceWriteTool();

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
        syncStatus: "skipped",
      }),
    );
    expect(execFileMock).not.toHaveBeenCalled();

    const indexEntries = await readExperienceIndexEntries();
    expect(indexEntries).toEqual([
      expect.objectContaining({
        id: "experience-index:missing-tool-payload-debug",
        title: "工具缺失排查经验",
        summary: "工具没有进入模型 payload 时，先检查实际 payload 再看注册路径。",
        type: "failure_pattern",
        noteId: null,
        notebookId: "local",
      }),
    ]);
  });
});
