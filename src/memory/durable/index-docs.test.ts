import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listDurableMemoryIndexDocuments, readDurableMemoryIndexDocument } from "./index-docs.ts";

async function createStateDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-index-docs-"));
}

describe("durable memory index documents", () => {
  it("lists scoped MEMORY.md index files and opens selected content", async () => {
    const stateDir = await createStateDir();
    const rootDir = path.join(stateDir, "durable-memory");
    const scopeDir = path.join(rootDir, "agents", "main");
    await fs.mkdir(path.join(scopeDir, "20 Projects"), { recursive: true });
    await fs.writeFile(
      path.join(scopeDir, "MEMORY.md"),
      [
        "# MEMORY.md",
        "",
        "## project",
        "- [Gateway recovery](./20 Projects/gateway-recovery.md) - restart order",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(scopeDir, "20 Projects", "gateway-recovery.md"),
      '---\ntype: "project"\n---\n\nRestart gateway first.\n',
      "utf8",
    );

    const result = await listDurableMemoryIndexDocuments({ rootDir });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: "agents/main/MEMORY.md",
        scopeKey: "main",
        agentId: "main",
        title: "MEMORY.md",
        noteCount: 1,
      }),
    ]);

    const document = await readDurableMemoryIndexDocument({
      rootDir,
      id: result.items[0]?.id ?? "",
    });

    expect(document.item.scopeKey).toBe("main");
    expect(document.content).toContain("Gateway recovery");
  });

  it("rejects paths outside the durable memory root", async () => {
    const rootDir = await createStateDir();

    await expect(readDurableMemoryIndexDocument({ rootDir, id: "../MEMORY.md" })).rejects.toThrow(
      /inside durable memory root/,
    );
  });
});
