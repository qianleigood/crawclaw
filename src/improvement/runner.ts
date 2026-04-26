import fs from "node:fs/promises";
import path from "node:path";
import { discoverSkillsForTask } from "../agents/skills/discovery.js";
import { readSkillFrontmatterSafe } from "../agents/skills/local-loader.js";
import { loadWorkspaceSkillEntries } from "../agents/skills/workspace.js";
import type { CrawClawConfig } from "../config/config.js";
import { upsertExperienceIndexEntryFromNote } from "../memory/experience/index-store.ts";
import { resolveN8nCallbackConfig, resolveN8nConfig } from "../workflows/n8n-client.js";
import {
  compileWorkflowSpecToN8n,
  getWorkflowN8nCallbackCompileError,
  getWorkflowN8nTriggerCompileError,
} from "../workflows/n8n-compiler.js";
import {
  createWorkflowDraft,
  describeWorkflow,
  listWorkflowVersions,
  updateWorkflowDefinition,
} from "../workflows/registry.js";
import { buildPromotionCandidateAssessments } from "./candidate-builder.js";
import { applyImprovementPolicy } from "./policy.js";
import { runPromotionJudge } from "./promotion-judge.js";
import {
  loadImprovementProposal,
  saveImprovementProposal,
  saveImprovementRunRecord,
} from "./store.js";
import type {
  ImprovementApplication,
  ImprovementProposal,
  ImprovementReview,
  ImprovementVerificationResult,
  ImprovementWorkflowResult,
  PromotionCandidate,
  PromotionCandidateAssessment,
  PromotionVerdict,
  WorkflowImprovementDraft,
  WorkflowImprovementPatch,
} from "./types.js";

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "improvement";
}

function trimToSentence(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function pickCandidate(
  assessments: PromotionCandidateAssessment[],
): PromotionCandidateAssessment | undefined {
  return (
    assessments.find((assessment) => assessment.baselineDecision === "ready") ?? assessments[0]
  );
}

function buildSkillName(candidate: PromotionCandidate, verdict: PromotionVerdict): string {
  const text = verdict.triggerPattern ?? verdict.reusableMethod ?? candidate.signalSummary;
  const normalized = slugify(text);
  return normalized.length >= 6 ? normalized : `improvement-${slugify(candidate.id)}`;
}

function renderSkillMarkdown(params: {
  skillName: string;
  candidate: PromotionCandidate;
  verdict: PromotionVerdict;
}): string {
  const when = trimToSentence(
    params.verdict.triggerPattern ?? params.candidate.triggerPattern,
    params.candidate.signalSummary,
  );
  const workflow =
    params.candidate.repeatedActions.length > 0
      ? params.candidate.repeatedActions
      : [trimToSentence(params.verdict.reusableMethod, params.candidate.signalSummary)];
  const verification =
    params.verdict.verificationPlan.length > 0
      ? params.verdict.verificationPlan
      : params.candidate.validationEvidence.length > 0
        ? params.candidate.validationEvidence
        : ["Validate the result before reusing this skill."];
  return [
    "---",
    `name: ${params.skillName}`,
    `description: Use when ${when}.`,
    "---",
    "",
    `# ${params.skillName}`,
    "",
    "## When to use",
    `- ${params.candidate.signalSummary}`,
    ...(params.verdict.triggerPattern ? [`- ${params.verdict.triggerPattern}`] : []),
    "",
    "## Workflow",
    ...workflow.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Verification",
    ...verification.map((step) => `- ${step}`),
    "",
    "## Evidence",
    ...(params.candidate.validationEvidence.length > 0
      ? params.candidate.validationEvidence.map((step) => `- ${step}`)
      : ["- No explicit evidence captured yet."]),
    "",
  ].join("\n");
}

function buildWorkflowDraft(params: {
  candidate: PromotionCandidate;
  verdict: PromotionVerdict;
}): WorkflowImprovementDraft {
  const steps =
    params.candidate.repeatedActions.length > 0
      ? params.candidate.repeatedActions
      : [trimToSentence(params.verdict.reusableMethod, params.candidate.signalSummary)];
  return {
    name: `${trimToSentence(params.verdict.triggerPattern, "Improvement Workflow").slice(0, 48)} workflow`,
    goal: trimToSentence(params.verdict.reusableMethod, params.candidate.signalSummary),
    description: params.candidate.signalSummary,
    sourceSummary: params.candidate.signalSummary,
    tags: ["improvement", "promotion"],
    stepSpecs: steps.map((step) => ({
      title: step,
      goal: step,
      kind: "crawclaw_agent",
      notes: "Generated from improvement promotion evidence.",
    })),
    safeForAutoRun: false,
    requiresApproval: true,
  };
}

function buildRollbackPlan(
  candidate: PromotionCandidate,
  verdict: PromotionVerdict,
  skillName?: string,
): string[] {
  if (verdict.decision === "propose_skill" && skillName) {
    return [`Delete .agents/skills/${skillName}/SKILL.md or restore the previous revision.`];
  }
  if (verdict.decision === "propose_workflow") {
    return [
      `Use workflow registry rollback for candidate ${candidate.id} if the promoted workflow misbehaves.`,
    ];
  }
  return ["Review the proposal manually in an isolated worktree before any code change."];
}

function createProposalFromVerdict(params: {
  candidate: PromotionCandidate;
  verdict: PromotionVerdict;
}): ImprovementProposal | null {
  const now = Date.now();
  if (params.verdict.decision === "propose_skill") {
    const skillName = buildSkillName(params.candidate, params.verdict);
    return {
      id: `proposal:${slugify(params.candidate.id)}:${now}`,
      status: "draft",
      candidate: params.candidate,
      verdict: params.verdict,
      patchPlan: {
        kind: "skill",
        targetDir: params.verdict.targetScope === "repo" ? "skills" : ".agents/skills",
        skillName,
        markdown: renderSkillMarkdown({
          skillName,
          candidate: params.candidate,
          verdict: params.verdict,
        }),
      },
      rollbackPlan: buildRollbackPlan(params.candidate, params.verdict, skillName),
      createdAt: now,
      updatedAt: now,
    };
  }
  if (params.verdict.decision === "propose_workflow") {
    return {
      id: `proposal:${slugify(params.candidate.id)}:${now}`,
      status: "draft",
      candidate: params.candidate,
      verdict: params.verdict,
      patchPlan: {
        kind: "workflow",
        patch: {
          mode: "create",
          draft: buildWorkflowDraft(params),
        },
      },
      rollbackPlan: buildRollbackPlan(params.candidate, params.verdict),
      createdAt: now,
      updatedAt: now,
    };
  }
  if (params.verdict.decision === "propose_code") {
    return {
      id: `proposal:${slugify(params.candidate.id)}:${now}`,
      status: "draft",
      candidate: params.candidate,
      verdict: params.verdict,
      patchPlan: {
        kind: "code",
        summary: trimToSentence(params.verdict.reusableMethod, params.candidate.signalSummary),
        recommendedWorktree: true,
      },
      rollbackPlan: buildRollbackPlan(params.candidate, params.verdict),
      createdAt: now,
      updatedAt: now,
    };
  }
  return null;
}

async function verifySkillApplication(params: {
  workspaceDir: string;
  proposal: ImprovementProposal;
  skillName: string;
  skillPath: string;
}): Promise<ImprovementVerificationResult> {
  const checks: string[] = [];
  const errors: string[] = [];
  const frontmatter = readSkillFrontmatterSafe({
    rootDir: path.join(params.workspaceDir, ".agents", "skills"),
    filePath: params.skillPath,
  });
  if (frontmatter?.name?.trim() && frontmatter.description?.trim()) {
    checks.push("skill_frontmatter_valid");
  } else {
    errors.push("skill_frontmatter_invalid");
  }
  const entries = loadWorkspaceSkillEntries(params.workspaceDir);
  if (entries.some((entry) => entry.skill.name === params.skillName)) {
    checks.push("skill_loaded");
  } else {
    errors.push("skill_not_loaded");
  }
  const projectSkillRoot = path.join(params.workspaceDir, ".agents", "skills");
  const projectEntries = entries.filter((entry) =>
    entry.skill.baseDir.startsWith(projectSkillRoot),
  );
  const discovery = await discoverSkillsForTask({
    taskDescription: [
      params.proposal.candidate.signalSummary,
      params.proposal.verdict.reusableMethod ?? "",
      params.proposal.verdict.triggerPattern ?? "",
    ]
      .join(" ")
      .trim(),
    availableSkills: projectEntries.map((entry) => ({
      name: entry.skill.name,
      description: entry.skill.description,
      location: entry.skill.filePath,
    })),
    limit: 5,
  });
  if (discovery.skills.some((entry) => entry.name === params.skillName)) {
    checks.push("skill_discovery_hit");
  } else {
    errors.push("skill_discovery_miss");
  }
  return {
    passed: errors.length === 0,
    checks,
    errors,
  };
}

async function verifyWorkflowApplication(params: {
  workspaceDir: string;
  workflowRef: string;
  config?: CrawClawConfig;
}): Promise<ImprovementVerificationResult> {
  const checks: string[] = [];
  const errors: string[] = [];
  const described = await describeWorkflow(
    { workspaceDir: params.workspaceDir },
    params.workflowRef,
  );
  if (!described?.spec) {
    return {
      passed: false,
      checks,
      errors: ["workflow_missing_after_apply"],
    };
  }
  checks.push("workflow_described");
  if (described.entry.requiresApproval) {
    checks.push("workflow_requires_approval");
  } else {
    errors.push("workflow_requires_approval_not_forced");
  }
  if (!described.entry.safeForAutoRun) {
    checks.push("workflow_auto_run_disabled");
  } else {
    errors.push("workflow_auto_run_not_forced_off");
  }
  const versions = await listWorkflowVersions(
    { workspaceDir: params.workspaceDir },
    params.workflowRef,
  );
  if ((versions?.specVersions.length ?? 0) > 0) {
    checks.push("workflow_version_snapshot");
  } else {
    errors.push("workflow_version_snapshot_missing");
  }
  const resolvedN8n = resolveN8nConfig(params.config);
  if (!resolvedN8n) {
    checks.push("workflow_compile_skipped");
    return {
      passed: errors.length === 0,
      checks,
      errors,
    };
  }
  const callbackConfig = resolveN8nCallbackConfig(params.config) ?? undefined;
  const triggerCompileError = getWorkflowN8nTriggerCompileError(described.spec, {
    triggerBearerToken: resolvedN8n.triggerBearerToken,
  });
  if (triggerCompileError) {
    errors.push(triggerCompileError);
  }
  const callbackCompileError = getWorkflowN8nCallbackCompileError(described.spec, callbackConfig);
  if (callbackCompileError) {
    errors.push(callbackCompileError);
  }
  if (!triggerCompileError && !callbackCompileError) {
    compileWorkflowSpecToN8n(described.spec, {
      specVersion: described.entry.specVersion,
      triggerBearerToken: resolvedN8n.triggerBearerToken,
      ...callbackConfig,
    });
    checks.push("workflow_compiled");
  }
  return {
    passed: errors.length === 0,
    checks,
    errors,
  };
}

async function readTextFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function buildSkillRelativePath(params: { targetDir: string; skillName: string }): string {
  return [params.targetDir, params.skillName, "SKILL.md"]
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

async function writePromotionExperienceNote(params: {
  proposal: ImprovementProposal;
  verification: ImprovementVerificationResult;
}): Promise<void> {
  await upsertExperienceIndexEntryFromNote({
    note: {
      type: params.proposal.patchPlan.kind === "workflow" ? "workflow_pattern" : "procedure",
      title: `自进化晋升：${params.proposal.patchPlan.kind}`,
      summary: `将重复经验晋升为 ${params.proposal.patchPlan.kind}，并通过了目标验证。`,
      context: `proposal=${params.proposal.id}`,
      trigger: "同类经验重复出现且经过审批。",
      action: `将候选 ${params.proposal.candidate.id} 晋升为 ${params.proposal.patchPlan.kind}。`,
      result: "提案应用成功并完成验证。",
      lesson: "重复经验先形成提案，再审批和验证，最后再沉淀为稳定能力。",
      appliesWhen: "需要把重复经验沉淀为 skill 或 workflow 时。",
      evidence: [`proposal=${params.proposal.id}`, ...params.verification.checks.slice(0, 4)],
      confidence: "high",
      dedupeKey: `improvement-promotion:${params.proposal.id}`,
      tags: ["improvement", params.proposal.patchPlan.kind],
    },
    notebookId: "local",
  });
}

export async function runImprovementWorkflow(params: {
  workspaceDir: string;
  judge?: (input: {
    candidate: PromotionCandidate;
    assessment: PromotionCandidateAssessment;
  }) => Promise<PromotionVerdict>;
  embeddedJudgeContext?: Parameters<typeof runPromotionJudge>[0]["embeddedContext"];
  config?: CrawClawConfig;
}): Promise<ImprovementWorkflowResult> {
  const assessments = await buildPromotionCandidateAssessments();
  const selected = pickCandidate(assessments);
  const baseRun = await saveImprovementRunRecord(
    { workspaceDir: params.workspaceDir },
    {
      runId: `improvement-run:${Date.now()}`,
      status: "no_candidate",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  );
  if (!selected) {
    return { run: baseRun };
  }
  if (selected.baselineDecision !== "ready" && !params.judge && !params.embeddedJudgeContext) {
    const run = await saveImprovementRunRecord(
      { workspaceDir: params.workspaceDir },
      {
        ...baseRun,
        status: "needs_more_evidence",
        candidateId: selected.candidate.id,
        note: selected.blockers.join(", "),
      },
    );
    return { run, assessment: selected };
  }

  const verdict = params.judge
    ? await params.judge({ candidate: selected.candidate, assessment: selected })
    : await runPromotionJudge({
        workspaceDir: params.workspaceDir,
        candidate: selected.candidate,
        embeddedContext: params.embeddedJudgeContext!,
      });

  const proposalDraft = createProposalFromVerdict({
    candidate: selected.candidate,
    verdict,
  });
  if (!proposalDraft) {
    const run = await saveImprovementRunRecord(
      { workspaceDir: params.workspaceDir },
      {
        ...baseRun,
        status: verdict.decision === "needs_more_evidence" ? "needs_more_evidence" : "rejected",
        candidateId: selected.candidate.id,
        decision: verdict.decision,
        note: verdict.reasonsAgainst.join("; ") || verdict.missingEvidence.join("; "),
      },
    );
    return { run, assessment: selected, verdict };
  }

  const proposal = applyImprovementPolicy(proposalDraft);
  const nextStatus = proposal.policyResult?.allowed ? "pending_review" : "policy_blocked";
  const storedProposal = await saveImprovementProposal(
    { workspaceDir: params.workspaceDir },
    {
      ...proposal,
      status: nextStatus,
    },
  );
  const run = await saveImprovementRunRecord(
    { workspaceDir: params.workspaceDir },
    {
      ...baseRun,
      status: nextStatus,
      candidateId: storedProposal.candidate.id,
      proposalId: storedProposal.id,
      decision: verdict.decision,
    },
  );
  return {
    run,
    proposal: storedProposal,
    assessment: selected,
    verdict,
  };
}

export async function reviewImprovementProposal(params: {
  workspaceDir: string;
  proposalId: string;
  approved: boolean;
  reviewer?: string;
  comments?: string;
}): Promise<ImprovementProposal> {
  const proposal = await loadImprovementProposal(
    { workspaceDir: params.workspaceDir },
    params.proposalId,
  );
  if (!proposal) {
    throw new Error(`Improvement proposal "${params.proposalId}" not found.`);
  }
  const review: ImprovementReview = {
    approved: params.approved,
    ...(params.reviewer?.trim() ? { reviewer: params.reviewer.trim() } : {}),
    ...(params.comments?.trim() ? { comments: params.comments.trim() } : {}),
  };
  return await saveImprovementProposal(
    { workspaceDir: params.workspaceDir },
    {
      ...proposal,
      review,
      status: params.approved ? "approved" : "rejected",
    },
  );
}

export async function verifyImprovementProposalApplication(params: {
  workspaceDir: string;
  proposalId: string;
  config?: CrawClawConfig;
}): Promise<ImprovementProposal> {
  const proposal = await loadImprovementProposal(
    { workspaceDir: params.workspaceDir },
    params.proposalId,
  );
  if (!proposal) {
    throw new Error(`Improvement proposal "${params.proposalId}" not found.`);
  }
  if (!proposal.application) {
    throw new Error("Improvement proposal must be applied before verification.");
  }
  if (proposal.patchPlan.kind === "code") {
    throw new Error("Code proposal verification requires the manual code-improvement flow.");
  }

  let verification: ImprovementVerificationResult;
  if (proposal.application.kind === "skill") {
    verification = await verifySkillApplication({
      workspaceDir: params.workspaceDir,
      proposal,
      skillName: proposal.application.skillName,
      skillPath: path.join(params.workspaceDir, proposal.application.relativePath),
    });
  } else {
    verification = await verifyWorkflowApplication({
      workspaceDir: params.workspaceDir,
      workflowRef: proposal.application.workflowRef,
      config: params.config,
    });
  }
  return await saveImprovementProposal(
    { workspaceDir: params.workspaceDir },
    {
      ...proposal,
      verificationResult: verification,
      status:
        proposal.status === "rolled_back"
          ? "rolled_back"
          : verification.passed
            ? "applied"
            : "failed",
    },
  );
}

export async function applyImprovementProposal(params: {
  workspaceDir: string;
  proposalId: string;
  sessionKey?: string;
  config?: CrawClawConfig;
  overrideMarkdown?: string;
}): Promise<ImprovementProposal> {
  const proposal = await loadImprovementProposal(
    { workspaceDir: params.workspaceDir },
    params.proposalId,
  );
  if (!proposal) {
    throw new Error(`Improvement proposal "${params.proposalId}" not found.`);
  }
  if (proposal.review?.approved !== true) {
    throw new Error("Improvement proposal requires an approved review before apply.");
  }
  if (proposal.policyResult?.allowed !== true) {
    throw new Error("Improvement proposal is policy blocked.");
  }
  let working = await saveImprovementProposal(
    { workspaceDir: params.workspaceDir },
    {
      ...proposal,
      status: "applying",
    },
  );
  try {
    if (working.patchPlan.kind === "skill") {
      const skillName = working.patchPlan.skillName;
      const skillDir = path.join(params.workspaceDir, working.patchPlan.targetDir, skillName);
      const skillPath = path.join(skillDir, "SKILL.md");
      const previousMarkdown = await readTextFileIfExists(skillPath);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(skillPath, params.overrideMarkdown ?? working.patchPlan.markdown, "utf8");
      const application: ImprovementApplication = {
        kind: "skill",
        targetDir: working.patchPlan.targetDir,
        skillName,
        relativePath: buildSkillRelativePath({
          targetDir: working.patchPlan.targetDir,
          skillName,
        }),
        created: previousMarkdown === null,
        ...(previousMarkdown !== null ? { previousMarkdown } : {}),
        appliedAt: Date.now(),
      };
      working = await saveImprovementProposal(
        { workspaceDir: params.workspaceDir },
        {
          ...working,
          status: "verifying",
          application,
          patchPlan: {
            ...working.patchPlan,
            markdown: params.overrideMarkdown ?? working.patchPlan.markdown,
          },
        },
      );
      const verification = await verifySkillApplication({
        workspaceDir: params.workspaceDir,
        proposal: working,
        skillName,
        skillPath,
      });
      working = await saveImprovementProposal(
        { workspaceDir: params.workspaceDir },
        {
          ...working,
          verificationResult: verification,
          status: verification.passed ? "applied" : "failed",
        },
      );
      if (verification.passed) {
        await writePromotionExperienceNote({
          proposal: working,
          verification,
        });
      }
      return working;
    }
    if (working.patchPlan.kind === "workflow") {
      let workflowRef = working.patchPlan.workflowRef;
      const workflowPatch: WorkflowImprovementPatch = working.patchPlan.patch;
      let application: ImprovementApplication;
      if (workflowPatch.mode === "create") {
        const created = await createWorkflowDraft({
          workspaceDir: params.workspaceDir,
          name: workflowPatch.draft.name,
          goal: workflowPatch.draft.goal,
          description: workflowPatch.draft.description,
          sourceSummary: workflowPatch.draft.sourceSummary,
          tags: workflowPatch.draft.tags,
          stepSpecs: workflowPatch.draft.stepSpecs,
          safeForAutoRun: workflowPatch.draft.safeForAutoRun,
          requiresApproval: workflowPatch.draft.requiresApproval,
          sessionKey: params.sessionKey,
        });
        workflowRef = created.entry.workflowId;
        application = {
          kind: "workflow",
          workflowRef,
          created: true,
          appliedSpecVersion: created.entry.specVersion,
          appliedAt: Date.now(),
        };
      } else {
        const before = await describeWorkflow(
          { workspaceDir: params.workspaceDir },
          workflowPatch.workflowRef,
        );
        const updated = await updateWorkflowDefinition(
          { workspaceDir: params.workspaceDir, sessionKey: params.sessionKey },
          workflowPatch.workflowRef,
          workflowPatch.patch,
        );
        if (!updated) {
          throw new Error(`Workflow "${workflowPatch.workflowRef}" not found.`);
        }
        workflowRef = updated.entry.workflowId;
        application = {
          kind: "workflow",
          workflowRef,
          created: false,
          ...(before?.entry.specVersion ? { previousSpecVersion: before.entry.specVersion } : {}),
          appliedSpecVersion: updated.entry.specVersion,
          appliedAt: Date.now(),
        };
      }
      working = await saveImprovementProposal(
        { workspaceDir: params.workspaceDir },
        {
          ...working,
          status: "verifying",
          application,
          patchPlan: {
            ...working.patchPlan,
            workflowRef,
          },
        },
      );
      const verification = await verifyWorkflowApplication({
        workspaceDir: params.workspaceDir,
        workflowRef,
        config: params.config,
      });
      working = await saveImprovementProposal(
        { workspaceDir: params.workspaceDir },
        {
          ...working,
          verificationResult: verification,
          status: verification.passed ? "applied" : "failed",
        },
      );
      if (verification.passed) {
        await writePromotionExperienceNote({
          proposal: working,
          verification,
        });
      }
      return working;
    }
    const failed = await saveImprovementProposal(
      { workspaceDir: params.workspaceDir },
      {
        ...working,
        status: "failed",
        verificationResult: {
          passed: false,
          checks: [],
          errors: ["code proposal cannot be auto-applied"],
        },
      },
    );
    return failed;
  } catch (error) {
    const failed = await saveImprovementProposal(
      { workspaceDir: params.workspaceDir },
      {
        ...working,
        status: "failed",
        verificationResult: {
          passed: false,
          checks: working.verificationResult?.checks ?? [],
          errors: [
            ...(working.verificationResult?.errors ?? []),
            error instanceof Error ? error.message : String(error),
          ],
        },
      },
    );
    return failed;
  }
}
