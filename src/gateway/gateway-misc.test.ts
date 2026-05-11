import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { defaultVoiceWakeTriggers } from "../infra/voicewake.js";
import { createGatewayBroadcaster } from "./server-broadcast.js";
import { createChatRunRegistry } from "./server-chat.js";
import { formatError, normalizeVoiceWakeTriggers } from "./server-utils.js";
import type { GatewayWsClient } from "./server/ws-types.js";

const wsMockState = vi.hoisted(() => ({
  last: null as { url: unknown; opts: unknown } | null,
}));

vi.mock("ws", () => ({
  WebSocket: class MockWebSocket {
    on = vi.fn();
    close = vi.fn();
    send = vi.fn();

    constructor(url: unknown, opts: unknown) {
      wsMockState.last = { url, opts };
    }
  },
}));

let GatewayClient: typeof import("./client.js").GatewayClient;

async function loadFreshGatewayClientModuleForTest() {
  vi.resetModules();
  vi.doMock("ws", () => ({
    WebSocket: class MockWebSocket {
      on = vi.fn();
      close = vi.fn();
      send = vi.fn();

      constructor(url: unknown, opts: unknown) {
        wsMockState.last = { url, opts };
      }
    },
  }));
  ({ GatewayClient } = await import("./client.js"));
}

beforeEach(async () => {
  wsMockState.last = null;
  await loadFreshGatewayClientModuleForTest();
});

describe("GatewayClient", () => {
  test("uses a large maxPayload for gateway snapshots", () => {
    const client = new GatewayClient({ url: "ws://127.0.0.1:1" });
    client.start();
    const last = wsMockState.last as { url: unknown; opts: unknown } | null;

    expect(last?.url).toBe("ws://127.0.0.1:1");
    expect(last?.opts).toEqual(expect.objectContaining({ maxPayload: 25 * 1024 * 1024 }));
  });
});

type TestSocket = {
  bufferedAmount: number;
  send: (payload: string) => void;
  close: (code: number, reason: string) => void;
};

describe("gateway broadcaster", () => {
  it("filters approval and pairing events by scope", () => {
    const approvalsSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const pairingSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const readSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: approvalsSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.approvals"] } as GatewayWsClient["connect"],
        connId: "c-approvals",
      },
      {
        socket: pairingSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.pairing"] } as GatewayWsClient["connect"],
        connId: "c-pairing",
      },
      {
        socket: readSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.read"] } as GatewayWsClient["connect"],
        connId: "c-read",
      },
    ]);

    const { broadcast, broadcastToConnIds } = createGatewayBroadcaster({ clients });

    broadcast("exec.approval.requested", { id: "1" });
    broadcast("device.pair.requested", { requestId: "r1" });

    expect(approvalsSocket.send).toHaveBeenCalledTimes(1);
    expect(pairingSocket.send).toHaveBeenCalledTimes(1);
    expect(readSocket.send).toHaveBeenCalledTimes(0);

    broadcastToConnIds("tick", { ts: 1 }, new Set(["c-read"]));
    expect(readSocket.send).toHaveBeenCalledTimes(1);
    expect(approvalsSocket.send).toHaveBeenCalledTimes(1);
    expect(pairingSocket.send).toHaveBeenCalledTimes(1);
  });
});

describe("chat run registry", () => {
  test("queues and removes runs per session", () => {
    const registry = createChatRunRegistry();

    registry.add("s1", { sessionKey: "main", clientRunId: "c1" });
    registry.add("s1", { sessionKey: "main", clientRunId: "c2" });

    expect(registry.peek("s1")?.clientRunId).toBe("c1");
    expect(registry.shift("s1")?.clientRunId).toBe("c1");
    expect(registry.peek("s1")?.clientRunId).toBe("c2");

    expect(registry.remove("s1", "c2")?.clientRunId).toBe("c2");
    expect(registry.peek("s1")).toBeUndefined();
  });
});

describe("normalizeVoiceWakeTriggers", () => {
  test("returns defaults when input is empty", () => {
    expect(normalizeVoiceWakeTriggers([])).toEqual(defaultVoiceWakeTriggers());
    expect(normalizeVoiceWakeTriggers(null)).toEqual(defaultVoiceWakeTriggers());
  });

  test("trims and limits entries", () => {
    const result = normalizeVoiceWakeTriggers(["  hello  ", "", "world"]);
    expect(result).toEqual(["hello", "world"]);
  });
});

describe("formatError", () => {
  test("prefers message for Error", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
  });

  test("handles status/code", () => {
    expect(formatError({ status: 500, code: "EPIPE" })).toBe("status=500 code=EPIPE");
    expect(formatError({ status: 404 })).toBe("status=404 code=unknown");
    expect(formatError({ code: "ENOENT" })).toBe("status=unknown code=ENOENT");
  });
});
