import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const ImprovementStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("policy_blocked"),
  Type.Literal("pending_review"),
  Type.Literal("approved"),
  Type.Literal("applying"),
  Type.Literal("verifying"),
  Type.Literal("applied"),
  Type.Literal("rejected"),
  Type.Literal("failed"),
  Type.Literal("superseded"),
  Type.Literal("rolled_back"),
]);

const ImprovementKindSchema = Type.Union([
  Type.Literal("skill"),
  Type.Literal("workflow"),
  Type.Literal("code"),
]);

const ImprovementActionSchema = Type.Union([
  Type.Literal("approve"),
  Type.Literal("reject"),
  Type.Literal("apply"),
  Type.Literal("verify"),
  Type.Literal("rollback"),
]);

const ImprovementWorkspaceParams = {
  workspaceDir: Type.Optional(Type.String({ minLength: 1 })),
} as const;

export const ImprovementListParamsSchema = Type.Object(
  {
    ...ImprovementWorkspaceParams,
    statuses: Type.Optional(Type.Array(ImprovementStatusSchema)),
    kinds: Type.Optional(Type.Array(ImprovementKindSchema)),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);

export const ImprovementGetParamsSchema = Type.Object(
  {
    ...ImprovementWorkspaceParams,
    proposalId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ImprovementRunParamsSchema = Type.Object(
  {
    ...ImprovementWorkspaceParams,
  },
  { additionalProperties: false },
);

export const ImprovementReviewParamsSchema = Type.Object(
  {
    ...ImprovementWorkspaceParams,
    proposalId: NonEmptyString,
    approved: Type.Boolean(),
    reviewer: Type.Optional(Type.String()),
    comments: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ImprovementMutationParamsSchema = Type.Object(
  {
    ...ImprovementWorkspaceParams,
    proposalId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ImprovementMetricsParamsSchema = Type.Object(
  {
    ...ImprovementWorkspaceParams,
  },
  { additionalProperties: false },
);

export const ImprovementListViewItemSchema = Type.Object(
  {
    id: NonEmptyString,
    title: Type.String(),
    kind: ImprovementKindSchema,
    kindLabel: Type.String(),
    status: ImprovementStatusSchema,
    statusLabel: Type.String(),
    riskLabel: Type.String(),
    confidenceLabel: Type.String(),
    signalSummary: Type.String(),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const ImprovementDetailViewSchema = Type.Intersect([
  ImprovementListViewItemSchema,
  Type.Object(
    {
      plainSummary: Type.String(),
      primaryReason: Type.String(),
      safetySummary: Type.String(),
      changeSummary: Type.String(),
      canUndo: Type.Boolean(),
      evidenceItems: Type.Array(
        Type.Object(
          {
            label: Type.String(),
            value: Type.String(),
          },
          { additionalProperties: false },
        ),
      ),
      verificationPlan: Type.Array(Type.String()),
      rollbackPlan: Type.Array(Type.String()),
      patchPreview: Type.Object(
        {
          title: Type.String(),
          lines: Type.Array(Type.String()),
        },
        { additionalProperties: false },
      ),
      availableActions: Type.Array(ImprovementActionSchema),
      disabledActions: Type.Array(
        Type.Object(
          {
            action: ImprovementActionSchema,
            reason: Type.String(),
          },
          { additionalProperties: false },
        ),
      ),
      technicalDetails: Type.Record(Type.String(), Type.Unknown()),
    },
    { additionalProperties: false },
  ),
]);

export const ImprovementListResultSchema = Type.Object(
  {
    workspaceDir: Type.String(),
    proposals: Type.Array(ImprovementListViewItemSchema),
  },
  { additionalProperties: false },
);

export const ImprovementDetailResultSchema = Type.Object(
  {
    workspaceDir: Type.String(),
    proposal: ImprovementDetailViewSchema,
  },
  { additionalProperties: false },
);

export const ImprovementRunResultSchema = Type.Object(
  {
    workspaceDir: Type.String(),
    run: Type.Unknown(),
    proposal: Type.Optional(ImprovementDetailViewSchema),
  },
  { additionalProperties: false },
);

export const ImprovementMetricsResultSchema = Type.Object(
  {
    workspaceDir: Type.String(),
    metrics: Type.Unknown(),
  },
  { additionalProperties: false },
);

export type ImprovementListParams = Static<typeof ImprovementListParamsSchema>;
export type ImprovementGetParams = Static<typeof ImprovementGetParamsSchema>;
export type ImprovementRunParams = Static<typeof ImprovementRunParamsSchema>;
export type ImprovementReviewParams = Static<typeof ImprovementReviewParamsSchema>;
export type ImprovementMutationParams = Static<typeof ImprovementMutationParamsSchema>;
export type ImprovementMetricsParams = Static<typeof ImprovementMetricsParamsSchema>;
