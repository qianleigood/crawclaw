import { randomUUID } from "node:crypto";
import { createCrawClawAgentNodeDraftRequest } from "./agent-node-contract.js";
import type {
  WorkflowBranchResolutionMode,
  WorkflowFanOutFailurePolicy,
  WorkflowFanOutJoinPolicy,
  WorkflowHttpMethod,
  WorkflowSpec,
  WorkflowStepActivationSpec,
  WorkflowStepSpec,
  WorkflowTopology,
} from "./types.js";

export type CompileWorkflowSpecToN8nOptions = {
  callbackBaseUrl?: string;
  callbackCredentialId?: string;
  callbackCredentialName?: string;
  callbackBearerEnvVar?: string;
  callbackBearerToken?: string;
};

type CrawClawStepContract = {
  workflowId: string;
  topology: WorkflowTopology;
  stepId: string;
  kind: WorkflowStepSpec["kind"];
  title?: string;
  goal?: string;
  portability?: WorkflowStepSpec["portability"];
  sourceSkill?: string;
  service?: string;
  path: string;
  branchGroup?: string;
  branchResolution: WorkflowBranchResolutionMode;
  parallel?: {
    failurePolicy?: WorkflowFanOutFailurePolicy;
    joinPolicy?: WorkflowFanOutJoinPolicy;
    maxActiveBranches?: number;
    retryOnFail?: boolean;
    maxTries?: number;
    waitBetweenTriesMs?: number;
  };
  activation: {
    mode: NonNullable<WorkflowStepActivationSpec["mode"]> | "sequential";
    when?: string;
    fromStepIds?: string[];
  };
  terminalOnSuccess: boolean;
  waitKind?: "input" | "external";
};

type ResolvedWorkflowStep = {
  step: WorkflowStepSpec;
  index: number;
  path: string;
  activationMode: NonNullable<WorkflowStepActivationSpec["mode"]> | "sequential";
  activationWhen?: string;
  sourceStepIds: string[];
};

function trimToUndefined(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildCrawClawStepContract(
  spec: WorkflowSpec,
  step: WorkflowStepSpec,
): CrawClawStepContract {
  return {
    workflowId: spec.workflowId,
    topology: spec.topology ?? "linear_v1",
    stepId: step.id,
    kind: step.kind,
    ...(trimToUndefined(step.title) ? { title: trimToUndefined(step.title) } : {}),
    ...(trimToUndefined(step.goal) ? { goal: trimToUndefined(step.goal) } : {}),
    ...(step.portability ? { portability: step.portability } : {}),
    ...(trimToUndefined(step.sourceSkill)
      ? { sourceSkill: trimToUndefined(step.sourceSkill) }
      : {}),
    ...(trimToUndefined(step.service) ? { service: trimToUndefined(step.service) } : {}),
    path: trimToUndefined(step.path) ?? "main",
    ...(trimToUndefined(step.branchGroup)
      ? { branchGroup: trimToUndefined(step.branchGroup) }
      : {}),
    branchResolution: resolveBranchResolutionMode(spec, step),
    ...(step.activation?.parallel
      ? {
          parallel: {
            ...(step.activation.parallel.failurePolicy
              ? { failurePolicy: step.activation.parallel.failurePolicy }
              : {}),
            ...(step.activation.parallel.joinPolicy
              ? { joinPolicy: step.activation.parallel.joinPolicy }
              : {}),
            ...(typeof step.activation.parallel.maxActiveBranches === "number"
              ? { maxActiveBranches: step.activation.parallel.maxActiveBranches }
              : {}),
            ...(typeof step.activation.parallel.retryOnFail === "boolean"
              ? { retryOnFail: step.activation.parallel.retryOnFail }
              : {}),
            ...(typeof step.activation.parallel.maxTries === "number"
              ? { maxTries: step.activation.parallel.maxTries }
              : {}),
            ...(typeof step.activation.parallel.waitBetweenTriesMs === "number"
              ? { waitBetweenTriesMs: step.activation.parallel.waitBetweenTriesMs }
              : {}),
          },
        }
      : {}),
    activation: {
      mode: step.activation?.mode ?? "sequential",
      ...(trimToUndefined(step.activation?.when)
        ? { when: trimToUndefined(step.activation?.when) }
        : {}),
      ...(step.activation?.fromStepIds?.length
        ? { fromStepIds: [...step.activation.fromStepIds] }
        : {}),
    },
    terminalOnSuccess: step.terminalOnSuccess === true,
    ...(step.kind === "human_wait" ? { waitKind: step.wait?.kind ?? "input" } : {}),
  };
}

export function buildWorkflowStepNodeName(step: WorkflowStepSpec, index: number): string {
  const title = trimToUndefined(step.title) ?? trimToUndefined(step.goal) ?? step.id;
  return `${index + 1}. ${step.id} · ${title}`;
}

function buildWorkflowGateNodeName(step: WorkflowStepSpec, index: number): string {
  return `Gate ${index + 1}. ${step.id}`;
}

function buildWorkflowMergeNodeName(
  step: WorkflowStepSpec,
  index: number,
  mergeIndex: number,
): string {
  return `Join ${index + 1}.${mergeIndex} ${step.id}`;
}

function buildWorkflowInputNormalizerNodeName(): string {
  return "Normalize workflow input";
}

function resolveStepPath(step: WorkflowStepSpec): string {
  return trimToUndefined(step.path) ?? "main";
}

function resolveBranchResolutionMode(
  spec: WorkflowSpec,
  step: WorkflowStepSpec,
): WorkflowBranchResolutionMode {
  const branchGroup = trimToUndefined(step.branchGroup);
  if (!branchGroup) {
    return "exclusive";
  }
  const path = resolveStepPath(step);
  const stepsInGroup = spec.steps.filter(
    (candidate) => trimToUndefined(candidate.branchGroup) === branchGroup,
  );
  const hasParallelSibling = stepsInGroup.some(
    (candidate) =>
      candidate.id !== step.id &&
      resolveStepPath(candidate) !== path &&
      (candidate.activation?.mode ?? "sequential") === "fan_out",
  );
  return (step.activation?.mode ?? "sequential") === "fan_out" || hasParallelSibling
    ? "parallel"
    : "exclusive";
}

function resolveStepActivationMode(
  step: WorkflowStepSpec,
): NonNullable<WorkflowStepActivationSpec["mode"]> | "sequential" {
  return step.activation?.mode ?? "sequential";
}

function findPreviousStepOnPath(
  spec: WorkflowSpec,
  index: number,
  path: string,
): WorkflowStepSpec | null {
  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = spec.steps[candidateIndex];
    if (candidate && resolveStepPath(candidate) === path) {
      return candidate;
    }
  }
  return null;
}

function resolveStepSourceIds(spec: WorkflowSpec, index: number): string[] {
  const step = spec.steps[index];
  if (!step) {
    return [];
  }
  const explicitSources =
    step.activation?.fromStepIds?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (explicitSources.length > 0) {
    return [...new Set(explicitSources)];
  }
  if (index === 0) {
    return [];
  }
  const path = resolveStepPath(step);
  const previousSamePath = findPreviousStepOnPath(spec, index, path);
  if (previousSamePath) {
    return [previousSamePath.id];
  }
  if (path === "main") {
    return [spec.steps[index - 1].id];
  }
  return [];
}

function resolveWorkflowSteps(spec: WorkflowSpec): ResolvedWorkflowStep[] {
  return spec.steps.map((step, index) => ({
    step,
    index,
    path: resolveStepPath(step),
    activationMode: resolveStepActivationMode(step),
    activationWhen: trimToUndefined(step.activation?.when),
    sourceStepIds: resolveStepSourceIds(spec, index),
  }));
}

function buildFanOutCohortKey(resolved: ResolvedWorkflowStep): string | null {
  if (resolved.activationMode !== "fan_out") {
    return null;
  }
  const sources = [...resolved.sourceStepIds].toSorted().join(",");
  return [resolved.step.branchGroup?.trim() ?? "", sources].join("::");
}

function buildFanOutCohorts(
  resolvedSteps: ResolvedWorkflowStep[],
): Map<string, ResolvedWorkflowStep[]> {
  const cohorts = new Map<string, ResolvedWorkflowStep[]>();
  for (const resolved of resolvedSteps) {
    const key = buildFanOutCohortKey(resolved);
    if (!key) {
      continue;
    }
    const existing = cohorts.get(key) ?? [];
    existing.push(resolved);
    cohorts.set(key, existing);
  }
  return cohorts;
}

function getUnsupportedLinearReason(
  spec: WorkflowSpec,
  resolved: ResolvedWorkflowStep,
): string | null {
  const { step, index, path, activationMode, activationWhen, sourceStepIds } = resolved;
  if (path && path !== "main") {
    return `step "${step.id}" declares unsupported path "${path}"`;
  }
  if (trimToUndefined(step.branchGroup)) {
    return `step "${step.id}" declares unsupported branchGroup "${step.branchGroup?.trim()}"`;
  }
  if (activationMode !== "sequential") {
    return `step "${step.id}" declares unsupported activation mode "${activationMode}"`;
  }
  if (activationWhen) {
    return `step "${step.id}" declares unsupported activation condition`;
  }
  if (sourceStepIds.length > 1 || (index > 0 && sourceStepIds[0] !== spec.steps[index - 1]?.id)) {
    return `step "${step.id}" declares unsupported activation sources`;
  }
  if (step.terminalOnSuccess && index !== spec.steps.length - 1) {
    return `step "${step.id}" declares terminalOnSuccess before the final linear step`;
  }
  return null;
}

function assertLinearWorkflowSpec(spec: WorkflowSpec): void {
  const topology = spec.topology?.trim();
  if (topology && topology !== "linear_v1") {
    throw new Error(
      `Workflow "${spec.name}" declares unsupported topology "${topology}". Only linear_v1 is supported in the current n8n compiler.`,
    );
  }
  for (const resolved of resolveWorkflowSteps(spec)) {
    const reason = getUnsupportedLinearReason(spec, resolved);
    if (reason) {
      throw new Error(
        `Workflow "${spec.name}" includes unsupported non-linear step metadata: ${reason}. Only linear_v1 sequential steps are supported in the current n8n compiler.`,
      );
    }
  }
}

function assertBranchWorkflowSpec(spec: WorkflowSpec): ResolvedWorkflowStep[] {
  const resolvedSteps = resolveWorkflowSteps(spec);
  const fanOutCohorts = buildFanOutCohorts(resolvedSteps);
  const seenStepIds = new Set<string>();
  for (const resolved of resolvedSteps) {
    const { step, index, path, activationMode, activationWhen, sourceStepIds } = resolved;
    if (seenStepIds.has(step.id)) {
      throw new Error(`Workflow "${spec.name}" contains duplicate step id "${step.id}".`);
    }
    seenStepIds.add(step.id);
    if (index === 0) {
      if (sourceStepIds.length > 0) {
        throw new Error(
          `Workflow "${spec.name}" step "${step.id}" is the entry step and must not declare activation sources.`,
        );
      }
      continue;
    }
    if (sourceStepIds.length === 0) {
      throw new Error(
        `Workflow "${spec.name}" step "${step.id}" must declare activation sources or follow a resolvable path predecessor.`,
      );
    }
    if (activationMode === "fan_out") {
      const rawJoinPolicy = step.activation?.parallel?.joinPolicy as string | undefined;
      const rawFailurePolicy = step.activation?.parallel?.failurePolicy as string | undefined;
      if (sourceStepIds.length === 0) {
        throw new Error(
          `Workflow "${spec.name}" step "${step.id}" must declare at least one activation source for fan_out branching.`,
        );
      }
      if (activationWhen) {
        throw new Error(
          `Workflow "${spec.name}" step "${step.id}" cannot declare activation.when for fan_out branching.`,
        );
      }
      if (rawJoinPolicy && rawJoinPolicy !== "all" && rawJoinPolicy !== "best_effort") {
        throw new Error(
          `Workflow "${spec.name}" step "${step.id}" declares unsupported fan_out join policy "${rawJoinPolicy}".`,
        );
      }
      if (rawFailurePolicy && rawFailurePolicy !== "fail_fast" && rawFailurePolicy !== "continue") {
        throw new Error(
          `Workflow "${spec.name}" step "${step.id}" declares unsupported fan_out failure policy "${rawFailurePolicy}".`,
        );
      }
      if (
        typeof step.activation?.parallel?.maxTries === "number" &&
        (!Number.isInteger(step.activation.parallel.maxTries) ||
          step.activation.parallel.maxTries < 1)
      ) {
        throw new Error(
          `Workflow "${spec.name}" step "${step.id}" must declare maxTries >= 1 when retryOnFail is configured.`,
        );
      }
      if (
        typeof step.activation?.parallel?.waitBetweenTriesMs === "number" &&
        step.activation.parallel.waitBetweenTriesMs < 0
      ) {
        throw new Error(
          `Workflow "${spec.name}" step "${step.id}" must declare waitBetweenTriesMs >= 0.`,
        );
      }
      if (
        typeof step.activation?.parallel?.maxActiveBranches === "number" &&
        (!Number.isInteger(step.activation.parallel.maxActiveBranches) ||
          step.activation.parallel.maxActiveBranches < 1)
      ) {
        throw new Error(
          `Workflow "${spec.name}" step "${step.id}" must declare maxActiveBranches >= 1.`,
        );
      }
      const cohort = fanOutCohorts.get(buildFanOutCohortKey(resolved) ?? "");
      if (
        cohort &&
        typeof step.activation?.parallel?.maxActiveBranches === "number" &&
        cohort.length > step.activation.parallel.maxActiveBranches
      ) {
        throw new Error(
          `Workflow "${spec.name}" step "${step.id}" limits fan_out width to ${step.activation.parallel.maxActiveBranches}, but the branch cohort expands to ${cohort.length} active branches. Lower-width fan_out scheduling is not supported yet.`,
        );
      }
    }
    if (activationMode === "conditional") {
      if (sourceStepIds.length !== 1) {
        throw new Error(
          `Workflow "${spec.name}" step "${step.id}" must declare exactly one activation source for conditional branching.`,
        );
      }
      if (!activationWhen) {
        throw new Error(
          `Workflow "${spec.name}" step "${step.id}" must declare activation.when for conditional branching.`,
        );
      }
    }
    if (activationMode === "fan_in" && sourceStepIds.length < 2) {
      throw new Error(
        `Workflow "${spec.name}" step "${step.id}" must declare at least two activation sources for fan_in joins.`,
      );
    }
    if (activationMode === "fan_in" && step.activation?.parallel?.failurePolicy) {
      throw new Error(
        `Workflow "${spec.name}" step "${step.id}" cannot declare fan_out failure policy on a fan_in join step.`,
      );
    }
    if (
      step.compensation?.mode &&
      step.compensation.mode !== "none" &&
      step.kind !== "crawclaw_agent"
    ) {
      throw new Error(
        `Workflow "${spec.name}" step "${step.id}" declares compensation mode "${step.compensation.mode}" on kind "${step.kind}", but only crawclaw_agent steps support runtime compensation today.`,
      );
    }
    if (activationMode === "sequential" && sourceStepIds.length > 1) {
      throw new Error(
        `Workflow "${spec.name}" step "${step.id}" cannot use sequential activation with multiple sources.`,
      );
    }
    if (path !== "main" && !sourceStepIds.length) {
      throw new Error(
        `Workflow "${spec.name}" step "${step.id}" is on path "${path}" but has no activation source.`,
      );
    }
  }
  return resolvedSteps;
}

function validateWorkflowSpec(spec: WorkflowSpec): ResolvedWorkflowStep[] {
  const topology = spec.topology?.trim() ?? "linear_v1";
  if (topology === "linear_v1") {
    assertLinearWorkflowSpec(spec);
    return resolveWorkflowSteps(spec);
  }
  if (topology === "branch_v2") {
    return assertBranchWorkflowSpec(spec);
  }
  throw new Error(`Workflow "${spec.name}" declares unsupported topology "${topology}".`);
}

export function buildCrawClawWorkflowWebhookPath(workflowId: string): string {
  const normalized = workflowId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `crawclaw-${normalized}` : `crawclaw-${randomUUID().slice(0, 8)}`;
}

function resolveCrawClawCallbackConfig(options?: CompileWorkflowSpecToN8nOptions): {
  callbackUrl: string;
  callbackBearerEnvVar: string;
  callbackCredentialId?: string;
  callbackCredentialName?: string;
  callbackBearerToken?: string;
} | null {
  const callbackBaseUrl = trimToUndefined(options?.callbackBaseUrl);
  if (!callbackBaseUrl) {
    return null;
  }
  return {
    callbackUrl: `${callbackBaseUrl.replace(/\/+$/, "")}/workflows/agent/run`,
    callbackBearerEnvVar:
      trimToUndefined(options?.callbackBearerEnvVar) ?? "CRAWCLAW_GATEWAY_TOKEN",
    ...(trimToUndefined(options?.callbackCredentialId)
      ? { callbackCredentialId: trimToUndefined(options?.callbackCredentialId) }
      : {}),
    ...(trimToUndefined(options?.callbackCredentialName)
      ? { callbackCredentialName: trimToUndefined(options?.callbackCredentialName) }
      : {}),
    ...(trimToUndefined(options?.callbackBearerToken)
      ? { callbackBearerToken: trimToUndefined(options?.callbackBearerToken) }
      : {}),
  };
}

export function workflowSpecRequiresCrawClawCallback(spec: WorkflowSpec): boolean {
  validateWorkflowSpec(spec);
  return spec.steps.some((step) => step.kind === "crawclaw_agent");
}

export function getWorkflowN8nCallbackCompileError(
  spec: WorkflowSpec,
  options?: CompileWorkflowSpecToN8nOptions,
): string | null {
  if (!workflowSpecRequiresCrawClawCallback(spec)) {
    return null;
  }
  const callbackConfig = resolveCrawClawCallbackConfig(options);
  if (!callbackConfig) {
    return "Workflow contains crawclaw_agent steps but workflow.n8n.callbackBaseUrl is not configured.";
  }
  if (!callbackConfig.callbackCredentialId && !callbackConfig.callbackBearerToken) {
    return "Workflow contains crawclaw_agent steps but callback auth is not configured. Set workflow.n8n.callbackCredentialId or workflow.n8n.callbackBearerToken.";
  }
  return null;
}

function serializeExpressionValue(value: unknown): string {
  if (typeof value === "string") {
    if (value === "$execution.id") {
      return "$execution.id";
    }
    if (value.startsWith("$json.")) {
      return `(${value} ?? null)`;
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeExpressionValue(item)).join(", ")}]`;
  }
  if (value && typeof value === "object") {
    return `{ ${Object.entries(value)
      .map(([key, entryValue]) => `${JSON.stringify(key)}: ${serializeExpressionValue(entryValue)}`)
      .join(", ")} }`;
  }
  return JSON.stringify(value);
}

function buildHttpRequestNode(params: {
  name: string;
  position: [number, number];
  step: WorkflowStepSpec;
  stepContract: CrawClawStepContract;
  url: string;
  method?: WorkflowHttpMethod;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}): Record<string, unknown> {
  const method = params.method ?? "POST";
  const headers = Object.entries(params.headers ?? {}).filter(
    ([name, value]) => name.trim() && value.trim(),
  );
  const hasBody = !!params.body && Object.keys(params.body).length > 0 && method !== "GET";
  return {
    id: `http_${randomUUID().slice(0, 8)}`,
    name: params.name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: params.position,
    parameters: {
      method,
      url: params.url,
      ...(headers.length > 0
        ? {
            sendHeaders: true,
            headerParameters: {
              parameters: headers.map(([name, value]) => ({
                name,
                value,
              })),
            },
          }
        : {}),
      ...(hasBody
        ? {
            sendBody: true,
            specifyBody: "json",
            jsonBody: `={{ ${serializeExpressionValue(params.body)} }}`,
          }
        : {}),
    },
    meta: {
      source: "crawclaw",
      crawclawStepKind: params.step.kind,
      crawclawStepId: params.step.id,
      crawclawStepContract: params.stepContract,
    },
  };
}

function applyFanOutExecutionControls(
  node: Record<string, unknown>,
  step: WorkflowStepSpec,
): Record<string, unknown> {
  if ((step.activation?.mode ?? "sequential") !== "fan_out") {
    return node;
  }
  const parallel = step.activation?.parallel;
  if (!parallel) {
    return node;
  }
  if (parallel.failurePolicy === "continue") {
    node.onError = "continueRegularOutput";
  }
  if (parallel.retryOnFail) {
    node.retryOnFail = true;
    node.maxTries =
      typeof parallel.maxTries === "number" && Number.isInteger(parallel.maxTries)
        ? parallel.maxTries
        : 3;
    node.waitBetweenTries =
      typeof parallel.waitBetweenTriesMs === "number" ? parallel.waitBetweenTriesMs : 1000;
  }
  return node;
}

function buildNativeSetNode(params: {
  name: string;
  position: [number, number];
  step: WorkflowStepSpec;
  stepContract: CrawClawStepContract;
}): Record<string, unknown> {
  return {
    id: `set_${randomUUID().slice(0, 8)}`,
    name: params.name,
    type: "n8n-nodes-base.set",
    typeVersion: 3.4,
    position: params.position,
    parameters: {
      mode: "manual",
      duplicateItem: false,
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: `assign_${randomUUID().slice(0, 8)}`,
            name: "crawclaw_step_id",
            value: params.step.id,
            type: "string",
          },
          {
            id: `assign_${randomUUID().slice(0, 8)}`,
            name: "crawclaw_step_kind",
            value: params.step.kind,
            type: "string",
          },
          {
            id: `assign_${randomUUID().slice(0, 8)}`,
            name: "crawclaw_step_title",
            value: params.step.title ?? params.step.goal ?? params.step.id,
            type: "string",
          },
        ],
      },
      options: {},
    },
    meta: {
      source: "crawclaw",
      crawclawStepKind: params.step.kind,
      crawclawStepId: params.step.id,
      crawclawStepContract: params.stepContract,
      crawclawStepNotes:
        params.step.notes ??
        "Native step placeholder compiled as a Set node until a stricter node mapping is supplied.",
    },
  };
}

function buildServicePlaceholderNode(params: {
  name: string;
  position: [number, number];
  step: WorkflowStepSpec;
  stepContract: CrawClawStepContract;
}): Record<string, unknown> {
  return {
    id: `code_${randomUUID().slice(0, 8)}`,
    name: params.name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: params.position,
    parameters: {
      jsCode: [
        "return [{",
        "  json: {",
        `    status: ${JSON.stringify(`draft_${params.step.kind}_step`)},`,
        "    executionId: $execution.id,",
        `    step: ${JSON.stringify({
          id: params.step.id,
          kind: params.step.kind,
          title: params.step.title ?? null,
          goal: params.step.goal ?? null,
          service: params.step.service ?? null,
          notes: params.step.notes ?? null,
        })},`,
        `    note: ${JSON.stringify(
          "Provide step.serviceRequest.url or workflow portability metadata with serviceUrl to compile this step into a real HTTP node.",
        )}`,
        "  }",
        "}];",
      ].join("\n"),
    },
    meta: {
      source: "crawclaw",
      crawclawStepKind: params.step.kind,
      crawclawStepId: params.step.id,
      crawclawStepContract: params.stepContract,
    },
  };
}

function normalizeConditionExpression(expression: string | undefined): string {
  const trimmed = trimToUndefined(expression);
  if (!trimmed) {
    return "true";
  }
  const unwrapped =
    trimmed.startsWith("{{") && trimmed.endsWith("}}") ? trimmed.slice(2, -2).trim() : trimmed;
  return unwrapped
    .replaceAll("$workflowInput", "item.json.workflowInput")
    .replaceAll("$json", "item.json");
}

function buildConditionalGateNode(params: {
  name: string;
  position: [number, number];
  step: WorkflowStepSpec;
  stepContract: CrawClawStepContract;
  when?: string;
}): Record<string, unknown> {
  const condition = normalizeConditionExpression(params.when);
  return {
    id: `gate_${randomUUID().slice(0, 8)}`,
    name: params.name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: params.position,
    parameters: {
      jsCode: [
        "const items = $input.all();",
        "const item = items[0] ?? { json: {} };",
        `return (${condition}) ? items : [];`,
      ].join("\n"),
    },
    meta: {
      source: "crawclaw",
      crawclawHelperKind: "conditional_gate",
      crawclawStepKind: params.step.kind,
      crawclawStepId: params.step.id,
      crawclawStepContract: params.stepContract,
      crawclawActivationWhen: params.when ?? null,
    },
  };
}

function buildMergeNode(params: {
  name: string;
  position: [number, number];
  step: WorkflowStepSpec;
  stepContract: CrawClawStepContract;
}): Record<string, unknown> {
  return {
    id: `merge_${randomUUID().slice(0, 8)}`,
    name: params.name,
    type: "n8n-nodes-base.merge",
    typeVersion: 3.1,
    position: params.position,
    parameters: {
      mode: "append",
    },
    meta: {
      source: "crawclaw",
      crawclawHelperKind: "fan_in_join",
      crawclawStepKind: params.step.kind,
      crawclawStepId: params.step.id,
      crawclawStepContract: params.stepContract,
    },
  };
}

function buildWorkflowInputNormalizerNode(position: [number, number]): Record<string, unknown> {
  return {
    id: `normalize_${randomUUID().slice(0, 8)}`,
    name: buildWorkflowInputNormalizerNodeName(),
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    parameters: {
      jsCode: [
        "const items = $input.all();",
        "return items.map((item, index) => {",
        "  const source = item?.json && typeof item.json === 'object' ? item.json : {};",
        "  const body = source.body && typeof source.body === 'object' ? source.body : {};",
        "  const workflowInput = body.workflowInput && typeof body.workflowInput === 'object' ? body.workflowInput : {};",
        "  return {",
        "    json: {",
        "      ...body,",
        "      ...workflowInput,",
        "      workflowInput,",
        "      crawclawExecutionId:",
        "        typeof body.crawclawExecutionId === 'string' && body.crawclawExecutionId.trim()",
        "          ? body.crawclawExecutionId",
        "          : null,",
        "      crawclawTriggerBody: body,",
        "      crawclawTriggerEnvelope: source,",
        "    },",
        "    pairedItem: item?.pairedItem ?? { item: index },",
        "  };",
        "});",
      ].join("\n"),
    },
    meta: {
      source: "crawclaw",
      crawclawHelperKind: "trigger_input_normalizer",
    },
  };
}

function addConnection(
  connections: Record<string, unknown>,
  fromNodeName: string,
  toNodeName: string,
  sourceOutputIndex = 0,
  targetInputIndex = 0,
): void {
  const current = (connections[fromNodeName] ?? { main: [] }) as {
    main: Array<Array<{ node: string; type: "main"; index: number }>>;
  };
  while (current.main.length <= sourceOutputIndex) {
    current.main.push([]);
  }
  current.main[sourceOutputIndex].push({
    node: toNodeName,
    type: "main",
    index: targetInputIndex,
  });
  connections[fromNodeName] = current;
}

function buildPathSlots(resolvedSteps: ResolvedWorkflowStep[]): Map<string, number> {
  const slots = new Map<string, number>();
  slots.set("main", 0);
  for (const resolved of resolvedSteps) {
    if (!slots.has(resolved.path)) {
      slots.set(resolved.path, slots.size);
    }
  }
  return slots;
}

function buildWorkflowStepNode(params: {
  spec: WorkflowSpec;
  step: WorkflowStepSpec;
  nodeName: string;
  position: [number, number];
  stepContract: CrawClawStepContract;
  callbackConfig: ReturnType<typeof resolveCrawClawCallbackConfig>;
}): Record<string, unknown> {
  const { spec, step, nodeName, position, stepContract, callbackConfig } = params;
  if (step.kind === "crawclaw_agent") {
    const contract = createCrawClawAgentNodeDraftRequest(spec, step);
    if (callbackConfig) {
      return applyFanOutExecutionControls(
        {
          id: `crawclaw_${randomUUID().slice(0, 8)}`,
          name: nodeName,
          type: "n8n-nodes-base.httpRequest",
          typeVersion: 4.2,
          position,
          parameters: {
            method: "POST",
            url: callbackConfig.callbackUrl,
            ...(callbackConfig.callbackCredentialId
              ? {
                  authentication: "genericCredentialType",
                  genericAuthType: "httpHeaderAuth",
                }
              : {}),
            sendHeaders: true,
            headerParameters: {
              parameters: [
                ...(callbackConfig.callbackCredentialId
                  ? []
                  : callbackConfig.callbackBearerToken
                    ? [
                        {
                          name: "Authorization",
                          value: `Bearer ${callbackConfig.callbackBearerToken}`,
                        },
                      ]
                    : []),
                {
                  name: "Content-Type",
                  value: "application/json",
                },
              ],
            },
            sendBody: true,
            specifyBody: "json",
            jsonBody: `={{ ${serializeExpressionValue(contract)} }}`,
          },
          ...(callbackConfig.callbackCredentialId
            ? {
                credentials: {
                  httpHeaderAuth: {
                    id: callbackConfig.callbackCredentialId,
                    name:
                      callbackConfig.callbackCredentialName ?? callbackConfig.callbackCredentialId,
                  },
                },
              }
            : {}),
          meta: {
            source: "crawclaw",
            crawclawStepKind: step.kind,
            crawclawStepId: step.id,
            crawclawStepContract: stepContract,
            crawclawAgentContract: contract,
            crawclawCallbackUrl: callbackConfig.callbackUrl,
          },
        },
        step,
      );
    }
    return applyFanOutExecutionControls(
      {
        id: `crawclaw_${randomUUID().slice(0, 8)}`,
        name: nodeName,
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position,
        parameters: {
          jsCode: [
            `const contract = ${JSON.stringify(contract, null, 2)};`,
            "return [{",
            "  json: {",
            "    status: 'draft_crawclaw_agent_step',",
            "    executionId: $execution.id,",
            "    contract,",
            `    note: ${JSON.stringify(
              "Set workflow.n8n.callbackBaseUrl to compile this step into an HTTP callback node.",
            )}`,
            "  }",
            "}];",
          ].join("\n"),
        },
        meta: {
          source: "crawclaw",
          crawclawStepKind: step.kind,
          crawclawStepId: step.id,
          crawclawStepContract: stepContract,
          crawclawAgentContract: contract,
        },
      },
      step,
    );
  }
  if (step.kind === "human_wait") {
    return applyFanOutExecutionControls(
      {
        id: `wait_${randomUUID().slice(0, 8)}`,
        name: nodeName,
        type: "n8n-nodes-base.wait",
        typeVersion: 1,
        position,
        parameters: {
          resume: "webhook",
          httpMethod: "POST",
          notice: step.wait?.prompt ?? step.prompt ?? step.title ?? step.goal ?? step.id,
        },
        meta: {
          source: "crawclaw",
          crawclawStepKind: step.kind,
          crawclawStepId: step.id,
          crawclawStepContract: stepContract,
          crawclawWaitKind: step.wait?.kind ?? "input",
        },
      },
      step,
    );
  }
  if (step.kind === "service") {
    const serviceUrl = step.serviceRequest?.url?.trim();
    if (serviceUrl) {
      return applyFanOutExecutionControls(
        buildHttpRequestNode({
          name: nodeName,
          position,
          step,
          stepContract,
          url: serviceUrl,
          method: step.serviceRequest?.method,
          headers: step.serviceRequest?.headers,
          body: step.serviceRequest?.body,
        }),
        step,
      );
    }
    return applyFanOutExecutionControls(
      buildServicePlaceholderNode({
        name: nodeName,
        position,
        step,
        stepContract,
      }),
      step,
    );
  }
  if (step.kind === "native") {
    if (step.serviceRequest?.url?.trim()) {
      return applyFanOutExecutionControls(
        buildHttpRequestNode({
          name: nodeName,
          position,
          step,
          stepContract,
          url: step.serviceRequest.url.trim(),
          method: step.serviceRequest?.method,
          headers: step.serviceRequest?.headers,
          body: step.serviceRequest?.body,
        }),
        step,
      );
    }
    return applyFanOutExecutionControls(
      buildNativeSetNode({
        name: nodeName,
        position,
        step,
        stepContract,
      }),
      step,
    );
  }
  return applyFanOutExecutionControls(
    buildServicePlaceholderNode({
      name: nodeName,
      position,
      step,
      stepContract,
    }),
    step,
  );
}

export function compileWorkflowSpecToN8n(
  spec: WorkflowSpec,
  options?: CompileWorkflowSpecToN8nOptions,
): {
  name: string;
  nodes: Array<Record<string, unknown>>;
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
  staticData: Record<string, unknown>;
  meta: Record<string, unknown>;
} {
  const resolvedSteps = validateWorkflowSpec(spec);
  const callbackConfig = resolveCrawClawCallbackConfig(options);
  const webhookPath = buildCrawClawWorkflowWebhookPath(spec.workflowId);
  const triggerName = "When webhook is called";
  const triggerNormalizerName = buildWorkflowInputNormalizerNodeName();
  const stepContracts = spec.steps.map((step) => buildCrawClawStepContract(spec, step));
  const summary = {
    workflowId: spec.workflowId,
    goal: spec.goal,
    stepCount: spec.steps.length,
    stepTitles: spec.steps.map((step) => step.title ?? step.goal ?? step.id),
  };
  const triggerNode = {
    id: `webhook_${randomUUID().slice(0, 8)}`,
    name: triggerName,
    type: "n8n-nodes-base.webhook",
    typeVersion: 2.1,
    position: [240, 300],
    parameters: {
      httpMethod: "POST",
      path: webhookPath,
      responseMode: "onReceived",
      options: {},
    },
  };
  const nodes: Array<Record<string, unknown>> = [triggerNode];
  nodes.push(buildWorkflowInputNormalizerNode([400, 300]));
  const connections: Record<string, unknown> = {};
  addConnection(connections, triggerName, triggerNormalizerName);
  const pathSlots = buildPathSlots(resolvedSteps);
  const stepNodeNames = new Map<string, string>();
  const stepPositions = new Map<string, [number, number]>();
  const stepContractsById = new Map<string, CrawClawStepContract>();
  const gateNodeNames = new Map<string, string>();
  const mergeNodeNames = new Map<string, string[]>();

  for (const resolved of resolvedSteps) {
    const nodeName = buildWorkflowStepNodeName(resolved.step, resolved.index);
    const position: [number, number] = [
      240 + (resolved.index + 1) * 320,
      180 + (pathSlots.get(resolved.path) ?? 0) * 180,
    ];
    const stepContract = stepContracts[resolved.index];
    stepNodeNames.set(resolved.step.id, nodeName);
    stepPositions.set(resolved.step.id, position);
    stepContractsById.set(resolved.step.id, stepContract);
    nodes.push(
      buildWorkflowStepNode({
        spec,
        step: resolved.step,
        nodeName,
        position,
        stepContract,
        callbackConfig,
      }),
    );
  }

  for (const resolved of resolvedSteps) {
    const position = stepPositions.get(resolved.step.id)!;
    const stepContract = stepContractsById.get(resolved.step.id)!;
    if (resolved.activationMode === "conditional") {
      const gateName = buildWorkflowGateNodeName(resolved.step, resolved.index);
      gateNodeNames.set(resolved.step.id, gateName);
      nodes.push(
        buildConditionalGateNode({
          name: gateName,
          position: [position[0] - 160, position[1]],
          step: resolved.step,
          stepContract,
          when: resolved.activationWhen,
        }),
      );
    }
    if (resolved.activationMode === "fan_in" && resolved.sourceStepIds.length > 1) {
      const mergeNames: string[] = [];
      for (let mergeIndex = 0; mergeIndex < resolved.sourceStepIds.length - 1; mergeIndex += 1) {
        const mergeName = buildWorkflowMergeNodeName(resolved.step, resolved.index, mergeIndex + 1);
        mergeNames.push(mergeName);
        nodes.push(
          buildMergeNode({
            name: mergeName,
            position: [position[0] - 160 + mergeIndex * 40, position[1]],
            step: resolved.step,
            stepContract,
          }),
        );
      }
      mergeNodeNames.set(resolved.step.id, mergeNames);
    }
  }

  for (const resolved of resolvedSteps) {
    const targetStepNodeName = stepNodeNames.get(resolved.step.id)!;
    const sourceNodeNames = resolved.sourceStepIds
      .map((stepId) => stepNodeNames.get(stepId))
      .filter((value): value is string => Boolean(value));
    if (resolved.sourceStepIds.length === 0) {
      addConnection(
        connections,
        triggerNormalizerName,
        gateNodeNames.get(resolved.step.id) ?? targetStepNodeName,
      );
      if (gateNodeNames.has(resolved.step.id)) {
        addConnection(connections, gateNodeNames.get(resolved.step.id)!, targetStepNodeName);
      }
      continue;
    }
    if (resolved.activationMode === "conditional") {
      const gateName = gateNodeNames.get(resolved.step.id)!;
      addConnection(connections, sourceNodeNames[0], gateName);
      addConnection(connections, gateName, targetStepNodeName);
      continue;
    }
    if (resolved.activationMode === "fan_in" && sourceNodeNames.length > 1) {
      const mergeNames = mergeNodeNames.get(resolved.step.id) ?? [];
      if (mergeNames.length === 0) {
        throw new Error(
          `Workflow "${spec.name}" failed to build merge helpers for step "${resolved.step.id}".`,
        );
      }
      if (sourceNodeNames.length === 2) {
        addConnection(connections, sourceNodeNames[0], mergeNames[0], 0, 0);
        addConnection(connections, sourceNodeNames[1], mergeNames[0], 0, 1);
        addConnection(connections, mergeNames[0], targetStepNodeName);
        continue;
      }
      addConnection(connections, sourceNodeNames[0], mergeNames[0], 0, 0);
      addConnection(connections, sourceNodeNames[1], mergeNames[0], 0, 1);
      for (let mergeIndex = 1; mergeIndex < mergeNames.length; mergeIndex += 1) {
        addConnection(connections, mergeNames[mergeIndex - 1], mergeNames[mergeIndex], 0, 0);
        addConnection(connections, sourceNodeNames[mergeIndex + 1], mergeNames[mergeIndex], 0, 1);
      }
      addConnection(connections, mergeNames[mergeNames.length - 1], targetStepNodeName);
      continue;
    }
    addConnection(connections, sourceNodeNames[0], targetStepNodeName);
  }

  return {
    name: spec.name,
    nodes,
    connections,
    settings: {
      executionOrder: "v1",
      saveExecutionProgress: true,
      saveDataErrorExecution: "all",
      saveDataSuccessExecution: "all",
      saveManualExecutions: true,
    },
    staticData: {
      crawclawWorkflowId: spec.workflowId,
      crawclawTopology: spec.topology ?? "linear_v1",
      crawclawSpecVersion: 1,
      crawclawTriggerPath: webhookPath,
      crawclawWorkflowInputNamespace: "workflowInput",
      crawclawSummary: summary,
      crawclawStepContracts: stepContracts,
      ...(callbackConfig ? { crawclawCallbackUrl: callbackConfig.callbackUrl } : {}),
    },
    meta: {
      source: "crawclaw",
      crawclawWorkflowId: spec.workflowId,
      crawclawTopology: spec.topology ?? "linear_v1",
      crawclawTriggerPath: webhookPath,
      crawclawWorkflowInputNamespace: "workflowInput",
      crawclawSummary: summary,
      crawclawStepContracts: stepContracts,
      ...(callbackConfig
        ? {
            crawclawCallbackUrl: callbackConfig.callbackUrl,
            ...(callbackConfig.callbackCredentialId
              ? {
                  crawclawCallbackCredentialId: callbackConfig.callbackCredentialId,
                  ...(callbackConfig.callbackCredentialName
                    ? { crawclawCallbackCredentialName: callbackConfig.callbackCredentialName }
                    : {}),
                }
              : {
                  crawclawCallbackBearerEnvVar: callbackConfig.callbackBearerEnvVar,
                }),
          }
        : {}),
    },
  };
}
