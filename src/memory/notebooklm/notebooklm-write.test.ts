import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing as promptJournalTesting } from "../diagnostics/prompt-journal.ts";
import type { NotebookLmConfig } from "../types/config.ts";
import {
  deleteNotebookLmExperienceNoteViaCli,
  writeNotebookLmExperienceNoteViaCli,
} from "./notebooklm-write.ts";
import { clearNotebookLmProviderStateCache } from "./provider-state.ts";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

describe("writeNotebookLmExperienceNoteViaCli", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    clearNotebookLmProviderStateCache();
    promptJournalTesting.resetSharedMemoryPromptJournal();
  });

  afterEach(() => {
    delete process.env.CRAWCLAW_MEMORY_PROMPT_JOURNAL;
    delete process.env.CRAWCLAW_MEMORY_PROMPT_JOURNAL_FILE;
    clearNotebookLmProviderStateCache();
    promptJournalTesting.resetSharedMemoryPromptJournal();
  });

  it("writes a payload file through the configured write command", async () => {
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            status: "ok",
            ready: true,
            profile: "default",
            notebookId: "nb-42",
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
            action: "upsert",
            noteId: "note-42",
            title: "经验召回改用 NotebookLM 的原因",
            notebookId: "nb-42",
          }),
        );
      });

    const result = await writeNotebookLmExperienceNoteViaCli({
      config: {
        enabled: true,
        auth: {
          profile: "default",
          cookieFile: "",
          statusTtlMs: 60_000,
          degradedCooldownMs: 120_000,
          refreshCooldownMs: 180_000,
          heartbeat: { enabled: true, minIntervalMs: 1_000, maxIntervalMs: 2_000 },
        },
        cli: {
          enabled: true,
          command: "python",
          args: ["query"],
          timeoutMs: 1000,
          limit: 5,
          notebookId: "nb-42",
        },
        write: {
          enabled: false,
          command: "python",
          args: ["writer.py", "{payloadFile}", "{notebookId}"],
          timeoutMs: 1000,
          notebookId: "nb-42",
        } as unknown as NotebookLmConfig["write"],
      },
      note: {
        type: "decision",
        title: "经验召回改用 NotebookLM 的原因",
        summary: "前台经验召回改用 NotebookLM，可以减少宿主维护的重型召回逻辑。",
        context: "NotebookLM 更适合作为经验库问答层。",
        lesson: "它能把查询和来源综合交给同一套经验后端处理。",
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        action: "upsert",
        noteId: "note-42",
        notebookId: "nb-42",
      }),
    );
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock.mock.calls[1]?.[0]).toBe("python");
    expect(execFileMock.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["writer.py", expect.any(String), "nb-42"]),
    );
  });

  it("writes through managed nlm source add when no custom write command is configured", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-notebooklm-native-write-"));
    const binPath =
      process.platform === "win32"
        ? path.join(stateDir, "runtimes", "notebooklm-mcp-cli", "venv", "Scripts", "nlm.exe")
        : path.join(stateDir, "runtimes", "notebooklm-mcp-cli", "venv", "bin", "nlm");
    await fs.mkdir(path.dirname(binPath), { recursive: true });
    await fs.writeFile(binPath, "", "utf8");
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    execFileMock
      .mockImplementationOnce((command, args, _options, callback) => {
        expect(command).toBe(binPath);
        expect(args).toEqual(["login", "--check"]);
        callback(null, "✓ Authentication valid!\n  Profile: default\n  Notebooks found: 1");
      })
      .mockImplementationOnce((command, args, _options, callback) => {
        expect(command).toBe(binPath);
        expect(args).toEqual(
          expect.arrayContaining([
            "source",
            "add",
            "nb-managed",
            "--title",
            "云端经验同步验收流程",
            "--text",
            "--wait",
          ]),
        );
        callback(
          null,
          "✓ Source added\n  Source ID: source-managed-1\n  Title: 云端经验同步验收流程\n",
        );
      });

    const result = await writeNotebookLmExperienceNoteViaCli({
      config: {
        enabled: true,
        auth: {
          profile: "default",
          cookieFile: "",
          statusTtlMs: 60_000,
          degradedCooldownMs: 120_000,
          refreshCooldownMs: 180_000,
          heartbeat: { enabled: true, minIntervalMs: 1_000, maxIntervalMs: 2_000 },
        },
        cli: {
          enabled: true,
          command: "",
          args: [
            "notebook",
            "query",
            "{notebookId}",
            "{query}",
            "--json",
            "--profile",
            "{profile}",
          ],
          timeoutMs: 1000,
          limit: 5,
          notebookId: "nb-managed",
        },
        write: {
          command: "",
          args: ["{payloadFile}"],
          timeoutMs: 1000,
          notebookId: "nb-managed",
        },
      },
      note: {
        type: "procedure",
        title: "云端经验同步验收流程",
        summary: "云端经验库验收要同时检查写入结果和检索命中。",
        context: "完成登录后需要确认云端经验库 provider 是否真正接通。",
        action: "写入经验 note 后再用同一标记检索。",
        lesson: "provider 验收不能只看本地 outbox。",
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        action: "create",
        noteId: "source-managed-1",
        notebookId: "nb-managed",
      }),
    );
  });

  it("deletes managed NotebookLM experience sources by id", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-notebooklm-native-delete-"));
    const binPath =
      process.platform === "win32"
        ? path.join(stateDir, "runtimes", "notebooklm-mcp-cli", "venv", "Scripts", "nlm.exe")
        : path.join(stateDir, "runtimes", "notebooklm-mcp-cli", "venv", "bin", "nlm");
    await fs.mkdir(path.dirname(binPath), { recursive: true });
    await fs.writeFile(binPath, "", "utf8");
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    execFileMock
      .mockImplementationOnce((command, args, _options, callback) => {
        expect(command).toBe(binPath);
        expect(args).toEqual(["login", "--check"]);
        callback(null, "✓ Authentication valid!\n  Profile: default\n  Notebooks found: 1");
      })
      .mockImplementationOnce((command, args, _options, callback) => {
        expect(command).toBe(binPath);
        expect(args).toEqual(["source", "delete", "source-managed-1", "--confirm"]);
        callback(null, "✓ Deleted source: source-managed-1\n");
      });

    const result = await deleteNotebookLmExperienceNoteViaCli({
      config: {
        enabled: true,
        auth: {
          profile: "default",
          cookieFile: "",
          statusTtlMs: 60_000,
          degradedCooldownMs: 120_000,
          refreshCooldownMs: 180_000,
          heartbeat: { enabled: true, minIntervalMs: 1_000, maxIntervalMs: 2_000 },
        },
        cli: {
          enabled: true,
          command: "",
          args: [
            "notebook",
            "query",
            "{notebookId}",
            "{query}",
            "--json",
            "--profile",
            "{profile}",
          ],
          timeoutMs: 1000,
          limit: 5,
          notebookId: "nb-managed",
        },
        write: {
          command: "",
          args: ["{payloadFile}"],
          timeoutMs: 1000,
          notebookId: "nb-managed",
        },
      },
      notebookId: "nb-managed",
      noteId: "source-managed-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        action: "delete",
        noteId: "source-managed-1",
        notebookId: "nb-managed",
      }),
    );
  });

  it("throws a clear error when the provider is not ready", async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(
        null,
        JSON.stringify({
          status: "missing",
          ready: false,
          reason: "auth_expired",
          profile: "default",
          refreshAttempted: true,
          refreshSucceeded: false,
          error: "Authentication expired",
        }),
      );
    });

    const logger = { warn: vi.fn() };
    await expect(() =>
      writeNotebookLmExperienceNoteViaCli({
        config: {
          enabled: true,
          auth: {
            profile: "default",
            cookieFile: "",
            statusTtlMs: 60_000,
            degradedCooldownMs: 120_000,
            refreshCooldownMs: 180_000,
            heartbeat: { enabled: true, minIntervalMs: 1_000, maxIntervalMs: 2_000 },
          },
          cli: {
            enabled: true,
            command: "python",
            args: ["query.py"],
            timeoutMs: 1000,
            limit: 5,
            notebookId: "nb-42",
          },
          write: {
            command: "python",
            args: ["writer.py", "{payloadFile}", "{notebookId}"],
            timeoutMs: 1000,
            notebookId: "nb-42",
          },
        },
        note: {
          type: "decision",
          title: "经验召回改用 NotebookLM 的原因",
          summary: "前台经验召回改用 NotebookLM，可以减少宿主维护的重型召回逻辑。",
        },
        logger,
      }),
    ).rejects.toThrow(/provider not ready: auth_expired/);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("provider not ready: auth_expired"),
    );
  });

  it("writes a prompt-journal experience event when enabled", async () => {
    const logFile = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-memory-prompt-journal-")),
      "journal.jsonl",
    );
    process.env.CRAWCLAW_MEMORY_PROMPT_JOURNAL = "1";
    process.env.CRAWCLAW_MEMORY_PROMPT_JOURNAL_FILE = logFile;

    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            status: "ok",
            ready: true,
            profile: "default",
            notebookId: "nb-42",
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
            noteId: "note-99",
            title: "MiniMax 工具挂载调试流程",
            notebookId: "nb-42",
          }),
        );
      });

    await writeNotebookLmExperienceNoteViaCli({
      config: {
        enabled: true,
        auth: {
          profile: "default",
          cookieFile: "",
          statusTtlMs: 60_000,
          degradedCooldownMs: 120_000,
          refreshCooldownMs: 180_000,
          heartbeat: { enabled: true, minIntervalMs: 1_000, maxIntervalMs: 2_000 },
        },
        cli: {
          enabled: true,
          command: "python",
          args: ["query"],
          timeoutMs: 1000,
          limit: 5,
          notebookId: "nb-42",
        },
        write: {
          command: "python",
          args: ["writer.py", "{payloadFile}", "{notebookId}"],
          timeoutMs: 1000,
          notebookId: "nb-42",
        },
      },
      note: {
        type: "procedure",
        title: "MiniMax 工具挂载调试流程",
        summary:
          "当工具没有出现在请求 payload 里时，先检查 session tool inventory、payload.tools 和 channel 解析。",
        context: "工具挂载调试时，请求 payload 没有带上预期工具。",
        action: "先检查 session tool inventory，再检查 payload.tools 和 channel 解析。",
        lesson: "工具缺失问题要先看实际 payload，再判断注册路径。",
      },
      notificationScope: {
        agentId: "main",
        channel: "smoke",
        userId: "memory-journal-user",
      },
    });

    await expect.poll(async () => (await fs.readFile(logFile, "utf8")).trim()).not.toBe("");
    const lines = (await fs.readFile(logFile, "utf8")).trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    const event = JSON.parse(lines.at(-1) ?? "{}");
    expect(event.stage).toBe("experience_write");
    expect(event.agentId).toBe("main");
    expect(event.channel).toBe("smoke");
    expect(event.userId).toBe("memory-journal-user");
    expect(event.payload.status).toBe("ok");
    expect(event.payload.noteId).toBe("note-99");
  });
});
