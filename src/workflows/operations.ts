import type { CrawClawConfig } from "../config/config.js";
import { sleep } from "../utils.js";
import { createN8nClient, resolveN8nCallbackConfig, resolveN8nConfig } from "./n8n-client.js";
import type { N8nExecutionRecord, N8nWorkflowRecord, N8nResolvedConfig } from "./n8n-client.js";
import {
  buildCrawClawWorkflowWebhookPath,
  compileWorkflowSpecToN8n,
  getWorkflowN8nCallbackCompileError,
} from "./n8n-compiler.js";
import {
  createWorkflowDefinitionDiffFromSnapshots,
} from "./diff.js";
import {
  deleteWorkflow,
  describeWorkflow,
  getWorkflowInvocationHint,
  listWorkflows,
  listWorkflowVersions,
  markWorkflowDeployed,
  matchWorkflows,
  rollbackWorkflowDefinition,
  setWorkflowArchived,
  setWorkflowEnabled,
  touchWorkflowRun,
  updateWorkflowDefinition,
} from "./registry.js";
import { buildWorkflowExecutionView, extractN8nResumeUrl } from "./status-view.js";
import {
  appendWorkflowExecutionEvent,
  attachWorkflowExecutionRemoteRef,
  createWorkflowExecutionRecord,
  getWorkflowExecution,
  listWorkflowExecutions,
  syncWorkflowExecutionFromN8n,
} from "./executions.js";
import type {
  WorkflowExecutionRecord,
  WorkflowExecutionView,
  WorkflowRegistryEntry,
  WorkflowSpec,
} from "./types.js";
import type { WorkflowStoreContext } from "./store.js";
import { buildWorkflowVersionSnapshot, loadWorkflowVersionSnapshot } from "./version-history.js";
import type { WorkflowDefinitionPatch } from "./types.js";

export function buildWorkflowListPayload(params: {
  workflows: WorkflowRegistryEntry[];
  executions: WorkflowExecutionRecord[];
  limit?: number;
  includeDisabled: boolean;
}) {
  const executionByWorkflowId = new Map<string, ReturnType<typeof buildWorkflowExecutionView>>();
  const executionCountByWorkflowId = new Map<string, number>();
  for (const execution of params.executions) {
    executionCountByWorkflowId.set(
      execution.workflowId,
      (executionCountByWorkflowId.get(execution.workflowId) ?? 0) + 1,
    );
    if (!executionByWorkflowId.has(execution.workflowId)) {
      executionByWorkflowId.set(
        execution.workflowId,
        buildWorkflowExecutionView({
          local: execution,
        }),
      );
    }
  }

  const filtered = params.includeDisabled
    ? params.workflows
    : params.workflows.filter((entry) => entry.enabled);
  const limited =
    typeof params.limit === "number" ? filtered.slice(0, Math.max(1, params.limit)) : filtered;

  return {
    count: filtered.length,
    workflows: limited.map((workflow) => ({
      ...workflow,
      invocation: getWorkflowInvocationHint(workflow),
      runCount: executionCountByWorkflowId.get(workflow.workflowId) ?? 0,
      recentExecution: executionByWorkflowId.get(workflow.workflowId) ?? null,
    })),
  };
}

export async function buildWorkflowCatalogPayload(params: {
  context: WorkflowStoreContext;
  limit?: number;
  includeDisabled: boolean;
}) {
  const workflows = await listWorkflows(params.context);
  const executions = await listWorkflowExecutions(params.context);
  return buildWorkflowListPayload({
    workflows,
    executions,
    limit: params.limit,
    includeDisabled: params.includeDisabled,
  });
}

export function parseWorkflowResumePayload(input: string | undefined): Record<string, unknown> {
  if (!input?.trim()) {
    return {};
  }
  const trimmed = input.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
      return { input: parsed };
    } catch {
      return { input: trimmed };
    }
  }
  return { input: trimmed };
}

export function requireWorkflowN8nRuntime(config?: CrawClawConfig): {
  resolved: N8nResolvedConfig;
  client: ReturnType<typeof createN8nClient>;
} {
  const resolved = resolveN8nConfig(config);
  if (!resolved) {
    throw new Error(
      "n8n is not configured. Set workflow.n8n.baseUrl/apiKey or CRAWCLAW_N8N_BASE_URL and CRAWCLAW_N8N_API_KEY.",
    );
  }
  return {
    resolved,
    client: createN8nClient(resolved),
  };
}

export class WorkflowOperationInputError extends Error {}

export class WorkflowOperationUnavailableError extends Error {}

export async function deployWorkflowDefinition(params: {
  context: WorkflowStoreContext;
  config?: CrawClawConfig;
  workflowRef: string;
  summary?: string;
  requireExistingDeployment?: boolean;
  publishedBySessionKey?: string;
}): Promise<{
  described: NonNullable<Awaited<ReturnType<typeof describeWorkflow>>>;
  deployed: Awaited<ReturnType<typeof markWorkflowDeployed>>;
  remote: N8nWorkflowRecord;
  compiled: ReturnType<typeof compileWorkflowSpecToN8n>;
}> {
  const { client } = requireWorkflowN8nRuntime(params.config);
  const described = await describeWorkflow(params.context, params.workflowRef);
  if (!described || !described.spec) {
    throw new Error(`Workflow "${params.workflowRef}" not found.`);
  }
  if (params.requireExistingDeployment && !described.entry.n8nWorkflowId) {
    throw new Error(
      `Workflow "${params.workflowRef}" has not been deployed yet. Use workflow.deploy first.`,
    );
  }
  const callbackConfig = resolveN8nCallbackConfig(params.config) ?? undefined;
  const compileError = getWorkflowN8nCallbackCompileError(described.spec, callbackConfig);
  if (compileError) {
    throw new Error(compileError);
  }
  const compiled = compileWorkflowSpecToN8n(described.spec, {
    ...callbackConfig,
  });
  const workflowData = { ...compiled };
  const createdOrUpdated = described.entry.n8nWorkflowId
    ? await client.updateWorkflow(described.entry.n8nWorkflowId, workflowData)
    : await client.createWorkflow(workflowData);
  const remote =
    createdOrUpdated.active === true
      ? createdOrUpdated
      : await client.activateWorkflow(createdOrUpdated.id);
  const deployed = await markWorkflowDeployed(params.context, described.entry.workflowId, {
    n8nWorkflowId: remote.id,
    specVersion: described.entry.specVersion,
    ...(params.publishedBySessionKey ? { publishedBySessionKey: params.publishedBySessionKey } : {}),
    ...(params.summary ? { summary: params.summary } : {}),
  });
  return {
    described,
    deployed,
    remote,
    compiled,
  };
}

export async function describeWorkflowWithRecentExecutions(
  context: WorkflowStoreContext,
  workflowRef: string,
  recentRunsLimit = 5,
) {
  const described = await describeWorkflow(context, workflowRef);
  if (!described || !described.spec) {
    return null;
  }
  const recentExecutions = await listWorkflowExecutions(context, {
    workflowId: described.entry.workflowId,
    limit: recentRunsLimit,
  });
  return {
    workflow: {
      ...described.entry,
      invocation: getWorkflowInvocationHint(described.entry),
    },
    spec: described.spec,
    specPath: described.specPath,
    storeRoot: described.storeRoot,
    recentExecutions: recentExecutions.map((execution) =>
      buildWorkflowExecutionView({
        local: execution,
      }),
    ),
  };
}

export async function buildWorkflowVersionsPayload(
  context: WorkflowStoreContext,
  workflowRef: string,
) {
  const versions = await listWorkflowVersions(context, workflowRef);
  if (!versions) {
    return null;
  }
  return {
    workflow: {
      ...versions.entry,
      invocation: getWorkflowInvocationHint(versions.entry),
    },
    specVersions: versions.specVersions.map((snapshot) => ({
      workflowId: snapshot.workflowId,
      specVersion: snapshot.specVersion,
      savedAt: snapshot.savedAt,
      savedBySessionKey: snapshot.savedBySessionKey,
      reason: snapshot.reason,
      name: snapshot.spec.name,
      goal: snapshot.spec.goal,
      topology: snapshot.spec.topology,
    })),
    deployments: versions.deployments,
    currentDeployment: versions.currentDeployment,
  };
}

export async function buildWorkflowMatchPayload(params: {
  context: WorkflowStoreContext;
  query: string;
  limit?: number;
  enabledOnly?: boolean;
  deployedOnly?: boolean;
  autoRunnableOnly?: boolean;
}) {
  const matches = await matchWorkflows(params.context, params.query, {
    limit: typeof params.limit === "number" ? params.limit : 5,
    enabledOnly: params.enabledOnly,
    deployedOnly: params.deployedOnly,
    autoRunnableOnly: params.autoRunnableOnly,
  });
  return {
    query: params.query,
    count: matches.length,
    matches: matches.map((entry) => ({
      ...entry,
      invocation: getWorkflowInvocationHint(entry),
    })),
  };
}

export async function resolveRunnableWorkflowForExecution(
  context: WorkflowStoreContext,
  workflowRef: string,
) {
  const described = await describeWorkflow(context, workflowRef);
  if (!described) {
    throw new WorkflowOperationInputError(`Workflow "${workflowRef}" not found.`);
  }
  if (described.entry.deploymentState !== "deployed" || !described.entry.n8nWorkflowId) {
    throw new WorkflowOperationInputError(
      `Workflow "${workflowRef}" is not currently deployed. Run workflow.deploy or workflow.republish first.`,
    );
  }
  return described;
}

export async function buildWorkflowDiffPayload(params: {
  context: WorkflowStoreContext;
  workflowRef: string;
  specVersion?: number;
  toSpecVersion?: number;
}) {
  const described = await describeWorkflow(params.context, params.workflowRef);
  if (!described || !described.spec) {
    throw new WorkflowOperationInputError(`Workflow "${params.workflowRef}" not found.`);
  }
  const versions = await listWorkflowVersions(params.context, described.entry.workflowId);
  if (!versions) {
    throw new WorkflowOperationInputError(`Workflow "${params.workflowRef}" not found.`);
  }
  const currentSnapshot = buildWorkflowVersionSnapshot({
    specVersion: described.entry.specVersion,
    reason: "current",
    spec: described.spec,
    entry: described.entry,
  });
  const resolvedToSpecVersion =
    typeof params.toSpecVersion === "number" ? params.toSpecVersion : described.entry.specVersion;
  const right =
    resolvedToSpecVersion === described.entry.specVersion
      ? currentSnapshot
      : await loadWorkflowVersionSnapshot(
          params.context,
          described.entry.workflowId,
          resolvedToSpecVersion,
        );
  if (!right) {
    throw new WorkflowOperationInputError(
      `Workflow "${params.workflowRef}" does not have spec version ${resolvedToSpecVersion}.`,
    );
  }
  const resolvedFromSpecVersion =
    typeof params.specVersion === "number"
      ? params.specVersion
      : (versions.currentDeployment?.specVersion ?? described.entry.specVersion - 1);
  if (resolvedFromSpecVersion <= 0) {
    throw new WorkflowOperationInputError(
      `Workflow "${params.workflowRef}" does not have an earlier or deployed spec version to diff against.`,
    );
  }
  const left =
    resolvedFromSpecVersion === described.entry.specVersion
      ? currentSnapshot
      : await loadWorkflowVersionSnapshot(
          params.context,
          described.entry.workflowId,
          resolvedFromSpecVersion,
        );
  if (!left) {
    throw new WorkflowOperationInputError(
      `Workflow "${params.workflowRef}" does not have spec version ${resolvedFromSpecVersion}.`,
    );
  }
  return {
    workflow: {
      workflowId: described.entry.workflowId,
      name: described.entry.name,
    },
    fromSpecVersion: left.specVersion,
    toSpecVersion: right.specVersion,
    diff: createWorkflowDefinitionDiffFromSnapshots(left, right),
  };
}

export async function rollbackWorkflowWithOptionalRepublish(params: {
  context: WorkflowStoreContext;
  config?: CrawClawConfig;
  workflowRef: string;
  specVersion: number;
  republish?: boolean;
  summary?: string;
  sessionKey?: string;
}) {
  const rolledBack = await rollbackWorkflowDefinition(
    {
      ...params.context,
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    },
    params.workflowRef,
    params.specVersion,
  );
  if (!rolledBack) {
    throw new WorkflowOperationInputError(`Workflow "${params.workflowRef}" not found.`);
  }
  if (params.republish !== true) {
    return {
      workflow: {
        ...rolledBack.entry,
        invocation: getWorkflowInvocationHint(rolledBack.entry),
      },
      spec: rolledBack.spec,
      restoredFromSpecVersion: rolledBack.restoredFromSpecVersion,
      needsRepublish: rolledBack.entry.deploymentVersion > 0,
    };
  }
  const deployedResult = await deployWorkflowDefinition({
    context: params.context,
    config: params.config,
    workflowRef: rolledBack.entry.workflowId,
    summary:
      params.summary ?? `rollback from spec version ${rolledBack.restoredFromSpecVersion}`,
    publishedBySessionKey: params.sessionKey,
  });
  return {
    workflow: deployedResult.deployed,
    spec: rolledBack.spec,
    restoredFromSpecVersion: rolledBack.restoredFromSpecVersion,
    remoteWorkflow: deployedResult.remote,
    compiled: deployedResult.compiled,
    republished: true,
  };
}

export async function buildWorkflowRunsPayload(params: {
  context: WorkflowStoreContext;
  workflowRef?: string;
  limit?: number;
}) {
  const described = params.workflowRef
    ? await describeWorkflow(params.context, params.workflowRef)
    : null;
  if (params.workflowRef && !described) {
    throw new WorkflowOperationInputError(`Workflow "${params.workflowRef}" not found.`);
  }
  const executions = await listWorkflowExecutions(params.context, {
    ...(described?.entry.workflowId ? { workflowId: described.entry.workflowId } : {}),
    ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
  });
  return {
    count: executions.length,
    executions: executions.map((execution) =>
      buildWorkflowExecutionView({
        local: execution,
      }),
    ),
  };
}

export async function updateWorkflowDefinitionPayload(params: {
  context: WorkflowStoreContext;
  workflowRef: string;
  patch: WorkflowDefinitionPatch;
  sessionKey?: string;
}) {
  const updated = await updateWorkflowDefinition(
    {
      ...params.context,
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    },
    params.workflowRef,
    params.patch,
  );
  if (!updated) {
    throw new WorkflowOperationInputError(`Workflow "${params.workflowRef}" not found.`);
  }
  return {
    workflow: {
      ...updated.entry,
      invocation: getWorkflowInvocationHint(updated.entry),
    },
    spec: updated.spec,
    needsRepublish: updated.entry.deploymentVersion > 0,
  };
}

export async function setWorkflowEnabledPayload(params: {
  context: WorkflowStoreContext;
  workflowRef: string;
  enabled: boolean;
}) {
  const updated = await setWorkflowEnabled(params.context, params.workflowRef, params.enabled);
  if (!updated) {
    throw new WorkflowOperationInputError(`Workflow "${params.workflowRef}" not found.`);
  }
  return {
    workflow: updated,
    invocation: getWorkflowInvocationHint(updated),
  };
}

export async function setWorkflowArchivedPayload(params: {
  context: WorkflowStoreContext;
  workflowRef: string;
  archived: boolean;
}) {
  const updated = await setWorkflowArchived(params.context, params.workflowRef, params.archived);
  if (!updated) {
    throw new WorkflowOperationInputError(`Workflow "${params.workflowRef}" not found.`);
  }
  return {
    workflow: updated,
    invocation: getWorkflowInvocationHint(updated),
  };
}

export async function deleteWorkflowPayload(
  context: WorkflowStoreContext,
  workflowRef: string,
) {
  const deleted = await deleteWorkflow(context, workflowRef);
  if (!deleted.deleted) {
    throw new WorkflowOperationInputError(`Workflow "${workflowRef}" not found.`);
  }
  return deleted;
}

function buildWorkflowExecutionResponse(params: {
  localExecution?: WorkflowExecutionRecord | null;
  remoteExecution?: N8nExecutionRecord | null;
  n8nBaseUrl: string;
}) {
  const localExecution = params.localExecution ?? null;
  const remoteExecution = params.remoteExecution ?? null;
  return {
    execution: buildWorkflowExecutionView({
      ...(localExecution ? { local: localExecution } : {}),
      ...(remoteExecution ? { remote: remoteExecution } : {}),
      n8nBaseUrl: params.n8nBaseUrl,
    }),
    ...(localExecution ? { localExecution } : {}),
    ...(remoteExecution ? { remoteExecution } : {}),
  };
}

export async function startWorkflowExecution(params: {
  context: WorkflowStoreContext;
  client: ReturnType<typeof createN8nClient>;
  n8nBaseUrl: string;
  workflowId: string;
  workflowName?: string;
  n8nWorkflowId: string;
  spec?: WorkflowSpec;
  workflowInputs?: Record<string, unknown>;
}) {
  const localExecution = await createWorkflowExecutionRecord(params.context, {
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    n8nWorkflowId: params.n8nWorkflowId,
    spec: params.spec,
    initialStatus: "running",
  });
  await params.client.triggerWebhook(buildCrawClawWorkflowWebhookPath(params.workflowId), {
    crawclawExecutionId: localExecution.executionId,
    ...(params.workflowInputs ? { workflowInput: params.workflowInputs } : {}),
    ...params.workflowInputs,
  });
  let execution = localExecution;
  let remoteExecution: N8nExecutionRecord | undefined;
  const listed = await params.client.listExecutions({
    workflowId: params.n8nWorkflowId,
    limit: 10,
  });
  const latestRemote = listed.data[0];
  if (latestRemote) {
    remoteExecution = {
      executionId: latestRemote.executionId ?? latestRemote.id ?? "",
      ...latestRemote,
    };
    execution =
      (await attachWorkflowExecutionRemoteRef(params.context, localExecution.executionId, {
        n8nExecutionId: latestRemote.executionId ?? latestRemote.id ?? "",
        n8nWorkflowId: params.n8nWorkflowId,
        remote: latestRemote,
      })) ?? execution;
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!execution.n8nExecutionId) {
      const refreshedList = await params.client
        .listExecutions({
          workflowId: params.n8nWorkflowId,
          limit: 10,
        })
        .catch(() => null);
      const candidate = refreshedList?.data[0];
      if (candidate) {
        remoteExecution = {
          executionId: candidate.executionId ?? candidate.id ?? "",
          ...candidate,
        };
        execution =
          (await attachWorkflowExecutionRemoteRef(params.context, localExecution.executionId, {
            n8nExecutionId: candidate.executionId ?? candidate.id ?? "",
            n8nWorkflowId: params.n8nWorkflowId,
            remote: candidate,
          })) ?? execution;
      }
    }
    const refreshed = await getWorkflowExecution(params.context, localExecution.executionId);
    if (refreshed) {
      execution = refreshed;
    }
    if (execution.n8nExecutionId || execution.status !== localExecution.status) {
      break;
    }
    await sleep(100);
  }
  await touchWorkflowRun(params.context, params.workflowId);
  return buildWorkflowExecutionResponse({
    localExecution: execution,
    ...(remoteExecution ? { remoteExecution } : {}),
    n8nBaseUrl: params.n8nBaseUrl,
  });
}

async function syncWorkflowExecutionSnapshot(params: {
  context: WorkflowStoreContext;
  client: ReturnType<typeof createN8nClient>;
  n8nBaseUrl: string;
  executionId: string;
  mode: "status" | "cancel";
}) {
  const localExecution = await getWorkflowExecution(params.context, params.executionId);
  const remoteExecutionId = localExecution?.n8nExecutionId ?? params.executionId;
  const remoteExecution =
    params.mode === "cancel"
      ? await params.client.stopExecution(remoteExecutionId)
      : await params.client.getExecution(remoteExecutionId, {
          includeData: true,
        });
  const synced = localExecution
    ? await syncWorkflowExecutionFromN8n(params.context, params.executionId, remoteExecution)
    : null;
  return buildWorkflowExecutionResponse({
    localExecution: synced ?? localExecution,
    remoteExecution,
    n8nBaseUrl: params.n8nBaseUrl,
  });
}

export async function readWorkflowExecutionStatus(params: {
  context: WorkflowStoreContext;
  client: ReturnType<typeof createN8nClient>;
  n8nBaseUrl: string;
  executionId: string;
}) {
  return await syncWorkflowExecutionSnapshot({
    ...params,
    mode: "status",
  });
}

export async function cancelWorkflowExecution(params: {
  context: WorkflowStoreContext;
  client: ReturnType<typeof createN8nClient>;
  n8nBaseUrl: string;
  executionId: string;
}) {
  return await syncWorkflowExecutionSnapshot({
    ...params,
    mode: "cancel",
  });
}

export async function resumeWorkflowExecution(params: {
  context: WorkflowStoreContext;
  client: ReturnType<typeof createN8nClient>;
  n8nBaseUrl: string;
  executionId: string;
  input?: string;
  actorLabel: string;
}) {
  const localExecution = await getWorkflowExecution(params.context, params.executionId);
  if (!localExecution) {
    throw new WorkflowOperationInputError(
      `Workflow execution "${params.executionId}" not found.`,
    );
  }
  const remoteExecutionId = localExecution.n8nExecutionId ?? params.executionId;
  const remoteExecution = await params.client.getExecution(remoteExecutionId, {
    includeData: true,
  });
  const resumeUrl = extractN8nResumeUrl(remoteExecution, params.n8nBaseUrl);
  if (!resumeUrl) {
    throw new WorkflowOperationUnavailableError(
      "This execution is not exposing an n8n resume URL yet. Refresh status after the Wait node persists execution progress.",
    );
  }
  const resumePayload = parseWorkflowResumePayload(params.input);
  await params.client.resumeExecutionByUrl(resumeUrl, resumePayload);
  await appendWorkflowExecutionEvent(params.context, params.executionId, {
    type: "execution.resume_requested",
    message: `Manual resume requested from ${params.actorLabel}.`,
    details: Object.keys(resumePayload).length > 0 ? { payload: resumePayload } : {},
  });
  const remoteAfter = await params.client
    .getExecution(remoteExecutionId, {
      includeData: true,
    })
    .catch(() => null);
  const synced = remoteAfter
    ? await syncWorkflowExecutionFromN8n(params.context, params.executionId, remoteAfter)
    : localExecution;
  return {
    ...buildWorkflowExecutionResponse({
      localExecution: synced ?? localExecution,
      ...(remoteAfter ? { remoteExecution: remoteAfter } : {}),
      n8nBaseUrl: params.n8nBaseUrl,
    }),
    resumeAccepted: true,
  };
}
