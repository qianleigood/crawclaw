import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { HookRunner } from "./hooks.js";
import type { PluginRegistry } from "./registry.js";

type HookRunnerGlobalState = {
  registry: PluginRegistry | null;
};

const hookRunnerGlobalStateKey = Symbol.for("crawclaw.plugins.hook-runner-global-state");
const getState = () =>
  resolveGlobalSingleton<HookRunnerGlobalState>(hookRunnerGlobalStateKey, () => ({
    registry: null,
  }));

export function initializeGlobalHookRunner(registry: PluginRegistry): void {
  getState().registry = registry;
}

export function getGlobalHookRunner(): HookRunner | null {
  return null;
}

export function getGlobalPluginRegistry(): PluginRegistry | null {
  return getState().registry;
}

export function hasGlobalHooks(): false {
  return false;
}

export async function runGlobalGatewayStopSafely(_params?: unknown): Promise<void> {}

export function resetGlobalHookRunner(): void {
  getState().registry = null;
}
