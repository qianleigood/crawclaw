import { loadConfig } from "../../config/config.js";
import {
  applyImprovementProposal,
  getImprovementProposalDetail,
  ImprovementCenterError,
  listImprovementProposals,
  reviewImprovementProposal,
  rollbackImprovementProposal,
  runImprovementScan,
  summarizeImprovementMetrics,
  verifyImprovementProposal,
} from "../../improvement/center.js";
import {
  buildImprovementDetailView,
  buildImprovementListViewItem,
  mapImprovementCenterError,
} from "../../improvement/view-model.js";
import {
  ErrorCodes,
  errorShape,
  validateImprovementGetParams,
  validateImprovementListParams,
  validateImprovementMetricsParams,
  validateImprovementMutationParams,
  validateImprovementReviewParams,
  validateImprovementRunParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

function workspaceDirFrom(params: { workspaceDir?: string }): string {
  return params.workspaceDir ?? process.cwd();
}

function respondError(respond: RespondFn, error: unknown) {
  if (error instanceof ImprovementCenterError) {
    const view = mapImprovementCenterError(error.code);
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, error.message, {
        details: {
          code: error.code,
          title: view.title,
          message: view.message,
        },
      }),
    );
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
}

export const improvementHandlers: GatewayRequestHandlers = {
  "improvement.list": async ({ params, respond }) => {
    if (!assertValidParams(params, validateImprovementListParams, "improvement.list", respond)) {
      return;
    }
    const workspaceDir = workspaceDirFrom(params);
    try {
      const proposals = await listImprovementProposals(
        { workspaceDir },
        { limit: params.limit, kinds: params.kinds, statuses: params.statuses },
      );
      respond(
        true,
        {
          workspaceDir,
          proposals: proposals.map(buildImprovementListViewItem),
        },
        undefined,
      );
    } catch (error) {
      respondError(respond, error);
    }
  },
  "improvement.get": async ({ params, respond }) => {
    if (!assertValidParams(params, validateImprovementGetParams, "improvement.get", respond)) {
      return;
    }
    const workspaceDir = workspaceDirFrom(params);
    try {
      const detail = await getImprovementProposalDetail({ workspaceDir }, params.proposalId);
      respond(true, { workspaceDir, proposal: buildImprovementDetailView(detail) }, undefined);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "improvement.metrics": async ({ params, respond }) => {
    if (
      !assertValidParams(params, validateImprovementMetricsParams, "improvement.metrics", respond)
    ) {
      return;
    }
    const workspaceDir = workspaceDirFrom(params);
    try {
      const metrics = await summarizeImprovementMetrics({ workspaceDir });
      respond(true, { workspaceDir, metrics }, undefined);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "improvement.run": async ({ params, respond }) => {
    if (!assertValidParams(params, validateImprovementRunParams, "improvement.run", respond)) {
      return;
    }
    const workspaceDir = workspaceDirFrom(params);
    try {
      const result = await runImprovementScan({ workspaceDir, config: loadConfig() });
      const proposal = result.proposal
        ? buildImprovementDetailView(
            await getImprovementProposalDetail({ workspaceDir }, result.proposal.id),
          )
        : undefined;
      respond(true, { workspaceDir, run: result.run, proposal }, undefined);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "improvement.review": async ({ params, respond }) => {
    if (
      !assertValidParams(params, validateImprovementReviewParams, "improvement.review", respond)
    ) {
      return;
    }
    const workspaceDir = workspaceDirFrom(params);
    try {
      const proposal = await reviewImprovementProposal({
        workspaceDir,
        proposalId: params.proposalId,
        approved: params.approved,
        reviewer: params.reviewer,
        comments: params.comments,
      });
      const detail = await getImprovementProposalDetail({ workspaceDir }, proposal.id);
      respond(true, { workspaceDir, proposal: buildImprovementDetailView(detail) }, undefined);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "improvement.apply": async ({ params, respond }) => {
    if (
      !assertValidParams(params, validateImprovementMutationParams, "improvement.apply", respond)
    ) {
      return;
    }
    const workspaceDir = workspaceDirFrom(params);
    try {
      const proposal = await applyImprovementProposal({
        workspaceDir,
        proposalId: params.proposalId,
        config: loadConfig(),
      });
      const detail = await getImprovementProposalDetail({ workspaceDir }, proposal.id);
      respond(true, { workspaceDir, proposal: buildImprovementDetailView(detail) }, undefined);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "improvement.verify": async ({ params, respond }) => {
    if (
      !assertValidParams(params, validateImprovementMutationParams, "improvement.verify", respond)
    ) {
      return;
    }
    const workspaceDir = workspaceDirFrom(params);
    try {
      const proposal = await verifyImprovementProposal({
        workspaceDir,
        proposalId: params.proposalId,
        config: loadConfig(),
      });
      const detail = await getImprovementProposalDetail({ workspaceDir }, proposal.id);
      respond(true, { workspaceDir, proposal: buildImprovementDetailView(detail) }, undefined);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "improvement.rollback": async ({ params, respond }) => {
    if (
      !assertValidParams(params, validateImprovementMutationParams, "improvement.rollback", respond)
    ) {
      return;
    }
    const workspaceDir = workspaceDirFrom(params);
    try {
      const proposal = await rollbackImprovementProposal({
        workspaceDir,
        proposalId: params.proposalId,
      });
      const detail = await getImprovementProposalDetail({ workspaceDir }, proposal.id);
      respond(true, { workspaceDir, proposal: buildImprovementDetailView(detail) }, undefined);
    } catch (error) {
      respondError(respond, error);
    }
  },
};
