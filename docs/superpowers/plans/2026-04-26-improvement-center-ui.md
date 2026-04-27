---
title: "Improvement Center UI Plan"
summary: "Implementation plan for the local Gateway-hosted Improvement Center UI"
read_when:
  - You are implementing the Improvement Center browser UI
  - You need the planned RPC, view-model, and Gateway serving work
---

# Improvement Center UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Gateway-hosted Improvement Center UI at `/improvements` that beginners can use to review, approve, apply, verify, and rollback governed improvement proposals.

**Architecture:** Add a readable view-model layer over `src/improvement/center.ts`, expose it through authenticated Gateway WebSocket RPC methods, and serve a small local HTML/CSS/JS page from the Gateway HTTP server. The page must not read `.crawclaw/improvements` directly and must not bypass policy, review, verification, or rollback behavior.

**Tech Stack:** TypeScript, Gateway WebSocket RPC, TypeBox protocol schemas, plain Gateway-served HTML/CSS/JS following `src/gateway/observation-workbench.ts`, Vitest.

---

## File Structure

- Create `src/improvement/view-model.ts`
  - Converts `ImprovementProposalListItem` and `ImprovementProposalDetail` into beginner-readable labels, summaries, patch previews, and disabled action explanations.
- Create `src/improvement/view-model.test.ts`
  - Covers skill, workflow, code, empty evidence, and disabled action mapping.
- Create `src/gateway/protocol/schema/improvement.ts`
  - Adds TypeBox schemas for `improvement.*` params and result payloads.
- Modify `src/gateway/protocol/schema.ts`
  - Exports the new improvement schema module.
- Modify `src/gateway/protocol/schema/protocol-schemas.ts`
  - Registers the new schemas in `ProtocolSchemas`.
- Create `src/gateway/server-methods/improvement.ts`
  - Implements Gateway handlers that delegate to `src/improvement/center.ts` and `src/improvement/view-model.ts`.
- Create `src/gateway/server-methods/improvement.test.ts`
  - Unit tests handler validation, center delegation, and error mapping.
- Modify `src/gateway/server-methods.ts`
  - Adds `improvementHandlers` to `coreGatewayHandlers`.
  - Adds mutation methods to `CONTROL_PLANE_WRITE_METHODS` so scan, review, apply, verify, and rollback share existing write-operation rate limiting.
- Modify `src/gateway/server-methods-list.ts`
  - Adds `improvement.list`, `improvement.get`, `improvement.metrics`, `improvement.run`, `improvement.review`, `improvement.apply`, `improvement.verify`, and `improvement.rollback`.
- Modify `src/gateway/method-scopes.ts`
  - Adds read methods to `operator.read` and mutation methods to `operator.write`.
- Create `src/gateway/improvement-center-web.ts`
  - Serves `/improvements`, `/improvements/app.js`, and `/improvements/styles.css`.
- Create `src/gateway/improvement-center-web.test.ts`
  - Covers shell, assets, method restrictions, and presence of readable UI copy/RPC methods.
- Modify `src/gateway/server-http.ts`
  - Authenticates and routes `/improvements*` to the new web surface.
- Modify `docs/web/index.md`
  - Adds Improvement Center to remaining Gateway browser surfaces.

Do not touch generated `src/canvas-host/a2ui/generated/a2ui.bundle.js`. This feature is not an A2UI canvas feature.

---

### Task 1: Add Beginner-Readable Improvement View Models

**Files:**

- Create: `src/improvement/view-model.ts`
- Create: `src/improvement/view-model.test.ts`

- [ ] **Step 1: Write failing tests for list and detail view models**

Create `src/improvement/view-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ImprovementProposalDetail, ImprovementProposalListItem } from "./center.js";
import type { ImprovementProposal } from "./types.js";
import {
  buildImprovementDetailView,
  buildImprovementListViewItem,
  mapImprovementCenterError,
} from "./view-model.js";

const now = 1_777_185_000_000;

function baseCandidate(): ImprovementProposal["candidate"] {
  return {
    id: "candidate-release",
    sourceRefs: [{ kind: "experience", ref: "exp-release-1" }],
    signalSummary: "Repeated release checklist before publishing",
    observedFrequency: 4,
    currentReuseLevel: "experience",
    triggerPattern: "before npm release",
    repeatedActions: ["run build", "run release checks"],
    validationEvidence: ["postpublish verify passed"],
    firstSeenAt: now - 1000,
    lastSeenAt: now,
  };
}

function baseVerdict(): ImprovementProposal["verdict"] {
  return {
    candidateId: "candidate-release",
    decision: "propose_skill",
    confidence: "high",
    riskLevel: "low",
    targetScope: "workspace",
    triggerPattern: "before npm release",
    reusableMethod: "Run build, release checks, and postpublish verification.",
    reasonsFor: ["Repeated 4 times", "Has validation evidence"],
    reasonsAgainst: [],
    missingEvidence: [],
    verificationPlan: ["Load skill", "Run skill discovery"],
  };
}

function skillProposal(overrides: Partial<ImprovementProposal> = {}): ImprovementProposal {
  return {
    id: "proposal-release-skill",
    status: "pending_review",
    candidate: baseCandidate(),
    verdict: baseVerdict(),
    patchPlan: {
      kind: "skill",
      targetDir: ".agents/skills",
      skillName: "release-checklist",
      markdown: "# Release checklist\n\nRun the release checks.",
    },
    policyResult: { allowed: true, blockers: [] },
    rollbackPlan: ["Delete .agents/skills/release-checklist/SKILL.md"],
    createdAt: now - 500,
    updatedAt: now,
    ...overrides,
  };
}

it("maps list items to beginner-readable labels", () => {
  const item: ImprovementProposalListItem = {
    id: "proposal-release-skill",
    candidateId: "candidate-release",
    kind: "skill",
    status: "pending_review",
    signalSummary: "Repeated release checklist before publishing",
    decision: "propose_skill",
    riskLevel: "low",
    confidence: "high",
    createdAt: now - 500,
    updatedAt: now,
  };

  expect(buildImprovementListViewItem(item)).toMatchObject({
    id: "proposal-release-skill",
    title: "Suggested Skill: Repeated release checklist before publishing",
    kindLabel: "Suggested Skill",
    statusLabel: "Needs review",
    riskLabel: "Low risk",
    confidenceLabel: "High confidence",
  });
});

it("puts plain-language summary before technical details", () => {
  const proposal = skillProposal();
  const detail: ImprovementProposalDetail = {
    proposal,
    evidenceRefs: proposal.candidate.sourceRefs,
    policyBlockers: [],
    availableActions: ["show", "approve", "reject"],
  };

  expect(buildImprovementDetailView(detail)).toMatchObject({
    id: "proposal-release-skill",
    title: "Suggested Skill: Repeated release checklist before publishing",
    plainSummary: "CrawClaw suggests creating a Skill from a repeated, validated pattern.",
    safetySummary: "Low risk. Policy allows this proposal.",
    changeSummary: "Create workspace skill .agents/skills/release-checklist/SKILL.md.",
    availableActions: expect.arrayContaining(["approve", "reject"]),
  });
});

it("disables code proposal apply with a clear explanation", () => {
  const proposal = skillProposal({
    verdict: { ...baseVerdict(), decision: "propose_code", riskLevel: "medium" },
    patchPlan: {
      kind: "code",
      summary: "Refactor repeated release validation into a shared helper.",
      recommendedWorktree: true,
    },
  });
  const detail: ImprovementProposalDetail = {
    proposal,
    evidenceRefs: proposal.candidate.sourceRefs,
    policyBlockers: [],
    availableActions: ["show"],
  };

  const view = buildImprovementDetailView(detail);
  expect(view.kindLabel).toBe("Code Change Proposal");
  expect(view.disabledActions).toContainEqual({
    action: "apply",
    reason: "Code proposals require a manual isolated worktree and review.",
  });
});

it("maps known center errors to short user messages", () => {
  expect(mapImprovementCenterError("review_required")).toEqual({
    title: "Approval required",
    message: "Approve this proposal before applying it.",
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
pnpm test -- src/improvement/view-model.test.ts
```

Expected:

```text
FAIL src/improvement/view-model.test.ts
Cannot find module './view-model.js'
```

- [ ] **Step 3: Implement the view-model layer**

Create `src/improvement/view-model.ts`:

```ts
import type {
  ImprovementCenterErrorCode,
  ImprovementProposalDetail,
  ImprovementProposalListItem,
} from "./center.js";
import type { ImprovementPatchPlan, ImprovementProposalStatus } from "./types.js";

export type ImprovementActionName = "approve" | "reject" | "apply" | "verify" | "rollback";

export type DisabledImprovementAction = {
  action: ImprovementActionName;
  reason: string;
};

export type ImprovementListViewItem = {
  id: string;
  title: string;
  kind: ImprovementPatchPlan["kind"];
  kindLabel: string;
  status: ImprovementProposalStatus;
  statusLabel: string;
  riskLabel: string;
  confidenceLabel: string;
  signalSummary: string;
  updatedAt: number;
};

export type ImprovementDetailView = ImprovementListViewItem & {
  plainSummary: string;
  primaryReason: string;
  safetySummary: string;
  changeSummary: string;
  evidenceItems: Array<{ label: string; value: string }>;
  verificationPlan: string[];
  rollbackPlan: string[];
  patchPreview: {
    title: string;
    lines: string[];
  };
  availableActions: ImprovementActionName[];
  disabledActions: DisabledImprovementAction[];
  technicalDetails: Record<string, unknown>;
};

export type ImprovementUserErrorView = {
  title: string;
  message: string;
};

const STATUS_LABELS: Record<ImprovementProposalStatus, string> = {
  draft: "Draft",
  policy_blocked: "Blocked by policy",
  pending_review: "Needs review",
  approved: "Approved",
  applying: "Applying",
  verifying: "Verifying",
  applied: "Applied",
  rejected: "Rejected",
  failed: "Failed",
  superseded: "Superseded",
  rolled_back: "Rolled back",
};

const RISK_LABELS = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
} as const;

const CONFIDENCE_LABELS = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
} as const;

function kindLabel(kind: ImprovementPatchPlan["kind"]): string {
  switch (kind) {
    case "skill":
      return "Suggested Skill";
    case "workflow":
      return "Suggested Workflow";
    case "code":
      return "Code Change Proposal";
  }
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function titleFor(kind: ImprovementPatchPlan["kind"], signalSummary: string): string {
  return `${kindLabel(kind)}: ${signalSummary}`;
}

function patchPreview(plan: ImprovementPatchPlan): ImprovementDetailView["patchPreview"] {
  if (plan.kind === "skill") {
    return {
      title: `Skill file preview`,
      lines: [
        `Target: ${plan.targetDir}/${plan.skillName}/SKILL.md`,
        "",
        ...plan.markdown.split(/\r?\n/).slice(0, 120),
      ],
    };
  }
  if (plan.kind === "workflow") {
    return {
      title: "Workflow registry update",
      lines: [
        `Target: ${plan.workflowRef ?? "new workflow"}`,
        `Mode: ${plan.patch.mode}`,
        "requiresApproval: true",
        "safeForAutoRun: false",
        JSON.stringify(plan.patch, null, 2),
      ],
    };
  }
  return {
    title: "Manual code proposal",
    lines: [
      plan.summary,
      "",
      "This proposal cannot be applied automatically.",
      "Use an isolated worktree and normal review flow.",
    ],
  };
}

function changeSummary(plan: ImprovementPatchPlan): string {
  if (plan.kind === "skill") {
    return `Create workspace skill ${plan.targetDir}/${plan.skillName}/SKILL.md.`;
  }
  if (plan.kind === "workflow") {
    return `Update workflow ${plan.workflowRef ?? "new workflow"} through the workflow registry.`;
  }
  return "Prepare a manual code proposal for an isolated implementation worktree.";
}

function disabledActions(detail: ImprovementProposalDetail): DisabledImprovementAction[] {
  const proposal = detail.proposal;
  const available = new Set(detail.availableActions);
  const disabled: DisabledImprovementAction[] = [];
  if (!available.has("apply")) {
    if (proposal.patchPlan.kind === "code") {
      disabled.push({
        action: "apply",
        reason: "Code proposals require a manual isolated worktree and review.",
      });
    } else if (proposal.status !== "approved") {
      disabled.push({ action: "apply", reason: "Approve this proposal before applying it." });
    }
  }
  if (!available.has("rollback") && proposal.status !== "applied") {
    disabled.push({
      action: "rollback",
      reason: "Rollback is available after a proposal is applied.",
    });
  }
  return disabled;
}

export function buildImprovementListViewItem(
  item: ImprovementProposalListItem,
): ImprovementListViewItem {
  return {
    id: item.id,
    title: titleFor(item.kind, item.signalSummary),
    kind: item.kind,
    kindLabel: kindLabel(item.kind),
    status: item.status,
    statusLabel: STATUS_LABELS[item.status] ?? item.status,
    riskLabel: RISK_LABELS[item.riskLevel],
    confidenceLabel: CONFIDENCE_LABELS[item.confidence],
    signalSummary: item.signalSummary,
    updatedAt: item.updatedAt,
  };
}

export function buildImprovementDetailView(
  detail: ImprovementProposalDetail,
): ImprovementDetailView {
  const proposal = detail.proposal;
  const listItem = buildImprovementListViewItem({
    id: proposal.id,
    status: proposal.status,
    candidateId: proposal.candidate.id,
    kind: proposal.patchPlan.kind,
    signalSummary: proposal.candidate.signalSummary,
    decision: proposal.verdict.decision,
    riskLevel: proposal.verdict.riskLevel,
    confidence: proposal.verdict.confidence,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  });
  const blockers = detail.policyBlockers;
  return {
    ...listItem,
    plainSummary: `CrawClaw suggests ${proposal.patchPlan.kind === "code" ? "recording" : "creating"} a ${listItem.kindLabel.replace(/^Suggested /, "")} from a repeated, validated pattern.`,
    primaryReason: sentence(proposal.candidate.signalSummary),
    safetySummary: blockers.length
      ? `Policy blocked this proposal: ${blockers.join("; ")}.`
      : `${RISK_LABELS[proposal.verdict.riskLevel]}. Policy allows this proposal.`,
    changeSummary: changeSummary(proposal.patchPlan),
    evidenceItems: [
      ...proposal.candidate.sourceRefs.map((ref) => ({
        label: ref.kind,
        value: ref.ref,
      })),
      ...proposal.candidate.validationEvidence.map((value) => ({
        label: "validation",
        value,
      })),
    ],
    verificationPlan: proposal.verdict.verificationPlan,
    rollbackPlan: proposal.rollbackPlan,
    patchPreview: patchPreview(proposal.patchPlan),
    availableActions: detail.availableActions.filter(
      (action): action is ImprovementActionName =>
        action === "approve" ||
        action === "reject" ||
        action === "apply" ||
        action === "verify" ||
        action === "rollback",
    ),
    disabledActions: disabledActions(detail),
    technicalDetails: {
      candidateId: proposal.candidate.id,
      decision: proposal.verdict.decision,
      status: proposal.status,
      policyResult: proposal.policyResult,
    },
  };
}

export function mapImprovementCenterError(
  code: ImprovementCenterErrorCode,
): ImprovementUserErrorView {
  switch (code) {
    case "not_found":
      return { title: "Proposal not found", message: "This proposal no longer exists." };
    case "policy_blocked":
      return {
        title: "Blocked by policy",
        message: "Policy does not allow applying this proposal.",
      };
    case "review_required":
      return { title: "Approval required", message: "Approve this proposal before applying it." };
    case "apply_not_supported":
      return {
        title: "Apply not supported",
        message: "This proposal type cannot be applied automatically.",
      };
    case "rollback_not_supported":
      return {
        title: "Rollback not supported",
        message: "This proposal has no supported rollback path.",
      };
    case "verification_failed":
      return { title: "Verification failed", message: "Verification ran and reported errors." };
  }
}
```

- [ ] **Step 4: Run the view-model tests**

Run:

```bash
pnpm test -- src/improvement/view-model.test.ts
```

Expected:

```text
PASS src/improvement/view-model.test.ts
```

- [ ] **Step 5: Commit**

Run:

```bash
scripts/committer "Improvement: add UI view models" src/improvement/view-model.ts src/improvement/view-model.test.ts
```

Expected: one commit with only the two view-model files.

---

### Task 2: Add Gateway RPC Methods For Improvement Center

**Files:**

- Create: `src/gateway/protocol/schema/improvement.ts`
- Modify: `src/gateway/protocol/schema.ts`
- Modify: `src/gateway/protocol/schema/protocol-schemas.ts`
- Create: `src/gateway/server-methods/improvement.ts`
- Create: `src/gateway/server-methods/improvement.test.ts`
- Modify: `src/gateway/server-methods.ts`
- Modify: `src/gateway/server-methods-list.ts`
- Modify: `src/gateway/method-scopes.ts`

- [ ] **Step 1: Write failing handler tests**

Create `src/gateway/server-methods/improvement.test.ts`:

```ts
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
    const { ImprovementCenterError } = await import("../../improvement/center.js");
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
pnpm test -- src/gateway/server-methods/improvement.test.ts
```

Expected:

```text
FAIL src/gateway/server-methods/improvement.test.ts
Cannot find module './improvement.js'
```

- [ ] **Step 3: Add protocol schemas**

Create `src/gateway/protocol/schema/improvement.ts`:

```ts
import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const ImprovementWorkspaceParamsSchema = Type.Object(
  {
    workspaceDir: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ImprovementListParamsSchema = Type.Object(
  {
    workspaceDir: Type.Optional(Type.String()),
    statuses: Type.Optional(Type.Array(Type.String())),
    kinds: Type.Optional(Type.Array(Type.String())),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const ImprovementGetParamsSchema = Type.Object(
  {
    workspaceDir: Type.Optional(Type.String()),
    proposalId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ImprovementReviewParamsSchema = Type.Object(
  {
    workspaceDir: Type.Optional(Type.String()),
    proposalId: NonEmptyString,
    approved: Type.Boolean(),
    reviewer: Type.Optional(Type.String()),
    comments: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ImprovementMutationParamsSchema = Type.Object(
  {
    workspaceDir: Type.Optional(Type.String()),
    proposalId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ImprovementViewItemSchema = Type.Object(
  {
    id: NonEmptyString,
    title: Type.String(),
    kind: Type.String(),
    kindLabel: Type.String(),
    status: Type.String(),
    statusLabel: Type.String(),
    riskLabel: Type.String(),
    confidenceLabel: Type.String(),
    signalSummary: Type.String(),
    updatedAt: Type.Number(),
  },
  { additionalProperties: false },
);

export const ImprovementDetailViewSchema = Type.Intersect([
  ImprovementViewItemSchema,
  Type.Object(
    {
      plainSummary: Type.String(),
      primaryReason: Type.String(),
      safetySummary: Type.String(),
      changeSummary: Type.String(),
      evidenceItems: Type.Array(Type.Object({ label: Type.String(), value: Type.String() })),
      verificationPlan: Type.Array(Type.String()),
      rollbackPlan: Type.Array(Type.String()),
      patchPreview: Type.Object({
        title: Type.String(),
        lines: Type.Array(Type.String()),
      }),
      availableActions: Type.Array(Type.String()),
      disabledActions: Type.Array(Type.Object({ action: Type.String(), reason: Type.String() })),
      technicalDetails: Type.Record(Type.String(), Type.Unknown()),
    },
    { additionalProperties: false },
  ),
]);

export const ImprovementListResultSchema = Type.Object(
  {
    workspaceDir: Type.String(),
    proposals: Type.Array(ImprovementViewItemSchema),
  },
  { additionalProperties: false },
);

export const ImprovementGetResultSchema = Type.Object(
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
```

Modify `src/gateway/protocol/schema.ts`:

```ts
export * from "./schema/improvement.js";
```

Add that export with the other schema exports.

Modify `src/gateway/protocol/schema/protocol-schemas.ts`:

```ts
import {
  ImprovementDetailViewSchema,
  ImprovementGetParamsSchema,
  ImprovementGetResultSchema,
  ImprovementListParamsSchema,
  ImprovementListResultSchema,
  ImprovementMetricsResultSchema,
  ImprovementMutationParamsSchema,
  ImprovementReviewParamsSchema,
  ImprovementRunResultSchema,
  ImprovementViewItemSchema,
  ImprovementWorkspaceParamsSchema,
} from "./improvement.js";
```

Add these keys inside `ProtocolSchemas`:

```ts
  ImprovementWorkspaceParams: ImprovementWorkspaceParamsSchema,
  ImprovementListParams: ImprovementListParamsSchema,
  ImprovementGetParams: ImprovementGetParamsSchema,
  ImprovementReviewParams: ImprovementReviewParamsSchema,
  ImprovementMutationParams: ImprovementMutationParamsSchema,
  ImprovementViewItem: ImprovementViewItemSchema,
  ImprovementDetailView: ImprovementDetailViewSchema,
  ImprovementListResult: ImprovementListResultSchema,
  ImprovementGetResult: ImprovementGetResultSchema,
  ImprovementRunResult: ImprovementRunResultSchema,
  ImprovementMetricsResult: ImprovementMetricsResultSchema,
```

- [ ] **Step 4: Add Gateway handlers**

Create `src/gateway/server-methods/improvement.ts`:

```ts
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
import type { ImprovementPatchPlan, ImprovementProposalStatus } from "../../improvement/types.js";
import {
  buildImprovementDetailView,
  buildImprovementListViewItem,
  mapImprovementCenterError,
} from "../../improvement/view-model.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateImprovementGetParams,
  validateImprovementListParams,
  validateImprovementMutationParams,
  validateImprovementReviewParams,
  validateImprovementWorkspaceParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function workspaceDirFrom(params: Record<string, unknown>): string {
  return typeof params.workspaceDir === "string" && params.workspaceDir.trim()
    ? params.workspaceDir.trim()
    : process.cwd();
}

function invalid(respond: RespondFn, method: string, errors: unknown) {
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${method} params: ${formatValidationErrors(errors as never)}`,
    ),
  );
}

function respondError(respond: RespondFn, error: unknown) {
  if (error instanceof ImprovementCenterError) {
    const view = mapImprovementCenterError(error.code);
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, error.message, {
        details: { code: error.code, ...view },
      }),
    );
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
}

function readStatuses(value: unknown): ImprovementProposalStatus[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? (value as ImprovementProposalStatus[])
    : undefined;
}

function readKinds(value: unknown): ImprovementPatchPlan["kind"][] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? (value as ImprovementPatchPlan["kind"][])
    : undefined;
}

export const improvementHandlers: GatewayRequestHandlers = {
  "improvement.list": async ({ params, respond }) => {
    if (!validateImprovementListParams(params)) {
      invalid(respond, "improvement.list", validateImprovementListParams.errors);
      return;
    }
    const workspaceDir = workspaceDirFrom(params);
    try {
      const proposals = await listImprovementProposals(
        { workspaceDir },
        {
          statuses: readStatuses(params.statuses),
          kinds: readKinds(params.kinds),
          limit: typeof params.limit === "number" ? params.limit : undefined,
        },
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
    if (!validateImprovementGetParams(params)) {
      invalid(respond, "improvement.get", validateImprovementGetParams.errors);
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
    if (!validateImprovementWorkspaceParams(params)) {
      invalid(respond, "improvement.metrics", validateImprovementWorkspaceParams.errors);
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
    if (!validateImprovementWorkspaceParams(params)) {
      invalid(respond, "improvement.run", validateImprovementWorkspaceParams.errors);
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
    if (!validateImprovementReviewParams(params)) {
      invalid(respond, "improvement.review", validateImprovementReviewParams.errors);
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
    if (!validateImprovementMutationParams(params)) {
      invalid(respond, "improvement.apply", validateImprovementMutationParams.errors);
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
    if (!validateImprovementMutationParams(params)) {
      invalid(respond, "improvement.verify", validateImprovementMutationParams.errors);
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
    if (!validateImprovementMutationParams(params)) {
      invalid(respond, "improvement.rollback", validateImprovementMutationParams.errors);
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
```

- [ ] **Step 5: Register handlers, methods, and scopes**

Modify `src/gateway/server-methods.ts`:

```ts
import { improvementHandlers } from "./server-methods/improvement.js";
```

Add to `CONTROL_PLANE_WRITE_METHODS`:

```ts
  "improvement.run",
  "improvement.review",
  "improvement.apply",
  "improvement.verify",
  "improvement.rollback",
```

Add to `coreGatewayHandlers`:

```ts
  ...improvementHandlers,
```

Modify `src/gateway/server-methods-list.ts` and add:

```ts
  "improvement.list",
  "improvement.get",
  "improvement.metrics",
  "improvement.run",
  "improvement.review",
  "improvement.apply",
  "improvement.verify",
  "improvement.rollback",
```

Modify `src/gateway/method-scopes.ts`:

Add to `READ_SCOPE`:

```ts
    "improvement.list",
    "improvement.get",
    "improvement.metrics",
```

Add to `WRITE_SCOPE`:

```ts
    "improvement.run",
    "improvement.review",
    "improvement.apply",
    "improvement.verify",
    "improvement.rollback",
```

- [ ] **Step 6: Run gateway handler tests**

Run:

```bash
pnpm test -- src/gateway/server-methods/improvement.test.ts src/gateway/protocol/index.test.ts
```

Expected:

```text
PASS src/gateway/server-methods/improvement.test.ts
PASS src/gateway/protocol/index.test.ts
```

- [ ] **Step 7: Commit**

Run:

```bash
scripts/committer "Gateway: expose Improvement Center methods" \
  src/gateway/protocol/schema/improvement.ts \
  src/gateway/protocol/schema.ts \
  src/gateway/protocol/schema/protocol-schemas.ts \
  src/gateway/server-methods/improvement.ts \
  src/gateway/server-methods/improvement.test.ts \
  src/gateway/server-methods.ts \
  src/gateway/server-methods-list.ts \
  src/gateway/method-scopes.ts
```

Expected: one commit with protocol and handler files only.

---

### Task 3: Serve The Local Browser UI

**Files:**

- Create: `src/gateway/improvement-center-web.ts`
- Create: `src/gateway/improvement-center-web.test.ts`
- Modify: `src/gateway/server-http.ts`

- [ ] **Step 1: Write failing web surface tests**

Create `src/gateway/improvement-center-web.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockHttpExchange } from "./server-http.test-harness.js";
import { handleImprovementCenterHttpRequest } from "./improvement-center-web.js";

describe("Improvement Center web surface", () => {
  it("serves the shell at /improvements", async () => {
    const { req, res } = createMockHttpExchange({ method: "GET", path: "/improvements" });

    expect(handleImprovementCenterHttpRequest({ req, res, requestPath: "/improvements" })).toBe(
      true,
    );
    expect(res.statusCode).toBe(200);
    expect(responseBody(res)).toContain("Improvement Center");
    expect(responseBody(res)).toContain("/improvements/app.js");
    expect(responseBody(res)).toContain("/improvements/styles.css");
  });

  it("serves assets with beginner-readable copy and improvement RPC methods", async () => {
    const js = createMockHttpExchange({ method: "GET", path: "/improvements/app.js" });
    const css = createMockHttpExchange({ method: "GET", path: "/improvements/styles.css" });

    expect(
      handleImprovementCenterHttpRequest({
        req: js.req,
        res: js.res,
        requestPath: "/improvements/app.js",
      }),
    ).toBe(true);
    expect(
      handleImprovementCenterHttpRequest({
        req: css.req,
        res: css.res,
        requestPath: "/improvements/styles.css",
      }),
    ).toBe(true);

    expect(responseBody(js.res)).toContain("improvement.list");
    expect(responseBody(js.res)).toContain("Approve");
    expect(responseBody(js.res)).toContain("Apply disabled");
    expect(responseBody(css.res)).toContain(".proposal-list");
  });

  it("rejects non-GET methods", async () => {
    const { req, res } = createMockHttpExchange({ method: "POST", path: "/improvements" });

    expect(handleImprovementCenterHttpRequest({ req, res, requestPath: "/improvements" })).toBe(
      true,
    );
    expect(res.statusCode).toBe(405);
  });
});

function responseBody(res: ReturnType<typeof createMockHttpExchange>["res"]): string {
  return String(res.getBody());
}
```

If `createMockHttpExchange` is not exported by the harness, add a local minimal request/response test helper in this test file instead of changing the production code.

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
pnpm test -- src/gateway/improvement-center-web.test.ts
```

Expected:

```text
FAIL src/gateway/improvement-center-web.test.ts
Cannot find module './improvement-center-web.js'
```

- [ ] **Step 3: Implement the web surface**

Create `src/gateway/improvement-center-web.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

const STORAGE_TOKEN_KEY = "crawclaw.gateway.token";
const STORAGE_WORKSPACE_KEY = "crawclaw.improvement.workspaceDir";

function sendText(
  res: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
  headOnly: boolean,
) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.end(headOnly ? undefined : body);
}

export function renderImprovementCenterHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Improvement Center</title>
    <link rel="stylesheet" href="/improvements/styles.css" />
  </head>
  <body>
    <main id="app" class="improvement-app" aria-live="polite"></main>
    <script type="module" src="/improvements/app.js"></script>
  </body>
</html>`;
}

export function renderImprovementCenterCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f6f8fb;
  --panel: #ffffff;
  --panel-soft: #f9fbfe;
  --text: #17202f;
  --muted: #667085;
  --border: #d8dee9;
  --accent: #0f6f78;
  --accent-soft: #d8f1f3;
  --danger: #b42318;
  --warning: #9a6700;
  --ok: #087443;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-size: 14px; }
button, input, select, textarea { font: inherit; }
button { border: 1px solid var(--border); background: var(--panel); color: var(--text); border-radius: 6px; padding: 7px 10px; cursor: pointer; }
button.primary { background: var(--accent); color: white; border-color: var(--accent); }
button.danger { color: var(--danger); border-color: #fecdca; }
button:disabled { opacity: .55; cursor: not-allowed; }
.improvement-app { min-height: 100vh; display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); grid-template-rows: 58px minmax(0, 1fr); }
.topbar { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 18px; background: var(--panel); border-bottom: 1px solid var(--border); }
.brand strong { display: block; font-size: 16px; }
.brand span { color: var(--muted); font-size: 12px; }
.workspace { display: flex; align-items: center; gap: 8px; min-width: 260px; }
.workspace input { min-width: 220px; border: 1px solid var(--border); border-radius: 6px; padding: 7px 9px; }
.pane { min-width: 0; min-height: 0; overflow: hidden; border-right: 1px solid var(--border); background: var(--panel); }
.detail-pane { border-right: 0; background: var(--bg); }
.pane-head { padding: 14px; border-bottom: 1px solid var(--border); display: grid; gap: 10px; }
.filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.filters select { min-width: 0; border: 1px solid var(--border); border-radius: 6px; padding: 8px; background: white; }
.proposal-list, .detail-scroll { min-height: 0; overflow: auto; padding: 12px; }
.proposal-item { width: 100%; display: grid; gap: 7px; text-align: left; border: 1px solid var(--border); border-radius: 8px; padding: 11px; margin-bottom: 10px; background: var(--panel); }
.proposal-item[aria-selected="true"] { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
.proposal-title { font-weight: 700; line-height: 1.35; }
.muted { color: var(--muted); }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.badge { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 7px; border: 1px solid var(--border); border-radius: 999px; background: var(--panel-soft); color: var(--muted); font-size: 12px; }
.badge.ok { color: var(--ok); background: #dff8eb; border-color: #a7e4c3; }
.badge.warn { color: var(--warning); background: #fef3c7; border-color: #fde68a; }
.badge.danger { color: var(--danger); background: #fee4e2; border-color: #fecdca; }
.detail-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 12px; }
.detail-card h2, .detail-card h3 { margin: 0 0 8px; }
.action-bar { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.disabled-reason { color: var(--muted); font-size: 12px; margin-top: 6px; }
.patch { white-space: pre-wrap; overflow-wrap: anywhere; background: #111827; color: #f9fafb; border-radius: 8px; padding: 12px; line-height: 1.45; max-height: 360px; overflow: auto; }
.empty, .error { padding: 28px; text-align: center; color: var(--muted); }
.error { color: var(--danger); }
@media (max-width: 900px) {
  .improvement-app { grid-template-columns: 1fr; grid-template-rows: auto auto auto; }
  .workspace { min-width: 0; width: 100%; }
  .workspace input { min-width: 0; flex: 1; }
  .topbar { align-items: flex-start; flex-direction: column; padding: 12px; }
  .pane { min-height: 40vh; border-right: 0; border-bottom: 1px solid var(--border); }
}
`;
}

export function renderImprovementCenterJs(): string {
  return `
const tokenKey = "${STORAGE_TOKEN_KEY}";
const workspaceKey = "${STORAGE_WORKSPACE_KEY}";
const state = {
  ws: null,
  rpcSeq: 1,
  pending: new Map(),
  proposals: [],
  selectedId: "",
  detail: null,
  error: "",
  loading: false,
  status: "",
  kind: "",
  workspaceDir: localStorage.getItem(workspaceKey) || "",
};
function gatewayToken() { return localStorage.getItem(tokenKey) || ""; }
function connect() {
  return new Promise((resolve, reject) => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) return resolve(state.ws);
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => reject(new Error("connect timeout")), 8000);
    ws.onmessage = (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      if (frame.type === "event" && frame.event === "connect.challenge") {
        ws.send(JSON.stringify({
          type: "req",
          id: "connect-" + Date.now(),
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: "improvement-center", version: "1", platform: "web", mode: "operator" },
            role: "operator",
            scopes: ["operator.read", "operator.write"],
            caps: [],
            commands: [],
            auth: gatewayToken() ? { token: gatewayToken(), password: gatewayToken() } : {},
            userAgent: navigator.userAgent,
          },
        }));
        return;
      }
      if (frame.type === "res" && String(frame.id).startsWith("connect-")) {
        clearTimeout(timeout);
        if (!frame.ok) return reject(new Error(frame.error?.message || "connect failed"));
        state.ws = ws;
        ws.onmessage = handleFrame;
        ws.onclose = () => { state.ws = null; };
        resolve(ws);
      }
    };
    ws.onerror = () => reject(new Error("websocket error"));
  });
}
function handleFrame(event) {
  let frame;
  try { frame = JSON.parse(event.data); } catch { return; }
  if (frame.type !== "res") return;
  const pending = state.pending.get(frame.id);
  if (!pending) return;
  state.pending.delete(frame.id);
  frame.ok ? pending.resolve(frame.payload) : pending.reject(new Error(frame.error?.details?.message || frame.error?.message || "RPC failed"));
}
async function rpc(method, params = {}) {
  const ws = await connect();
  const id = "improve-" + state.rpcSeq++;
  const promise = new Promise((resolve, reject) => state.pending.set(id, { resolve, reject }));
  ws.send(JSON.stringify({ type: "req", id, method, params: { ...params, workspaceDir: state.workspaceDir || undefined } }));
  return promise;
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function badgeClass(label) {
  const raw = String(label || "").toLowerCase();
  if (raw.includes("blocked") || raw.includes("failed") || raw.includes("high")) return "danger";
  if (raw.includes("medium") || raw.includes("needs")) return "warn";
  if (raw.includes("low") || raw.includes("applied") || raw.includes("approved")) return "ok";
  return "";
}
function render() {
  const app = document.getElementById("app");
  app.innerHTML = \`
    <header class="topbar">
      <div class="brand">
        <strong>Improvement Center</strong>
        <span>Review repeated work before CrawClaw turns it into Skills or Workflows.</span>
      </div>
      <div class="workspace">
        <input data-workspace placeholder="Workspace path (blank = gateway cwd)" value="\${esc(state.workspaceDir)}" />
        <button data-save-workspace>Use</button>
        <button class="primary" data-run-scan>Run scan</button>
      </div>
    </header>
    <section class="pane">
      <div class="pane-head">
        <strong>Proposal inbox</strong>
        <div class="filters">
          <select data-status>
            <option value="">All statuses</option>
            <option value="pending_review">Needs review</option>
            <option value="approved">Approved</option>
            <option value="policy_blocked">Blocked</option>
            <option value="applied">Applied</option>
            <option value="failed">Failed</option>
            <option value="rolled_back">Rolled back</option>
          </select>
          <select data-kind>
            <option value="">All kinds</option>
            <option value="skill">Skills</option>
            <option value="workflow">Workflows</option>
            <option value="code">Code proposals</option>
          </select>
        </div>
      </div>
      <div class="proposal-list">\${renderList()}</div>
    </section>
    <section class="pane detail-pane">
      <div class="detail-scroll">\${renderDetail()}</div>
    </section>
  \`;
  app.querySelector("[data-status]").value = state.status;
  app.querySelector("[data-kind]").value = state.kind;
  app.querySelector("[data-status]").onchange = (event) => { state.status = event.target.value; loadList(); };
  app.querySelector("[data-kind]").onchange = (event) => { state.kind = event.target.value; loadList(); };
  app.querySelector("[data-save-workspace]").onclick = () => {
    state.workspaceDir = app.querySelector("[data-workspace]").value.trim();
    localStorage.setItem(workspaceKey, state.workspaceDir);
    loadList();
  };
  app.querySelector("[data-run-scan]").onclick = () => runScan();
  app.querySelectorAll("[data-proposal]").forEach((el) => el.onclick = () => selectProposal(el.dataset.proposal));
  app.querySelectorAll("[data-action]").forEach((el) => el.onclick = () => performAction(el.dataset.action));
}
function renderList() {
  if (state.loading) return '<div class="empty">Loading proposals...</div>';
  if (state.error) return '<div class="error">' + esc(state.error) + '</div>';
  if (!state.proposals.length) return '<div class="empty"><strong>No proposals yet.</strong><br/>Run a scan to find repeated, validated work that may become a Skill or Workflow.</div>';
  return state.proposals.map((item) => \`
    <button class="proposal-item" data-proposal="\${esc(item.id)}" aria-selected="\${item.id === state.selectedId}">
      <div class="proposal-title">\${esc(item.title)}</div>
      <div class="row">
        <span class="badge">\${esc(item.kindLabel)}</span>
        <span class="badge \${badgeClass(item.statusLabel)}">\${esc(item.statusLabel)}</span>
        <span class="badge \${badgeClass(item.riskLabel)}">\${esc(item.riskLabel)}</span>
      </div>
      <div class="muted">\${esc(item.signalSummary)}</div>
    </button>
  \`).join("");
}
function renderDetail() {
  const detail = state.detail;
  if (!detail) return '<div class="empty">Select a proposal to see what CrawClaw noticed, what will change, and whether it is safe.</div>';
  return \`
    <article class="detail-card">
      <div class="row">
        <span class="badge">\${esc(detail.kindLabel)}</span>
        <span class="badge \${badgeClass(detail.statusLabel)}">\${esc(detail.statusLabel)}</span>
        <span class="badge \${badgeClass(detail.riskLabel)}">\${esc(detail.riskLabel)}</span>
      </div>
      <h2>\${esc(detail.title)}</h2>
      <p>\${esc(detail.plainSummary)}</p>
      <p class="muted">\${esc(detail.primaryReason)}</p>
      <div class="action-bar">\${renderActions(detail)}</div>
      \${detail.disabledActions.map((item) => '<div class="disabled-reason">' + esc(labelAction(item.action)) + ' disabled: ' + esc(item.reason) + '</div>').join("")}
    </article>
    <section class="detail-card"><h3>Safety check</h3><p>\${esc(detail.safetySummary)}</p></section>
    <section class="detail-card"><h3>What will change</h3><p>\${esc(detail.changeSummary)}</p></section>
    <section class="detail-card"><h3>Evidence</h3>\${renderEvidence(detail)}</section>
    <section class="detail-card"><h3>\${esc(detail.patchPreview.title)}</h3><pre class="patch">\${esc(detail.patchPreview.lines.join("\\n"))}</pre></section>
    <section class="detail-card"><h3>Verification plan</h3><ul>\${detail.verificationPlan.map((line) => '<li>' + esc(line) + '</li>').join("")}</ul></section>
    <section class="detail-card"><h3>Rollback plan</h3><ul>\${detail.rollbackPlan.map((line) => '<li>' + esc(line) + '</li>').join("")}</ul></section>
  \`;
}
function labelAction(action) {
  return ({ approve: "Approve", reject: "Reject", apply: "Apply", verify: "Verify", rollback: "Rollback" })[action] || action;
}
function renderActions(detail) {
  return detail.availableActions.map((action) => {
    const cls = action === "reject" || action === "rollback" ? "danger" : action === "approve" || action === "apply" ? "primary" : "";
    return '<button class="' + cls + '" data-action="' + esc(action) + '">' + esc(labelAction(action)) + '</button>';
  }).join("");
}
function renderEvidence(detail) {
  if (!detail.evidenceItems.length) return '<p class="muted">No evidence refs recorded.</p>';
  return '<ul>' + detail.evidenceItems.map((item) => '<li><strong>' + esc(item.label) + '</strong>: ' + esc(item.value) + '</li>').join("") + '</ul>';
}
async function loadList() {
  state.loading = true;
  state.error = "";
  render();
  try {
    const result = await rpc("improvement.list", {
      statuses: state.status ? [state.status] : undefined,
      kinds: state.kind ? [state.kind] : undefined,
      limit: 100,
    });
    state.proposals = result.proposals || [];
    if (!state.selectedId && state.proposals[0]) state.selectedId = state.proposals[0].id;
    state.loading = false;
    render();
    if (state.selectedId) await selectProposal(state.selectedId);
  } catch (error) {
    state.loading = false;
    state.error = error.message || String(error);
    render();
  }
}
async function selectProposal(id) {
  state.selectedId = id;
  state.detail = null;
  render();
  try {
    const result = await rpc("improvement.get", { proposalId: id });
    state.detail = result.proposal;
    render();
  } catch (error) {
    state.error = error.message || String(error);
    render();
  }
}
async function runScan() {
  try {
    await rpc("improvement.run", {});
    await loadList();
  } catch (error) {
    state.error = error.message || String(error);
    render();
  }
}
async function performAction(action) {
  if (!state.selectedId) return;
  const warnings = {
    approve: "Approve records human approval. It will not apply files yet.",
    reject: "Reject closes the proposal without changing files.",
    apply: "Apply writes the approved Skill or Workflow change.",
    verify: "Verify runs checks for the applied proposal.",
    rollback: "Rollback restores the recorded application artifact.",
  };
  if (!confirm(warnings[action] || "Continue?")) return;
  const method = action === "approve" || action === "reject" ? "improvement.review" : "improvement." + action;
  const params = action === "approve" || action === "reject"
    ? { proposalId: state.selectedId, approved: action === "approve", reviewer: "ui" }
    : { proposalId: state.selectedId };
  try {
    const result = await rpc(method, params);
    state.detail = result.proposal;
    await loadList();
  } catch (error) {
    state.error = error.message || String(error);
    render();
  }
}
render();
loadList();
`;
}

export function handleImprovementCenterHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestPath: string;
}): boolean {
  if (
    params.requestPath !== "/improvements" &&
    params.requestPath !== "/improvements/" &&
    params.requestPath !== "/improvements/app.js" &&
    params.requestPath !== "/improvements/styles.css"
  ) {
    return false;
  }
  const method = (params.req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    params.res.statusCode = 405;
    params.res.setHeader("Allow", "GET, HEAD");
    params.res.setHeader("Content-Type", "text/plain; charset=utf-8");
    params.res.end("Method Not Allowed");
    return true;
  }
  const headOnly = method === "HEAD";
  if (params.requestPath.endsWith("/app.js")) {
    sendText(
      params.res,
      200,
      "application/javascript; charset=utf-8",
      renderImprovementCenterJs(),
      headOnly,
    );
    return true;
  }
  if (params.requestPath.endsWith("/styles.css")) {
    sendText(params.res, 200, "text/css; charset=utf-8", renderImprovementCenterCss(), headOnly);
    return true;
  }
  sendText(params.res, 200, "text/html; charset=utf-8", renderImprovementCenterHtml(), headOnly);
  return true;
}
```

- [ ] **Step 4: Register HTTP route**

Modify `src/gateway/server-http.ts`:

Add import:

```ts
import { handleImprovementCenterHttpRequest } from "./improvement-center-web.js";
```

Add a request stage after plugin routes and before probes:

```ts
requestStages.push({
  name: "improvement-center",
  run: async () => {
    if (
      requestPath !== "/improvements" &&
      requestPath !== "/improvements/" &&
      requestPath !== "/improvements/app.js" &&
      requestPath !== "/improvements/styles.css"
    ) {
      return false;
    }
    const requestAuth = await authorizeGatewayHttpRequestOrReply({
      req,
      res,
      auth: resolvedAuth,
      trustedProxies,
      allowRealIpFallback,
      rateLimiter,
    });
    if (!requestAuth) {
      return true;
    }
    return handleImprovementCenterHttpRequest({ req, res, requestPath });
  },
});
```

- [ ] **Step 5: Run web surface tests**

Run:

```bash
pnpm test -- src/gateway/improvement-center-web.test.ts src/gateway/server-http.test.ts
```

Expected:

```text
PASS src/gateway/improvement-center-web.test.ts
PASS src/gateway/server-http.test.ts
```

- [ ] **Step 6: Commit**

Run:

```bash
scripts/committer "Gateway: add Improvement Center web UI" \
  src/gateway/improvement-center-web.ts \
  src/gateway/improvement-center-web.test.ts \
  src/gateway/server-http.ts
```

Expected: one commit with only the web surface files and route registration.

---

### Task 4: Document The New Local UI

**Files:**

- Modify: `docs/web/index.md`
- Create: `docs/web/improvements.md`
- Modify: `docs/docs.json`

- [ ] **Step 1: Write the docs update**

Create `docs/web/improvements.md`:

```md
---
summary: "Local browser UI for reviewing CrawClaw improvement proposals"
read_when:
  - You want to review Improvement Center proposals in a browser
  - You want to approve, apply, verify, or rollback a governed proposal
title: "Improvement Center"
---

# Improvement Center

Open `/improvements` on the Gateway HTTP port to review governed improvement
proposals in a browser.

The Improvement Center is a local UI over `crawclaw improve`. It shows the same
workspace proposal store, policy decisions, patch previews, verification plans,
and rollback state as the CLI and TUI.

## What you can do

- Run an improvement scan.
- Review proposal evidence in plain language.
- Approve or reject a proposal.
- Apply an approved Skill or Workflow proposal.
- Verify an applied proposal.
- Rollback a recorded Skill or Workflow application.

Code proposals are display-only. They cannot be applied or rolled back from the
UI.

## Workspace

The page defaults to the Gateway process working directory. If your proposals
live in another workspace, enter that workspace path at the top of the page.

## Safety

The UI uses the authenticated Gateway WebSocket connection and calls the same
`improvement.*` methods as other local clients. It does not read
`.crawclaw/improvements` directly and does not bypass policy, review,
verification, or rollback checks.
```

Modify `docs/web/index.md`:

Add Improvement Center to the remaining surfaces list:

```md
- Improvement Center at `/improvements`
```

Add a short section after Observation Workbench:

```md
## Improvement Center

Open `/improvements` on the Gateway HTTP port to review governed improvement
proposals. The page uses the same proposal store and safety gates as
`crawclaw improve` and `/improve` in the TUI.

See [Improvement Center](/web/improvements).
```

Modify `docs/docs.json` by adding `web/improvements` next to the other `web`
pages. Preserve the existing nav ordering.

- [ ] **Step 2: Run docs checks that cover touched docs**

Run:

```bash
pnpm docs:check-i18n-glossary
```

Expected:

```text
PASS
```

If the command reports a missing glossary entry for `Improvement Center`, add it to `docs/.i18n/glossary.zh-CN.json` with a fixed translation and rerun the same command.

- [ ] **Step 3: Commit**

Run:

```bash
scripts/committer "Docs: add Improvement Center web UI" docs/web/index.md docs/web/improvements.md docs/docs.json docs/.i18n/glossary.zh-CN.json
```

If the glossary did not change, omit it from the command.

Expected: one docs commit.

---

### Task 5: End-To-End Verification

**Files:**

- No new code files unless a test reveals a bug in the touched implementation.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm test -- \
  src/improvement/view-model.test.ts \
  src/gateway/server-methods/improvement.test.ts \
  src/gateway/improvement-center-web.test.ts \
  src/gateway/server-http.test.ts \
  src/gateway/protocol/index.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 2: Run improvement regression tests**

Run:

```bash
pnpm test -- src/improvement src/cli/improve-cli.test.ts src/cli/improve-cli.runtime.test.ts src/tui/tui-command-handlers.test.ts src/tui/commands.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 3: Run local development gate**

Run:

```bash
pnpm check
```

Expected:

```text
Found 0 warnings and 0 errors.
```

- [ ] **Step 4: Run build because Gateway HTTP and protocol surfaces changed**

Run:

```bash
pnpm build
```

Expected:

```text
build completes with no [INEFFECTIVE_DYNAMIC_IMPORT] warning
```

- [ ] **Step 5: Manual local UI smoke**

Start the gateway on a free local port:

```bash
pnpm crawclaw gateway run --bind loopback --port 18789 --force
```

Open:

```text
http://127.0.0.1:18789/improvements
```

Expected:

- empty store shows a beginner-readable empty state
- `Run scan` does not crash
- proposal list can load from a workspace with `.crawclaw/improvements`
- detail page shows summary, safety, evidence, patch preview, verification plan, and rollback plan
- code proposal apply is disabled with a clear explanation

Stop the gateway before final handoff.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short --branch --untracked-files=no
```

Expected:

```text
## <branch>...origin/<branch> [ahead N]
```

Only intended commits should be ahead.

---

## Self-Review Checklist

- Every UI mutation uses `src/improvement/center.ts` through Gateway handlers.
- No UI code reads `.crawclaw/improvements` directly.
- `operator.read` covers list/get/metrics only.
- `operator.write` covers run/review/apply/verify/rollback.
- Code proposals cannot apply, verify, or rollback through the UI.
- Beginner-readable copy appears before technical details.
- Existing CLI and TUI tests still pass.
- The route is documented under `docs/web`.
