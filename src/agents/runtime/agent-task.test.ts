import { describe, expect, it } from "vitest";
import {
  getAgentTaskMode,
  getParentAgentId,
  isAgentTaskRecord,
  normalizeAgentTaskMetadata,
} from "./agent-task.js";

describe("agent-task metadata helpers", () => {
  it("normalizes and trims metadata fields", () => {
    expect(
      normalizeAgentTaskMetadata({
        parentAgentId: " parent-agent ",
        mode: "background",
        transcriptRef: " transcript.jsonl ",
        runtimeStateRef: " runtime.json ",
        capabilitySnapshotRef: " capabilities.json ",
        spawnSource: " sessions_spawn ",
      }),
    ).toEqual({
      parentAgentId: "parent-agent",
      mode: "background",
      transcriptRef: "transcript.jsonl",
      runtimeStateRef: "runtime.json",
      capabilitySnapshotRef: "capabilities.json",
      spawnSource: "sessions_spawn",
    });
  });

  it("recognizes agent-backed tasks and exposes derived helpers", () => {
    const task = {
      agentId: "agent-child",
      agentMetadata: {
        parentAgentId: "agent-parent",
        mode: "foreground" as const,
      },
    };

    expect(isAgentTaskRecord(task)).toBe(true);
    expect(getAgentTaskMode(task)).toBe("foreground");
    expect(getParentAgentId(task)).toBe("agent-parent");
  });
});
