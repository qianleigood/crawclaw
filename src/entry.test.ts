import { describe, expect, it, vi } from "vitest";
import { tryHandleRootHelpFastPath } from "./entry.js";

describe("entry root help fast path", () => {
  it("renders root help without importing the full program", async () => {
    const outputRootHelpMock = vi.fn();

    const handled = tryHandleRootHelpFastPath(["node", "crawclaw", "--help"], {
      outputRootHelp: outputRootHelpMock,
    });
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(outputRootHelpMock).toHaveBeenCalledTimes(1);
  });

  it("ignores non-root help invocations", () => {
    const outputRootHelpMock = vi.fn();

    const handled = tryHandleRootHelpFastPath(["node", "crawclaw", "status", "--help"], {
      outputRootHelp: outputRootHelpMock,
    });

    expect(handled).toBe(false);
    expect(outputRootHelpMock).not.toHaveBeenCalled();
  });
});
