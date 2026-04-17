import { describe, expect, it } from "vitest";
import { buildMemoryActionVisibilityProjection } from "./action-visibility.js";

describe("buildMemoryActionVisibilityProjection", () => {
  it("projects durable extraction completion titles", () => {
    expect(
      buildMemoryActionVisibilityProjection({
        kind: "extraction",
        phase: "final",
        resultStatus: "written",
        summary: "saved one durable note",
      }),
    ).toEqual({
      projectedTitle: "Memory extraction wrote durable notes",
      projectedSummary: "saved one durable note",
    });
  });

  it("projects session summary running titles", () => {
    expect(
      buildMemoryActionVisibilityProjection({
        kind: "session_summary",
        phase: "running",
        summary: "session-1",
      }),
    ).toEqual({
      projectedTitle: "Session summary running",
      projectedSummary: "session-1",
    });
  });

  it("projects dream gather titles", () => {
    expect(
      buildMemoryActionVisibilityProjection({
        kind: "dream",
        phase: "gather",
        summary: "main:feishu:user-1",
      }),
    ).toEqual({
      projectedTitle: "Dream gathering signal",
      projectedSummary: "main:feishu:user-1",
    });
  });

  it("projects dream no-change completion titles", () => {
    expect(
      buildMemoryActionVisibilityProjection({
        kind: "dream",
        phase: "final",
        resultStatus: "no_change",
        summary: "nothing durable changed",
      }),
    ).toEqual({
      projectedTitle: "Dream found no changes",
      projectedSummary: "nothing durable changed",
    });
  });
});
