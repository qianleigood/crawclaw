import type { PluginHookSkillExposureState } from "../../plugins/types.js";

type SkillExposureScope = {
  sessionId?: string;
  sessionKey?: string;
};

const exposureStateBySession = new Map<string, PluginHookSkillExposureState>();

function resolveScopeKey(scope: SkillExposureScope): string | null {
  const sessionId = scope.sessionId?.trim();
  if (sessionId) {
    return `sessionId:${sessionId}`;
  }
  const sessionKey = scope.sessionKey?.trim();
  if (sessionKey) {
    return `sessionKey:${sessionKey}`;
  }
  return null;
}

function cloneState(
  state: PluginHookSkillExposureState | undefined,
): PluginHookSkillExposureState | undefined {
  if (!state) {
    return undefined;
  }
  return {
    surfacedSkillNames: state.surfacedSkillNames ? [...state.surfacedSkillNames] : undefined,
    loadedSkillNames: state.loadedSkillNames ? [...state.loadedSkillNames] : undefined,
    discoveredSkillNames: state.discoveredSkillNames ? [...state.discoveredSkillNames] : undefined,
    discoverCount: state.discoverCount,
    discoverBudgetRemaining: state.discoverBudgetRemaining,
  };
}

function normalizeSkillNames(skillNames: readonly string[] | undefined): string[] | undefined {
  if (!skillNames?.length) {
    return undefined;
  }
  const normalized = skillNames
    .map((skillName) => skillName.trim())
    .filter((skillName, index, list) => Boolean(skillName) && list.indexOf(skillName) === index);
  return normalized.length ? normalized : undefined;
}

function updateState(
  scope: SkillExposureScope,
  updater: (state: PluginHookSkillExposureState) => void,
): void {
  const key = resolveScopeKey(scope);
  if (!key) {
    return;
  }
  const nextState = cloneState(exposureStateBySession.get(key)) ?? {};
  updater(nextState);
  exposureStateBySession.set(key, nextState);
}

export function getSkillExposureState(
  scope: SkillExposureScope,
): PluginHookSkillExposureState | undefined {
  const key = resolveScopeKey(scope);
  return key ? cloneState(exposureStateBySession.get(key)) : undefined;
}

export function setSurfacedSkillNames(
  scope: SkillExposureScope,
  surfacedSkillNames: readonly string[] | undefined,
): void {
  const normalized = normalizeSkillNames(surfacedSkillNames);
  if (!normalized?.length) {
    return;
  }
  updateState(scope, (state) => {
    state.surfacedSkillNames = normalized;
  });
}

export function recordLoadedSkillName(scope: SkillExposureScope, skillName: string): void {
  const normalized = normalizeSkillNames([skillName]);
  if (!normalized?.length) {
    return;
  }
  updateState(scope, (state) => {
    state.loadedSkillNames = normalizeSkillNames([
      ...(state.loadedSkillNames ?? []),
      normalized[0],
    ]);
  });
}

export function updateSkillExposureState(
  scope: SkillExposureScope,
  patch: Partial<PluginHookSkillExposureState>,
): void {
  updateState(scope, (state) => {
    if (patch.surfacedSkillNames) {
      state.surfacedSkillNames = normalizeSkillNames(patch.surfacedSkillNames);
    }
    if (patch.loadedSkillNames) {
      state.loadedSkillNames = normalizeSkillNames(patch.loadedSkillNames);
    }
    if (patch.discoveredSkillNames) {
      state.discoveredSkillNames = normalizeSkillNames(patch.discoveredSkillNames);
    }
    if (typeof patch.discoverCount === "number") {
      state.discoverCount = patch.discoverCount;
    }
    if (typeof patch.discoverBudgetRemaining === "number") {
      state.discoverBudgetRemaining = patch.discoverBudgetRemaining;
    }
  });
}

export function recordDiscoveredSkills(params: {
  scope: SkillExposureScope;
  discoveredSkillNames: readonly string[];
  surfacedSkillNames?: readonly string[];
  discoverCount?: number;
  discoverBudgetRemaining?: number;
}): void {
  const normalizedDiscovered = normalizeSkillNames(params.discoveredSkillNames);
  if (!normalizedDiscovered?.length) {
    return;
  }
  updateState(params.scope, (state) => {
    state.surfacedSkillNames = normalizeSkillNames([
      ...(params.surfacedSkillNames ?? state.surfacedSkillNames ?? []),
      ...normalizedDiscovered,
    ]);
    state.discoveredSkillNames = normalizeSkillNames([
      ...(state.discoveredSkillNames ?? []),
      ...normalizedDiscovered,
    ]);
    state.discoverCount = params.discoverCount ?? ((state.discoverCount ?? 0) + 1);
    state.discoverBudgetRemaining =
      params.discoverBudgetRemaining ??
      Math.max(0, (state.discoverBudgetRemaining ?? 0) - 1);
  });
}

export function clearSkillExposureState(scope: SkillExposureScope): void {
  const key = resolveScopeKey(scope);
  if (key) {
    exposureStateBySession.delete(key);
  }
}

export function inferLoadedSkillNameFromToolCall(params: {
  toolName?: string;
  toolParams?: Record<string, unknown>;
}): string | undefined {
  if (params.toolName?.trim().toLowerCase() !== "read") {
    return undefined;
  }
  const rawPath =
    typeof params.toolParams?.path === "string"
      ? params.toolParams.path
      : typeof params.toolParams?.file_path === "string"
        ? params.toolParams.file_path
        : typeof params.toolParams?.filePath === "string"
          ? params.toolParams.filePath
        : typeof params.toolParams?.file === "string"
          ? params.toolParams.file
        : undefined;
  const normalizedPath = rawPath?.trim().replaceAll("\\", "/");
  if (!normalizedPath) {
    return undefined;
  }
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.length < 2) {
    return undefined;
  }
  const filename = parts.at(-1);
  if (!filename || !/^skill\.md$/i.test(filename)) {
    return undefined;
  }
  const skillName = parts.at(-2)?.trim();
  return skillName || undefined;
}

export function clearAllSkillExposureStateForTest(): void {
  exposureStateBySession.clear();
}
