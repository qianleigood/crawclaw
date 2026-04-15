import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryPromptJournal, __testing } from "./prompt-journal.ts";

describe("memory prompt journal", () => {
  it("stays disabled by default", () => {
    expect(createMemoryPromptJournal({ env: {} as NodeJS.ProcessEnv })).toBeNull();
  });

  it("writes JSONL events when enabled", () => {
    const writes: string[] = [];
    const journal = createMemoryPromptJournal({
      env: {
        CRAWCLAW_MEMORY_PROMPT_JOURNAL: "1",
        CRAWCLAW_MEMORY_PROMPT_JOURNAL_FILE: "/tmp/memory-prompt-journal.test.jsonl",
      } as NodeJS.ProcessEnv,
      writer: {
        filePath: "/tmp/memory-prompt-journal.test.jsonl",
        write: (line: string) => {
          writes.push(line);
        },
      },
    });

    expect(journal).not.toBeNull();
    journal?.recordStage("knowledge_write", {
      sessionId: "session-1",
      sessionKey: "key-1",
      payload: {
        title: "MiniMax 工具挂载调试流程",
        summary: "x".repeat(4500),
      },
    });

    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0] ?? "{}");
    expect(parsed.stage).toBe("knowledge_write");
    expect(parsed.sessionId).toBe("session-1");
    expect(parsed.payload.title).toBe("MiniMax 工具挂载调试流程");
    expect(String(parsed.payload.summary)).toContain("[truncated");
  });

  it("formats local date bucket as YYYY-MM-DD", () => {
    const value = __testing.formatLocalDateBucket(new Date("2026-04-05T12:34:56.000Z"));
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("prunes old journal files when retention is configured", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-memory-journal-retention-"));
    const staleFile = path.join(dir, "2026-04-01.jsonl");
    const freshFile = path.join(dir, "2026-04-05.jsonl");
    await fs.writeFile(staleFile, "{}\n", "utf8");
    await fs.writeFile(freshFile, "{}\n", "utf8");
    const now = Date.now();
    const staleTime = now - 10 * 24 * 60 * 60 * 1000;
    await fs.utimes(staleFile, staleTime / 1000, staleTime / 1000);

    await __testing.prunePromptJournalDirectory(dir, 3);

    await expect(fs.stat(staleFile)).rejects.toThrow();
    await expect(fs.stat(freshFile)).resolves.toBeDefined();
  });
});
