import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  markExperienceIndexEntrySyncFailed,
  markExperienceIndexEntrySynced,
  pruneExperienceIndexEntries,
  readExperienceIndexEntries,
  readPendingExperienceIndexEntries,
  updateExperienceIndexEntryStatus,
  upsertExperienceIndexEntry,
  upsertExperienceIndexEntryFromNote,
} from "./index-store.js";

const previousStateDir = process.env.CRAWCLAW_STATE_DIR;
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  if (previousStateDir === undefined) {
    delete process.env.CRAWCLAW_STATE_DIR;
  } else {
    process.env.CRAWCLAW_STATE_DIR = previousStateDir;
  }
});

async function useTempStateDir(): Promise<string> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-experience-index-"));
  tempDirs.push(stateDir);
  process.env.CRAWCLAW_STATE_DIR = stateDir;
  return stateDir;
}

describe("experience local index", () => {
  it("tracks NotebookLM sync state separately from lifecycle state", async () => {
    await useTempStateDir();
    const entry = await upsertExperienceIndexEntryFromNote({
      note: {
        type: "procedure",
        title: "待同步经验",
        summary: "NotebookLM 暂不可用时，本地只作为同步队列。",
        context: "NotebookLM 登录态过期。",
        action: "先落本地，等待恢复后同步。",
        lesson: "本地状态不能被当作 prompt recall 来源。",
        dedupeKey: "pending-sync-experience",
      },
      notebookId: "local",
      syncStatus: "pending_sync",
      syncError: "auth_expired",
      updatedAt: 1_000,
    });

    expect(entry).toMatchObject({
      id: "experience-index:pending-sync-experience",
      status: "active",
      syncStatus: "pending_sync",
      syncAttempts: 0,
      lastSyncAttemptAt: null,
      lastSyncError: "auth_expired",
    });

    expect((await readPendingExperienceIndexEntries(10)).map((item) => item.id)).toEqual([
      "experience-index:pending-sync-experience",
    ]);

    await markExperienceIndexEntrySyncFailed({
      id: entry.id,
      error: "notebook unreachable",
      attemptedAt: 2_000,
    });
    expect(await readPendingExperienceIndexEntries(10)).toEqual([
      expect.objectContaining({
        id: entry.id,
        syncStatus: "failed",
        syncAttempts: 1,
        lastSyncAttemptAt: 2_000,
        lastSyncError: "notebook unreachable",
      }),
    ]);

    await markExperienceIndexEntrySynced({
      id: entry.id,
      noteId: "note-synced",
      notebookId: "experience-notebook",
      attemptedAt: 3_000,
    });

    expect(await readPendingExperienceIndexEntries(10)).toEqual([]);
    expect(await readExperienceIndexEntries(10)).toEqual([
      expect.objectContaining({
        id: entry.id,
        syncStatus: "synced",
        syncAttempts: 2,
        lastSyncAttemptAt: 3_000,
        lastSyncError: null,
        noteId: "note-synced",
        notebookId: "experience-notebook",
      }),
    ]);
  });

  it("maps failure and workflow experience into index layers", async () => {
    await useTempStateDir();
    await upsertExperienceIndexEntry({
      note: {
        type: "failure_pattern",
        title: "工具缺失失败经验",
        summary: "请求 payload 没有工具时，先检查实际 payload 再检查注册路径。",
        context: "工具调用失败且模型看不到预期工具。",
        trigger: "payload.tools 为空或缺少目标工具。",
        action: "先读取实际 payload，再定位工具注册和 channel 解析。",
        lesson: "工具缺失不能只看注册代码，必须先看运行时 payload。",
        evidence: ["实际 payload 能直接证明工具是否注入。"],
        dedupeKey: "missing-tool-payload",
      },
      writeResult: {
        status: "ok",
        action: "upsert",
        noteId: "note-failure",
        title: "工具缺失失败经验",
        notebookId: "experience-notebook",
        payloadFile: "/tmp/payload.json",
      },
      updatedAt: 1_000,
    });
    await upsertExperienceIndexEntry({
      note: {
        type: "workflow_pattern",
        title: "发布排查协作经验",
        summary: "用户要求继续时，沿着下一个具体 blocker 推进，而不是停在总结。",
        context: "发布或 CI 排查连续暴露多个 blocker。",
        action: "每解决一个 blocker 后继续检查下一个失败点。",
        lesson: "这种场景要持续推进到真实阻塞点清空。",
        dedupeKey: "release-debug-workflow",
      },
      writeResult: {
        status: "ok",
        action: "upsert",
        noteId: "note-workflow",
        title: "发布排查协作经验",
        notebookId: "experience-notebook",
        payloadFile: "/tmp/payload.json",
      },
      updatedAt: 2_000,
    });

    const entries = await readExperienceIndexEntries(10);
    const failureEntry = entries.find(
      (entry) => entry.id === "experience-index:missing-tool-payload",
    );
    const workflowEntry = entries.find(
      (entry) => entry.id === "experience-index:release-debug-workflow",
    );
    expect(failureEntry).toMatchObject({
      id: "experience-index:missing-tool-payload",
      layer: "runtime_signals",
      memoryKind: "runtime_pattern",
    });
    expect(workflowEntry).toMatchObject({
      id: "experience-index:release-debug-workflow",
      layer: "sop",
      memoryKind: "procedure",
    });
  });

  it("filters archived and superseded experience out of recallable index reads", async () => {
    await useTempStateDir();
    await upsertExperienceIndexEntry({
      note: {
        type: "procedure",
        title: "当前网关恢复流程",
        summary: "网关异常时，先检查 health，再重启服务并复测。",
        context: "适用于当前网关恢复。",
        steps: ["检查 health", "重启服务", "复测 health"],
        dedupeKey: "gateway-recovery-current",
      },
      writeResult: {
        status: "ok",
        action: "upsert",
        noteId: "note-current",
        title: "当前网关恢复流程",
        notebookId: "experience-notebook",
        payloadFile: "/tmp/payload.json",
      },
      updatedAt: 3_000,
    });
    await upsertExperienceIndexEntry({
      note: {
        type: "procedure",
        title: "旧网关恢复流程",
        summary: "旧流程要求直接重启服务。",
        context: "旧版本网关恢复。",
        steps: ["直接重启服务"],
        dedupeKey: "gateway-recovery-old",
      },
      writeResult: {
        status: "ok",
        action: "upsert",
        noteId: "note-old",
        title: "旧网关恢复流程",
        notebookId: "experience-notebook",
        payloadFile: "/tmp/payload.json",
      },
      updatedAt: 2_000,
    });
    await upsertExperienceIndexEntry({
      note: {
        type: "procedure",
        title: "废弃网关恢复流程",
        summary: "废弃流程依赖不存在的启动命令。",
        context: "废弃版本。",
        steps: ["运行旧启动命令"],
        dedupeKey: "gateway-recovery-archived",
      },
      writeResult: {
        status: "ok",
        action: "upsert",
        noteId: "note-archived",
        title: "废弃网关恢复流程",
        notebookId: "experience-notebook",
        payloadFile: "/tmp/payload.json",
      },
      updatedAt: 1_000,
    });

    await updateExperienceIndexEntryStatus({
      id: "experience-index:gateway-recovery-old",
      status: "superseded",
      supersededBy: "experience-index:gateway-recovery-current",
      updatedAt: 4_000,
    });
    await updateExperienceIndexEntryStatus({
      id: "experience-index:gateway-recovery-archived",
      status: "archived",
      updatedAt: 5_000,
    });

    const recallableEntries = await readExperienceIndexEntries(10, { recallableOnly: true });
    expect(recallableEntries.map((item) => item.id)).toEqual([
      "experience-index:gateway-recovery-current",
    ]);

    const archivedEntries = await readExperienceIndexEntries(10, { status: "archived" });
    expect(archivedEntries).toEqual([
      expect.objectContaining({
        id: "experience-index:gateway-recovery-archived",
        status: "archived",
        archivedAt: 5_000,
      }),
    ]);
  });

  it("prunes experience index entries through stale and archived lifecycle states", async () => {
    await useTempStateDir();
    for (const [dedupeKey, title, updatedAt] of [
      ["gateway-current", "当前网关经验", 1_500],
      ["gateway-old-active", "旧 active 网关经验", 500],
      ["gateway-old-stale", "旧 stale 网关经验", 100],
    ] as const) {
      await upsertExperienceIndexEntry({
        note: {
          type: "procedure",
          title,
          summary: `${title} 的恢复流程。`,
          context: "网关恢复。",
          steps: ["检查 health", "重启服务"],
          dedupeKey,
        },
        writeResult: {
          status: "ok",
          action: "upsert",
          noteId: `note-${dedupeKey}`,
          title,
          notebookId: "experience-notebook",
          payloadFile: "/tmp/payload.json",
        },
        updatedAt,
      });
    }
    await updateExperienceIndexEntryStatus({
      id: "experience-index:gateway-old-stale",
      status: "stale",
      updatedAt: 100,
    });

    const result = await pruneExperienceIndexEntries({
      now: 2_000,
      staleAfterMs: 1_000,
      archiveAfterMs: 1_500,
    });

    expect(result).toMatchObject({
      staleIds: ["experience-index:gateway-old-active"],
      archivedIds: ["experience-index:gateway-old-stale"],
      retainedIds: ["experience-index:gateway-current"],
    });
    expect(
      (await readExperienceIndexEntries(10, { status: "stale" })).map((entry) => entry.id),
    ).toEqual(["experience-index:gateway-old-active"]);
    expect(
      (await readExperienceIndexEntries(10, { status: "archived" })).map((entry) => entry.id),
    ).toEqual(["experience-index:gateway-old-stale"]);
  });

  it("serializes concurrent experience index lifecycle mutations", async () => {
    await useTempStateDir();
    for (const [dedupeKey, title] of [
      ["concurrent-archive", "并发归档经验"],
      ["concurrent-supersede", "并发替换经验"],
    ] as const) {
      await upsertExperienceIndexEntry({
        note: {
          type: "procedure",
          title,
          summary: `${title} 的状态写入流程。`,
          context: "多个 lifecycle 操作同时触发。",
          steps: ["串行化读取和写回 index 文件"],
          dedupeKey,
        },
        writeResult: {
          status: "ok",
          action: "upsert",
          noteId: `note-${dedupeKey}`,
          title,
          notebookId: "experience-notebook",
          payloadFile: "/tmp/payload.json",
        },
        updatedAt: 100,
      });
    }

    await Promise.all([
      updateExperienceIndexEntryStatus({
        id: "experience-index:concurrent-archive",
        status: "archived",
        updatedAt: 2_000,
      }),
      pruneExperienceIndexEntries({
        now: 2_000,
        staleAfterMs: 1_000,
        archiveAfterMs: 1_500,
      }),
      updateExperienceIndexEntryStatus({
        id: "experience-index:concurrent-supersede",
        status: "superseded",
        supersededBy: "experience-index:concurrent-archive",
        updatedAt: 3_000,
      }),
    ]);

    const entries = await readExperienceIndexEntries(10);
    expect(
      entries.map((entry) => ({
        id: entry.id,
        status: entry.status,
        supersededBy: entry.supersededBy,
      })),
    ).toEqual([
      {
        id: "experience-index:concurrent-supersede",
        status: "superseded",
        supersededBy: "experience-index:concurrent-archive",
      },
      {
        id: "experience-index:concurrent-archive",
        status: "archived",
        supersededBy: null,
      },
    ]);
  });
});
