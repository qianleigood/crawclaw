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

describe("verification session tool gating", () => {
  it("keeps verification tool inventory broad but runtime-denies non-allowlisted tools", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-verification-tools-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "sessions.json");
    const sessionKey = "agent:main:subagent:verification-child";
    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          [sessionKey]: {
            sessionId: "verification-child-session",
            updatedAt: Date.now(),
            spawnSource: "verification",
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
    expect(toolNames).not.toContain("verify_task");

    const blockedTool = tools.find((tool) => tool.name === "write");
    expect(blockedTool).toBeDefined();
    await expect(
      blockedTool!.execute?.("call-verification-deny", {
        file_path: path.join(dir, "blocked.txt"),
        content: "should-not-run",
      }),
    ).rejects.toThrow('Tool "write" is not allowed for this special-agent run');
  });

  it("keeps memory-extraction tool inventory broad but runtime-denies non-allowlisted tools", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-memory-extraction-tools-"));
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
            spawnSource: "memory-extraction",
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
      specialAgentSpawnSource: "memory-extraction",
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
});
