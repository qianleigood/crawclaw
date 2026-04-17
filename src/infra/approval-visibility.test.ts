import { describe, expect, it } from "vitest";
import { buildApprovalActionVisibilityProjection } from "./approval-visibility.js";

describe("buildApprovalActionVisibilityProjection", () => {
  it("uses exec-specific waiting titles and preserves command summary", () => {
    expect(
      buildApprovalActionVisibilityProjection({
        status: "waiting",
        summary: "pnpm test auth",
        detail: { kind: "exec" },
      }),
    ).toEqual({
      projectedTitle: "Waiting for exec approval",
      projectedSummary: "pnpm test auth",
    });
  });

  it("uses plugin-specific waiting titles", () => {
    expect(
      buildApprovalActionVisibilityProjection({
        status: "waiting",
        summary: "Publish note",
        detail: { kind: "plugin" },
      }),
    ).toEqual({
      projectedTitle: "Waiting for plugin approval",
      projectedSummary: "Publish note",
    });
  });

  it("hides no-approval-route machine summaries", () => {
    expect(
      buildApprovalActionVisibilityProjection({
        status: "blocked",
        summary: "no-approval-route",
        detail: { kind: "exec", reason: "no-approval-route" },
      }),
    ).toEqual({
      projectedTitle: "Approval unavailable",
    });
  });

  it("keeps decision summaries for resolved approvals", () => {
    expect(
      buildApprovalActionVisibilityProjection({
        status: "completed",
        summary: "allow-once",
        detail: { kind: "exec", decision: "allow-once" },
      }),
    ).toEqual({
      projectedTitle: "Approval granted",
      projectedSummary: "allow-once",
    });
  });

  it("maps deny decisions to denied titles", () => {
    expect(
      buildApprovalActionVisibilityProjection({
        status: "blocked",
        summary: "deny",
        detail: { kind: "plugin", decision: "deny" },
      }),
    ).toEqual({
      projectedTitle: "Approval denied",
      projectedSummary: "deny",
    });
  });
});
