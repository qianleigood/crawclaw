export class ComfyUiClientError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(message: string, params: { code: string; status?: number; details?: unknown }) {
    super(message);
    this.name = "ComfyUiClientError";
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ComfyUiClientParams = {
  baseUrl: string;
  requestTimeoutMs: number;
  fetch?: FetchLike;
};

export class ComfyUiClient {
  readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(params: ComfyUiClientParams) {
    this.baseUrl = params.baseUrl.replace(/\/$/u, "");
    this.requestTimeoutMs = params.requestTimeoutMs;
    this.fetchImpl = params.fetch ?? fetch;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private async jsonRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.url(path), {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
      const text = await response.text();
      const body = text ? (JSON.parse(text) as unknown) : {};
      if (!response.ok) {
        throw new ComfyUiClientError(`ComfyUI request failed: ${path}`, {
          code: "comfyui_http_error",
          status: response.status,
          details: body,
        });
      }
      return body as T;
    } catch (error) {
      if (error instanceof ComfyUiClientError) {
        throw error;
      }
      throw new ComfyUiClientError(`ComfyUI request failed: ${path}`, {
        code: "comfyui_request_failed",
        details: String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async getSystemStats(): Promise<unknown> {
    return await this.jsonRequest("/system_stats", { method: "GET" });
  }

  async getObjectInfo(): Promise<unknown> {
    return await this.jsonRequest("/object_info", { method: "GET" });
  }

  async getQueue(): Promise<unknown> {
    return await this.jsonRequest("/queue", { method: "GET" });
  }

  async submitPrompt(prompt: unknown): Promise<{ prompt_id: string; number?: number }> {
    return await this.jsonRequest("/prompt", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
  }

  async getHistory(promptId: string): Promise<unknown> {
    return await this.jsonRequest(`/history/${encodeURIComponent(promptId)}`, { method: "GET" });
  }

  async downloadView(params: {
    filename: string;
    subfolder?: string;
    type?: string;
  }): Promise<Uint8Array> {
    const query = new URLSearchParams({ filename: params.filename });
    if (params.subfolder) {
      query.set("subfolder", params.subfolder);
    }
    if (params.type) {
      query.set("type", params.type);
    }
    const response = await this.fetchImpl(this.url(`/view?${query.toString()}`), { method: "GET" });
    if (!response.ok) {
      throw new ComfyUiClientError("ComfyUI output download failed", {
        code: "comfyui_download_failed",
        status: response.status,
      });
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
