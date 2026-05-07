import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanDurableMemoryManifest } from "./manifest.ts";

async function writeNote(filePath: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
}

describe("durable memory manifest", () => {
  it("extracts MEMORY.md index hooks alongside note metadata", async () => {
    const scopeDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-manifest-"));
    try {
      await fs.writeFile(
        path.join(scopeDir, "MEMORY.md"),
        [
          "# MEMORY.md",
          "",
          "## project",
          "- [Gateway recovery](./project-gateway-recovery.md) — Clear stale gateway processes before restarting probes.",
        ].join("\n"),
        "utf8",
      );
      await writeNote(
        path.join(scopeDir, "project-gateway-recovery.md"),
        [
          "---",
          "title: Gateway recovery",
          "durable_memory_type: project",
          "description: Recover the local gateway safely.",
          "---",
          "",
          "Gateway recovery note.",
        ].join("\n"),
      );

      const manifest = await scanDurableMemoryManifest({
        scope: {
          agentId: "main",
          channel: "discord",
          userId: "user-42",
          scopeKey: "main",
          rootDir: scopeDir,
        },
      });

      expect(manifest).toHaveLength(1);
      expect(manifest[0]).toMatchObject({
        notePath: "project-gateway-recovery.md",
        title: "Gateway recovery",
        durableType: "project",
      });
      expect(manifest[0]?.indexHook).toContain("Clear stale gateway processes");
    } finally {
      await fs.rm(scopeDir, { recursive: true, force: true });
    }
  });
});
