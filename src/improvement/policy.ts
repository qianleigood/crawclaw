import type {
  ImprovementPatchPlan,
  ImprovementProposal,
  WorkflowImprovementPatch,
} from "./types.js";

const BLOCKED_AUTO_APPLY_SKILL_DIRS = new Set(["skills", "skills-optional"]);
const BLOCKED_CORE_PREFIXES = ["src/plugin-sdk/", "src/channels/", "src/plugins/"] as const;

function cloneProposal(proposal: ImprovementProposal): ImprovementProposal {
  return structuredClone(proposal);
}

function normalizeWorkflowPatch(patch: WorkflowImprovementPatch): WorkflowImprovementPatch {
  if (patch.mode === "create") {
    return {
      mode: "create",
      draft: {
        ...patch.draft,
        safeForAutoRun: false,
        requiresApproval: true,
      },
    };
  }
  return {
    mode: "update",
    workflowRef: patch.workflowRef,
    patch: {
      ...patch.patch,
      safeForAutoRun: false,
      requiresApproval: true,
    },
  };
}

function applyPatchPlanPolicy(patchPlan: ImprovementPatchPlan): {
  patchPlan: ImprovementPatchPlan;
  blockers: string[];
} {
  const blockers: string[] = [];
  if (patchPlan.kind === "skill") {
    const normalizedTarget = patchPlan.targetDir.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
    if (BLOCKED_AUTO_APPLY_SKILL_DIRS.has(normalizedTarget)) {
      blockers.push("repo_bundled_skills_require_manual_promotion");
    }
    if (BLOCKED_CORE_PREFIXES.some((prefix) => normalizedTarget.startsWith(prefix))) {
      blockers.push("restricted_core_surface");
    }
    return { patchPlan: { ...patchPlan, targetDir: normalizedTarget }, blockers };
  }
  if (patchPlan.kind === "workflow") {
    return {
      patchPlan: {
        ...patchPlan,
        patch: normalizeWorkflowPatch(patchPlan.patch),
      },
      blockers,
    };
  }
  blockers.push("code_improvement_requires_isolated_manual_flow");
  return { patchPlan, blockers };
}

export function applyImprovementPolicy(proposal: ImprovementProposal): ImprovementProposal {
  const next = cloneProposal(proposal);
  const normalized = applyPatchPlanPolicy(next.patchPlan);
  next.patchPlan = normalized.patchPlan;
  next.policyResult = {
    allowed: normalized.blockers.length === 0,
    blockers: normalized.blockers,
  };
  if (!next.policyResult.allowed && next.status === "draft") {
    next.status = "policy_blocked";
  }
  next.updatedAt = Date.now();
  return next;
}
