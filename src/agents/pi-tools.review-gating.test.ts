import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import "./test-helpers/fast-coding-tools.js";
import { createCrawClawCodingTools } from "./pi-tools.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.allSettled(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("review session tool gating", () => {
  it("keeps review tool inventory broad but runtime-denies non-allowlisted tools", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-review-tools-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "sessions.json");
    const sessionKey = "agent:main:subagent:review-child";
    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          [sessionKey]: {
            sessionId: "review-child-session",
            updatedAt: Date.now(),
            spawnSource: "review-quality",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const cfg = {
      session: {
        store: storePath,
      },
    } as CrawClawConfig;

    const tools = createCrawClawCodingTools({
      config: cfg,
      sessionKey,
      messageProvider: "feishu",
      senderId: "user-1",
      senderIsOwner: true,
    });
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining(["read", "exec", "process"]));
    expect(toolNames).toContain("write");
    expect(toolNames).toContain("edit");
    expect(toolNames).not.toContain("review_task");

    const blockedTool = tools.find((tool) => tool.name === "write");
    expect(blockedTool).toBeDefined();
    await expect(
      blockedTool!.execute?.("call-review-deny", {
        file_path: path.join(dir, "blocked.txt"),
        content: "should-not-run",
      }),
    ).rejects.toThrow('Tool "write" is not allowed for this special-agent run');
  });

  it("keeps durable-memory tool inventory broad but runtime-denies non-allowlisted tools", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-memory-tools-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "sessions.json");
    const sessionKey = "agent:main:subagent:memory-child";
    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          [sessionKey]: {
            sessionId: "memory-child-session",
            updatedAt: Date.now(),
            spawnSource: "durable-memory",
            durableMemoryScope: {
              agentId: "main",
              channel: "feishu",
              userId: "user-1",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const cfg = {
      session: {
        store: storePath,
      },
    } as CrawClawConfig;

    const tools = createCrawClawCodingTools({
      config: cfg,
      sessionKey,
      senderIsOwner: true,
    });
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
      ]),
    );
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("write");
    expect(toolNames).not.toContain("remember_durable_preference");
    expect(toolNames).not.toContain("write_durable_memory_note");
    expect(toolNames).not.toContain("delete_durable_memory_note");

    const blockedTool = tools.find((tool) => tool.name === "write");
    expect(blockedTool).toBeDefined();
    await expect(
      blockedTool!.execute?.("call-memory-deny", {
        file_path: path.join(dir, "blocked.txt"),
        content: "should-not-run",
      }),
    ).rejects.toThrow('Tool "write" is not allowed for this special-agent run');
  });

  it("exposes durable memory tools for embedded special-agent runs without child-session scope metadata", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-memory-embedded-tools-"));
    tempDirs.push(dir);

    const tools = createCrawClawCodingTools({
      sessionKey: "agent:main:main",
      workspaceDir: dir,
      agentDir: path.join(dir, "agent"),
      specialAgentSpawnSource: "durable-memory",
      specialDurableMemoryScope: {
        agentId: "main",
        channel: "feishu",
        userId: "user-1",
      },
      senderIsOwner: true,
    });
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
      ]),
    );

    const blockedTool = tools.find((tool) => tool.name === "write");
    expect(blockedTool).toBeDefined();
    await expect(
      blockedTool!.execute?.("call-memory-deny-embedded", {
        file_path: path.join(dir, "blocked.txt"),
        content: "should-not-run",
      }),
    ).rejects.toThrow('Tool "write" is not allowed for this special-agent run');
  });

  it("keeps scoped memory tools for embedded memory maintenance runs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-dream-tools-"));
    tempDirs.push(dir);
    const config = {
      memory: {
        dreaming: {
          enabled: true,
        },
      },
    } as CrawClawConfig;
    const scope = {
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    };

    const dreamTools = createCrawClawCodingTools({
      config,
      sessionKey: "agent:main:main",
      workspaceDir: dir,
      specialAgentSpawnSource: "dream",
      specialDurableMemoryScope: scope,
      senderIsOwner: true,
    });
    const dreamToolNames = dreamTools.map((tool) => tool.name);
    expect(dreamToolNames).toEqual(
      expect.arrayContaining([
        "read",
        "exec",
        "write",
        "edit",
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
      ]),
    );
    const blockedDreamWrite = dreamTools.find((tool) => tool.name === "write");
    expect(blockedDreamWrite).toBeDefined();
    await expect(
      blockedDreamWrite!.execute?.("call-dream-write-deny", {
        file_path: path.join(dir, "outside-memory.md"),
        content: "should-not-run",
      }),
    ).rejects.toThrow("memory maintenance write/edit is restricted");
    const blockedDreamExec = dreamTools.find((tool) => tool.name === "exec");
    expect(blockedDreamExec).toBeDefined();
    await expect(
      blockedDreamExec!.execute?.("call-dream-exec-deny", {
        command: "rm -rf /tmp/crawclaw-memory",
      }),
    ).rejects.toThrow("memory maintenance exec is restricted to read-only commands");

    const extractionTools = createCrawClawCodingTools({
      config,
      sessionKey: "agent:main:main",
      workspaceDir: dir,
      specialAgentSpawnSource: "durable-memory",
      specialDurableMemoryScope: scope,
      senderIsOwner: true,
    });
    expect(extractionTools.map((tool) => tool.name)).toContain("memory_manifest_read");
  });
});
