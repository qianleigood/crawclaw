import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();
const tempRoots: string[] = [];
const originalStateDir = process.env.CRAWCLAW_STATE_DIR;

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

function makeManagedNlmBin(): string {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-notebooklm-cli-"));
  tempRoots.push(stateDir);
  const binPath =
    process.platform === "win32"
      ? path.join(stateDir, "runtimes", "notebooklm-mcp-cli", "venv", "Scripts", "nlm.exe")
      : path.join(stateDir, "runtimes", "notebooklm-mcp-cli", "venv", "bin", "nlm");
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(binPath, "", "utf8");
  process.env.CRAWCLAW_STATE_DIR = stateDir;
  return binPath;
}

function createNotebookLmConfig() {
  return {
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
      command: "",
      args: ["{payloadFile}"],
      timeoutMs: 1000,
      notebookId: "",
    },
  };
}

describe("searchNotebookLmViaCli", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
    if (originalStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = originalStateDir;
    }
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

  it("normalizes native nlm value-wrapped query responses", async () => {
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
            value: {
              answer: "源里包含发布回归排查三步法和自进化晋升 workflow。",
              sources_used: ["source-1"],
            },
          }),
        );
      });

    const { searchNotebookLmViaCli } = await import("./notebooklm-cli.ts");
    const items = await searchNotebookLmViaCli({
      config: {
        ...createNotebookLmConfig(),
        cli: {
          ...createNotebookLmConfig().cli,
          command: "nlm",
          args: ["notebook", "query", "{notebookId}", "{query}", "--json", "--timeout", "120"],
        },
      },
      query: "源里有哪些经验标题？",
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toContain("发布回归排查三步法");
    expect(items[0]?.sourceRef).toBe("source-1");
  });

  it("preserves structured JSON answers for callers that parse NotebookLM output", async () => {
    const answer = JSON.stringify({
      candidates: [
        {
          id: "notebooklm-candidate:workflow-order",
          signalSummary: "workflow 执行异常时使用 registry、operations、executions 的顺序排查。",
          observedFrequency: 3,
          currentReuseLevel: "experience",
          triggerPattern: "workflow 状态不一致",
          repeatedActions: ["先查 registry", "再查 operations", "最后查 executions"],
          validationEvidence: ["三次排障都能定位失败层级"],
          evidenceKinds: ["trigger", "action", "result", "validation"],
          baselineDecision: "ready",
          blockers: [],
          score: 95,
        },
      ],
    });
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
            value: {
              answer,
              sources_used: ["source-json"],
            },
          }),
        );
      });

    const { searchNotebookLmViaCli } = await import("./notebooklm-cli.ts");
    const items = await searchNotebookLmViaCli({
      config: {
        ...createNotebookLmConfig(),
        cli: {
          ...createNotebookLmConfig().cli,
          command: "nlm",
          args: ["notebook", "query", "{notebookId}", "{query}", "--json", "--timeout", "120"],
        },
      },
      query: "返回自进化候选 JSON。",
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.content).toBe(answer);
    expect(JSON.parse(items[0]?.content ?? "{}")).toMatchObject({
      candidates: [
        {
          id: "notebooklm-candidate:workflow-order",
          baselineDecision: "ready",
          score: 95,
        },
      ],
    });
  });

  it("queries through the managed nlm runtime when no command is configured", async () => {
    const binPath = makeManagedNlmBin();
    execFileMock
      .mockImplementationOnce((command, args, _options, callback) => {
        expect(command).toBe(binPath);
        expect(args).toEqual(["login", "--check"]);
        callback(null, "✓ Authentication valid!\n  Profile: default\n  Notebooks found: 1");
      })
      .mockImplementationOnce((command, args, _options, callback) => {
        expect(command).toBe(binPath);
        expect(args).toContain("notebook");
        expect(args).toContain("query");
        callback(
          null,
          JSON.stringify({
            answer: "经验卡片一：受管运行时 未配置命令时使用 CrawClaw 安装的 nlm。",
          }),
        );
      });

    const { searchNotebookLmViaCli } = await import("./notebooklm-cli.ts");
    const items = await searchNotebookLmViaCli({
      query: "managed runtime?",
      config: {
        ...createNotebookLmConfig(),
        cli: {
          ...createNotebookLmConfig().cli,
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
        },
      },
    });

    expect(items[0]?.source).toBe("notebooklm");
    expect(items[0]?.summary).toContain("受管运行时");
  });

  it("returns no items instead of running local note-list matching when source query fails", async () => {
    const logger = { warn: vi.fn() };
    execFileMock
      .mockImplementationOnce((_command, args, _options, callback) => {
        expect(args).toEqual(["login", "--check"]);
        callback(null, "✓ Authentication valid!\n  Profile: default\n  Notebooks found: 1");
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          Object.assign(new Error("Query failed"), { code: 1 }),
          JSON.stringify({
            status: "error",
            error: "This notebook has no sources to query.",
          }),
          "",
        );
      });

    const { searchNotebookLmViaCli } = await import("./notebooklm-cli.ts");
    const items = await searchNotebookLmViaCli({
      query: "codex-note-token 云端经验同步验收流程",
      config: {
        ...createNotebookLmConfig(),
        cli: {
          ...createNotebookLmConfig().cli,
          command: "nlm",
          args: ["notebook", "query", "{notebookId}", "{query}", "--json"],
        },
      },
      logger,
    });

    expect(items).toEqual([]);
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("notebooklm cli retrieval skipped"),
    );
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

it("renders the configured NotebookLM profile into CLI args", async () => {
  execFileMock.mockImplementation((_command, args, _options, callback) => {
    if (args.includes("login")) {
      callback(null, "✓ Authentication valid!\n  Profile: work\n  Notebooks found: 2");
      return;
    }
    expect(args).toContain("--profile");
    expect(args).toContain("work");
    callback(
      null,
      JSON.stringify({
        answer: "经验卡片一：Profile 路由 使用 work profile 查询 NotebookLM。",
      }),
    );
  });

  const { searchNotebookLmViaCli } = await import("./notebooklm-cli.ts");
  const items = await searchNotebookLmViaCli({
    query: "profile?",
    config: {
      ...createNotebookLmConfig(),
      auth: {
        ...createNotebookLmConfig().auth,
        profile: "work",
      },
      cli: {
        ...createNotebookLmConfig().cli,
        command: "nlm",
        args: ["notebook", "query", "{notebookId}", "{query}", "--json", "--profile", "{profile}"],
      },
    },
  });

  expect(items[0]?.source).toBe("notebooklm");
});
