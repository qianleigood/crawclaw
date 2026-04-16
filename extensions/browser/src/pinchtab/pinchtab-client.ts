/**
 * PinchTab transport adapter.
 *
 * This client speaks the raw PinchTab HTTP API used by host-side browser
 * integrations. It is intentionally lower-level than the browser control
 * facade in ../browser/control-client.ts and should stay focused on backend
 * protocol details such as auth headers, instance routes, and binary payloads.
 */
type PinchTabFetch = typeof fetch;

type PinchTabClientDeps = {
  fetchImpl: PinchTabFetch;
};

const pinchTabClientDeps: PinchTabClientDeps = {
  fetchImpl: fetch,
};

export const __testing = {
  setDepsForTest(overrides: Partial<PinchTabClientDeps> | null) {
    pinchTabClientDeps.fetchImpl = overrides?.fetchImpl ?? fetch;
  },
};

export type PinchTabClient = ReturnType<typeof createPinchTabClient>;

function buildHeaders(token?: string, extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...extra,
  };
  const trimmed = token?.trim();
  if (trimmed) {
    headers.Authorization = `Bearer ${trimmed}`;
    headers["X-Bridge-Token"] = trimmed;
  }
  return headers;
}

async function expectOk(response: Response, method: string, url: string) {
  if (response.ok) {
    return;
  }
  const text = await response.text().catch(() => "");
  throw new Error(
    `PinchTab ${method} ${url} failed (${response.status}): ${text || response.statusText}`,
  );
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export function createPinchTabClient(params: { baseUrl: string; token?: string }) {
  const baseUrl = params.baseUrl.replace(/\/$/, "");
  const token = params.token?.trim() || undefined;

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${baseUrl}${path}`;
    const response = await pinchTabClientDeps.fetchImpl(url, {
      ...init,
      headers: buildHeaders(token, init?.headers as Record<string, string> | undefined),
    });
    await expectOk(response, init?.method ?? "GET", url);
    return await readJson<T>(response);
  }

  async function requestBinary(path: string): Promise<Buffer> {
    const url = `${baseUrl}${path}`;
    const response = await pinchTabClientDeps.fetchImpl(url, {
      headers: buildHeaders(token),
    });
    await expectOk(response, "GET", url);
    const buf = await response.arrayBuffer();
    return Buffer.from(buf);
  }

  return {
    health: async () => await requestJson<Record<string, unknown>>("/health"),
    listProfiles: async () =>
      await requestJson<Array<Record<string, unknown>>>("/profiles?all=true"),
    createProfile: async (input: { name: string }) =>
      await requestJson<Record<string, unknown>>("/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    startInstance: async (input: { profileId?: string }) =>
      await requestJson<Record<string, unknown>>(
        input.profileId ? "/instances/start" : "/instances/launch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            input.profileId ? { profileId: input.profileId } : { mode: "headless" },
          ),
        },
      ),
    stopInstance: async (instanceId: string) =>
      await requestJson<Record<string, unknown>>(
        `/instances/${encodeURIComponent(instanceId)}/stop`,
        {
          method: "POST",
        },
      ),
    listTabs: async (instanceId: string) =>
      await requestJson<Array<Record<string, unknown>>>(
        `/instances/${encodeURIComponent(instanceId)}/tabs`,
      ),
    openTab: async (instanceId: string, url: string) =>
      await requestJson<Record<string, unknown>>(
        `/instances/${encodeURIComponent(instanceId)}/tabs/open`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        },
      ),
    closeTab: async (tabId: string) =>
      await requestJson<Record<string, unknown>>(`/tabs/${encodeURIComponent(tabId)}`, {
        method: "DELETE",
      }),
    getSnapshot: async (tabId: string) =>
      await requestJson<Record<string, unknown>>(`/tabs/${encodeURIComponent(tabId)}/snapshot`),
    getText: async (tabId: string) =>
      await requestJson<Record<string, unknown>>(`/tabs/${encodeURIComponent(tabId)}/text`),
    runAction: async (tabId: string, action: Record<string, unknown>) =>
      await requestJson<Record<string, unknown>>(`/tabs/${encodeURIComponent(tabId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      }),
    getCookies: async (tabId: string) =>
      await requestJson<Record<string, unknown>>(`/tabs/${encodeURIComponent(tabId)}/cookies`),
    evaluate: async (instanceId: string, expression: string) =>
      await requestJson<Record<string, unknown>>(
        `/instances/${encodeURIComponent(instanceId)}/evaluate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expression }),
        },
      ),
    getScreenshot: async (tabId: string) =>
      await requestBinary(`/tabs/${encodeURIComponent(tabId)}/screenshot`),
    getPdf: async (tabId: string) => await requestBinary(`/tabs/${encodeURIComponent(tabId)}/pdf`),
  };
}
