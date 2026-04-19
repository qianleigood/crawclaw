import type { ControlUiMethodParamsMap } from "../../../../src/gateway/protocol/control-ui-methods.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  ChannelConfigSchemaResponse,
  ChannelConfigSnapshot,
  ConfigUiHints,
} from "../types.ts";
import type { JsonSchema } from "../views/config-form.shared.ts";
import { coerceFormValues } from "./config/form-coerce.ts";
import {
  cloneConfigObject,
  removePathValue,
  serializeConfigForm,
  setPathValue,
} from "./config/form-utils.ts";

type ChannelConfigSaveMethod = "channels.config.patch" | "channels.config.apply";

export type ChannelConfigState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  applySessionKey: string;
  selectedChannelId: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configApplying: boolean;
  configSnapshot: ChannelConfigSnapshot | null;
  configSchema: unknown;
  configSchemaVersion: string | null;
  configSchemaLoading: boolean;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  configFormOriginal: Record<string, unknown> | null;
  configFormDirty: boolean;
  lastError: string | null;
};

function asJsonSchema(value: unknown): JsonSchema | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonSchema;
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneUnknown<T>(value: T): T {
  return structuredClone(value);
}

function isConfigValueEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => isConfigValueEqual(item, right[index]));
  }
  if (isPlainObjectRecord(left) && isPlainObjectRecord(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (!isConfigValueEqual(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function createConfigMergePatch(base: unknown, target: unknown): unknown {
  if (!isPlainObjectRecord(base) || !isPlainObjectRecord(target)) {
    return cloneUnknown(target);
  }

  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(target)]);
  for (const key of keys) {
    const hasBase = key in base;
    const hasTarget = key in target;
    if (!hasTarget) {
      patch[key] = null;
      continue;
    }
    const targetValue = target[key];
    if (!hasBase) {
      patch[key] = cloneUnknown(targetValue);
      continue;
    }
    const baseValue = base[key];
    if (isPlainObjectRecord(baseValue) && isPlainObjectRecord(targetValue)) {
      const childPatch = createConfigMergePatch(baseValue, targetValue);
      if (isPlainObjectRecord(childPatch) && Object.keys(childPatch).length === 0) {
        continue;
      }
      patch[key] = childPatch;
      continue;
    }
    if (!isConfigValueEqual(baseValue, targetValue)) {
      patch[key] = cloneUnknown(targetValue);
    }
  }
  return patch;
}

function containsArrayPatch(value: unknown): boolean {
  if (Array.isArray(value)) {
    return true;
  }
  if (!isPlainObjectRecord(value)) {
    return false;
  }
  return Object.values(value).some((child) => containsArrayPatch(child));
}

function serializeFormForSubmit(state: ChannelConfigState): string {
  const schema = asJsonSchema(state.configSchema);
  const form = state.configForm ?? {};
  const coerced = schema ? (coerceFormValues(form, schema) as Record<string, unknown>) : form;
  return serializeConfigForm(coerced);
}

function resolveSaveRequest(state: ChannelConfigState): {
  method: ChannelConfigSaveMethod;
  params: ControlUiMethodParamsMap[ChannelConfigSaveMethod];
} {
  const channel = state.selectedChannelId?.trim();
  if (!channel) {
    throw new Error("No channel selected.");
  }
  const raw = serializeFormForSubmit(state);
  const baseHash = state.configSnapshot?.hash;
  if (!baseHash) {
    throw new Error("Channel config hash missing; reload and retry.");
  }
  const original = cloneConfigObject(
    state.configFormOriginal ?? state.configSnapshot?.config ?? {},
  );
  const current = JSON.parse(raw) as Record<string, unknown>;
  const patch = createConfigMergePatch(original, current);
  if (!isPlainObjectRecord(patch) || containsArrayPatch(patch)) {
    return {
      method: "channels.config.apply",
      params: {
        channel,
        raw,
        baseHash,
        sessionKey: state.applySessionKey,
      },
    };
  }
  return {
    method: "channels.config.patch",
    params: {
      channel,
      raw: serializeConfigForm(patch),
      baseHash,
      sessionKey: state.applySessionKey,
    },
  };
}

export function resetChannelConfigState(state: ChannelConfigState) {
  state.selectedChannelId = null;
  state.configLoading = false;
  state.configSaving = false;
  state.configApplying = false;
  state.configSnapshot = null;
  state.configSchema = null;
  state.configSchemaVersion = null;
  state.configSchemaLoading = false;
  state.configUiHints = {};
  state.configForm = null;
  state.configFormOriginal = null;
  state.configFormDirty = false;
  state.lastError = null;
}

export function applyChannelConfigSchema(
  state: ChannelConfigState,
  res: ChannelConfigSchemaResponse,
) {
  state.configSchema = res.schema ?? null;
  state.configUiHints = res.uiHints ?? {};
  state.configSchemaVersion = res.version ?? null;
}

export function applyChannelConfigSnapshot(
  state: ChannelConfigState,
  snapshot: ChannelConfigSnapshot,
) {
  state.configSnapshot = snapshot;
  if (!state.configFormDirty) {
    state.configForm = cloneConfigObject(snapshot.config ?? {});
    state.configFormOriginal = cloneConfigObject(snapshot.config ?? {});
  }
}

export async function loadChannelConfig(state: ChannelConfigState, channelId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.selectedChannelId = channelId;
  state.configLoading = true;
  state.lastError = null;
  try {
    const res = await state.client.request<ChannelConfigSnapshot>("channels.config.get", {
      channel: channelId,
    });
    if (state.selectedChannelId !== channelId) {
      return;
    }
    applyChannelConfigSnapshot(state, res);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configLoading = false;
  }
}

export async function loadChannelConfigSchema(state: ChannelConfigState, channelId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.selectedChannelId = channelId;
  state.configSchemaLoading = true;
  state.lastError = null;
  try {
    const res = await state.client.request<ChannelConfigSchemaResponse>("channels.config.schema", {
      channel: channelId,
    });
    if (state.selectedChannelId !== channelId) {
      return;
    }
    applyChannelConfigSchema(state, res);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configSchemaLoading = false;
  }
}

export async function saveChannelConfig(state: ChannelConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.configSaving = true;
  state.lastError = null;
  try {
    const { method, params } = resolveSaveRequest(state);
    await state.client.request(method, params);
    state.configFormDirty = false;
    if (state.selectedChannelId) {
      await loadChannelConfig(state, state.selectedChannelId);
    }
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configSaving = false;
  }
}

export async function applyChannelConfig(state: ChannelConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.configApplying = true;
  state.lastError = null;
  try {
    const channel = state.selectedChannelId?.trim();
    if (!channel) {
      state.lastError = "No channel selected.";
      return;
    }
    const baseHash = state.configSnapshot?.hash;
    if (!baseHash) {
      state.lastError = "Channel config hash missing; reload and retry.";
      return;
    }
    const raw = serializeFormForSubmit(state);
    const params: ControlUiMethodParamsMap["channels.config.apply"] = {
      channel,
      raw,
      baseHash,
      sessionKey: state.applySessionKey,
    };
    await state.client.request("channels.config.apply", params);
    state.configFormDirty = false;
    await loadChannelConfig(state, channel);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configApplying = false;
  }
}

export function updateChannelConfigFormValue(
  state: ChannelConfigState,
  path: Array<string | number>,
  value: unknown,
) {
  const base = cloneConfigObject(state.configForm ?? state.configSnapshot?.config ?? {});
  setPathValue(base, path, value);
  state.configForm = base;
  state.configFormDirty = true;
}

export function removeChannelConfigFormValue(
  state: ChannelConfigState,
  path: Array<string | number>,
) {
  const base = cloneConfigObject(state.configForm ?? state.configSnapshot?.config ?? {});
  removePathValue(base, path);
  state.configForm = base;
  state.configFormDirty = true;
}
