import { describe, expect, it, vi } from "vitest";
import { createContextArchiveRunCapture } from "./run-capture.js";
import type { ContextArchiveService } from "./service.js";

describe("context archive run capture", () => {
  it("reuses one run per source and run id while appending events", async () => {
    const createRun = vi.fn().mockResolvedValue({ id: "carun-task-1" });
    const appendEvent = vi.fn().mockResolvedValue({ id: "caevt-1" });
    const updateRun = vi.fn().mockResolvedValue({ id: "carun-task-1" });
    const capture = createContextArchiveRunCapture({
      archive: {
        createRun,
        appendEvent,
        updateRun,
      } satisfies Pick<ContextArchiveService, "createRun" | "appendEvent" | "updateRun">,
    });

    await capture.appendEvent({
      source: "tool-execution",
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "agent:main:session-1",
      taskId: "task-1",
      agentId: "main",
      type: "tool.guard_admission",
      payload: { decision: "allow" },
    });
    await capture.appendEvent({
      source: "tool-execution",
      runId: "run-1",
      sessionId: "session-1",
      taskId: "task-1",
      agentId: "main",
      type: "tool.result",
      payload: { ok: true },
    });
    await capture.updateRunState({
      source: "tool-execution",
      runId: "run-1",
      sessionId: "session-1",
      taskId: "task-1",
      agentId: "main",
      status: "complete",
      summary: { events: 2 },
    });

    expect(createRun).toHaveBeenCalledTimes(1);
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        taskId: "task-1",
        agentId: "main",
        kind: "task",
        label: "tool-execution",
        metadata: expect.objectContaining({
          source: "tool-execution",
          runId: "run-1",
        }),
      }),
    );
    expect(appendEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        runId: "carun-task-1",
        type: "tool.guard_admission",
        payload: { decision: "allow" },
      }),
    );
    expect(appendEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        runId: "carun-task-1",
        type: "tool.result",
        payload: { ok: true },
      }),
    );
    expect(updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "carun-task-1",
        status: "complete",
        summary: { events: 2 },
      }),
    );
  });
});
