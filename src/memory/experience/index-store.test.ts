import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchExperienceIndexEntries, upsertExperienceIndexEntry } from "./index-store.js";

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
  it("recalls a written SOP note from the baseline index", async () => {
    await useTempStateDir();
    await upsertExperienceIndexEntry({
      note: {
        type: "procedure",
        title: "本地网关恢复流程",
        summary: "网关关闭或 health 失败时，按端口检查、重启服务、重新验证的顺序恢复。",
        body: "适用于本地网关异常关闭。",
        steps: ["检查 18789 端口", "重启 CrawClaw 网关", "重新运行 health probe"],
        validation: ["health probe 返回 ok:true"],
        dedupeKey: "gateway-recovery-procedure",
        tags: ["网关", "恢复"],
      },
      writeResult: {
        status: "ok",
        action: "upsert",
        noteId: "note-gateway",
        title: "本地网关恢复流程",
        notebookId: "experience-notebook",
        payloadFile: "/tmp/payload.json",
      },
      updatedAt: 1_000,
    });

    const items = await searchExperienceIndexEntries({
      query: "本地网关挂了怎么恢复？给我操作流程",
      limit: 5,
      targetLayers: ["sop", "sources"],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "experience-index:gateway-recovery-procedure",
      source: "local_experience_index",
      title: "本地网关恢复流程",
      layer: "sop",
      memoryKind: "procedure",
      sourceRef: "note-gateway",
      metadata: expect.objectContaining({
        indexSource: "local_experience_index",
      }),
    });
  });

  it("maps failure and workflow experience into recallable layers", async () => {
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

    const failureItems = await searchExperienceIndexEntries({
      query: "工具没有出现在 payload 里怎么查",
      limit: 5,
      targetLayers: ["runtime_signals"],
    });
    expect(failureItems[0]).toMatchObject({
      id: "experience-index:missing-tool-payload",
      layer: "runtime_signals",
      memoryKind: "runtime_pattern",
    });

    const workflowItems = await searchExperienceIndexEntries({
      query: "发布排查继续看下一个 blocker",
      limit: 5,
      targetLayers: ["sop"],
    });
    expect(workflowItems[0]).toMatchObject({
      id: "experience-index:release-debug-workflow",
      layer: "sop",
      memoryKind: "procedure",
    });
  });
});
