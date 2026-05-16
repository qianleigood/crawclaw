import { createEmptyPluginRegistry } from "./registry-empty.js";
import type { PluginRegistry } from "./registry.js";

const REGISTRY_STATE = Symbol.for("crawclaw.pluginRegistryState");

type RegistrySurfaceState = {
  registry: PluginRegistry | null;
  pinned: boolean;
  version: number;
};

type RegistryState = {
  activeRegistry: PluginRegistry | null;
  activeVersion: number;
  httpRoute: RegistrySurfaceState;
  key: string | null;
  importedPluginIds: Set<string>;
};

const state: RegistryState = (() => {
  const globalState = globalThis as typeof globalThis & {
    [REGISTRY_STATE]?: RegistryState;
  };
  if (!globalState[REGISTRY_STATE]) {
    globalState[REGISTRY_STATE] = {
      activeRegistry: null,
      activeVersion: 0,
      httpRoute: {
        registry: null,
        pinned: false,
        version: 0,
      },
      key: null,
      importedPluginIds: new Set<string>(),
    };
  }
  return globalState[REGISTRY_STATE];
})();

export function recordImportedPluginId(pluginId: string): void {
  state.importedPluginIds.add(pluginId);
}

function installSurfaceRegistry(
  surface: RegistrySurfaceState,
  registry: PluginRegistry | null,
  pinned: boolean,
) {
  if (surface.registry === registry && surface.pinned === pinned) {
    return;
  }
  surface.registry = registry;
  surface.pinned = pinned;
  surface.version += 1;
}

function syncTrackedSurface(
  surface: RegistrySurfaceState,
  registry: PluginRegistry | null,
  refreshVersion = false,
) {
  if (surface.pinned) {
    return;
  }
  if (surface.registry === registry && !surface.pinned) {
    if (refreshVersion) {
      surface.version += 1;
    }
    return;
  }
  installSurfaceRegistry(surface, registry, false);
}

export function setActivePluginRegistry(registry: PluginRegistry, cacheKey?: string) {
  state.activeRegistry = registry;
  state.activeVersion += 1;
  syncTrackedSurface(state.httpRoute, registry, true);
  state.key = cacheKey ?? null;
}

export function getActivePluginRegistry(): PluginRegistry | null {
  return state.activeRegistry;
}

export function requireActivePluginRegistry(): PluginRegistry {
  if (!state.activeRegistry) {
    state.activeRegistry = createEmptyPluginRegistry();
    state.activeVersion += 1;
    syncTrackedSurface(state.httpRoute, state.activeRegistry);
  }
  return state.activeRegistry;
}

export function pinActivePluginHttpRouteRegistry(registry: PluginRegistry) {
  installSurfaceRegistry(state.httpRoute, registry, true);
}

export function releasePinnedPluginHttpRouteRegistry(registry?: PluginRegistry) {
  if (registry && state.httpRoute.registry !== registry) {
    return;
  }
  installSurfaceRegistry(state.httpRoute, state.activeRegistry, false);
}

export function getActivePluginHttpRouteRegistry(): PluginRegistry | null {
  return state.httpRoute.registry ?? state.activeRegistry;
}

export function getActivePluginHttpRouteRegistryVersion(): number {
  return state.httpRoute.registry ? state.httpRoute.version : state.activeVersion;
}

export function requireActivePluginHttpRouteRegistry(): PluginRegistry {
  const existing = getActivePluginHttpRouteRegistry();
  if (existing) {
    return existing;
  }
  const created = requireActivePluginRegistry();
  installSurfaceRegistry(state.httpRoute, created, false);
  return created;
}

export function resolveActivePluginHttpRouteRegistry(fallback: PluginRegistry): PluginRegistry {
  const routeRegistry = getActivePluginHttpRouteRegistry();
  if (!routeRegistry) {
    return fallback;
  }
  const routeCount = routeRegistry.httpRoutes?.length ?? 0;
  const fallbackRouteCount = fallback.httpRoutes?.length ?? 0;
  if (routeCount === 0 && fallbackRouteCount > 0) {
    return fallback;
  }
  return routeRegistry;
}

export function getActivePluginRegistryKey(): string | null {
  return state.key;
}

export function getActivePluginRegistryVersion(): number {
  return state.activeVersion;
}

function collectLoadedPluginIds(
  registry: PluginRegistry | null | undefined,
  ids: Set<string>,
): void {
  if (!registry) {
    return;
  }
  for (const plugin of registry.plugins) {
    if (plugin.status === "loaded" && plugin.format !== "bundle") {
      ids.add(plugin.id);
    }
  }
}

/**
 * Returns plugin ids that were imported by plugin runtime or registry loading in
 * the current process.
 *
 * This is a process-level view, not a fresh import trace: cached registry reuse
 * still counts because the plugin code was loaded earlier in this process.
 * Explicit loader import tracking covers plugins that were imported but later
 * ended in an error state during registration.
 * Bundle-format plugins are excluded because they can be "loaded" from metadata
 * without importing any JS entrypoint.
 */
export function listImportedRuntimePluginIds(): string[] {
  const imported = new Set(state.importedPluginIds);
  collectLoadedPluginIds(state.activeRegistry, imported);
  collectLoadedPluginIds(state.httpRoute.registry, imported);
  return [...imported].toSorted((left, right) => left.localeCompare(right));
}

export function resetPluginRuntimeStateForTest(): void {
  state.activeRegistry = null;
  state.activeVersion += 1;
  installSurfaceRegistry(state.httpRoute, null, false);
  state.key = null;
  state.importedPluginIds.clear();
}
