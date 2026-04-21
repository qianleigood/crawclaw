import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchKnowledgeIndexEntries, upsertKnowledgeIndexEntry } from "./index-store.js";

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
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-knowledge-index-"));
  tempDirs.push(stateDir);
  process.env.CRAWCLAW_STATE_DIR = stateDir;
  return stateDir;
}

describe("knowledge local index", () => {
  it("recalls a written SOP note from the baseline index", async () => {
    await useTempStateDir();
    await upsertKnowledgeIndexEntry({
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
        notebookId: "knowledge-notebook",
        payloadFile: "/tmp/payload.json",
      },
      updatedAt: 1_000,
    });

    const items = await searchKnowledgeIndexEntries({
      query: "本地网关挂了怎么恢复？给我操作流程",
      limit: 5,
      targetLayers: ["sop", "sources"],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "knowledge-index:gateway-recovery-procedure",
      source: "local_knowledge_index",
      title: "本地网关恢复流程",
      layer: "sop",
      memoryKind: "procedure",
      sourceRef: "note-gateway",
      metadata: expect.objectContaining({
        indexSource: "local_knowledge_index",
      }),
    });
  });
});
