import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import type { ContextArchiveService } from "./service.js";
import {
  captureModelVisibleContextToService,
  createContextArchiveTurnCapture,
} from "./turn-capture.js";
import type { ModelVisibleContextCaptureInput } from "./turn-capture.js";

describe("context archive turn capture", () => {
  it("creates one session run and appends model-visible events to it", async () => {
    const createRun = vi.fn().mockResolvedValue({ id: "carun-1" });
    const appendEvent = vi.fn().mockResolvedValue({ id: "caevt-1" });
    const capture = createContextArchiveTurnCapture({
      archive: {
        createRun,
        appendEvent,
      } satisfies Pick<ContextArchiveService, "createRun" | "appendEvent">,
    });

    await capture.captureModelVisibleContext({
      sessionId: "session-1",
      sessionKey: "agent:main:session-1",
      agentId: "main",
      turnIndex: 3,
      payload: { prompt: "hello" },
    });
    await capture.captureModelVisibleContext({
      sessionId: "session-1",
      payload: { prompt: "hello again" },
    });

    expect(createRun).toHaveBeenCalledTimes(1);
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        sessionKey: "agent:main:session-1",
        agentId: "main",
        kind: "session",
        label: "memory-context-assembly",
      }),
    );
    expect(appendEvent).toHaveBeenCalledTimes(2);
    expect(appendEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        runId: "carun-1",
        type: "turn.model_visible_context",
        turnIndex: 3,
        payload: { prompt: "hello" },
      }),
    );
    expect(appendEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        runId: "carun-1",
        type: "turn.model_visible_context",
        payload: { prompt: "hello again" },
      }),
    );
  });

  it("captures a full model-visible snapshot into a service-backed turn run", async () => {
    const createRun = vi.fn().mockResolvedValue({ id: "carun-2" });
    const putBlob = vi.fn().mockResolvedValue({ blobKey: "tools.schema" });
    const appendEvent = vi.fn().mockResolvedValue({ id: "caevt-2" });
    const updateRun = vi.fn().mockResolvedValue({ id: "carun-2" });
    const input: ModelVisibleContextCaptureInput = {
      runId: "run-1",
      sessionId: "session-2",
      sessionKey: "agent:main:session-2",
      agentId: "main",
      prompt: "verify the login flow",
      systemPrompt: "You are CrawClaw.",
      systemContextSections: [
        {
          id: "memory:session",
          role: "system_context",
          content: "## Session memory",
        },
      ],
      messages: [
        {
          role: "user",
          content: "verify the login flow",
          timestamp: Date.now(),
        },
      ] as unknown as ModelVisibleContextCaptureInput["messages"],
      tools: [
        {
          name: "read",
          description: "Read files",
          parameters: Type.Object({
            path: Type.String(),
          }),
        },
      ] as unknown as ModelVisibleContextCaptureInput["tools"],
      provider: "openai",
      model: "gpt-5.4",
    };

    const runId = await captureModelVisibleContextToService(
      {
        createRun,
        putBlob,
        appendEvent,
        updateRun,
      } as unknown as ContextArchiveService,
      input,
    );

    expect(runId).toBe("carun-2");
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-2",
        kind: "turn",
      }),
    );
    expect(putBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "carun-2",
        blobKey: "tools.schema",
        blobKind: "tool-schema-snapshot",
      }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "carun-2",
        type: "turn.model_visible_context",
        payload: expect.objectContaining({
          runId: "run-1",
          provider: "openai",
          model: "gpt-5.4",
          prompt: "verify the login flow",
          systemPrompt: "You are CrawClaw.",
          toolSchemaBlobKey: "tools.schema",
        }),
      }),
    );
    expect(updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "carun-2",
        status: "complete",
      }),
    );
  });
});
