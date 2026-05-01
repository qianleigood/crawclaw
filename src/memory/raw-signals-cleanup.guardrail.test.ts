import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

describe("raw signal memory cleanup guardrail", () => {
  it("keeps the removed raw signal buffer out of runtime and gateway surfaces", async () => {
    await expect(pathExists("src/memory/signals")).resolves.toBe(false);
    await expect(
      pathExists("src/memory/runtime/sqlite-runtime-store.memory-signals.test.ts"),
    ).resolves.toBe(false);
    await expect(pathExists("src/memory/runtime/migrations/020_memory_signals.sql")).resolves.toBe(
      false,
    );

    const checkedFiles = [
      "src/gateway/server-methods-list.ts",
      "src/gateway/method-scopes.ts",
      "src/gateway/server-methods/memory.ts",
      "src/memory/runtime/runtime-store.ts",
      "src/memory/runtime/sqlite-runtime-store.ts",
      "src/memory/types/runtime.ts",
      "src/memory/README.md",
    ];

    for (const file of checkedFiles) {
      const source = await readRepoFile(file);
      expect(source, file).not.toContain("memory.signals");
      expect(source, file).not.toContain("MemorySignal");
      expect(source, file).not.toContain("appendMemorySignal");
      expect(source, file).not.toContain("listMemorySignals");
      expect(source, file).not.toContain("gm_memory_signals");
      expect(source, file).not.toContain("memory/signals");
    }
  });
});
