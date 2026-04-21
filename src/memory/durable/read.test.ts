import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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
      const scopeDir = path.join(
        rootDir,
        "agents",
        "main",
        "channels",
        "discord",
        "users",
        "user-42",
      );
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
      const scopeDir = path.join(
        rootDir,
        "agents",
        "main",
        "channels",
        "discord",
        "users",
        "user-42",
      );
      await fs.mkdir(scopeDir, { recursive: true });
      await fs.writeFile(
        path.join(scopeDir, "MEMORY.md"),
        [
          "# Durable memory index",
          "",
          "- [Prefer concise answers](./feedback-answer-style.md) - Keep operational answers short and step-first.",
          "- [Memory refactor scope](./project-memory-refactor.md) - Tracks the durable and knowledge split.",
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
          "description: Refactor the memory subsystem into durable and knowledge sections.",
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

      expect(manifest.map((entry) => entry.notePath).toSorted()).toEqual(
        ["feedback-answer-style.md", "project-memory-refactor.md"].toSorted(),
      );
      expect(
        manifest.find((entry) => entry.notePath === "project-memory-refactor.md")?.durableType,
      ).toBe("project");
      expect(
        manifest.find((entry) => entry.notePath === "feedback-answer-style.md")?.description,
      ).toContain("step-first");
      expect(
        manifest.find((entry) => entry.notePath === "project-memory-refactor.md")?.indexHook,
      ).toContain("durable and knowledge split");
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
      expect(String(result.items[0]?.metadata?.freshnessText)).toContain(
        "Verify against current files",
      );
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

  it("uses MEMORY.md index hooks during heuristic durable selection", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-index-hook-"));
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
          "- [Ops scratchpad](./project-ops-scratchpad.md) - Clear stale gateway processes before restarting probes.",
          "- [Gateway overview](./project-gateway-overview.md) - General gateway background and setup context.",
        ].join("\n"),
        "utf8",
      );
      await writeNote(
        path.join(scopeDir, "project-ops-scratchpad.md"),
        [
          "---",
          "title: Ops scratchpad",
          "durable_memory_type: project",
          "description: Miscellaneous operational notes.",
          "---",
          "",
          "Internal ops scratchpad.",
        ].join("\n"),
      );
      await writeNote(
        path.join(scopeDir, "project-gateway-overview.md"),
        [
          "---",
          "title: Gateway overview",
          "durable_memory_type: project",
          "description: Gateway setup and background.",
          "---",
          "",
          "Gateway background.",
        ].join("\n"),
      );

      const result = await recallDurableMemory({
        scope,
        prompt: "How do I clear a stale gateway process before restarting probes?",
        limit: 1,
      });

      expect(result.selection.mode).toBe("heuristic");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.metadata?.notePath).toBe("project-ops-scratchpad.md");
      expect(result.selection.selectedDetails?.[0]?.provenance).toContain("index");
      expect(
        result.selection.omittedDetails?.find(
          (entry) => entry.notePath === "project-gateway-overview.md",
        )?.provenance,
      ).toContain("header");
    } finally {
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });

  it("uses note body excerpts to rerank durable recall candidates", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-excerpt-rerank-"));
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
          "- [Gateway note](./project-gateway-note.md) - General gateway maintenance note.",
          "- [Probe note](./project-probe-note.md) - General probe maintenance note.",
        ].join("\n"),
        "utf8",
      );
      await writeNote(
        path.join(scopeDir, "project-gateway-note.md"),
        [
          "---",
          "title: Gateway note",
          "durable_memory_type: project",
          "description: General gateway maintenance note.",
          "---",
          "",
          "Gateway process checklist.",
        ].join("\n"),
      );
      await writeNote(
        path.join(scopeDir, "project-probe-note.md"),
        [
          "---",
          "title: Probe note",
          "durable_memory_type: project",
          "description: General probe maintenance note.",
          "---",
          "",
          "If probes stay stale after a restart, clear the stale gateway process first, then restart the probes.",
        ].join("\n"),
      );

      const result = await recallDurableMemory({
        scope,
        prompt: "How do I clear a stale gateway process before restarting probes?",
        limit: 1,
      });

      expect(result.selection.mode).toBe("heuristic");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.metadata?.notePath).toBe("project-probe-note.md");
      expect(result.selection.selectedDetails?.[0]?.provenance).toContain("body_rerank");
      expect(
        result.selection.omittedDetails?.find(
          (entry) => entry.notePath === "project-gateway-note.md",
        )?.omittedReason,
      ).toBe("ranked_below_limit");
    } finally {
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });

  it("bounds durable excerpt reads to the top candidate slice", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-excerpt-bound-"));
    const readSpy = vi.spyOn(fs, "readFile");
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
          ...Array.from(
            { length: 20 },
            (_, index) =>
              `- [Note ${index + 1}](./project-note-${index + 1}.md) - Candidate ${index + 1}.`,
          ),
        ].join("\n"),
        "utf8",
      );
      for (let index = 0; index < 20; index += 1) {
        await writeNote(
          path.join(scopeDir, `project-note-${index + 1}.md`),
          [
            "---",
            `title: Note ${index + 1}`,
            "durable_memory_type: project",
            `description: Candidate ${index + 1}.`,
            "---",
            "",
            `Body ${index + 1}.`,
          ].join("\n"),
        );
      }

      await recallDurableMemory({
        scope,
        prompt: "candidate",
        limit: 1,
      });
      readSpy.mockClear();

      await recallDurableMemory({
        scope,
        prompt: "candidate",
        limit: 1,
      });

      const excerptReads = readSpy.mock.calls
        .map((call) => call[0])
        .filter(
          (value): value is string =>
            typeof value === "string" && value.includes("project-note-") && value.endsWith(".md"),
        );
      expect(excerptReads.length).toBeLessThanOrEqual(13);
    } finally {
      readSpy.mockRestore();
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });

  it("uses the body index cache to promote old body-strong durable notes into recall candidates", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-body-index-"));
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
          ...Array.from(
            { length: 20 },
            (_, index) =>
              `- [Project note ${index + 1}](./project-note-${index + 1}.md) - General project context ${index + 1}.`,
          ),
        ].join("\n"),
        "utf8",
      );

      const now = Date.now();
      for (let index = 0; index < 20; index += 1) {
        const notePath = path.join(scopeDir, `project-note-${index + 1}.md`);
        const isTarget = index === 19;
        await writeNote(
          notePath,
          [
            "---",
            `title: Project note ${index + 1}`,
            "durable_memory_type: project",
            `description: General project context ${index + 1}.`,
            "---",
            "",
            isTarget
              ? "The legacy subsystem uses needlecache routing. When asked about needlecache, recall this old note even if the title is generic."
              : `General body ${index + 1}.`,
          ].join("\n"),
        );
        const updatedAt = isTarget ? now - 20 * 60_000 : now - index * 1_000;
        await fs.utimes(notePath, new Date(updatedAt), new Date(updatedAt));
      }

      const result = await recallDurableMemory({
        scope,
        prompt: "How does needlecache routing work?",
        limit: 1,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.metadata?.notePath).toBe("project-note-20.md");
      expect(result.selection.selectedDetails[0]?.provenance).toContain("body_index");
      expect(result.selection.selectedDetails[0]?.scoreBreakdown.bodyIndex).toBeGreaterThan(0);
    } finally {
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });

  it("boosts recently dream-touched notes during heuristic recall", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-dream-boost-"));
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
          "- [Gateway recovery A](./project-gateway-a.md) - Gateway recovery note.",
          "- [Gateway recovery B](./project-gateway-b.md) - Gateway recovery note.",
        ].join("\n"),
        "utf8",
      );
      for (const suffix of ["a", "b"]) {
        await writeNote(
          path.join(scopeDir, `project-gateway-${suffix}.md`),
          [
            "---",
            `title: Gateway recovery ${suffix.toUpperCase()}`,
            "durable_memory_type: project",
            "description: Gateway recovery note.",
            "---",
            "",
            "Gateway recovery baseline note.",
          ].join("\n"),
        );
      }

      const result = await recallDurableMemory({
        scope,
        prompt: "gateway recovery",
        recentDreamTouchedNotes: [{ notePath: "project-gateway-b.md", touchedAt: Date.now() }],
        limit: 1,
      });

      expect(result.selection.mode).toBe("heuristic");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.metadata?.notePath).toBe("project-gateway-b.md");
      expect(result.selection.selectedDetails?.[0]?.provenance).toContain("dream_boost");
    } finally {
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });

  it("does not apply dream boost to unrelated touched durable notes", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-dream-relevance-"));
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
          "- [Answer style](./feedback-answer-style.md) - Keep answers short.",
          "- [Gateway recovery](./project-gateway-recovery.md) - Gateway recovery note.",
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
        path.join(scopeDir, "project-gateway-recovery.md"),
        [
          "---",
          "title: Gateway recovery",
          "durable_memory_type: project",
          "description: Gateway recovery note.",
          "---",
          "",
          "Restart gateway probes after clearing stale processes.",
        ].join("\n"),
      );

      const result = await recallDurableMemory({
        scope,
        prompt: "gateway recovery",
        recentDreamTouchedNotes: [{ notePath: "feedback-answer-style.md", touchedAt: Date.now() }],
        limit: 1,
      });

      const unrelated = result.selection.omittedDetails.find(
        (entry) => entry.notePath === "feedback-answer-style.md",
      );
      expect(result.items[0]?.metadata?.notePath).toBe("project-gateway-recovery.md");
      expect(unrelated?.provenance).not.toContain("dream_boost");
      expect(unrelated?.scoreBreakdown.dreamBoost).toBe(0);
    } finally {
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });

  it("decays dream boost for stale touched durable notes", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-dream-decay-"));
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
          "- [Gateway recovery](./project-gateway-recovery.md) - Gateway recovery note.",
        ].join("\n"),
        "utf8",
      );
      await writeNote(
        path.join(scopeDir, "project-gateway-recovery.md"),
        [
          "---",
          "title: Gateway recovery",
          "durable_memory_type: project",
          "description: Gateway recovery note.",
          "---",
          "",
          "Restart gateway probes after clearing stale processes.",
        ].join("\n"),
      );

      const result = await recallDurableMemory({
        scope,
        prompt: "gateway recovery",
        recentDreamTouchedNotes: [
          { notePath: "project-gateway-recovery.md", touchedAt: Date.now() - 20 * 86_400_000 },
        ],
        limit: 1,
      });

      expect(result.selection.selectedDetails[0]?.provenance).not.toContain("dream_boost");
      expect(result.selection.selectedDetails[0]?.scoreBreakdown.dreamBoost).toBe(0);
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
        ["# Durable memory index", "", "- [Answer style](./feedback-answer-style.md)"].join("\n"),
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
        complete: async () =>
          JSON.stringify({ selectedIds: [], reason: "no relevant durable memory" }),
        limit: 1,
      });

      expect(result.selection.mode).toBe("llm_none");
      expect(result.selection.selectedItemIds).toEqual([]);
      expect(result.items).toEqual([]);
      expect(result.selection.omittedDetails?.[0]?.omittedReason).toBe("llm_none");
      expect(
        result.selection.omittedDetails?.find(
          (entry) => entry.notePath === "feedback-answer-style.md",
        )?.provenance,
      ).toContain("header");
    } finally {
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });
});
