import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextArchiveExportSummary } from "../agents/context-archive/export.js";
import type { ContextArchiveService } from "../agents/context-archive/service.js";
import type { RuntimeEnv } from "../runtime.js";
import { agentExportContextCommand } from "./agent.export-context.js";

const mocks = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  resolveSharedContextArchiveServiceMock: vi.fn(),
  exportContextArchiveSnapshotMock: vi.fn(),
  writeRuntimeJsonMock: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfigMock,
}));

vi.mock("../agents/context-archive/runtime.js", () => ({
  resolveSharedContextArchiveService: mocks.resolveSharedContextArchiveServiceMock,
}));

vi.mock("../agents/context-archive/export.js", () => ({
  exportContextArchiveSnapshot: mocks.exportContextArchiveSnapshotMock,
}));

vi.mock("../runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
  return {
    ...actual,
    writeRuntimeJson: mocks.writeRuntimeJsonMock,
    defaultRuntime: {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    },
  };
});

function createRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

describe("agent.export-context command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigMock.mockReturnValue({});
    mocks.exportContextArchiveSnapshotMock.mockReset();
  });

  it("writes json for matching archive runs", async () => {
    const runtime = createRuntime();
    mocks.resolveSharedContextArchiveServiceMock.mockResolvedValue({
      rootDir: "/tmp/archive",
    } as Pick<ContextArchiveService, "rootDir">);
    const snapshot: ContextArchiveExportSummary = {
      version: 1,
      exportedAt: 1,
      rootDir: "/tmp/archive",
      filters: { taskId: "task-1" },
      runs: [{ run: { id: "carun-1" } }] as unknown as ContextArchiveExportSummary["runs"],
    } as unknown as ContextArchiveExportSummary;
    mocks.exportContextArchiveSnapshotMock.mockResolvedValue(snapshot);

    await agentExportContextCommand({ taskId: "task-1", json: true }, runtime);

    expect(mocks.writeRuntimeJsonMock).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({
        filters: { taskId: "task-1" },
      }),
    );
  });

  it("exits when no lookup target is passed", async () => {
    const runtime = createRuntime();

    await agentExportContextCommand({}, runtime);

    expect(runtime.error).toHaveBeenCalledWith(
      "Pass --run-id, --task-id, --session-id, or --agent-id.",
    );
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });
});
