import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientMode,
  type GatewayClientName,
} from "../../src/utils/gateway-client-surface.js";

type TestGatewayWsEvent = {
  event?: string;
  payload?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  expectFinal: boolean;
  timeout: NodeJS.Timeout | null;
};

export type TestGatewayWsClientOptions = {
  url: string;
  token?: string;
  password?: string;
  clientName?: GatewayClientName;
  clientDisplayName?: string;
  clientVersion?: string;
  mode?: GatewayClientMode;
  platform?: string;
  deviceFamily?: string;
  role?: "operator";
  scopes?: string[];
  caps?: string[];
  commands?: string[];
  instanceId?: string;
  onEvent?: (evt: TestGatewayWsEvent) => void;
  onHelloOk?: (hello: unknown) => void;
  onConnectError?: (err: Error) => void;
  onClose?: (code: number, reason: string) => void;
};

export class TestGatewayWsClient {
  private readonly opts: TestGatewayWsClientOptions;
  private ws: WebSocket | null = null;
  private closed = false;
  private pending = new Map<string, PendingRequest>();

  constructor(opts: TestGatewayWsClientOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.closed) {
      return;
    }
    const ws = new WebSocket(this.opts.url, { maxPayload: 25 * 1024 * 1024 });
    this.ws = ws;
    ws.on("open", () => {
      void this.request("connect", this.connectParams())
        .then((hello) => this.opts.onHelloOk?.(hello))
        .catch((error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          this.opts.onConnectError?.(err);
          ws.close(1008, "connect failed");
        });
    });
    ws.on("message", (data) => this.handleMessage(rawWsDataToString(data)));
    ws.on("close", (code, reason) => {
      const reasonText = rawWsDataToString(reason);
      this.flushPending(new Error(`gateway closed (${code}): ${reasonText}`));
      this.opts.onClose?.(code, reasonText);
    });
    ws.on("error", (error) => {
      this.opts.onConnectError?.(error instanceof Error ? error : new Error(String(error)));
    });
  }

  stop(): void {
    this.closed = true;
    const ws = this.ws;
    this.ws = null;
    this.flushPending(new Error("gateway client stopped"));
    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
      ws.close(1000, "client stopped");
    }
  }

  async stopAndWait(timeoutMs = 1_000): Promise<void> {
    const ws = this.ws;
    this.stop();
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      return;
    }
    await Promise.race([
      new Promise<void>((resolve) => ws.once("close", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number | null },
  ): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("gateway client is not connected");
    }
    const id = randomUUID();
    const expectFinal = opts?.expectFinal === true;
    const timeoutMs =
      typeof opts?.timeoutMs === "number" && Number.isFinite(opts.timeoutMs)
        ? Math.max(1, Math.min(Math.floor(opts.timeoutMs), 2_147_483_647))
        : expectFinal
          ? null
          : 30_000;
    return await new Promise<T>((resolve, reject) => {
      const timeout =
        timeoutMs == null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`gateway request timeout for ${method}`));
            }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        expectFinal,
        timeout,
      });
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method,
          params: params ?? {},
        }),
      );
    });
  }

  private connectParams(): Record<string, unknown> {
    const auth =
      this.opts.token || this.opts.password
        ? { token: this.opts.token, password: this.opts.password }
        : undefined;
    return {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: this.opts.clientName ?? GATEWAY_CLIENT_NAMES.TEST,
        displayName: this.opts.clientDisplayName ?? "vitest",
        version: this.opts.clientVersion ?? "dev",
        platform: this.opts.platform ?? process.platform,
        deviceFamily: this.opts.deviceFamily,
        mode: this.opts.mode ?? GATEWAY_CLIENT_MODES.TEST,
        instanceId: this.opts.instanceId,
      },
      caps: Array.isArray(this.opts.caps) ? this.opts.caps : [],
      commands: Array.isArray(this.opts.commands) ? this.opts.commands : undefined,
      auth,
      role: this.opts.role ?? "operator",
      scopes: this.opts.scopes ?? ["operator.admin"],
    };
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    const frame = parsed as {
      type?: unknown;
      id?: unknown;
      ok?: unknown;
      payload?: unknown;
      error?: { message?: unknown };
      event?: string;
    };
    if (frame.type === "event") {
      this.opts.onEvent?.({ event: frame.event, payload: frame.payload });
      return;
    }
    if (frame.type !== "res" || typeof frame.id !== "string") {
      return;
    }
    const pending = this.pending.get(frame.id);
    if (!pending) {
      return;
    }
    const payloadStatus =
      frame.payload && typeof frame.payload === "object"
        ? (frame.payload as { status?: unknown }).status
        : undefined;
    if (pending.expectFinal && payloadStatus === "accepted") {
      return;
    }
    this.pending.delete(frame.id);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    if (frame.ok === true) {
      pending.resolve(frame.payload);
      return;
    }
    const message =
      typeof frame.error?.message === "string" ? frame.error.message : "gateway request failed";
    pending.reject(new Error(message));
  }

  private flushPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function connectTestGatewayWsClient(
  params: TestGatewayWsClientOptions & {
    timeoutMs?: number;
    timeoutMessage?: string;
  },
): Promise<TestGatewayWsClient> {
  return await new Promise<TestGatewayWsClient>((resolve, reject) => {
    let settled = false;
    const client = new TestGatewayWsClient({
      ...params,
      onHelloOk: (hello) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        params.onHelloOk?.(hello);
        resolve(client);
      },
      onConnectError: (err) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
      onClose: (code, reason) => {
        if (settled) {
          params.onClose?.(code, reason);
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(new Error(`gateway closed during connect (${code}): ${reason}`));
      },
    });
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      client.stop();
      reject(new Error(params.timeoutMessage ?? "gateway connect timeout"));
    }, params.timeoutMs ?? 10_000);
    timer.unref();
    client.start();
  });
}

function rawWsDataToString(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data.map((chunk) => Buffer.from(chunk))).toString("utf8");
  }
  return String(data);
}
