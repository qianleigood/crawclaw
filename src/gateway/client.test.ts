import { Buffer } from "node:buffer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEnv } from "../test-utils/env.js";

const wsInstances = vi.hoisted((): MockWebSocket[] => []);

type WsEvent = "open" | "message" | "close" | "error";
type WsEventHandlers = {
  open: () => void;
  message: (data: string | Buffer) => void;
  close: (code: number, reason: Buffer) => void;
  error: (err: unknown) => void;
};

class MockWebSocket {
  private openHandlers: WsEventHandlers["open"][] = [];
  private messageHandlers: WsEventHandlers["message"][] = [];
  private closeHandlers: WsEventHandlers["close"][] = [];
  private errorHandlers: WsEventHandlers["error"][] = [];
  readonly sent: string[] = [];
  closeCalls = 0;
  terminateCalls = 0;
  autoCloseOnClose = true;

  constructor(_url: string, _options?: unknown) {
    wsInstances.push(this);
  }

  on(event: "open", handler: WsEventHandlers["open"]): void;
  on(event: "message", handler: WsEventHandlers["message"]): void;
  on(event: "close", handler: WsEventHandlers["close"]): void;
  on(event: "error", handler: WsEventHandlers["error"]): void;
  on(event: WsEvent, handler: WsEventHandlers[WsEvent]): void {
    switch (event) {
      case "open":
        this.openHandlers.push(handler as WsEventHandlers["open"]);
        return;
      case "message":
        this.messageHandlers.push(handler as WsEventHandlers["message"]);
        return;
      case "close":
        this.closeHandlers.push(handler as WsEventHandlers["close"]);
        return;
      case "error":
        this.errorHandlers.push(handler as WsEventHandlers["error"]);
        return;
      default:
        return;
    }
  }

  close(code?: number, reason?: string): void {
    this.closeCalls += 1;
    if (this.autoCloseOnClose) {
      this.emitClose(code ?? 1000, reason ?? "");
    }
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  emitOpen(): void {
    for (const handler of this.openHandlers) {
      handler();
    }
  }

  emitMessage(data: string): void {
    for (const handler of this.messageHandlers) {
      handler(data);
    }
  }

  emitClose(code: number, reason: string): void {
    for (const handler of this.closeHandlers) {
      handler(code, Buffer.from(reason));
    }
  }
}

vi.mock("ws", () => ({
  WebSocket: MockWebSocket,
}));

type GatewayClientModule = typeof import("./client.js");
type GatewayClientInstance = InstanceType<GatewayClientModule["GatewayClient"]>;

let GatewayClient: GatewayClientModule["GatewayClient"];

async function loadGatewayClientModule() {
  vi.resetModules();
  ({ GatewayClient } = await import("./client.js"));
}

function getLatestWs(): MockWebSocket {
  const ws = wsInstances.at(-1);
  if (!ws) {
    throw new Error("missing mock websocket instance");
  }
  return ws;
}

function expectSecurityConnectError(
  onConnectError: ReturnType<typeof vi.fn>,
  params?: { expectTailscaleHint?: boolean },
) {
  expect(onConnectError).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringContaining("SECURITY ERROR"),
    }),
  );
  const error = onConnectError.mock.calls[0]?.[0] as Error;
  expect(error.message).toContain("crawclaw doctor --fix");
  if (params?.expectTailscaleHint) {
    expect(error.message).toContain("Tailscale Serve/Funnel");
  }
}

beforeAll(async () => {
  await loadGatewayClientModule();
});

describe("GatewayClient security checks", () => {
  const envSnapshot = captureEnv(["CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS"]);

  beforeEach(() => {
    envSnapshot.restore();
    delete process.env.CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS;
    wsInstances.length = 0;
  });

  afterEach(() => {
    envSnapshot.restore();
    delete process.env.CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS;
  });

  it("blocks ws:// to non-loopback addresses (CWE-319)", () => {
    const onConnectError = vi.fn();
    const client = new GatewayClient({
      url: "ws://remote.example.com:18789",
      onConnectError,
    });

    client.start();

    expectSecurityConnectError(onConnectError, { expectTailscaleHint: true });
    expect(wsInstances.length).toBe(0); // No WebSocket created
    client.stop();
  });

  it("handles malformed URLs gracefully without crashing", () => {
    const onConnectError = vi.fn();
    const client = new GatewayClient({
      url: "not-a-valid-url",
      onConnectError,
    });

    // Should not throw
    expect(() => client.start()).not.toThrow();

    expectSecurityConnectError(onConnectError);
    expect(wsInstances.length).toBe(0); // No WebSocket created
    client.stop();
  });

  it("allows ws:// to loopback addresses", () => {
    const onConnectError = vi.fn();
    const client = new GatewayClient({
      url: "ws://127.0.0.1:18789",
      onConnectError,
    });

    client.start();

    expect(onConnectError).not.toHaveBeenCalled();
    expect(wsInstances.length).toBe(1); // WebSocket created
    client.stop();
  });

  it("allows wss:// to any address", () => {
    const onConnectError = vi.fn();
    const client = new GatewayClient({
      url: "wss://remote.example.com:18789",
      onConnectError,
    });

    client.start();

    expect(onConnectError).not.toHaveBeenCalled();
    expect(wsInstances.length).toBe(1); // WebSocket created
    client.stop();
  });

  it("allows ws:// to private addresses only with CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS=1", () => {
    process.env.CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS = "1";
    const onConnectError = vi.fn();
    const client = new GatewayClient({
      url: "ws://192.168.1.100:18789",
      onConnectError,
    });

    client.start();

    expect(onConnectError).not.toHaveBeenCalled();
    expect(wsInstances.length).toBe(1);
    client.stop();
  });

  it("allows ws:// hostnames with CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS=1", () => {
    process.env.CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS = "1";
    const onConnectError = vi.fn();
    const client = new GatewayClient({
      url: "ws://crawclaw-gateway.ai:18789",
      onConnectError,
    });

    client.start();

    expect(onConnectError).not.toHaveBeenCalled();
    expect(wsInstances.length).toBe(1);
    client.stop();
  });
});

describe("GatewayClient close handling", () => {
  beforeEach(() => {
    wsInstances.length = 0;
  });

  it("force-terminates a lingering socket after stop", async () => {
    vi.useFakeTimers();
    try {
      const client = new GatewayClient({
        url: "ws://127.0.0.1:18789",
      });

      client.start();
      const ws = getLatestWs();

      client.stop();

      expect(ws.closeCalls).toBe(1);
      expect(ws.terminateCalls).toBe(0);

      await vi.advanceTimersByTimeAsync(250);

      expect(ws.terminateCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a lingering socket to terminate in stopAndWait", async () => {
    vi.useFakeTimers();
    try {
      const client = new GatewayClient({
        url: "ws://127.0.0.1:18789",
      });

      client.start();
      const ws = getLatestWs();
      ws.autoCloseOnClose = false;

      let settled = false;
      const stopPromise = client.stopAndWait().then(() => {
        settled = true;
      });

      expect(ws.closeCalls).toBe(1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(249);
      expect(ws.terminateCalls).toBe(0);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await stopPromise;

      expect(ws.terminateCalls).toBe(1);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GatewayClient connect auth payload", () => {
  beforeEach(() => {
    wsInstances.length = 0;
  });

  function connectFrameFrom(ws: MockWebSocket) {
    const raw = ws.sent.find((frame) => frame.includes('"method":"connect"'));
    if (!raw) {
      throw new Error("missing connect frame");
    }
    const parsed = JSON.parse(raw) as {
      params?: {
        auth?: {
          token?: string;
          password?: string;
        };
      };
    };
    return parsed.params?.auth ?? {};
  }

  function connectRequestFrom(ws: MockWebSocket) {
    const raw = ws.sent.find((frame) => frame.includes('"method":"connect"'));
    expect(raw).toBeTruthy();
    return JSON.parse(raw ?? "{}") as {
      id?: string;
      params?: {
        auth?: {
          token?: string;
        };
      };
    };
  }

  function startClientAndConnect(params: { client: GatewayClientInstance }) {
    params.client.start();
    const ws = getLatestWs();
    ws.emitOpen();
    return { ws, connect: connectRequestFrom(ws) };
  }

  function emitConnectFailure(
    ws: MockWebSocket,
    connectId: string | undefined,
    details: Record<string, unknown>,
  ) {
    ws.emitMessage(
      JSON.stringify({
        type: "res",
        id: connectId,
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "unauthorized",
          details,
        },
      }),
    );
  }

  async function expectNoReconnectAfterConnectFailure(params: {
    client: GatewayClientInstance;
    firstWs: MockWebSocket;
    connectId: string | undefined;
    failureDetails: Record<string, unknown>;
  }) {
    vi.useFakeTimers();
    try {
      emitConnectFailure(params.firstWs, params.connectId, params.failureDetails);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(wsInstances).toHaveLength(1);
    } finally {
      params.client.stop();
      vi.useRealTimers();
    }
  }

  it("uses explicit shared token", () => {
    const client = new GatewayClient({
      url: "ws://127.0.0.1:18789",
      token: "shared-token",
    });

    client.start();
    const ws = getLatestWs();
    ws.emitOpen();

    expect(connectFrameFrom(ws)).toMatchObject({
      token: "shared-token",
    });
    client.stop();
  });

  it("uses explicit shared password", () => {
    const client = new GatewayClient({
      url: "ws://127.0.0.1:18789",
      password: "shared-password", // pragma: allowlist secret
    });

    client.start();
    const ws = getLatestWs();
    ws.emitOpen();

    expect(connectFrameFrom(ws)).toMatchObject({
      password: "shared-password", // pragma: allowlist secret
    });
    expect(connectFrameFrom(ws).token).toBeUndefined();
    client.stop();
  });

  it("omits auth when no shared credential is configured", () => {
    const client = new GatewayClient({
      url: "ws://127.0.0.1:18789",
    });

    client.start();
    const ws = getLatestWs();
    ws.emitOpen();

    expect(connectFrameFrom(ws)).toEqual({});
    client.stop();
  });

  it("does not auto-reconnect on AUTH_TOKEN_MISSING connect failures", async () => {
    const client = new GatewayClient({
      url: "ws://127.0.0.1:18789",
      token: "shared-token",
    });

    const { ws: ws1, connect: firstConnect } = startClientAndConnect({ client });
    await expectNoReconnectAfterConnectFailure({
      client,
      firstWs: ws1,
      connectId: firstConnect.id,
      failureDetails: { code: "AUTH_TOKEN_MISSING" },
    });
  });

  it("does not auto-reconnect on token mismatch", async () => {
    const client = new GatewayClient({
      url: "wss://gateway.example.com:18789",
      token: "shared-token",
    });

    const { ws: ws1, connect: firstConnect } = startClientAndConnect({ client });
    await expectNoReconnectAfterConnectFailure({
      client,
      firstWs: ws1,
      connectId: firstConnect.id,
      failureDetails: { code: "AUTH_TOKEN_MISMATCH" },
    });
  });
});
