import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

describe("searchNotebookLmViaCli", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("normalizes list-style NotebookLM CLI results", async () => {
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            status: "ok",
            ready: true,
            profile: "default",
            notebookId: "nb-1",
            refreshAttempted: false,
            refreshSucceeded: false,
          }),
        );
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            results: [
              {
                id: "src-1",
                title: "Gateway restart troubleshooting",
                summary: "Use this when the gateway returns 1006.",
                content: "Restart the service and verify the installed path.",
                score: 0.88,
                url: "https://example.com/notebooklm/gateway",
                tags: ["procedure"],
              },
            ],
          }),
        );
      });

    const { searchNotebookLmViaCli } = await import("./notebooklm-cli.ts");
    const items = await searchNotebookLmViaCli({
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
          args: ["/tmp/notebooklm-cli-recall.py", "{query}", "{limit}", "{notebookId}"],
          timeoutMs: 1000,
          limit: 5,
          notebookId: "nb-1",
          queryInstruction: "请使用简体中文，只返回直接相关的经验卡片。",
        },
        write: {
          enabled: false,
          command: "",
          args: ["{payloadFile}"],
          timeoutMs: 1000,
          notebookId: "",
        },
      },
      query: "how do I restart the gateway safely?",
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "notebooklm:src-1",
      source: "notebooklm",
      title: "Gateway restart troubleshooting",
      memoryKind: "procedure",
      sourceRef: "https://example.com/notebooklm/gateway",
    });
    const queryCall = execFileMock.mock.calls[1];
    expect(queryCall?.[1]?.[1]).toContain("请使用简体中文");
    expect(queryCall?.[1]?.[1]).toContain("当前问题：how do I restart the gateway safely?");
  });

  it("normalizes answer-style NotebookLM CLI results", async () => {
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            status: "ok",
            ready: true,
            profile: "default",
            notebookId: "nb-2",
            refreshAttempted: false,
            refreshSucceeded: false,
          }),
        );
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            answer:
              "**操作建议** 先重启本地服务并重新检查健康状态。[1-3] 如果健康检查仍失败，再确认安装路径是否正确。[4] 最后重新验证连接是否恢复。[5]",
            title: "NotebookLM answer",
            source: "gateway-notebook",
          }),
        );
      });

    const { searchNotebookLmViaCli } = await import("./notebooklm-cli.ts");
    const items = await searchNotebookLmViaCli({
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
          args: ["/tmp/notebooklm-cli-recall.py", "{query}", "{limit}", "{notebookId}"],
          timeoutMs: 1000,
          limit: 3,
          notebookId: "nb-2",
          queryInstruction: "请使用简体中文，只保留直接相关内容。",
        },
        write: {
          enabled: false,
          command: "",
          args: ["{payloadFile}"],
          timeoutMs: 1000,
          notebookId: "",
        },
      },
      query: "what is the gateway recovery flow?",
    });

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("notebooklm");
    expect(items[0].summary).toContain("操作建议");
    expect(items[0].summary).toContain("先重启本地服务并重新检查健康状态。");
    expect(items[0].summary).not.toContain("[1-3]");
    expect(items[0].summary).not.toContain("**");
  });

  it("returns no items when provider is not ready", async () => {
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
    const { searchNotebookLmViaCli } = await import("./notebooklm-cli.ts");
    const items = await searchNotebookLmViaCli({
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
          command: "nlm",
          args: ["status-wrapper"],
          timeoutMs: 1000,
          limit: 3,
          notebookId: "nb-3",
        },
        write: {
          enabled: false,
          command: "",
          args: ["{payloadFile}"],
          timeoutMs: 1000,
          notebookId: "",
        },
      },
      query: "gateway",
      logger,
    });

    expect(items).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("reason=auth_expired"));
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("splits notebooklm answer cards into multiple recall items", async () => {
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            status: "ok",
            ready: true,
            profile: "default",
            notebookId: "nb-4",
            refreshAttempted: false,
            refreshSucceeded: false,
          }),
        );
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            answer:
              "经验卡片一：区号治理 213 是电话资源治理的经典案例。加州监管报告发现大量号码闲置。经验卡片二：文化象征 213 也是西海岸嘻哈文化的重要符号，同时带有灵性数字含义。",
            title: "NotebookLM answer",
            source: "213-notebook",
          }),
        );
      });

    const { searchNotebookLmViaCli } = await import("./notebooklm-cli.ts");
    const items = await searchNotebookLmViaCli({
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
          args: ["/tmp/notebooklm-cli-recall.py", "{query}", "{limit}", "{notebookId}"],
          timeoutMs: 1000,
          limit: 5,
          notebookId: "nb-4",
          queryInstruction: "请只返回简短经验卡片。",
        },
        write: {
          enabled: false,
          command: "",
          args: ["{payloadFile}"],
          timeoutMs: 1000,
          notebookId: "",
        },
      },
      query: "213 的主要结论是什么？",
    });

    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("经验卡片一：区号治理");
    expect(items[0]?.summary).toContain("213 是电话资源治理的经典案例。");
    expect(items[1]?.title).toBe("经验卡片二：文化象征");
    expect(items[1]?.summary).toContain("213 也是西海岸嘻哈文化的重要符号");
  });
});
