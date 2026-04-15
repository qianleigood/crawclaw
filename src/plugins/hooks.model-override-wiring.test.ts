/**
 * Layer 2: Explicit model/prompt hook wiring tests.
 *
 * Verifies:
 * 1. before_model_resolve applies deterministic provider/model overrides
 * 2. before_prompt_build receives session messages and emits structured prompt patches
 * 3. the runner exposes only the new phase hooks
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRunner } from "./hooks.js";
import { addTestHook, TEST_PLUGIN_AGENT_CTX } from "./hooks.test-helpers.js";
import { createEmptyPluginRegistry, type PluginRegistry } from "./registry.js";
import type {
  PluginHookAgentContext,
  PluginHookBeforeModelResolveEvent,
  PluginHookBeforeModelResolveResult,
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforePromptBuildResult,
  PluginHookRegistration,
} from "./types.js";

function addBeforeModelResolveHook(
  registry: PluginRegistry,
  pluginId: string,
  handler: (
    event: PluginHookBeforeModelResolveEvent,
    ctx: PluginHookAgentContext,
  ) => PluginHookBeforeModelResolveResult | Promise<PluginHookBeforeModelResolveResult>,
  priority?: number,
) {
  addTestHook({
    registry,
    pluginId,
    hookName: "before_model_resolve",
    handler: handler as PluginHookRegistration["handler"],
    priority,
  });
}

function addBeforePromptBuildHook(
  registry: PluginRegistry,
  pluginId: string,
  handler: (
    event: PluginHookBeforePromptBuildEvent,
    ctx: PluginHookAgentContext,
  ) => PluginHookBeforePromptBuildResult | Promise<PluginHookBeforePromptBuildResult>,
  priority?: number,
) {
  addTestHook({
    registry,
    pluginId,
    hookName: "before_prompt_build",
    handler: handler as PluginHookRegistration["handler"],
    priority,
  });
}

const stubCtx: PluginHookAgentContext = TEST_PLUGIN_AGENT_CTX;

describe("model override pipeline wiring", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = createEmptyPluginRegistry();
  });

  async function runPromptBuildWithMessages(messages: unknown[]) {
    const runner = createHookRunner(registry);
    return await runner.runBeforePromptBuild({ prompt: "test", messages }, stubCtx);
  }

  async function expectBeforeModelResolve(params: {
    event: PluginHookBeforeModelResolveEvent;
    expected: Partial<PluginHookBeforeModelResolveResult>;
    withBrokenHook?: boolean;
    catchErrors?: boolean;
  }) {
    const handlerSpy = vi.fn(
      (_event: PluginHookBeforeModelResolveEvent) =>
        ({
          modelOverride: "demo-local-model",
          providerOverride: "demo-local-provider",
        }) as PluginHookBeforeModelResolveResult,
    );

    if (params.withBrokenHook) {
      addBeforeModelResolveHook(
        registry,
        "broken-plugin",
        () => {
          throw new Error("plugin crashed");
        },
        10,
      );
    }
    addBeforeModelResolveHook(registry, "router-plugin", handlerSpy);
    const runner = createHookRunner(
      registry,
      params.catchErrors ? { catchErrors: true } : undefined,
    );
    const result = await runner.runBeforeModelResolve(params.event, stubCtx);

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(handlerSpy).toHaveBeenCalledWith(params.event, stubCtx);
    expect(result).toEqual(expect.objectContaining(params.expected));
    return result;
  }

  async function expectPromptBuildPrependContext(params: {
    messages: unknown[];
    expectedPrependContext: string;
  }) {
    const handlerSpy = vi.fn(
      (event: PluginHookBeforePromptBuildEvent) =>
        ({
          queryContextPatch: {
            prependUserContextSections: [{ content: `Saw ${event.messages.length} messages` }],
          },
        }) as PluginHookBeforePromptBuildResult,
    );

    addBeforePromptBuildHook(registry, "context-plugin", handlerSpy);
    const result = await runPromptBuildWithMessages(params.messages);

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(
      result?.queryContextPatch?.prependUserContextSections?.map((section) => section.content),
    ).toEqual([params.expectedPrependContext]);
    return result;
  }

  describe("before_model_resolve (run.ts pattern)", () => {
    it.each([
      {
        name: "hook receives prompt-only event and returns provider/model override",
        event: { prompt: "PII text" },
        expected: {
          modelOverride: "demo-local-model",
          providerOverride: "demo-local-provider",
        },
      },
      {
        name: "one broken before_model_resolve plugin does not block other overrides",
        event: { prompt: "PII data" },
        withBrokenHook: true,
        catchErrors: true,
        expected: {
          modelOverride: "demo-local-model",
          providerOverride: "demo-local-provider",
        },
      },
    ] as const)("$name", async ({ event, expected, withBrokenHook, catchErrors }) => {
      await expectBeforeModelResolve({ event, expected, withBrokenHook, catchErrors });
    });

    it("applies overrides entirely through before_model_resolve", async () => {
      addBeforeModelResolveHook(registry, "new-hook", () => ({
        modelOverride: "demo-local-model",
        providerOverride: "demo-local-provider",
      }));

      const runner = createHookRunner(registry);
      const result = await runner.runBeforeModelResolve({ prompt: "sensitive" }, stubCtx);

      expect(result?.providerOverride).toBe("demo-local-provider");
      expect(result?.modelOverride).toBe("demo-local-model");
    });
  });

  describe("before_prompt_build (attempt.ts pattern)", () => {
    it.each([
      {
        name: "hook receives prompt and messages and can prepend context",
        messages: [{}, {}] as unknown[],
        expectedPrependContext: "Saw 2 messages",
      },
    ] as const)("$name", async ({ messages, expectedPrependContext }) => {
      await expectPromptBuildPrependContext({
        messages,
        expectedPrependContext,
      });
    });
  });

  describe("hook detection", () => {
    it("hasHooks reports the new phase hooks independently", () => {
      const runner1 = createHookRunner(registry);
      expect(runner1.hasHooks("before_model_resolve")).toBe(false);
      expect(runner1.hasHooks("before_prompt_build")).toBe(false);

      addBeforeModelResolveHook(registry, "plugin-a", () => ({}));
      addBeforePromptBuildHook(registry, "plugin-b", () => ({}));

      const runner2 = createHookRunner(registry);
      expect(runner2.hasHooks("before_model_resolve")).toBe(true);
      expect(runner2.hasHooks("before_prompt_build")).toBe(true);
    });
  });
});
