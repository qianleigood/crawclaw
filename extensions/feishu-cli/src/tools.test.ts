import { describe, expect, it, vi } from "vitest";

const runFeishuCliUserCommandMock = vi.hoisted(() => vi.fn());

vi.mock("./lark-cli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lark-cli.js")>();
  return {
    ...actual,
    runFeishuCliUserCommand: runFeishuCliUserCommandMock,
  };
});

import {
  createFeishuUserCalendarTool,
  createFeishuUserMessagesTool,
  createFeishuUserTaskTool,
} from "./tools.js";

const config = {
  enabled: true,
  command: "lark-cli",
  timeoutMs: 30_000,
} as const;

describe("feishu-cli user tools", () => {
  it("builds calendar agenda args with user identity", async () => {
    runFeishuCliUserCommandMock.mockResolvedValueOnce({ items: [] });
    const tool = createFeishuUserCalendarTool(config);

    await tool.execute?.("call_1", {
      calendar_id: "primary",
      start: "2026-04-10T00:00:00+08:00",
    });

    expect(runFeishuCliUserCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "calendar",
          "+agenda",
          "--as",
          "user",
          "--format",
          "json",
          "--calendar-id",
          "primary",
          "--start",
          "2026-04-10T00:00:00+08:00",
        ],
      }),
    );
  });

  it("requires summary for task creation", async () => {
    const tool = createFeishuUserTaskTool(config);

    await expect(tool.execute?.("call_1", { action: "create" })).rejects.toThrow(
      /summary required/i,
    );
  });

  it("builds message search args with query", async () => {
    runFeishuCliUserCommandMock.mockResolvedValueOnce({ items: [] });
    const tool = createFeishuUserMessagesTool(config);

    await tool.execute?.("call_1", {
      query: "roadmap",
      chat_type: "group",
      is_at_me: true,
    });

    expect(runFeishuCliUserCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "im",
          "+messages-search",
          "--as",
          "user",
          "--format",
          "json",
          "--query",
          "roadmap",
          "--chat-type",
          "group",
          "--is-at-me",
        ],
      }),
    );
  });
});
