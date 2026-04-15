import { beforeEach, describe, expect, it } from "vitest";
import { createHookRunner } from "./hooks.js";
import { addStaticTestHooks } from "./hooks.test-helpers.js";
import { createEmptyPluginRegistry, type PluginRegistry } from "./registry.js";
import type {
  PluginHookBeforeModelResolveResult,
  PluginHookBeforeSkillsPromptBuildResult,
  PluginHookDiscoverSkillsForStepResult,
  PluginHookBeforePromptBuildResult,
} from "./types.js";

describe("phase hooks merger", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = createEmptyPluginRegistry();
  });

  async function runPhaseHook(params: {
    hookName:
      | "before_model_resolve"
      | "before_skills_prompt_build"
      | "discover_skills_for_step"
      | "before_prompt_build";
    hooks: ReadonlyArray<{
      pluginId: string;
      result:
        | PluginHookBeforeModelResolveResult
        | PluginHookBeforeSkillsPromptBuildResult
        | PluginHookDiscoverSkillsForStepResult
        | PluginHookBeforePromptBuildResult;
      priority?: number;
    }>;
  }) {
    addStaticTestHooks(registry, {
      hookName: params.hookName,
      hooks: [...params.hooks],
    });
    const runner = createHookRunner(registry);
    if (params.hookName === "before_model_resolve") {
      return await runner.runBeforeModelResolve({ prompt: "test" }, {});
    }
    if (params.hookName === "before_skills_prompt_build") {
      return await runner.runBeforeSkillsPromptBuild(
        { purpose: "run", prompt: "test", workspaceDir: "/tmp/crawclaw", availableSkills: [] },
        {},
      );
    }
    if (params.hookName === "discover_skills_for_step") {
      return await runner.runDiscoverSkillsForStep(
        {
          purpose: "run",
          prompt: "test",
          workspaceDir: "/tmp/crawclaw",
          availableSkills: [],
          skillExposureState: {
            surfacedSkillNames: ["deploy-runbook"],
            loadedSkillNames: ["deploy-runbook"],
            discoverCount: 0,
            discoverBudgetRemaining: 2,
          },
        },
        {},
      );
    }
    return await runner.runBeforePromptBuild({ prompt: "test", messages: [] }, {});
  }

  async function expectPhaseHookMerge(params: {
    hookName:
      | "before_model_resolve"
      | "before_skills_prompt_build"
      | "discover_skills_for_step"
      | "before_prompt_build";
    hooks: ReadonlyArray<{
      pluginId: string;
      result:
        | PluginHookBeforeModelResolveResult
        | PluginHookBeforeSkillsPromptBuildResult
        | PluginHookDiscoverSkillsForStepResult
        | PluginHookBeforePromptBuildResult;
      priority?: number;
    }>;
    expected: Record<string, unknown>;
  }) {
    const result = await runPhaseHook(params);
    expect(result).toEqual(expect.objectContaining(params.expected));
  }

  it.each([
    {
      name: "before_model_resolve keeps higher-priority override values",
      hookName: "before_model_resolve" as const,
      hooks: [
        { pluginId: "low", result: { modelOverride: "demo-low-priority-model" }, priority: 1 },
        {
          pluginId: "high",
          result: {
            modelOverride: "demo-high-priority-model",
            providerOverride: "demo-provider",
          },
          priority: 10,
        },
      ],
      expected: {
        modelOverride: "demo-high-priority-model",
        providerOverride: "demo-provider",
      },
    },
    {
      name: "before_skills_prompt_build merges surfaced skill names in priority order",
      hookName: "before_skills_prompt_build" as const,
      hooks: [
        {
          pluginId: "high",
          result: { surfacedSkillNames: ["deploy-runbook", "repo-defaults"] },
          priority: 10,
        },
        {
          pluginId: "low",
          result: { surfacedSkillNames: ["repo-defaults", "incident-response"] },
          priority: 1,
        },
      ],
      expected: {
        surfacedSkillNames: ["deploy-runbook", "repo-defaults", "incident-response"],
      },
    },
    {
      name: "discover_skills_for_step merges discovered skills in priority order",
      hookName: "discover_skills_for_step" as const,
      hooks: [
        {
          pluginId: "high",
          result: { discoveredSkillNames: ["feishu-create-doc", "repo-defaults"] },
          priority: 10,
        },
        {
          pluginId: "low",
          result: { discoveredSkillNames: ["repo-defaults", "task-tracker"] },
          priority: 1,
        },
      ],
      expected: {
        discoveredSkillNames: ["feishu-create-doc", "repo-defaults", "task-tracker"],
      },
    },
    {
      name: "before_prompt_build concatenates structured patches and preserves system prompt override precedence",
      hookName: "before_prompt_build" as const,
      hooks: [
        {
          pluginId: "high",
          result: {
            queryContextPatch: {
              prependUserContextSections: [{ content: "context A" }] as Array<{
                content: string;
              }>,
              replaceSystemPromptSections: [{ content: "system A" }] as Array<{
                content: string;
              }>,
            },
          },
          priority: 10,
        },
        {
          pluginId: "low",
          result: {
            queryContextPatch: {
              prependUserContextSections: [{ content: "context B" }] as Array<{
                content: string;
              }>,
              replaceSystemPromptSections: [{ content: "system B" }] as Array<{
                content: string;
              }>,
            },
          },
          priority: 1,
        },
      ],
      expected: {
        queryContextPatch: {
          prependUserContextSections: [{ content: "context A" }, { content: "context B" }],
          replaceSystemPromptSections: [{ content: "system A" }],
        },
      },
    },
    {
      name: "before_prompt_build concatenates structured system-context sections",
      hookName: "before_prompt_build" as const,
      hooks: [
        {
          pluginId: "first",
          result: {
            queryContextPatch: {
              prependSystemContextSections: [{ content: "prepend A" }] as Array<{
                content: string;
              }>,
              appendSystemContextSections: [{ content: "append A" }] as Array<{
                content: string;
              }>,
            },
          },
          priority: 10,
        },
        {
          pluginId: "second",
          result: {
            queryContextPatch: {
              prependSystemContextSections: [{ content: "prepend B" }] as Array<{
                content: string;
              }>,
              appendSystemContextSections: [{ content: "append B" }] as Array<{
                content: string;
              }>,
            },
          },
          priority: 1,
        },
      ],
      expected: {
        queryContextPatch: {
          prependSystemContextSections: [{ content: "prepend A" }, { content: "prepend B" }],
          appendSystemContextSections: [{ content: "append A" }, { content: "append B" }],
        },
      },
    },
  ] as const)("$name", async ({ hookName, hooks, expected }) => {
    await expectPhaseHookMerge({ hookName, hooks, expected });
  });
});
