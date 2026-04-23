import type { CrawClawConfig } from "../config/config.js";

type N8nFetch = typeof fetch;

type N8nClientDeps = {
  fetchImpl: N8nFetch;
};

const n8nClientDeps: N8nClientDeps = {
  fetchImpl: fetch,
};

export const __testing = {
  setDepsForTest(overrides: Partial<N8nClientDeps> | null) {
    n8nClientDeps.fetchImpl = overrides?.fetchImpl ?? fetch;
  },
};

export type N8nResolvedConfig = {
  baseUrl: string;
  apiKey: string;
  projectId?: string;
  triggerBearerToken?: string;
};

export type N8nCallbackConfig = {
  callbackBaseUrl: string;
  callbackBearerEnvVar: string;
  callbackCredentialId?: string;
  callbackCredentialName?: string;
  callbackBearerToken?: string;
};

export type N8nWorkflowPayload = {
  name: string;
  nodes: Array<Record<string, unknown>>;
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
  staticData?: Record<string, unknown>;
  tags?: string[];
  projectId?: string;
  meta?: Record<string, unknown>;
};

export type N8nWorkflowRecord = {
  id: string;
  name: string;
  active?: boolean;
  nodes: Array<Record<string, unknown>>;
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  staticData?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

export type N8nExecutionRecord = {
  id?: string;
  executionId?: string;
  workflowId?: string;
  status?: string;
  finished?: boolean;
  stoppedAt?: string | null;
  startedAt?: string | null;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

export type N8nExecutionListResponse = {
  data: N8nExecutionRecord[];
  nextCursor?: string | null;
};

function sanitizeWorkflowNodesForApi(
  nodes: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> {
  if (!Array.isArray(nodes)) {
    return [];
  }
  return nodes.map((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return {};
    }
    const clone = { ...node };
    delete clone.meta;
    return clone;
  });
}

function sanitizeWorkflowPayloadForApi(payload: N8nWorkflowPayload): N8nWorkflowPayload {
  const sanitized: N8nWorkflowPayload = {
    ...payload,
    nodes: sanitizeWorkflowNodesForApi(payload.nodes),
  };
  delete sanitized.meta;
  return sanitized;
}

function sanitizeWorkflowPatchForApi(
  payload: Partial<N8nWorkflowPayload>,
): Partial<N8nWorkflowPayload> {
  const sanitized: Partial<N8nWorkflowPayload> = { ...payload };
  if ("nodes" in payload) {
    sanitized.nodes = sanitizeWorkflowNodesForApi(payload.nodes);
  }
  delete sanitized.meta;
  return sanitized;
}

function trimToUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveN8nConfig(
  config?: CrawClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): N8nResolvedConfig | null {
  const raw = (config?.workflow?.n8n ?? {}) as {
    baseUrl?: unknown;
    apiKey?: unknown;
    projectId?: unknown;
    triggerBearerToken?: unknown;
  };
  const baseUrl = trimToUndefined(raw.baseUrl) ?? trimToUndefined(env.CRAWCLAW_N8N_BASE_URL);
  const apiKey = trimToUndefined(raw.apiKey) ?? trimToUndefined(env.CRAWCLAW_N8N_API_KEY);
  const projectId = trimToUndefined(raw.projectId) ?? trimToUndefined(env.CRAWCLAW_N8N_PROJECT_ID);
  const triggerBearerToken =
    trimToUndefined(raw.triggerBearerToken) ??
    trimToUndefined(env.CRAWCLAW_N8N_TRIGGER_BEARER_TOKEN);
  if (!baseUrl || !apiKey) {
    return null;
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    ...(projectId ? { projectId } : {}),
    ...(triggerBearerToken ? { triggerBearerToken } : {}),
  };
}

export function resolveN8nCallbackConfig(
  config?: CrawClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): N8nCallbackConfig | null {
  const raw = (config?.workflow?.n8n ?? {}) as {
    callbackBaseUrl?: unknown;
    callbackCredentialId?: unknown;
    callbackCredentialName?: unknown;
    callbackBearerEnvVar?: unknown;
    callbackBearerToken?: unknown;
  };
  const callbackBaseUrl =
    trimToUndefined(raw.callbackBaseUrl) ?? trimToUndefined(env.CRAWCLAW_N8N_CALLBACK_BASE_URL);
  if (!callbackBaseUrl) {
    return null;
  }
  const callbackBearerEnvVarCandidate =
    trimToUndefined(raw.callbackBearerEnvVar) ??
    trimToUndefined(env.CRAWCLAW_N8N_CALLBACK_BEARER_ENV_VAR) ??
    "CRAWCLAW_GATEWAY_TOKEN";
  const callbackCredentialId =
    trimToUndefined(raw.callbackCredentialId) ??
    trimToUndefined(env.CRAWCLAW_N8N_CALLBACK_CREDENTIAL_ID);
  const callbackCredentialName =
    trimToUndefined(raw.callbackCredentialName) ??
    trimToUndefined(env.CRAWCLAW_N8N_CALLBACK_CREDENTIAL_NAME);
  const callbackBearerToken =
    trimToUndefined(raw.callbackBearerToken) ??
    trimToUndefined(env.CRAWCLAW_N8N_CALLBACK_BEARER_TOKEN) ??
    trimToUndefined(env[callbackBearerEnvVarCandidate]);
  return {
    callbackBaseUrl: callbackBaseUrl.replace(/\/+$/, ""),
    callbackBearerEnvVar: callbackBearerEnvVarCandidate,
    ...(callbackCredentialId ? { callbackCredentialId } : {}),
    ...(callbackCredentialName ? { callbackCredentialName } : {}),
    ...(callbackBearerToken ? { callbackBearerToken } : {}),
  };
}

function buildHeaders(apiKey: string, extra?: Record<string, string>) {
  return {
    Accept: "application/json",
    "X-N8N-API-KEY": apiKey,
    ...extra,
  };
}

async function expectOk(response: Response, method: string, url: string) {
  if (response.ok) {
    return;
  }
  const text = await response.text().catch(() => "");
  throw new Error(
    `n8n ${method} ${url} failed (${response.status}): ${text || response.statusText}`,
  );
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function joinBaseUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function buildTriggerWebhookHeaders(config: N8nResolvedConfig): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(config.triggerBearerToken ? { Authorization: `Bearer ${config.triggerBearerToken}` } : {}),
  };
}

function normalizeExecutionListPayload(payload: unknown): N8nExecutionListResponse {
  if (Array.isArray(payload)) {
    return { data: payload as N8nExecutionRecord[] };
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      return {
        data: record.data as N8nExecutionRecord[],
        ...(typeof record.nextCursor === "string" || record.nextCursor === null
          ? { nextCursor: record.nextCursor }
          : {}),
      };
    }
    if (Array.isArray(record.items)) {
      return { data: record.items as N8nExecutionRecord[] };
    }
  }
  return { data: [] };
}

function parseStartedAtTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createN8nClient(config: N8nResolvedConfig) {
  const baseUrl = `${config.baseUrl}/api/v1`;

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${baseUrl}${path}`;
    const response = await n8nClientDeps.fetchImpl(url, {
      ...init,
      headers: buildHeaders(config.apiKey, init?.headers as Record<string, string> | undefined),
    });
    await expectOk(response, init?.method ?? "GET", url);
    return await readJson<T>(response);
  }

  async function requestAbsolute<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await n8nClientDeps.fetchImpl(url, init);
    await expectOk(response, init?.method ?? "GET", url);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return await readJson<T>(response);
    }
    const text = await response.text();
    return text ? ({ text } as T) : ({} as T);
  }

  return {
    listWorkflows: async () =>
      await requestJson<{ data: N8nWorkflowRecord[]; nextCursor?: string | null }>("/workflows"),
    getWorkflow: async (workflowId: string) =>
      await requestJson<N8nWorkflowRecord>(`/workflows/${encodeURIComponent(workflowId)}`),
    createWorkflow: async (payload: N8nWorkflowPayload) =>
      await requestJson<N8nWorkflowRecord>("/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitizeWorkflowPayloadForApi(payload)),
      }),
    updateWorkflow: async (workflowId: string, payload: Partial<N8nWorkflowPayload>) =>
      await requestJson<N8nWorkflowRecord>(`/workflows/${encodeURIComponent(workflowId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitizeWorkflowPatchForApi(payload)),
      }),
    activateWorkflow: async (workflowId: string) =>
      await requestJson<N8nWorkflowRecord>(
        `/workflows/${encodeURIComponent(workflowId)}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      ),
    deactivateWorkflow: async (workflowId: string) =>
      await requestJson<N8nWorkflowRecord>(
        `/workflows/${encodeURIComponent(workflowId)}/deactivate`,
        {
          method: "POST",
        },
      ),
    listExecutions: async (options?: {
      workflowId?: string;
      limit?: number;
      cursor?: string;
      includeData?: boolean;
    }) => {
      const query = new URLSearchParams();
      if (options?.workflowId?.trim()) {
        query.set("workflowId", options.workflowId.trim());
      }
      if (
        typeof options?.limit === "number" &&
        Number.isFinite(options.limit) &&
        options.limit > 0
      ) {
        query.set("limit", String(Math.floor(options.limit)));
      }
      if (options?.cursor?.trim()) {
        query.set("cursor", options.cursor.trim());
      }
      if (options?.includeData === true) {
        query.set("includeData", "true");
      }
      const payload = await requestJson<unknown>(
        `/executions${query.size > 0 ? `?${query.toString()}` : ""}`,
      );
      return normalizeExecutionListPayload(payload);
    },
    triggerWebhook: async (webhookPath: string, payload?: Record<string, unknown>) =>
      await requestAbsolute<Record<string, unknown>>(
        joinBaseUrl(config.baseUrl, `/webhook/${encodeURIComponent(webhookPath)}`),
        {
          method: "POST",
          headers: buildTriggerWebhookHeaders(config),
          body: JSON.stringify(payload ?? {}),
        },
      ),
    triggerWorkflowByWebhookAndWaitForExecution: async (params: {
      workflowId: string;
      webhookPath: string;
      payload?: Record<string, unknown>;
      timeoutMs?: number;
      pollMs?: number;
      startedAfter?: number;
    }) => {
      const startedAfter = params.startedAfter ?? Date.now();
      const timeoutMs = Math.max(1_000, Math.floor(params.timeoutMs ?? 20_000));
      const pollMs = Math.max(100, Math.floor(params.pollMs ?? 500));
      await requestAbsolute<Record<string, unknown>>(
        joinBaseUrl(config.baseUrl, `/webhook/${encodeURIComponent(params.webhookPath)}`),
        {
          method: "POST",
          headers: buildTriggerWebhookHeaders(config),
          body: JSON.stringify(params.payload ?? {}),
        },
      );

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const listed = await requestJson<unknown>(
          `/executions?workflowId=${encodeURIComponent(params.workflowId)}&limit=10`,
        );
        const executions = normalizeExecutionListPayload(listed).data;
        const match = [...executions]
          .toSorted((left, right) => {
            const leftAt = parseStartedAtTimestamp(left.startedAt) ?? 0;
            const rightAt = parseStartedAtTimestamp(right.startedAt) ?? 0;
            return rightAt - leftAt;
          })
          .find((execution) => {
            const startedAt = parseStartedAtTimestamp(execution.startedAt);
            return startedAt == null || startedAt >= startedAfter - 2_000;
          });
        if (match) {
          return {
            ...match,
            executionId:
              (typeof match.executionId === "string" && match.executionId.trim()) ||
              (typeof match.id === "string" && match.id.trim())
                ? (match.executionId ?? match.id)
                : undefined,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      throw new Error(
        `n8n webhook trigger for workflow ${params.workflowId} did not surface a public execution within ${timeoutMs}ms`,
      );
    },
    getExecution: async (
      executionId: string,
      options?: {
        includeData?: boolean;
      },
    ) => {
      const query = new URLSearchParams();
      if (options?.includeData === true) {
        query.set("includeData", "true");
      }
      return await requestJson<N8nExecutionRecord>(
        `/executions/${encodeURIComponent(executionId)}${query.size > 0 ? `?${query.toString()}` : ""}`,
      );
    },
    stopExecution: async (executionId: string) =>
      await requestJson<N8nExecutionRecord>(`/executions/${encodeURIComponent(executionId)}/stop`, {
        method: "POST",
      }),
    resumeExecutionByUrl: async (resumeUrl: string, payload?: Record<string, unknown>) =>
      await requestAbsolute<Record<string, unknown>>(resumeUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload ?? {}),
      }),
  };
}
