import { describe, expect, it } from "vitest";
import { buildCompletionActionVisibilityProjection } from "./completion-visibility.js";

describe("buildCompletionActionVisibilityProjection", () => {
  it("projects accepted completion states", () => {
    expect(
      buildCompletionActionVisibilityProjection({
        status: "completed",
        summary: "Completion evidence satisfied for fix task.",
        detail: {
          completionStatus: "accepted",
        },
      }),
    ).toEqual({
      projectedTitle: "Completion accepted",
      projectedSummary: "Completion evidence satisfied for fix task.",
    });
  });

  it("projects waiting_user completion states", () => {
    expect(
      buildCompletionActionVisibilityProjection({
        status: "waiting",
        summary: "Task is waiting for explicit user confirmation before it can be completed.",
        detail: {
          completionStatus: "waiting_user",
        },
      }),
    ).toEqual({
      projectedTitle: "Waiting for user confirmation",
      projectedSummary:
        "Task is waiting for explicit user confirmation before it can be completed.",
    });
  });

  it("projects waiting_external completion states", () => {
    expect(
      buildCompletionActionVisibilityProjection({
        status: "waiting",
        summary: "Task is waiting for the external condition to be observed before completion.",
        detail: {
          completionStatus: "waiting_external",
        },
      }),
    ).toEqual({
      projectedTitle: "Waiting for external condition",
      projectedSummary:
        "Task is waiting for the external condition to be observed before completion.",
    });
  });

  it("projects review_missing blockers", () => {
    expect(
      buildCompletionActionVisibilityProjection({
        status: "blocked",
        summary: "Missing completion evidence: one of passing test, assertion command.",
        detail: {
          completionStatus: "incomplete",
          blockingState: "review_missing",
        },
      }),
    ).toEqual({
      projectedTitle: "Completion missing review",
      projectedSummary: "Missing completion evidence: one of passing test, assertion command.",
    });
  });
});
