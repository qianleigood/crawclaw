import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { updateSessionStore } from "../config/sessions/store.js";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { createCrawClawCodingTools } from "./pi-tools.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("pi-tools session-summary tool exposure", () => {
  it("keeps session-summary tools available while runtime-denying unrelated tools", async () => {
    const rootDir = await tempDirs.make("pi-tools-session-summary-");
    const storePath = path.join(rootDir, "sessions.json");
    const parentSessionKey = "agent:main:main";
    const childSessionKey = "agent:main:subagent:session-summary";

    await updateSessionStore(storePath, (store) => {
      store[parentSessionKey] = {
        sessionId: "session-parent",
        updatedAt: Date.now(),
      };
      store[childSessionKey] = {
        sessionId: "session-child",
        updatedAt: Date.now(),
        spawnSource: "session-summary",
        parentSessionKey,
      };
    });

    const cfg = {
      session: {
        mainKey: parentSessionKey,
        store: storePath,
      },
    } as CrawClawConfig;

    const tools = createCrawClawCodingTools({
      config: cfg,
      sessionKey: childSessionKey,
      workspaceDir: rootDir,
      agentDir: path.join(rootDir, "agent"),
    });
    const toolNames = new Set(tools.map((tool) => tool.name));

    expect(toolNames.has("session_summary_file_read")).toBe(true);
    expect(toolNames.has("session_summary_file_edit")).toBe(true);
    expect(toolNames.has("write")).toBe(true);

    const readTool = tools.find((tool) => tool.name === "session_summary_file_read");
    expect(readTool).toBeDefined();
    const readResult = await readTool!.execute?.("call-summary-read", {});
    expect(readResult).toMatchObject({
      details: {
        status: "ok",
        sessionId: "session-parent",
        agentId: "main",
      },
    });

    const blockedTool = tools.find((tool) => tool.name === "write");
    expect(blockedTool).toBeDefined();
    await expect(
      blockedTool!.execute?.("call-summary-deny", {
        file_path: path.join(rootDir, "blocked.txt"),
        content: "should-not-run",
      }),
    ).rejects.toThrow('Tool "write" is not allowed for this special-agent run');
  });

  it("does not expose session summary tools for ordinary sessions", async () => {
    const rootDir = await tempDirs.make("pi-tools-session-summary-off-");
    const storePath = path.join(rootDir, "sessions.json");
    const parentSessionKey = "agent:main:main";
    const childSessionKey = "agent:main:subagent:ordinary";

    await updateSessionStore(storePath, (store) => {
      store[parentSessionKey] = {
        sessionId: "session-parent",
        updatedAt: Date.now(),
      };
      store[childSessionKey] = {
        sessionId: "session-child",
        updatedAt: Date.now(),
        spawnSource: "sessions_spawn",
        parentSessionKey,
      };
    });

    const cfg = {
      session: {
        mainKey: parentSessionKey,
        store: storePath,
      },
    } as CrawClawConfig;

    const tools = createCrawClawCodingTools({
      config: cfg,
      sessionKey: childSessionKey,
      workspaceDir: rootDir,
      agentDir: path.join(rootDir, "agent"),
    });
    const toolNames = new Set(tools.map((tool) => tool.name));

    expect(toolNames.has("session_summary_file_read")).toBe(false);
    expect(toolNames.has("session_summary_file_edit")).toBe(false);
  });

  it("exposes session summary tools for embedded special-agent runs without session-store spawn metadata", async () => {
    const rootDir = await tempDirs.make("pi-tools-session-summary-embedded-");
    const tools = createCrawClawCodingTools({
      sessionKey: "agent:main:main",
      workspaceDir: rootDir,
      agentDir: path.join(rootDir, "agent"),
      specialAgentSpawnSource: "session-summary",
      specialSessionSummaryTarget: {
        agentId: "main",
        sessionId: "session-parent",
      },
    });
    const toolNames = new Set(tools.map((tool) => tool.name));

    expect(toolNames.has("session_summary_file_read")).toBe(true);
    expect(toolNames.has("session_summary_file_edit")).toBe(true);

    const blockedTool = tools.find((tool) => tool.name === "write");
    expect(blockedTool).toBeDefined();
    await expect(
      blockedTool!.execute?.("call-summary-deny-embedded", {
        file_path: path.join(rootDir, "blocked.txt"),
        content: "should-not-run",
      }),
    ).rejects.toThrow('Tool "write" is not allowed for this special-agent run');
  });
});
