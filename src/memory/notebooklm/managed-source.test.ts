import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperienceIndexEntry } from "../experience/index-store.ts";
import {
  renderNotebookLmExperienceIndexSource,
  syncNotebookLmExperienceIndexSourceViaCli,
} from "./managed-source.ts";
import { clearNotebookLmProviderStateCache } from "./provider-state.ts";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const previousStateDir = process.env.CRAWCLAW_STATE_DIR;

function makeEntry(overrides: Partial<ExperienceIndexEntry> = {}): ExperienceIndexEntry {
  return {
    id: "experience-index:gateway-release-order",
    title: "网关发布失败顺序经验",
    summary: "网关发布失败时先回滚 service，再验证 secret 和探针输出。",
    content: "# 网关发布失败顺序经验\n\n先回滚 service，再检查 secret，最后验证 probe。",
    type: "failure_pattern",
    layer: "runtime_signals",
    memoryKind: "runtime_pattern",
    noteId: "note-1",
    notebookId: "nb-1",
    dedupeKey: "gateway-release-order",
    aliases: ["gateway 发布失败"],
    tags: ["release"],
    status: "active",
    supersededBy: null,
    archivedAt: null,
    updatedAt: 1_777_000_000_000,
    ...overrides,
  };
}

function makeConfig() {
  return {
    enabled: true,
    auth: {
      profile: "default",
      cookieFile: "",
      statusTtlMs: 0,
      degradedCooldownMs: 120_000,
      refreshCooldownMs: 180_000,
      heartbeat: { enabled: true, minIntervalMs: 1_000, maxIntervalMs: 2_000 },
    },
    cli: {
      enabled: true,
      command: "nlm",
      args: ["notebook", "query", "{notebookId}", "{query}", "--json"],
      timeoutMs: 1_000,
      limit: 5,
      notebookId: "nb-1",
    },
    write: {
      enabled: true,
      command: "",
      args: ["{payloadFile}"],
      timeoutMs: 1_000,
      notebookId: "nb-1",
    },
    source: {
      enabled: true,
      title: "CrawClaw Memory Index",
      timeoutMs: 1_000,
      maxEntries: 20,
      maxChars: 20_000,
      deletePrevious: true,
    },
  };
}

describe("renderNotebookLmExperienceIndexSource", () => {
  it("renders a bounded source from recallable experience index entries", () => {
    const content = renderNotebookLmExperienceIndexSource({
      entries: [
        makeEntry(),
        makeEntry({
          id: "experience-index:old",
          title: "旧经验",
          status: "archived",
          summary: "归档经验不应该进入 NotebookLM source。",
        }),
      ],
      title: "CrawClaw Memory Index",
      maxEntries: 10,
      maxChars: 20_000,
    });

    expect(content).toContain("# CrawClaw Memory Index");
    expect(content).toContain("网关发布失败顺序经验");
    expect(content).toContain("gateway-release-order");
    expect(content).not.toContain("旧经验");
  });
});

describe("syncNotebookLmExperienceIndexSourceViaCli", () => {
  beforeEach(async () => {
    execFileMock.mockReset();
    clearNotebookLmProviderStateCache();
    process.env.CRAWCLAW_STATE_DIR = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-managed-source-"),
    );
  });

  afterEach(async () => {
    if (process.env.CRAWCLAW_STATE_DIR) {
      await fs.rm(process.env.CRAWCLAW_STATE_DIR, { recursive: true, force: true });
    }
    if (previousStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = previousStateDir;
    }
    clearNotebookLmProviderStateCache();
  });

  it("adds one managed source from the experience index", async () => {
    execFileMock
      .mockImplementationOnce((_command, args, _options, callback) => {
        expect(args).toEqual(["login", "--check"]);
        callback(null, "✓ Authentication valid!\n  Profile: default\n");
      })
      .mockImplementationOnce((_command, args, _options, callback) => {
        expect(args).toEqual(["source", "list", "nb-1", "--json"]);
        callback(null, "[]");
      })
      .mockImplementationOnce((_command, args, _options, callback) => {
        expect(args).toEqual(
          expect.arrayContaining([
            "source",
            "add",
            "nb-1",
            "--text",
            expect.stringContaining("网关发布失败顺序经验"),
            "--title",
            "CrawClaw Memory Index",
            "--wait",
          ]),
        );
        callback(null, "✓ Source added: source-1\n");
      })
      .mockImplementationOnce((_command, args, _options, callback) => {
        expect(args).toEqual(["source", "list", "nb-1", "--json"]);
        callback(null, JSON.stringify([{ id: "source-1", title: "CrawClaw Memory Index" }]));
      });

    const result = await syncNotebookLmExperienceIndexSourceViaCli({
      config: makeConfig(),
      entries: [makeEntry()],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        action: "create",
        notebookId: "nb-1",
        sourceId: "source-1",
      }),
    );
  });

  it("skips upload when the rendered source content did not change", async () => {
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, "✓ Authentication valid!\n  Profile: default\n");
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, "[]");
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, "✓ Source added: source-1\n");
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, JSON.stringify([{ id: "source-1", title: "CrawClaw Memory Index" }]));
      });

    await syncNotebookLmExperienceIndexSourceViaCli({
      config: makeConfig(),
      entries: [makeEntry()],
    });
    const second = await syncNotebookLmExperienceIndexSourceViaCli({
      config: makeConfig(),
      entries: [makeEntry()],
    });

    expect(second?.status).toBe("no_change");
    expect(execFileMock).toHaveBeenCalledTimes(4);
  });
});
