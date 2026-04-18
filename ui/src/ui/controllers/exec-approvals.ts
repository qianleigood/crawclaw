import type {
  ControlUiMethodParamsMap,
  ControlUiMethodResultMap,
} from "../../../../src/gateway/protocol/control-ui-methods.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import { cloneConfigObject, removePathValue, setPathValue } from "./config/form-utils.ts";

export type ExecApprovalsDefaults = {
  security?: string;
  ask?: string;
  askFallback?: string;
  autoAllowSkills?: boolean;
};

export type ExecApprovalsAllowlistEntry = {
  id?: string;
  pattern: string;
  lastUsedAt?: number;
  lastUsedCommand?: string;
  lastResolvedPath?: string;
};

export type ExecApprovalsAgent = ExecApprovalsDefaults & {
  allowlist?: ExecApprovalsAllowlistEntry[];
};

export type ExecApprovalsFile = {
  version?: number;
  socket?: { path?: string };
  defaults?: ExecApprovalsDefaults;
  agents?: Record<string, ExecApprovalsAgent>;
};

export type ExecApprovalsSnapshot = {
  path: string;
  exists: boolean;
  hash: string;
  file: ExecApprovalsFile;
};

export type ExecApprovalsTarget = { kind: "gateway" } | { kind: "node"; nodeId: string };

export type ExecApprovalsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  execApprovalsLoading: boolean;
  execApprovalsSaving: boolean;
  execApprovalsDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: ExecApprovalsFile | null;
  execApprovalsSelectedAgent: string | null;
  lastError: string | null;
};

type ExecApprovalsReadMethod = "exec.approvals.get" | "exec.approvals.node.get";
type ExecApprovalsWriteMethod = "exec.approvals.set" | "exec.approvals.node.set";

type ExecApprovalsRpc<K extends ExecApprovalsReadMethod | ExecApprovalsWriteMethod> = {
  method: K;
  params: ControlUiMethodParamsMap[K];
};

type ExecApprovalsResolution<K extends ExecApprovalsReadMethod | ExecApprovalsWriteMethod> =
  | { rpc: ExecApprovalsRpc<K>; error?: undefined }
  | { rpc?: undefined; error: string };

function resolveExecApprovalsRpc(
  client: GatewayBrowserClient,
  target?: ExecApprovalsTarget | null,
): ExecApprovalsResolution<ExecApprovalsReadMethod> {
  if (!target || target.kind === "gateway") {
    if (!client.hasMethod("exec.approvals.get")) {
      return { error: "Exec approvals are not supported by this gateway." };
    }
    return { rpc: { method: "exec.approvals.get", params: {} } };
  }
  const nodeId = target.nodeId.trim();
  if (!nodeId) {
    return { error: "Select a node before loading exec approvals." };
  }
  if (!client.hasCapability("exec.approvals.node")) {
    return { error: "Node exec approvals are not supported by this gateway." };
  }
  return { rpc: { method: "exec.approvals.node.get", params: { nodeId } } };
}

function resolveExecApprovalsSaveRpc(
  client: GatewayBrowserClient,
  target: ExecApprovalsTarget | null | undefined,
  params: { file: ExecApprovalsFile; baseHash: string },
): ExecApprovalsResolution<ExecApprovalsWriteMethod> {
  if (!target || target.kind === "gateway") {
    if (!client.hasMethod("exec.approvals.set")) {
      return { error: "Exec approvals are not supported by this gateway." };
    }
    return {
      rpc: {
        method: "exec.approvals.set",
        params: params as ControlUiMethodParamsMap["exec.approvals.set"],
      },
    };
  }
  const nodeId = target.nodeId.trim();
  if (!nodeId) {
    return { error: "Select a node before saving exec approvals." };
  }
  if (!client.hasCapability("exec.approvals.node")) {
    return { error: "Node exec approvals are not supported by this gateway." };
  }
  return {
    rpc: {
      method: "exec.approvals.node.set",
      params: { ...params, nodeId } as ControlUiMethodParamsMap["exec.approvals.node.set"],
    },
  };
}

export async function loadExecApprovals(
  state: ExecApprovalsState,
  target?: ExecApprovalsTarget | null,
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.execApprovalsLoading) {
    return;
  }
  state.execApprovalsLoading = true;
  state.lastError = null;
  try {
    const { rpc, error } = resolveExecApprovalsRpc(state.client, target);
    if (!rpc) {
      state.lastError = error;
      return;
    }
    const res = await state.client.request<ControlUiMethodResultMap[typeof rpc.method]>(
      rpc.method,
      rpc.params,
    );
    applyExecApprovalsSnapshot(state, res);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.execApprovalsLoading = false;
  }
}

export function applyExecApprovalsSnapshot(
  state: ExecApprovalsState,
  snapshot: ExecApprovalsSnapshot,
) {
  state.execApprovalsSnapshot = snapshot;
  if (!state.execApprovalsDirty) {
    state.execApprovalsForm = cloneConfigObject(snapshot.file ?? {});
  }
}

export async function saveExecApprovals(
  state: ExecApprovalsState,
  target?: ExecApprovalsTarget | null,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.execApprovalsSaving = true;
  state.lastError = null;
  try {
    const baseHash = state.execApprovalsSnapshot?.hash;
    if (!baseHash) {
      state.lastError = "Exec approvals hash missing; reload and retry.";
      return;
    }
    const file = state.execApprovalsForm ?? state.execApprovalsSnapshot?.file ?? {};
    const { rpc, error } = resolveExecApprovalsSaveRpc(state.client, target, { file, baseHash });
    if (!rpc) {
      state.lastError = error;
      return;
    }
    await state.client.request(rpc.method, rpc.params);
    state.execApprovalsDirty = false;
    await loadExecApprovals(state, target);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.execApprovalsSaving = false;
  }
}

export function updateExecApprovalsFormValue(
  state: ExecApprovalsState,
  path: Array<string | number>,
  value: unknown,
) {
  const base = cloneConfigObject(
    state.execApprovalsForm ?? state.execApprovalsSnapshot?.file ?? {},
  );
  setPathValue(base, path, value);
  state.execApprovalsForm = base;
  state.execApprovalsDirty = true;
}

export function removeExecApprovalsFormValue(
  state: ExecApprovalsState,
  path: Array<string | number>,
) {
  const base = cloneConfigObject(
    state.execApprovalsForm ?? state.execApprovalsSnapshot?.file ?? {},
  );
  removePathValue(base, path);
  state.execApprovalsForm = base;
  state.execApprovalsDirty = true;
}
