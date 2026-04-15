import path from "node:path";
import {
  readSkillFrontmatterSafe,
  loadSkillsFromDirSafe,
} from "../agents/skills/local-loader.js";
import { resolveCrawClawMetadata } from "../agents/skills/frontmatter.js";
import type { CrawClawSkillMetadata } from "../agents/skills/types.js";
import type { WorkflowStoreContext } from "./store.js";
import type { WorkflowHttpMethod, WorkflowPortability, WorkflowStepKind } from "./types.js";

export type WorkflowSkillHint = {
  name: string;
  filePath: string;
  baseDir: string;
  metadata?: CrawClawSkillMetadata;
};

export type WorkflowSkillPortabilityHint = {
  skillName: string;
  portability: WorkflowPortability;
  stepKind: WorkflowStepKind;
  serviceUrl?: string;
  serviceMethod?: WorkflowHttpMethod;
  tags?: string[];
  allowedTools?: string[];
  allowedSkills?: string[];
  requiresApproval?: boolean;
  waitKind?: "input" | "external";
  notes?: string;
};

function uniqueRoots(context: WorkflowStoreContext): string[] {
  const roots = new Set<string>();
  const workspaceDir = context.workspaceDir?.trim();
  if (workspaceDir) {
    roots.add(path.join(workspaceDir, "skills"));
    roots.add(path.join(workspaceDir, "skills-optional"));
    roots.add(path.join(workspaceDir, ".crawclaw", "skills"));
  }
  const agentDir = context.agentDir?.trim();
  if (agentDir) {
    roots.add(path.join(agentDir, "skills"));
  }
  return [...roots];
}

function resolveDefaultStepKind(
  portability: WorkflowPortability,
  explicit?: WorkflowStepKind,
): WorkflowStepKind {
  if (explicit) {
    return explicit;
  }
  switch (portability) {
    case "native":
      return "native";
    case "service":
      return "service";
    case "human":
      return "human_wait";
    case "crawclaw_agent":
    case "non_portable":
      return "crawclaw_agent";
  }
}

export function listWorkflowSkillHints(context: WorkflowStoreContext): WorkflowSkillHint[] {
  const seen = new Map<string, WorkflowSkillHint>();
  for (const root of uniqueRoots(context)) {
    const loaded = loadSkillsFromDirSafe({
      dir: root,
      source: "workflow-portability",
    });
    for (const skill of loaded.skills) {
      const frontmatter =
        readSkillFrontmatterSafe({
          rootDir: skill.baseDir,
          filePath: skill.filePath,
        }) ?? {};
      const hint: WorkflowSkillHint = {
        name: skill.name,
        filePath: skill.filePath,
        baseDir: skill.baseDir,
        metadata: resolveCrawClawMetadata(frontmatter),
      };
      seen.set(skill.name.trim().toLowerCase(), hint);
    }
  }
  return [...seen.values()].toSorted((left, right) => left.name.localeCompare(right.name));
}

export function resolveWorkflowSkillPortabilityHint(
  context: WorkflowStoreContext,
  skillName: string,
): WorkflowSkillPortabilityHint | null {
  const normalized = skillName.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const hint = listWorkflowSkillHints(context).find((entry) => entry.name.trim().toLowerCase() === normalized);
  const workflow = hint?.metadata?.workflow;
  const portability = workflow?.portability;
  if (!hint || !workflow || !portability) {
    return null;
  }
  return {
    skillName: hint.name,
    portability,
    stepKind: resolveDefaultStepKind(portability, workflow.stepKind),
    ...(workflow.serviceUrl ? { serviceUrl: workflow.serviceUrl } : {}),
    ...(workflow.serviceMethod ? { serviceMethod: workflow.serviceMethod } : {}),
    ...(workflow.tags?.length ? { tags: workflow.tags } : {}),
    ...(workflow.allowedTools?.length ? { allowedTools: workflow.allowedTools } : {}),
    ...(workflow.allowedSkills?.length ? { allowedSkills: workflow.allowedSkills } : {}),
    ...(workflow.requiresApproval !== undefined
      ? { requiresApproval: workflow.requiresApproval }
      : {}),
    ...(workflow.waitKind ? { waitKind: workflow.waitKind } : {}),
    ...(workflow.notes ? { notes: workflow.notes } : {}),
  };
}
