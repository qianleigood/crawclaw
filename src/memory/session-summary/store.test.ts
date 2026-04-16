import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import {
  SESSION_SUMMARY_READ_CACHE_DESCRIPTOR,
  clearSessionSummaryReadCache,
  getSessionSummaryReadCacheMeta,
  ensureSessionSummaryFile,
  resolveSessionSummaryPath,
  readSessionSummaryFile,
  writeSessionSummaryFile,
} from "./store.js";
import { renderSessionSummaryTemplate, SESSION_SUMMARY_SECTION_ORDER } from "./template.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("session summary store", () => {
  afterEach(() => {
    clearSessionSummaryReadCache();
  });

  it("renders a Claude-style summary template", () => {
    const template = renderSessionSummaryTemplate();
    expect(template).toContain("# Session Title");
    expect(template).toContain("# Current State");
    expect(template).toContain("# Task specification");
    expect(template).toContain("# Files and Functions");
    expect(template).toContain("# Workflow");
    expect(template).toContain("# Errors & Corrections");
    expect(template).toContain("# Codebase and System Documentation");
    expect(template).toContain("# Learnings");
    expect(template).toContain("# Key results");
    expect(template).toContain("# Worklog");
    expect(template).toContain("_What is actively being worked on right now?");
    expect(template).toMatch(/\n$/);
    expect(template).not.toContain("---");
    expect(SESSION_SUMMARY_SECTION_ORDER).toHaveLength(10);
  });

  it("creates a per-session summary.md file with the template when missing", async () => {
    const rootDir = await tempDirs.make("session-summary-store-");
    const sessionId = "session-1";

    const result = await ensureSessionSummaryFile({
      agentId: "main",
      sessionId,
      rootDir,
    });

    expect(result.summaryPath).toBe(
      path.join(rootDir, "session-summary", "agents", "main", "sessions", sessionId, "summary.md"),
    );
    expect(await fs.readFile(result.summaryPath, "utf8")).toBe(result.content);
    expect(result.content).toContain("# Session Title");
    expect(result.exists).toBe(true);
    expect(result.bytes).toBe(Buffer.byteLength(result.content ?? "", "utf8"));

    const readBack = await readSessionSummaryFile({
      agentId: "main",
      sessionId,
      rootDir,
    });
    expect(readBack).toMatchObject({
      sessionId,
      summaryPath: result.summaryPath,
      exists: true,
    });
  });

  it("writes and reads existing summary content without dropping session scoping", async () => {
    const rootDir = await tempDirs.make("session-summary-store-write-");
    const sessionId = "session-2";

    const written = await writeSessionSummaryFile({
      agentId: "main",
      sessionId,
      rootDir,
      content:
        "# Session Title\n_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_\n\nCustom title\n\n# Current State\n_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._\n\nWorking\n",
    });

    expect(written.summaryPath).toBe(
      resolveSessionSummaryPath({
        agentId: "main",
        sessionId,
        rootDir,
      }),
    );
    expect(written.content).toContain("Custom title");
    expect(written.content).toMatch(/\n$/);

    const readBack = await readSessionSummaryFile({
      agentId: "main",
      sessionId,
      rootDir,
    });
    expect(readBack?.content).toBe(written.content);
    expect(readBack?.summaryPath).toBe(written.summaryPath);
  });

  it("reuses cached summary reads when mtime/bytes are unchanged", async () => {
    const rootDir = await tempDirs.make("session-summary-store-cache-");
    const sessionId = "session-cache-1";

    await writeSessionSummaryFile({
      agentId: "main",
      sessionId,
      rootDir,
      content:
        "# Session Title\n_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_\n\nCache test\n",
    });

    const readFileSpy = vi.spyOn(fs, "readFile");
    const first = await readSessionSummaryFile({ agentId: "main", sessionId, rootDir });
    const second = await readSessionSummaryFile({ agentId: "main", sessionId, rootDir });

    expect(first.exists).toBe(true);
    expect(second.exists).toBe(true);
    expect(second.content).toBe(first.content);
    expect(readFileSpy).toHaveBeenCalledTimes(0);
    readFileSpy.mockRestore();
  });

  it("serves updated content after summary updates without stale cache", async () => {
    const rootDir = await tempDirs.make("session-summary-store-cache-invalidate-");
    const sessionId = "session-cache-2";

    await writeSessionSummaryFile({
      agentId: "main",
      sessionId,
      rootDir,
      content:
        "# Session Title\n_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_\n\nVersion A\n",
    });

    const readFileSpy = vi.spyOn(fs, "readFile");
    const initial = await readSessionSummaryFile({ agentId: "main", sessionId, rootDir });
    await writeSessionSummaryFile({
      agentId: "main",
      sessionId,
      rootDir,
      content:
        "# Session Title\n_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_\n\nVersion B\n",
    });
    const updated = await readSessionSummaryFile({ agentId: "main", sessionId, rootDir });

    expect(initial.content).toContain("Version A");
    expect(updated.content).toContain("Version B");
    expect(readFileSpy).toHaveBeenCalledTimes(0);
    readFileSpy.mockRestore();
  });

  it("clears cached summary snapshots explicitly and exposes cache meta", async () => {
    const rootDir = await tempDirs.make("session-summary-store-cache-clear-");
    const sessionId = "session-cache-3";

    const written = await writeSessionSummaryFile({
      agentId: "main",
      sessionId,
      rootDir,
      content: "# Session Title\n\nCache clear\n",
    });
    await readSessionSummaryFile({ agentId: "main", sessionId, rootDir });

    expect(getSessionSummaryReadCacheMeta()).toEqual({ size: 1 });

    clearSessionSummaryReadCache(written.summaryPath);
    expect(getSessionSummaryReadCacheMeta()).toEqual({ size: 0 });
  });

  it("publishes explicit governance metadata", () => {
    expect(SESSION_SUMMARY_READ_CACHE_DESCRIPTOR.category).toBe("file_ui");
    expect(SESSION_SUMMARY_READ_CACHE_DESCRIPTOR.owner).toContain("session-summary");
    expect(SESSION_SUMMARY_READ_CACHE_DESCRIPTOR.invalidation).toContain(
      "clearSessionSummaryReadCache(summaryPath?) clears one or all entries",
    );
  });
});
