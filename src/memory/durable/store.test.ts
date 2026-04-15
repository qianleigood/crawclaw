import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDurableMemoryNote, resolveDurableMemoryDeletionPath, scanDurableMemoryScopeEntries, upsertDurableMemoryNote } from "./store.ts";

async function createStateDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-store-state-"));
}

const previousStateDir = process.env.CRAWCLAW_STATE_DIR;

afterEach(() => {
  if (previousStateDir === undefined) {
    delete process.env.CRAWCLAW_STATE_DIR;
  } else {
    process.env.CRAWCLAW_STATE_DIR = previousStateDir;
  }
});

describe("durable memory file store", () => {
  it("upserts notes, regenerates MEMORY.md, and keeps scopes isolated", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const scopeA = { agentId: "main", channel: "discord", userId: "user-42" } as const;
    const scopeB = { agentId: "research", channel: "discord", userId: "user-42" } as const;

    const created = await upsertDurableMemoryNote({
      scope: scopeA,
      input: {
        type: "project",
        title: "CrawClaw memory refactor",
        summary: "First version.",
        dedupeKey: "crawclaw-memory-refactor",
      },
    });
    expect(created.action).toBe("create");
    expect(created.notePath).toBe("20 Projects/crawclaw-memory-refactor.md");

    const updated = await upsertDurableMemoryNote({
      scope: scopeA,
      input: {
        type: "project",
        title: "CrawClaw durable memory refactor",
        summary: "Second version.",
        dedupeKey: "crawclaw-memory-refactor",
      },
    });
    expect(updated.action).toBe("update");

    const isolated = await upsertDurableMemoryNote({
      scope: scopeB,
      input: {
        type: "project",
        title: "CrawClaw memory refactor",
        summary: "Other scope.",
        dedupeKey: "crawclaw-memory-refactor",
      },
    });
    expect(isolated.notePath).toBe("20 Projects/crawclaw-memory-refactor.md");

    const scopeADir = path.join(
      stateDir,
      "durable-memory",
      "agents",
      "main",
      "channels",
      "discord",
      "users",
      "user-42",
    );
    const scopeBDir = path.join(
      stateDir,
      "durable-memory",
      "agents",
      "research",
      "channels",
      "discord",
      "users",
      "user-42",
    );
    const scopeAIndex = await fs.readFile(path.join(scopeADir, "MEMORY.md"), "utf8");
    const scopeBIndex = await fs.readFile(path.join(scopeBDir, "MEMORY.md"), "utf8");
    const scopeANote = await fs.readFile(
      path.join(scopeADir, "20 Projects", "crawclaw-memory-refactor.md"),
      "utf8",
    );

    expect(scopeAIndex).toContain("# MEMORY.md");
    expect(scopeAIndex).not.toContain("---\n");
    expect(scopeAIndex).toContain("CrawClaw durable memory refactor");
    expect(scopeAIndex).not.toContain("Other scope.");
    expect(scopeBIndex).toContain("Other scope.");
    expect(scopeANote).toContain('type: "project"');
    expect(scopeANote).toContain('scope_agent_id: "main"');
    expect(scopeANote).not.toContain("durable_memory_type:");
    expect(scopeANote).not.toContain("memory_bucket:");

    const scopeAEntries = await scanDurableMemoryScopeEntries(scopeA);
    expect(scopeAEntries).toHaveLength(1);
    expect(scopeAEntries[0]?.description).toBe("Second version.");
  });

  it("deletes notes by dedupe key and reports missing entries", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const scope = { agentId: "main", channel: "discord", userId: "user-42" } as const;

    await upsertDurableMemoryNote({
      scope,
      input: {
        type: "feedback",
        title: "Step-first answers",
        summary: "Lead with steps.",
        dedupeKey: "step-first-answers",
      },
    });

    const deletionPath = await resolveDurableMemoryDeletionPath({
      scope,
      type: "feedback",
      dedupeKey: "step-first-answers",
    });
    expect(deletionPath).toBe("60 Preferences/step-first-answers.md");

    const deleted = await deleteDurableMemoryNote({
      scope,
      type: "feedback",
      dedupeKey: "step-first-answers",
    });
    expect(deleted.action).toBe("deleted");

    const missing = await deleteDurableMemoryNote({
      scope,
      type: "feedback",
      dedupeKey: "step-first-answers",
    });
    expect(missing.action).toBe("missing");
    expect(missing.notePath).toBe("60 Preferences/step-first-answers.md");
  });
});
