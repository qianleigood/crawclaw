import type { WorkflowDefinitionPatch, WorkflowStepKind } from "../workflows/types.js";

export type PromotionSourceRef = {
  kind: "experience" | "context_archive" | "workflow_run";
  ref: string;
};

export type PromotionCandidate = {
  id: string;
  sourceRefs: PromotionSourceRef[];
  signalSummary: string;
  observedFrequency: number;
  currentReuseLevel: "none" | "experience" | "skill" | "workflow";
  triggerPattern?: string;
  repeatedActions: string[];
  validationEvidence: string[];
  firstSeenAt: number;
  lastSeenAt: number;
};

export type PromotionVerdict = {
  candidateId: string;
  decision:
    | "keep_experience"
    | "propose_skill"
    | "propose_workflow"
    | "propose_code"
    | "needs_more_evidence"
    | "reject";
  confidence: "low" | "medium" | "high";
  riskLevel: "low" | "medium" | "high";
  targetScope?: "workspace" | "repo" | "agent";
  triggerPattern?: string;
  reusableMethod?: string;
  reasonsFor: string[];
  reasonsAgainst: string[];
  missingEvidence: string[];
  verificationPlan: string[];
};

export type WorkflowImprovementDraft = {
  name: string;
  goal: string;
  description?: string;
  sourceSummary?: string;
  tags?: string[];
  stepSpecs?: Array<{
    title: string;
    goal?: string;
    kind?: WorkflowStepKind;
    prompt?: string;
    allowedTools?: string[];
    allowedSkills?: string[];
    notes?: string;
  }>;
  safeForAutoRun?: boolean;
  requiresApproval?: boolean;
};

export type WorkflowImprovementPatch =
  | {
      mode: "create";
      draft: WorkflowImprovementDraft;
    }
  | {
      mode: "update";
      workflowRef: string;
      patch: WorkflowDefinitionPatch;
    };

export type ImprovementPatchPlan =
  | {
      kind: "skill";
      targetDir: string;
      skillName: string;
      markdown: string;
    }
  | {
      kind: "workflow";
      workflowRef?: string;
      patch: WorkflowImprovementPatch;
    }
  | {
      kind: "code";
      summary: string;
      recommendedWorktree: true;
    };

export type ImprovementPolicyResult = {
  allowed: boolean;
  blockers: string[];
};

export type ImprovementReview = {
  approved: boolean;
  reviewer?: string;
  comments?: string;
};

export type ImprovementVerificationResult = {
  passed: boolean;
  checks: string[];
  errors: string[];
};

export type ImprovementApplication =
  | {
      kind: "skill";
      targetDir: string;
      skillName: string;
      relativePath: string;
      created: boolean;
      previousMarkdown?: string;
      appliedAt: number;
    }
  | {
      kind: "workflow";
      workflowRef: string;
      created: boolean;
      previousSpecVersion?: number;
      appliedSpecVersion: number;
      appliedAt: number;
    };

export type ImprovementRollbackResult = {
  kind: ImprovementPatchPlan["kind"];
  rolledBackAt: number;
  success: boolean;
  note?: string;
  errors: string[];
};

export type ImprovementProposalStatus =
  | "draft"
  | "policy_blocked"
  | "pending_review"
  | "approved"
  | "applying"
  | "verifying"
  | "applied"
  | "rejected"
  | "failed"
  | "superseded"
  | "rolled_back";

export type ImprovementProposal = {
  id: string;
  status: ImprovementProposalStatus;
  candidate: PromotionCandidate;
  verdict: PromotionVerdict;
  patchPlan: ImprovementPatchPlan;
  policyResult?: ImprovementPolicyResult;
  review?: ImprovementReview;
  verificationResult?: ImprovementVerificationResult;
  application?: ImprovementApplication;
  rollback?: ImprovementRollbackResult;
  rollbackPlan: string[];
  createdAt: number;
  updatedAt: number;
};

export type ImprovementProposalIndexEntry = {
  id: string;
  status: ImprovementProposalStatus;
  candidateId: string;
  kind: ImprovementPatchPlan["kind"];
  createdAt: number;
  updatedAt: number;
};

export type ImprovementRunStatus =
  | "no_candidate"
  | "needs_more_evidence"
  | "rejected"
  | "policy_blocked"
  | "pending_review"
  | "applied"
  | "failed";

export type ImprovementRunRecord = {
  runId: string;
  status: ImprovementRunStatus;
  candidateId?: string;
  proposalId?: string;
  decision?: PromotionVerdict["decision"];
  note?: string;
  createdAt: number;
  updatedAt: number;
};

export type ImprovementRunIndexEntry = {
  runId: string;
  status: ImprovementRunStatus;
  candidateId?: string;
  proposalId?: string;
  createdAt: number;
  updatedAt: number;
};

export type ImprovementStoreIndex = {
  version: 1;
  updatedAt: number;
  proposals: ImprovementProposalIndexEntry[];
  runs: ImprovementRunIndexEntry[];
};

export type PromotionEvidenceKind = "trigger" | "action" | "result" | "validation";

export type PromotionCandidateAssessment = {
  candidate: PromotionCandidate;
  evidenceKinds: PromotionEvidenceKind[];
  baselineDecision: "ready" | "needs_more_evidence";
  blockers: string[];
  score: number;
};

export type PromotionJudgeVerdictEnvelope = {
  version: 1;
  runId: string;
  verdict: PromotionVerdict;
  createdAt: number;
};

export type ImprovementWorkflowResult = {
  run: ImprovementRunRecord;
  proposal?: ImprovementProposal;
  assessment?: PromotionCandidateAssessment;
  verdict?: PromotionVerdict;
};
