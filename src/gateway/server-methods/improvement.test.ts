import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  listImprovementProposals: vi.fn(),
  getImprovementProposalDetail: vi.fn(),
  runImprovementScan: vi.fn(),
  reviewImprovementProposal: vi.fn(),
  applyImprovementProposal: vi.fn(),
  verifyImprovementProposal: vi.fn(),
  rollbackImprovementProposal: vi.fn(),
  summarizeImprovementMetrics: vi.fn(),
}));

vi.mock("../../improvement/center.js", async () => {
  const actual = await vi.importActual<typeof import("../../improvement/center.js")>(
    "../../improvement/center.js",
  );
  return { ...actual, ...mocks };
});

import { ImprovementCenterError } from "../../improvement/center.js";
import { improvementHandlers } from "./improvement.js";

function options(method: string, params: Record<string, unknown>): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {} as GatewayRequestHandlerOptions["context"],
  };
}

describe("improvementHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists proposal view models", async () => {
    mocks.listImprovementProposals.mockResolvedValue([
      {
        id: "proposal-1",
        candidateId: "candidate-1",
        kind: "skill",
        status: "pending_review",
        signalSummary: "Repeated release checklist",
        decision: "propose_skill",
        riskLevel: "low",
        confidence: "high",
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    const opts = options("improvement.list", { workspaceDir: "/tmp/ws", limit: 10 });
    await improvementHandlers["improvement.list"](opts);

    expect(mocks.listImprovementProposals).toHaveBeenCalledWith(
      { workspaceDir: "/tmp/ws" },
      { limit: 10, kinds: undefined, statuses: undefined },
    );
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        workspaceDir: "/tmp/ws",
        proposals: [
          expect.objectContaining({
            title: "Suggested Skill: Repeated release checklist",
            statusLabel: "Needs review",
          }),
        ],
      }),
      undefined,
    );
  });

  it("rejects invalid review params", async () => {
    const opts = options("improvement.review", { proposalId: "proposal-1" });
    await improvementHandlers["improvement.review"](opts);

    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: expect.stringContaining("invalid improvement.review params"),
      }),
    );
  });

  it("maps center errors to gateway errors with user-facing details", async () => {
    mocks.applyImprovementProposal.mockRejectedValue(
      new ImprovementCenterError("review_required", "review required"),
    );

    const opts = options("improvement.apply", {
      workspaceDir: "/tmp/ws",
      proposalId: "proposal-1",
    });
    await improvementHandlers["improvement.apply"](opts);

    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        details: expect.objectContaining({
          code: "review_required",
          title: "Approval required",
        }),
      }),
    );
  });
});
