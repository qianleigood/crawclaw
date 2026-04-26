import { describe, expect, it } from "vitest";
import { saveImprovementProposal } from "../improvement/store.js";
import type { ImprovementProposal } from "../improvement/types.js";
import { handleImprovementCenterHttpRequest } from "./improvement-center-web.js";
import {
  AUTH_NONE,
  createRequest,
  createResponse,
  sendRequest,
  withGatewayServer,
} from "./server-http.test-harness.js";

function buildProposal(params: {
  id: string;
  status: ImprovementProposal["status"];
  kind: ImprovementProposal["patchPlan"]["kind"];
  updatedAt: number;
}): ImprovementProposal {
  return {
    id: params.id,
    status: params.status,
    candidate: {
      id: `candidate-${params.id}`,
      sourceRefs: [{ kind: "experience", ref: `exp-${params.id}` }],
      signalSummary: `Signal ${params.id}`,
      observedFrequency: 2,
      currentReuseLevel: "experience",
      triggerPattern: "repeat trigger",
      repeatedActions: ["Do the stable action"],
      validationEvidence: ["Validated once"],
      firstSeenAt: params.updatedAt - 10,
      lastSeenAt: params.updatedAt,
    },
    verdict: {
      candidateId: `candidate-${params.id}`,
      decision:
        params.kind === "workflow"
          ? "propose_workflow"
          : params.kind === "code"
            ? "propose_code"
            : "propose_skill",
      confidence: "high",
      riskLevel: "low",
      targetScope: "workspace",
      triggerPattern: "workflow issue repeats",
      reusableMethod: "Check registry, operations, and executions in order.",
      reasonsFor: ["Repeated issue", "Stable procedure"],
      reasonsAgainst: [],
      missingEvidence: [],
      verificationPlan: ["Validate the generated skill"],
    },
    patchPlan:
      params.kind === "skill"
        ? {
            kind: "skill",
            targetDir: ".agents/skills",
            skillName: `skill-${params.id}`,
            markdown: ["---", `name: skill-${params.id}`, "---", "", "# Skill"].join("\n"),
          }
        : params.kind === "workflow"
          ? {
              kind: "workflow",
              patch: {
                mode: "create",
                draft: {
                  name: `Workflow ${params.id}`,
                  goal: "Run the stable action",
                  safeForAutoRun: false,
                  requiresApproval: true,
                },
              },
            }
          : {
              kind: "code",
              summary: "Manual code improvement only.",
              recommendedWorktree: true,
            },
    policyResult: {
      allowed: params.kind !== "code",
      blockers: params.kind === "code" ? ["code"] : [],
    },
    rollbackPlan: ["Rollback the applied artifact."],
    createdAt: params.updatedAt - 10,
    updatedAt: params.updatedAt,
  };
}

describe("Improvement Center HTTP surface", () => {
  it("serves the Improvement Center shell at /improvements", async () => {
    await withGatewayServer({
      prefix: "crawclaw-improvement-center-",
      resolvedAuth: AUTH_NONE,
      run: async (server) => {
        const response = await sendRequest(server, {
          path: "/improvements",
          host: "127.0.0.1:18789",
        });

        expect(response.res.statusCode).toBe(200);
        expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "text/html; charset=utf-8");
        expect(response.getBody()).toContain("Improvement Center");
        expect(response.getBody()).toContain("/improvements/app.js");
        expect(response.getBody()).toContain("/improvements/styles.css");
      },
    });
  });

  it("serves browser assets with readable copy and improvement RPC methods", async () => {
    await withGatewayServer({
      prefix: "crawclaw-improvement-center-assets-",
      resolvedAuth: AUTH_NONE,
      run: async (server) => {
        const script = await sendRequest(server, {
          path: "/improvements/app.js",
          host: "127.0.0.1:18789",
        });
        const styles = await sendRequest(server, {
          path: "/improvements/styles.css",
          host: "127.0.0.1:18789",
        });

        expect(script.res.statusCode).toBe(200);
        expect(script.setHeader).toHaveBeenCalledWith(
          "Content-Type",
          "application/javascript; charset=utf-8",
        );
        expect(script.getBody()).toContain("/improvements/api/proposals");
        expect(script.getBody()).toContain("/improvements/api/run");
        expect(script.getBody()).toContain("/improvements/api/metrics");
        expect(script.getBody()).toContain("What CrawClaw noticed");
        expect(script.getBody()).toContain("Approve records human approval");
        expect(script.getBody()).not.toContain("new WebSocket(");
        expect(script.getBody()).not.toContain("confirm(");
        expect(styles.res.statusCode).toBe(200);
        expect(styles.setHeader).toHaveBeenCalledWith("Content-Type", "text/css; charset=utf-8");
        expect(styles.getBody()).toContain("@media (max-width: 860px)");
        expect(styles.getBody()).toContain("grid-template-columns");
      },
    });
  });

  it("rejects unsupported methods on the Improvement Center page", async () => {
    await withGatewayServer({
      prefix: "crawclaw-improvement-center-methods-",
      resolvedAuth: AUTH_NONE,
      run: async (server) => {
        const response = await sendRequest(server, {
          path: "/improvements",
          host: "127.0.0.1:18789",
          method: "POST",
        });

        expect(response.res.statusCode).toBe(405);
        expect(response.setHeader).toHaveBeenCalledWith("Allow", "GET, HEAD");
        expect(response.getBody()).toBe("Method Not Allowed");
      },
    });
  });

  it("serves proposal list and review actions over the HTTP API", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { Readable } = await import("node:stream");
    const workspaceDir = await mkdtemp(join(tmpdir(), "crawclaw-improvement-center-http-"));
    try {
      await saveImprovementProposal(
        { workspaceDir },
        buildProposal({
          id: "http-api-skill",
          status: "pending_review",
          kind: "skill",
          updatedAt: Date.now(),
        }),
      );

      const listResponse = createResponse();
      await handleImprovementCenterHttpRequest({
        req: createRequest({
          path: "/improvements/api/proposals?limit=10",
          method: "GET",
          host: "127.0.0.1:18789",
        }),
        res: listResponse.res,
        requestPath: "/improvements/api/proposals",
        workspaceDir,
      });

      expect(listResponse.res.statusCode).toBe(200);
      const listBody = JSON.parse(listResponse.getBody()) as {
        proposals: Array<{ id: string; statusLabel: string }>;
      };
      expect(listBody.proposals.some((proposal) => proposal.id === "http-api-skill")).toBe(true);

      const reviewResponse = createResponse();
      const reviewReq = Object.assign(
        Readable.from([JSON.stringify({ approved: true, reviewer: "browser-test" })]),
        createRequest({
          path: "/improvements/api/proposals/http-api-skill/review",
          method: "POST",
          host: "127.0.0.1:18789",
          headers: { "content-type": "application/json" },
        }),
      );
      await handleImprovementCenterHttpRequest({
        req: reviewReq,
        res: reviewResponse.res,
        requestPath: "/improvements/api/proposals/http-api-skill/review",
        workspaceDir,
      });

      expect(reviewResponse.res.statusCode).toBe(200);
      const reviewBody = JSON.parse(reviewResponse.getBody()) as {
        proposal: { id: string; statusLabel: string };
      };
      expect(reviewBody.proposal.id).toBe("http-api-skill");
      expect(reviewBody.proposal.statusLabel).toBe("Approved");
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
