import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyPluginRegistry } from "./registry.js";

async function importHookRunnerGlobalModule() {
  return import("./hook-runner-global.js");
}

async function expectGlobalRunnerState(expected: { hasRunner: boolean; registry?: unknown }) {
  const mod = await importHookRunnerGlobalModule();
  expect(mod.getGlobalHookRunner() === null).toBe(!expected.hasRunner);
  if ("registry" in expected) {
    expect(mod.getGlobalPluginRegistry()).toBe(expected.registry ?? null);
  }
  return mod;
}

afterEach(async () => {
  const mod = await importHookRunnerGlobalModule();
  mod.resetGlobalHookRunner();
});

describe("hook-runner-global", () => {
  async function createInitializedModule() {
    const modA = await importHookRunnerGlobalModule();
    const registry = createEmptyPluginRegistry();
    modA.initializeGlobalHookRunner(registry);
    return { modA, registry };
  }

  it("preserves the initialized registry across module reloads without a runner", async () => {
    const { modA, registry } = await createInitializedModule();
    expect(modA.getGlobalHookRunner()).toBeNull();

    vi.resetModules();

    const modB = await expectGlobalRunnerState({ hasRunner: false, registry });
    expect(modB.getGlobalHookRunner()).toBeNull();
  });

  it("clears the shared state across module reloads", async () => {
    await createInitializedModule();

    vi.resetModules();

    const modB = await expectGlobalRunnerState({ hasRunner: false });
    modB.resetGlobalHookRunner();
    expect(modB.getGlobalHookRunner()).toBeNull();
    expect(modB.getGlobalPluginRegistry()).toBeNull();

    vi.resetModules();

    await expectGlobalRunnerState({ hasRunner: false });
  });
});
