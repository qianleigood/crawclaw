import { beforeEach, describe, expect, it, vi } from "vitest";

const resetArtifactMocks = vi.hoisted(() => ({
  archiveSessionTranscripts: vi.fn(),
  disposeSessionMcpRuntime: vi.fn(),
}));

vi.mock("../transcript-archive.fs.js", () => ({
  archiveSessionTranscripts: resetArtifactMocks.archiveSessionTranscripts,
}));

vi.mock("../../agents/pi-bundle-mcp-tools.js", () => ({
  disposeSessionMcpRuntime: resetArtifactMocks.disposeSessionMcpRuntime,
}));

const { archivePreviousSessionArtifacts, archiveSessionTranscriptsForMutation } =
  await import("./reset-artifacts.js");

describe("reset artifacts helpers", () => {
  beforeEach(() => {
    resetArtifactMocks.archiveSessionTranscripts
      .mockReset()
      .mockReturnValue(["/tmp/archived.jsonl"]);
    resetArtifactMocks.disposeSessionMcpRuntime.mockReset().mockResolvedValue(undefined);
  });

  it("archives nothing when there is no session id", () => {
    expect(
      archiveSessionTranscriptsForMutation({
        sessionId: undefined,
        storePath: "/tmp/sessions.json",
        reason: "reset",
      }),
    ).toEqual([]);
    expect(resetArtifactMocks.archiveSessionTranscripts).not.toHaveBeenCalled();
  });

  it("archives transcript candidates for reset/delete mutations", () => {
    const archived = archiveSessionTranscriptsForMutation({
      sessionId: "session-1",
      storePath: "/tmp/sessions.json",
      sessionFile: "/tmp/session-1.jsonl",
      agentId: "main",
      reason: "deleted",
    });

    expect(archived).toEqual(["/tmp/archived.jsonl"]);
    expect(resetArtifactMocks.archiveSessionTranscripts).toHaveBeenCalledWith({
      sessionId: "session-1",
      storePath: "/tmp/sessions.json",
      sessionFile: "/tmp/session-1.jsonl",
      agentId: "main",
      reason: "deleted",
    });
  });

  it("archives and disposes the previous MCP runtime on session reset", async () => {
    const archived = await archivePreviousSessionArtifacts({
      sessionId: "session-2",
      storePath: "/tmp/sessions.json",
      sessionFile: "/tmp/session-2.jsonl",
      agentId: "main",
      disposeMcpRuntime: true,
    });

    expect(archived).toEqual(["/tmp/archived.jsonl"]);
    expect(resetArtifactMocks.archiveSessionTranscripts).toHaveBeenCalledWith({
      sessionId: "session-2",
      storePath: "/tmp/sessions.json",
      sessionFile: "/tmp/session-2.jsonl",
      agentId: "main",
      reason: "reset",
    });
    expect(resetArtifactMocks.disposeSessionMcpRuntime).toHaveBeenCalledWith("session-2");
  });
});
