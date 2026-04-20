import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryManifestReadTool,
  createMemoryNoteDeleteTool,
  createMemoryNoteEditTool,
  createMemoryNoteReadTool,
  createMemoryNoteWriteTool,
} from "./memory-file-tools.js";

const previousStateDir = process.env.CRAWCLAW_STATE_DIR;
const previousDurableMemoryDir = process.env.CRAWCLAW_DURABLE_MEMORY_DIR;

async function createStateDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-memory-file-tools-"));
}

function createScopedTools() {
  const options = {
    scope: {
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    },
  };
  return {
    manifest: createMemoryManifestReadTool(options),
    read: createMemoryNoteReadTool(options),
    write: createMemoryNoteWriteTool(options),
    edit: createMemoryNoteEditTool(options),
    del: createMemoryNoteDeleteTool(options),
  };
}

describe("memory file tools", () => {
  afterEach(() => {
    if (previousStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = previousStateDir;
    }
    if (previousDurableMemoryDir === undefined) {
      delete process.env.CRAWCLAW_DURABLE_MEMORY_DIR;
    } else {
      process.env.CRAWCLAW_DURABLE_MEMORY_DIR = previousDurableMemoryDir;
    }
  });

  it("reads the manifest and performs scoped note read/write/edit/delete", async () => {
    process.env.CRAWCLAW_STATE_DIR = await createStateDir();
    const { manifest, read, write, edit, del } = createScopedTools();
    expect(manifest && read && write && edit && del).toBeTruthy();

    const notePath = "60 Preferences/step-first.md";
    const noteContent = [
      "---",
      'title: "Step-first answers"',
      'description: "Lead with steps first."',
      'type: "feedback"',
      'updated_at: "2026-04-07T00:00:00.000Z"',
      "---",
      "",
      "# Step-first answers",
      "",
      "## Summary",
      "",
      "Lead with steps first.",
      "",
    ].join("\n");
    const indexContent = [
      "# MEMORY.md",
      "",
      "## feedback",
      "",
      "- [Step-first answers](./60 Preferences/step-first.md) — Lead with steps first.",
      "",
    ].join("\n");

    const writeResult = await write!.execute("tool-1", {
      notePath,
      content: noteContent,
    });
    expect(JSON.stringify(writeResult.details)).toContain('"status":"ok"');

    await write!.execute("tool-2", {
      notePath: "MEMORY.md",
      content: indexContent,
    });

    const manifestResult = await manifest!.execute("tool-3", {});
    expect(JSON.stringify(manifestResult.details)).toContain('"entryCount":1');
    expect(JSON.stringify(manifestResult.details)).toContain("Step-first answers");

    const readResult = await read!.execute("tool-4", { notePath });
    expect(JSON.stringify(readResult.details)).toContain("Lead with steps first.");

    const editResult = await edit!.execute("tool-5", {
      notePath,
      findText: "Lead with steps first.",
      replaceText: "Lead with steps, then explain.",
    });
    expect(JSON.stringify(editResult.details)).toContain('"replacements":1');

    const readAfterEdit = await read!.execute("tool-6", { notePath });
    expect(JSON.stringify(readAfterEdit.details)).toContain("Lead with steps, then explain.");

    const deleteResult = await del!.execute("tool-7", { notePath });
    expect(JSON.stringify(deleteResult.details)).toContain('"status":"deleted"');
  });

  it("rejects MEMORY.md content that violates Claude-style index constraints", async () => {
    process.env.CRAWCLAW_STATE_DIR = await createStateDir();
    const { write } = createScopedTools();
    expect(write).toBeTruthy();

    await expect(
      write!.execute("tool-1", {
        notePath: "MEMORY.md",
        content: ["---", 'title: "bad"', "---", "", "# MEMORY.md"].join("\n"),
      }),
    ).rejects.toThrow(/frontmatter/i);
  });

  it("rejects note deletion paths that escape the durable memory scope", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-memory-delete-scope-"));
    process.env.CRAWCLAW_DURABLE_MEMORY_DIR = path.join(rootDir, "durable-root");
    const outsidePath = path.join(rootDir, "outside.md");
    await fs.writeFile(outsidePath, "outside", "utf8");

    const { del } = createScopedTools();
    expect(del).toBeTruthy();

    await expect(
      del!.execute("tool-8", {
        notePath: "../../../../../../../outside.md",
      }),
    ).rejects.toThrow(/scope|inside/i);
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside");
  });
});
