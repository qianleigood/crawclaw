import type { CrawClawConfig } from "../../../config/config.js";
import type {
  PluginHookAgentContext,
  PluginHookDiscoverSkillsForStepResult,
  PluginHookSkillExposureState,
  PluginHookBeforeSkillsPromptBuildResult,
  PluginHookBeforePromptBuildResult,
} from "../../../plugins/types.js";
import { isCronSessionKey, isSubagentSessionKey } from "../../../routing/session-key.js";
import type { QueryContextPatch, QueryContextSection } from "../../query-context/types.js";
import type { SkillEntry, SkillSnapshot } from "../../skills.js";
import {
  getSkillExposureState,
  recordDiscoveredSkills,
  setSurfacedSkillNames,
  updateSkillExposureState,
} from "../../skills/exposure-state.js";
import { resolveEffectiveToolFsWorkspaceOnly } from "../../tool-fs-policy.js";
import type { CompactEmbeddedPiSessionParams } from "../compact.js";
import { buildEmbeddedCompactionRuntimeContext } from "../compaction-runtime-context.js";
import { log } from "../logger.js";
import { shouldInjectHeartbeatPromptForTrigger } from "./trigger-policy.js";
import type { EmbeddedRunAttemptParams } from "./types.js";

export type PromptBuildHookRunner = {
  hasHooks: (hookName: "before_prompt_build") => boolean;
  runBeforePromptBuild: (
    event: { prompt: string; messages: unknown[] },
    ctx: PluginHookAgentContext,
  ) => Promise<PluginHookBeforePromptBuildResult | undefined>;
};

export type ResolvedPromptBuildHookResult = {
  queryContextPatch?: QueryContextPatch;
};

export type SkillsPromptBuildHookRunner = {
  hasHooks: (hookName: "before_skills_prompt_build" | "discover_skills_for_step") => boolean;
  runBeforeSkillsPromptBuild: (
    event: {
      purpose: "run" | "compaction";
      prompt?: string;
      customInstructions?: string;
      workspaceDir: string;
      availableSkills: Array<{ name: string; description?: string; location: string }>;
      skillExposureState?: PluginHookSkillExposureState;
    },
    ctx: PluginHookAgentContext,
  ) => Promise<PluginHookBeforeSkillsPromptBuildResult | undefined>;
  runDiscoverSkillsForStep: (
    event: {
      purpose: "run" | "compaction";
      prompt?: string;
      customInstructions?: string;
      workspaceDir: string;
      availableSkills: Array<{ name: string; description?: string; location: string }>;
      skillExposureState: PluginHookSkillExposureState;
    },
    ctx: PluginHookAgentContext,
  ) => Promise<PluginHookDiscoverSkillsForStepResult | undefined>;
};

function createQueryContextSection(params: {
  id: string;
  role: QueryContextSection["role"];
  content?: string;
  source: string;
}): QueryContextSection | null {
  const content = params.content?.trim();
  if (!content) {
    return null;
  }
  return {
    id: params.id,
    role: params.role,
    content,
    source: params.source,
    cacheable: params.role !== "user_context",
  };
}

const DEFAULT_SKILL_DISCOVER_BUDGET = 2;

export function shouldTriggerSkillDiscovery(params: {
  purpose: "run" | "compaction";
  prompt?: string;
  availableSkills: Array<{ name: string; description?: string; location: string }>;
  skillExposureState: PluginHookSkillExposureState;
}): boolean {
  if (params.purpose !== "run") {
    return false;
  }
  if (!params.prompt?.trim()) {
    return false;
  }
  if ((params.skillExposureState.discoverBudgetRemaining ?? 0) <= 0) {
    return false;
  }
  if (!params.skillExposureState.loadedSkillNames?.length) {
    return false;
  }
  const availableSkillNames = new Set(params.availableSkills.map((skill) => skill.name));
  const surfacedVisibleCount = (params.skillExposureState.surfacedSkillNames ?? []).filter(
    (skillName) => availableSkillNames.has(skillName),
  ).length;
  return surfacedVisibleCount < params.availableSkills.length;
}

export async function resolvePromptBuildHookResult(params: {
  prompt: string;
  messages: unknown[];
  hookCtx: PluginHookAgentContext;
  hookRunner?: PromptBuildHookRunner | null;
}): Promise<ResolvedPromptBuildHookResult> {
  const promptBuildResult = params.hookRunner?.hasHooks("before_prompt_build")
    ? await params.hookRunner
        .runBeforePromptBuild(
          {
            prompt: params.prompt,
            messages: params.messages,
          },
          params.hookCtx,
        )
        .catch((hookErr: unknown) => {
          log.warn(`before_prompt_build hook failed: ${String(hookErr)}`);
          return undefined;
        })
    : undefined;

  const promptBuildPatch = normalizePromptBuildHookPatch(promptBuildResult?.queryContextPatch);

  return {
    queryContextPatch: promptBuildPatch,
  };
}

function normalizePromptBuildHookPatch(
  structuredPatch?: PluginHookBeforePromptBuildResult["queryContextPatch"],
): QueryContextPatch | undefined {
  if (!structuredPatch) {
    return undefined;
  }
  const patch: QueryContextPatch = {
    ...(typeof structuredPatch.replaceUserPrompt === "string"
      ? { replaceUserPrompt: structuredPatch.replaceUserPrompt }
      : {}),
    ...(structuredPatch.clearSystemContextSections === true
      ? { clearSystemContextSections: true }
      : {}),
    ...(Array.isArray(structuredPatch.replaceSystemPromptSections)
      ? {
          replaceSystemPromptSections: structuredPatch.replaceSystemPromptSections
            .map((section, index) =>
              createQueryContextSection({
                id: section.id?.trim() || `hook:replace_system_prompt:${index}`,
                role: "system_prompt",
                content: section.content,
                source: section.source?.trim() || "hook:before_prompt_build",
              }),
            )
            .filter((section): section is QueryContextSection => Boolean(section)),
        }
      : {}),
    prependUserContextSections: (structuredPatch.prependUserContextSections ?? [])
      .map((section, index) =>
        createQueryContextSection({
          id: section.id?.trim() || `hook:prepend_user_context:${index}`,
          role: "user_context",
          content: section.content,
          source: section.source?.trim() || "hook:before_prompt_build",
        }),
      )
      .filter((section): section is QueryContextSection => Boolean(section)),
    appendUserContextSections: (structuredPatch.appendUserContextSections ?? [])
      .map((section, index) =>
        createQueryContextSection({
          id: section.id?.trim() || `hook:append_user_context:${index}`,
          role: "user_context",
          content: section.content,
          source: section.source?.trim() || "hook:before_prompt_build",
        }),
      )
      .filter((section): section is QueryContextSection => Boolean(section)),
    prependSystemContextSections: (structuredPatch.prependSystemContextSections ?? [])
      .map((section, index) =>
        createQueryContextSection({
          id: section.id?.trim() || `hook:prepend_system_context:${index}`,
          role: "system_context",
          content: section.content,
          source: section.source?.trim() || "hook:before_prompt_build",
        }),
      )
      .filter((section): section is QueryContextSection => Boolean(section)),
    appendSystemContextSections: (structuredPatch.appendSystemContextSections ?? [])
      .map((section, index) =>
        createQueryContextSection({
          id: section.id?.trim() || `hook:append_system_context:${index}`,
          role: "system_context",
          content: section.content,
          source: section.source?.trim() || "hook:before_prompt_build",
        }),
      )
      .filter((section): section is QueryContextSection => Boolean(section)),
  };
  const hasContent =
    typeof patch.replaceUserPrompt === "string" ||
    patch.clearSystemContextSections === true ||
    (patch.replaceSystemPromptSections?.length ?? 0) > 0 ||
    (patch.prependUserContextSections?.length ?? 0) > 0 ||
    (patch.appendUserContextSections?.length ?? 0) > 0 ||
    (patch.prependSystemContextSections?.length ?? 0) > 0 ||
    (patch.appendSystemContextSections?.length ?? 0) > 0;
  return hasContent ? compactQueryContextPatch(patch) : undefined;
}

function compactQueryContextPatch(patch: QueryContextPatch): QueryContextPatch {
  return {
    ...(typeof patch.replaceUserPrompt === "string"
      ? { replaceUserPrompt: patch.replaceUserPrompt }
      : {}),
    ...(patch.clearSystemContextSections === true ? { clearSystemContextSections: true } : {}),
    ...(Array.isArray(patch.replaceSystemPromptSections) &&
    patch.replaceSystemPromptSections.length > 0
      ? { replaceSystemPromptSections: patch.replaceSystemPromptSections }
      : {}),
    ...(Array.isArray(patch.prependUserContextSections) &&
    patch.prependUserContextSections.length > 0
      ? { prependUserContextSections: patch.prependUserContextSections }
      : {}),
    ...(Array.isArray(patch.appendUserContextSections) && patch.appendUserContextSections.length > 0
      ? { appendUserContextSections: patch.appendUserContextSections }
      : {}),
    ...(Array.isArray(patch.prependSystemContextSections) &&
    patch.prependSystemContextSections.length > 0
      ? { prependSystemContextSections: patch.prependSystemContextSections }
      : {}),
    ...(Array.isArray(patch.appendSystemContextSections) &&
    patch.appendSystemContextSections.length > 0
      ? { appendSystemContextSections: patch.appendSystemContextSections }
      : {}),
  };
}

export async function resolveSurfacedSkillsHookResult(params: {
  initialSkillExposureState?: PluginHookSkillExposureState;
  explicitSurfacedSkillNames?: string[];
  explicitRelevantSkillNames?: string[];
  purpose: "run" | "compaction";
  prompt?: string;
  customInstructions?: string;
  workspaceDir: string;
  availableSkills: Array<{ name: string; description?: string; location: string }>;
  hookCtx: PluginHookAgentContext;
  hookRunner?: SkillsPromptBuildHookRunner | null;
}): Promise<string[] | undefined> {
  const exposureScope = {
    sessionId: params.hookCtx.sessionId,
    sessionKey: params.hookCtx.sessionKey,
  };
  const priorSkillExposureState = getSkillExposureState(exposureScope);
  const skillExposureState: PluginHookSkillExposureState = {
    surfacedSkillNames:
      priorSkillExposureState?.surfacedSkillNames ??
      params.initialSkillExposureState?.surfacedSkillNames,
    loadedSkillNames:
      priorSkillExposureState?.loadedSkillNames ??
      params.initialSkillExposureState?.loadedSkillNames ??
      [],
    discoveredSkillNames:
      priorSkillExposureState?.discoveredSkillNames ??
      params.initialSkillExposureState?.discoveredSkillNames,
    discoverCount:
      priorSkillExposureState?.discoverCount ??
      params.initialSkillExposureState?.discoverCount ??
      0,
    discoverBudgetRemaining:
      priorSkillExposureState?.discoverBudgetRemaining ??
      params.initialSkillExposureState?.discoverBudgetRemaining ??
      DEFAULT_SKILL_DISCOVER_BUDGET,
  };
  updateSkillExposureState(exposureScope, skillExposureState);
  if (params.explicitSurfacedSkillNames?.length) {
    setSurfacedSkillNames(exposureScope, params.explicitSurfacedSkillNames);
    return params.explicitSurfacedSkillNames;
  }
  if (params.explicitRelevantSkillNames?.length) {
    setSurfacedSkillNames(exposureScope, params.explicitRelevantSkillNames);
    return params.explicitRelevantSkillNames;
  }
  const hookResult = params.hookRunner?.hasHooks("before_skills_prompt_build")
    ? await params.hookRunner
        .runBeforeSkillsPromptBuild(
          {
            purpose: params.purpose,
            prompt: params.prompt,
            customInstructions: params.customInstructions,
            workspaceDir: params.workspaceDir,
            availableSkills: params.availableSkills,
            skillExposureState,
          },
          params.hookCtx,
        )
        .catch((hookErr: unknown) => {
          log.warn(`before_skills_prompt_build hook failed: ${String(hookErr)}`);
          return undefined;
        })
    : undefined;
  const surfaced = hookResult?.surfacedSkillNames ?? hookResult?.relevantSkillNames ?? [];
  if (surfaced.length) {
    setSurfacedSkillNames(exposureScope, surfaced);
  }
  const nextExposureState: PluginHookSkillExposureState = {
    ...skillExposureState,
    surfacedSkillNames: surfaced.length ? surfaced : skillExposureState.surfacedSkillNames,
  };
  const discoverResult =
    params.hookRunner?.hasHooks("discover_skills_for_step") &&
    shouldTriggerSkillDiscovery({
      purpose: params.purpose,
      prompt: params.prompt ?? params.customInstructions,
      availableSkills: params.availableSkills,
      skillExposureState: nextExposureState,
    })
      ? await params.hookRunner
          .runDiscoverSkillsForStep(
            {
              purpose: params.purpose,
              prompt: params.prompt,
              customInstructions: params.customInstructions,
              workspaceDir: params.workspaceDir,
              availableSkills: params.availableSkills,
              skillExposureState: nextExposureState,
            },
            params.hookCtx,
          )
          .catch((hookErr: unknown) => {
            log.warn(`discover_skills_for_step hook failed: ${String(hookErr)}`);
            return undefined;
          })
      : undefined;
  const discovered = discoverResult?.discoveredSkillNames ?? [];
  if (discovered.length) {
    recordDiscoveredSkills({
      scope: exposureScope,
      surfacedSkillNames: surfaced,
      discoveredSkillNames: discovered,
      discoverCount: (nextExposureState.discoverCount ?? 0) + 1,
      discoverBudgetRemaining: Math.max(
        0,
        (nextExposureState.discoverBudgetRemaining ?? DEFAULT_SKILL_DISCOVER_BUDGET) - 1,
      ),
    });
  }
  const mergedSurfaced = [...surfaced, ...discovered].filter(
    (skillName, index, list) => Boolean(skillName) && list.indexOf(skillName) === index,
  );
  return mergedSurfaced.length ? mergedSurfaced : undefined;
}

export function buildAvailableSkillsForHook(params: {
  skillEntries?: SkillEntry[];
  skillsSnapshot?: SkillSnapshot;
}): Array<{ name: string; description?: string; location: string }> {
  if (params.skillEntries?.length) {
    return params.skillEntries.map((entry) => ({
      name: entry.skill.name,
      description: entry.skill.description,
      location: entry.skill.filePath,
    }));
  }
  if (params.skillsSnapshot?.resolvedSkills?.length) {
    return params.skillsSnapshot.resolvedSkills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      location: skill.filePath,
    }));
  }
  return [];
}

export function resolvePromptModeForSession(sessionKey?: string): "minimal" | "full" {
  if (!sessionKey) {
    return "full";
  }
  return isSubagentSessionKey(sessionKey) || isCronSessionKey(sessionKey) ? "minimal" : "full";
}

export function shouldInjectHeartbeatPrompt(params: {
  isDefaultAgent: boolean;
  trigger?: EmbeddedRunAttemptParams["trigger"];
}): boolean {
  return params.isDefaultAgent && shouldInjectHeartbeatPromptForTrigger(params.trigger);
}

export function resolveAttemptFsWorkspaceOnly(params: {
  config?: CrawClawConfig;
  sessionAgentId: string;
}): boolean {
  return resolveEffectiveToolFsWorkspaceOnly({
    cfg: params.config,
    agentId: params.sessionAgentId,
  });
}

/** Build runtime context passed into memory-runtime afterTurn hooks. */
export function buildAfterTurnRuntimeContext(params: {
  attempt: Pick<
    EmbeddedRunAttemptParams,
    | "sessionKey"
    | "agentId"
    | "messageChannel"
    | "messageProvider"
    | "agentAccountId"
    | "currentChannelId"
    | "currentThreadTs"
    | "currentMessageId"
    | "config"
    | "skillsSnapshot"
    | "surfacedSkillNames"
    | "relevantSkillNames"
    | "senderIsOwner"
    | "senderId"
    | "provider"
    | "modelId"
    | "thinkLevel"
    | "reasoningLevel"
    | "bashElevated"
    | "extraSystemPrompt"
    | "ownerNumbers"
    | "authProfileId"
  >;
  workspaceDir: string;
  agentDir: string;
}): Partial<CompactEmbeddedPiSessionParams> {
  return buildEmbeddedCompactionRuntimeContext({
    sessionKey: params.attempt.sessionKey,
    agentId: params.attempt.agentId,
    messageChannel: params.attempt.messageChannel,
    messageProvider: params.attempt.messageProvider,
    agentAccountId: params.attempt.agentAccountId,
    currentChannelId: params.attempt.currentChannelId,
    currentThreadTs: params.attempt.currentThreadTs,
    currentMessageId: params.attempt.currentMessageId,
    authProfileId: params.attempt.authProfileId,
    workspaceDir: params.workspaceDir,
    agentDir: params.agentDir,
    config: params.attempt.config,
    skillsSnapshot: params.attempt.skillsSnapshot,
    senderIsOwner: params.attempt.senderIsOwner,
    senderId: params.attempt.senderId,
    provider: params.attempt.provider,
    modelId: params.attempt.modelId,
    thinkLevel: params.attempt.thinkLevel,
    reasoningLevel: params.attempt.reasoningLevel,
    bashElevated: params.attempt.bashElevated,
    extraSystemPrompt: params.attempt.extraSystemPrompt,
    ownerNumbers: params.attempt.ownerNumbers,
  });
}
