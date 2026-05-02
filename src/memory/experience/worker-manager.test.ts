import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAgentUserMessage } from "../../agents/test-helpers/agent-message-fixtures.js";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type {
  AppendMessageInput,
  GmMessageRow,
  UpdateMaintenanceRunInput,
} from "../types/runtime.ts";

describe("ExperienceExtractionWorkerManager", () => {
  const previousStateDir = process.env.CRAWCLAW_STATE_DIR;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { __testing } = await import("./worker-manager.ts");
    await __testing.resetSharedExperienceExtractionWorkerManager();
    if (previousStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = previousStateDir;
    }
  });

  async function createStateDir(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-experience-worker-"));
  }

  type MockRuntimeStore = Pick<
    RuntimeStore,
    "appendMessage" | "createMaintenanceRun" | "updateMaintenanceRun" | "listMessagesByTurnRange"
  > & {
    maintenanceUpdates: UpdateMaintenanceRunInput[];
  };

  function createRuntimeStore(): MockRuntimeStore {
    let nextMessageId = 0;
    const messageRows: GmMessageRow[] = [];
    const maintenanceUpdates: UpdateMaintenanceRunInput[] = [];
    return {
      maintenanceUpdates,
      appendMessage: vi.fn().mockImplementation(async (input: AppendMessageInput) => {
        const contentText = input.contentText ?? input.content;
        messageRows.push({
          id: `msg-${++nextMessageId}`,
          sessionId: input.sessionId,
          conversationUid: input.conversationUid,
          role: input.role,
          content: input.content,
          contentText,
          contentBlocks: input.contentBlocks ?? [{ type: "text", text: contentText }],
          hasMedia: input.hasMedia ?? false,
          primaryMediaId: input.primaryMediaId ?? null,
          runtimeMeta: input.runtimeMeta ?? null,
          runtimeShape: input.runtimeShape ?? null,
          turnIndex: input.turnIndex,
          extracted: false,
          createdAt: input.createdAt ?? Date.now(),
        });
      }),
      createMaintenanceRun: vi.fn().mockResolvedValue("mrun-experience-1"),
      updateMaintenanceRun: vi.fn().mockImplementation(async (input: UpdateMaintenanceRunInput) => {
        maintenanceUpdates.push(input);
      }),
      listMessagesByTurnRange: vi
        .fn()
        .mockImplementation(async (sessionId: string, startTurn: number, endTurn: number) =>
          messageRows
            .filter(
              (row) =>
                row.sessionId === sessionId &&
                row.turnIndex >= startTurn &&
                row.turnIndex <= endTurn,
            )
            .toSorted((left, right) => left.turnIndex - right.turnIndex),
        ),
    };
  }

  async function appendMessage(
    runtimeStore: MockRuntimeStore,
    input: Omit<AppendMessageInput, "conversationUid">,
  ): Promise<void> {
    await runtimeStore.appendMessage({
      conversationUid: input.sessionId,
      ...input,
    });
  }

  it("passes multiple foreground experience writes as constraints after delayed stop", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const runtimeStore = createRuntimeStore();
    const runner = vi.fn().mockResolvedValue({
      status: "no_change",
      summary: "no duplicate write",
      writtenCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      touchedNotes: [],
      advanceCursor: true,
    });

    const { getSharedExperienceExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedExperienceExtractionWorkerManager({
      config: {
        enabled: true,
        recentMessageLimit: 3,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 1,
        workerIdleTtlMs: 60_000,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await appendMessage(runtimeStore, {
      sessionId: "session-experience-delayed",
      role: "user",
      content: "A 是已验证经验。",
      turnIndex: 1,
    });
    await appendMessage(runtimeStore, {
      sessionId: "session-experience-delayed",
      role: "toolResult",
      content: JSON.stringify({
        status: "ok",
        action: "upsert",
        noteId: "note-a",
        title: "经验 A",
        type: "workflow_pattern",
        dedupeKey: "experience-a",
        summary: "A 已由主 Agent 写入。",
      }),
      runtimeShape: {
        toolCallId: "toolcall-a",
        toolName: "write_experience_note",
        isError: false,
      },
      turnIndex: 2,
    });
    await appendMessage(runtimeStore, {
      sessionId: "session-experience-delayed",
      role: "user",
      content: "几轮后又验证出 B 是另一条经验。",
      turnIndex: 3,
    });
    await appendMessage(runtimeStore, {
      sessionId: "session-experience-delayed",
      role: "toolResult",
      content: JSON.stringify({
        status: "ok",
        action: "upsert",
        noteId: "note-b",
        title: "经验 B",
        type: "failure_pattern",
        dedupeKey: "experience-b",
        summary: "B 也已由主 Agent 写入。",
      }),
      runtimeShape: {
        toolCallId: "toolcall-b",
        toolName: "write_experience_note",
        isError: false,
      },
      turnIndex: 5,
    });
    await appendMessage(runtimeStore, {
      sessionId: "session-experience-delayed",
      role: "user",
      content: "stop 延迟到这一轮才发生，后台仍要判断是否有其他经验。",
      turnIndex: 6,
    });

    manager.submitTurn({
      sessionId: "session-experience-delayed",
      sessionKey: "agent:main:feishu:direct:user-1",
      newMessages: [
        makeAgentUserMessage({
          content: "stop 延迟到这一轮才发生，后台仍要判断是否有其他经验。",
        }),
      ] as never,
      messageCursor: 6,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });

    await manager.drainAll();

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0]).toMatchObject({
      foregroundExperienceWrites: [
        {
          cursor: 2,
          action: "upsert",
          toolCallId: "toolcall-a",
          noteId: "note-a",
          title: "经验 A",
          type: "workflow_pattern",
          dedupeKey: "experience-a",
        },
        {
          cursor: 5,
          action: "upsert",
          toolCallId: "toolcall-b",
          noteId: "note-b",
          title: "经验 B",
          type: "failure_pattern",
          dedupeKey: "experience-b",
        },
      ],
    });
    expect(runtimeStore.maintenanceUpdates).toHaveLength(1);
    const metrics = JSON.parse(runtimeStore.maintenanceUpdates[0]?.metricsJson ?? "{}") as {
      foregroundWriteCount?: number;
    };
    expect(metrics.foregroundWriteCount).toBe(2);
  });
});
