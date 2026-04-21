import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import {
  createSessionSummaryEditTool,
  createSessionSummaryReadTool,
  createSessionSummaryTools,
} from "./session-summary-tools.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("session summary tools", () => {
  it("exposes read/edit tools for a session-scoped summary file", async () => {
    const rootDir = await tempDirs.make("session-summary-tools-");
    const readTool = createSessionSummaryReadTool({
      agentId: "main",
      summarySessionId: "session-1",
      rootDir,
    });
    const editTool = createSessionSummaryEditTool({
      agentId: "main",
      summarySessionId: "session-1",
      rootDir,
    });
    const toolNames = createSessionSummaryTools({
      agentId: "main",
      summarySessionId: "session-1",
      rootDir,
    }).map((tool) => tool.name);

    expect(readTool?.name).toBe("session_summary_file_read");
    expect(editTool?.name).toBe("session_summary_file_edit");
    expect(toolNames).toEqual(["session_summary_file_read", "session_summary_file_edit"]);
  });

  it("reads and edits the scoped summary.md file", async () => {
    const rootDir = await tempDirs.make("session-summary-tools-fs-");
    const tools = createSessionSummaryTools({
      agentId: "main",
      summarySessionId: "session-2",
      rootDir,
    });
    const readTool = tools.find((tool) => tool.name === "session_summary_file_read");
    const editTool = tools.find((tool) => tool.name === "session_summary_file_edit");
    if (!readTool || !editTool) {
      throw new Error("session summary tools missing");
    }

    const initialRead = await readTool.execute("session-summary-read", {});
    const initial = initialRead.details as {
      summaryPath?: string;
      content?: string;
      exists?: boolean;
    };
    expect(initial.exists).toBe(true);
    expect(initial.content).toContain("# Current State");
    expect(initial.summaryPath).toBeDefined();

    const editResult = await editTool.execute("session-summary-edit", {
      findText:
        "# Current State\n_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._\n\n",
      replaceText:
        "# Current State\n_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._\n\nUpdated\n\n",
    });
    const edited = editResult.details as { replacements?: number; content?: string };
    expect(edited.replacements).toBe(1);
    expect(edited.content).toContain("Updated");

    const readResult = await readTool.execute("session-summary-read", {});
    const read = readResult.details as { content?: string; exists?: boolean };
    expect(read.exists).toBe(true);
    expect(read.content).toContain("Updated");
    if (initial.summaryPath) {
      expect(await fs.readFile(path.resolve(initial.summaryPath), "utf8")).toContain("Updated");
    }
  });
});
