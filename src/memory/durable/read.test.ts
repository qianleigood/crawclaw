import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanDurableMemoryManifest } from "./manifest.ts";
import { recallDurableMemory } from "./read.ts";

async function writeNote(filePath: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
}

describe("durable memory recall", () => {
  it("applies maxFiles after sorting by freshness when building the manifest", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-maxfiles-"));
    try {
      const scopeDir = path.join(rootDir, "agents", "main", "channels", "discord", "users", "user-42");
      await fs.mkdir(scopeDir, { recursive: true });
      await writeNote(
        path.join(scopeDir, "old-note.md"),
        [
          "---",
          "title: Old note",
          "durable_memory_type: reference",
          "description: old",
          "---",
          "",
          "old",
        ].join("\n"),
      );
      await writeNote(
        path.join(scopeDir, "new-note.md"),
        [
          "---",
          "title: New note",
          "durable_memory_type: reference",
          "description: new",
          "---",
          "",
          "new",
        ].join("\n"),
      );
      const oldPath = path.join(scopeDir, "old-note.md");
      const newPath = path.join(scopeDir, "new-note.md");
      const now = Date.now();
      await fs.utimes(oldPath, new Date(now - 60_000), new Date(now - 60_000));
      await fs.utimes(newPath, new Date(now), new Date(now));

      const manifest = await scanDurableMemoryManifest({
        scope: {
          agentId: "main",
          channel: "discord",
          userId: "user-42",
          scopeKey: "main:discord:user-42",
          rootDir: scopeDir,
        },
        maxFiles: 1,
      });

      expect(manifest).toHaveLength(1);
      expect(manifest[0]?.notePath).toBe("new-note.md");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("scans only notes under the durable scope directory and builds a manifest from MEMORY.md", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-scope-"));
    try {
      const scopeDir = path.join(rootDir, "agents", "main", "channels", "discord", "users", "user-42");
      await fs.mkdir(scopeDir, { recursive: true });
      await fs.writeFile(
        path.join(scopeDir, "MEMORY.md"),
        [
          "# Durable memory index",
          "",
          "- [Prefer concise answers](./feedback-answer-style.md)",
          "- [Memory refactor scope](./project-memory-refactor.md)",
        ].join("\n"),
        "utf8",
      );
      await writeNote(
        path.join(scopeDir, "feedback-answer-style.md"),
        [
          "---",
          "title: Prefer concise answers",
          "durable_memory_type: feedback",
          "description: Keep operational answers short and step-first.",
          "---",
          "",
          "Keep operational answers short and step-first.",
          "",
          `${"extra detail ".repeat(80)}TAIL-SHOULD-STAY-IN-FULL-NOTE`,
        ].join("\n"),
      );
      await writeNote(
        path.join(scopeDir, "project-memory-refactor.md"),
        [
          "---",
          "title: Memory refactor scope",
          "durable_memory_type: project",
          "description: Refactor the memory subsystem into Claude-style durable and knowledge sections.",
          "---",
          "",
          "This note tracks the current memory architecture migration.",
        ].join("\n"),
      );
      await writeNote(path.join(scopeDir, "notes", "ignore.md"), "# Outside durable scope");

      const manifest = await scanDurableMemoryManifest({
        scope: {
          agentId: "main",
          channel: "discord",
          userId: "user-42",
          scopeKey: "main:discord:user-42",
          rootDir: scopeDir,
        },
      });

      expect(manifest.map((entry) => entry.notePath).toSorted()).toEqual([
        "feedback-answer-style.md",
        "project-memory-refactor.md",
      ].toSorted());
      expect(manifest.find((entry) => entry.notePath === "project-memory-refactor.md")?.durableType).toBe("project");
      expect(manifest.find((entry) => entry.notePath === "feedback-answer-style.md")?.description).toContain("step-first");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("selects durable notes from the manifest and loads full note content only for selected items", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-recall-"));
    try {
      const scope = {
        agentId: "main",
        channel: "discord",
        userId: "user-42",
        scopeKey: "main:discord:user-42",
        rootDir: scopeDir,
      };
      const selectedTail = "TAIL-FROM-FULL-NOTE";
      await fs.writeFile(
        path.join(scopeDir, "MEMORY.md"),
        [
          "# Durable memory index",
          "",
          "- [Concise answer preference](./feedback-concise-answering.md)",
          "- [Project context](./project-project-context.md)",
        ].join("\n"),
        "utf8",
      );
      await writeNote(
        path.join(scopeDir, "feedback-concise-answering.md"),
        [
          "---",
          "title: Concise answer preference",
          "durable_memory_type: feedback",
          "description: Answer operational questions in short, step-first form.",
          "---",
          "",
          "The assistant should answer operational questions in short, step-first form.",
          "",
          `${"padding ".repeat(120)}${selectedTail}`,
        ].join("\n"),
      );
      await writeNote(
        path.join(scopeDir, "project-project-context.md"),
        [
          "---",
          "title: Project context",
          "durable_memory_type: project",
          "description: This project is a memory runtime refactor.",
          "---",
          "",
          "This project is a memory runtime refactor.",
        ].join("\n"),
      );
      const now = Date.now();
      await fs.utimes(
        path.join(scopeDir, "feedback-concise-answering.md"),
        new Date(now),
        new Date(now),
      );
      await fs.utimes(
        path.join(scopeDir, "project-project-context.md"),
        new Date(now - 60_000),
        new Date(now - 60_000),
      );

      const result = await recallDurableMemory({
        scope,
        prompt: "How should the assistant answer operational questions?",
        complete: async () => JSON.stringify({ selectedIds: ["cand_1"], reason: "best match" }),
        limit: 1,
      });

      expect(result.manifest).toHaveLength(2);
      expect(result.selection.mode).toBe("llm");
      expect(result.selection.selectedItemIds).toEqual(["durable:feedback-concise-answering.md"]);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.summary).toContain("step-first");
      expect(result.items[0]?.content).toContain(selectedTail);
      expect(result.items[0]?.metadata?.notePath).toBe("feedback-concise-answering.md");
      expect(result.items[0]?.metadata?.ageText).toBeTypeOf("string");
    } finally {
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });

  it("adds a freshness warning for durable notes older than one day", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-freshness-"));
    try {
      const scope = {
        agentId: "main",
        channel: "discord",
        userId: "user-42",
        scopeKey: "main:discord:user-42",
        rootDir: scopeDir,
      };
      await fs.writeFile(
        path.join(scopeDir, "MEMORY.md"),
        ["# Durable memory index", "", "- [Old note](./project-old-note.md)"].join("\n"),
        "utf8",
      );
      const notePath = path.join(scopeDir, "project-old-note.md");
      await writeNote(
        notePath,
        [
          "---",
          "title: Old project note",
          "durable_memory_type: project",
          "description: Old project state that may have drifted.",
          "---",
          "",
          "Old project state that may have drifted.",
        ].join("\n"),
      );
      const threeDaysAgo = Date.now() - 3 * 86_400_000;
      await fs.utimes(notePath, new Date(threeDaysAgo), new Date(threeDaysAgo));

      const result = await recallDurableMemory({
        scope,
        prompt: "what is the old project state",
        complete: async () => JSON.stringify({ selectedIds: ["cand_1"] }),
        limit: 1,
      });

      expect(result.items).toHaveLength(1);
      expect(String(result.items[0]?.metadata?.freshnessText)).toContain("3 days old");
      expect(String(result.items[0]?.metadata?.freshnessText)).toContain("Verify against current files");
    } finally {
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });

  it("falls back to heuristic durable selection when no llm is available", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-fallback-"));
    try {
      const scope = {
        agentId: "main",
        channel: "discord",
        userId: "user-42",
        scopeKey: "main:discord:user-42",
        rootDir: scopeDir,
      };
      await fs.writeFile(
        path.join(scopeDir, "MEMORY.md"),
        [
          "# Durable memory index",
          "",
          "- [Answer style](./feedback-answer-style.md)",
          "- [Project context](./project-project.md)",
        ].join("\n"),
        "utf8",
      );
      await writeNote(
        path.join(scopeDir, "feedback-answer-style.md"),
        [
          "---",
          "title: Answer style",
          "durable_memory_type: feedback",
          "description: Keep answers short.",
          "---",
          "",
          "Keep answers short.",
        ].join("\n"),
      );
      await writeNote(
        path.join(scopeDir, "project-project.md"),
        [
          "---",
          "title: Project context",
          "durable_memory_type: project",
          "description: Project background.",
          "---",
          "",
          "Project background.",
        ].join("\n"),
      );

      const result = await recallDurableMemory({
        scope,
        prompt: "short answers",
        limit: 1,
      });

      expect(result.selection.mode).toBe("heuristic");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.durableKind).toBe("feedback");
    } finally {
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });

  it("respects an explicit llm choice to select no durable memory", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-none-"));
    try {
      const scope = {
        agentId: "main",
        channel: "discord",
        userId: "user-42",
        scopeKey: "main:discord:user-42",
        rootDir: scopeDir,
      };
      await fs.writeFile(
        path.join(scopeDir, "MEMORY.md"),
        [
          "# Durable memory index",
          "",
          "- [Answer style](./feedback-answer-style.md)",
        ].join("\n"),
        "utf8",
      );
      await writeNote(
        path.join(scopeDir, "feedback-answer-style.md"),
        [
          "---",
          "title: Answer style",
          "durable_memory_type: feedback",
          "description: Keep answers short.",
          "---",
          "",
          "Keep answers short.",
        ].join("\n"),
      );

      const result = await recallDurableMemory({
        scope,
        prompt: "What database schema should I use?",
        complete: async () => JSON.stringify({ selectedIds: [], reason: "no relevant durable memory" }),
        limit: 1,
      });

      expect(result.selection.mode).toBe("llm_none");
      expect(result.selection.selectedItemIds).toEqual([]);
      expect(result.items).toEqual([]);
    } finally {
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });
});
