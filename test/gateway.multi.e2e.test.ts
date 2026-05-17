import { afterAll, describe, expect, it } from "vitest";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../src/utils/gateway-client-surface.js";
import {
  type GatewayInstance,
  connectStatusClient,
  postJson,
  spawnGatewayInstance,
  stopGatewayInstance,
} from "./helpers/gateway-e2e-harness.js";
import {
  connectTestGatewayWsClient,
  type TestGatewayWsClient,
} from "./helpers/gateway-ws-client.js";

const E2E_TIMEOUT_MS = 120_000;

describe("gateway multi-instance e2e", () => {
  const instances: GatewayInstance[] = [];
  const chatClients: TestGatewayWsClient[] = [];

  afterAll(async () => {
    for (const client of chatClients) {
      client.stop();
    }
    for (const inst of instances) {
      await stopGatewayInstance(inst);
    }
  });

  it(
    "spins up two gateways and exercises Rust WS + HTTP RPC",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      const [gwA, gwB] = await Promise.all([spawnGatewayInstance("a"), spawnGatewayInstance("b")]);
      instances.push(gwA, gwB);

      const [rpcResA, rpcResB] = await Promise.all([
        postJson(
          `http://127.0.0.1:${gwA.port}/api/gateway/rpc`,
          {
            id: "health-a",
            method: "health",
            params: {},
          },
          { "x-crawclaw-gateway-token": gwA.gatewayToken },
        ),
        postJson(
          `http://127.0.0.1:${gwB.port}/api/gateway/rpc`,
          {
            id: "health-b",
            method: "health",
            params: {},
          },
          { "x-crawclaw-gateway-token": gwB.gatewayToken },
        ),
      ]);
      expect(rpcResA.status).toBe(200);
      expect((rpcResA.json as { ok?: boolean; result?: { runtime?: string } }).ok).toBe(true);
      expect((rpcResA.json as { result?: { runtime?: string } }).result?.runtime).toBe("rust");
      expect(rpcResB.status).toBe(200);
      expect((rpcResB.json as { ok?: boolean; result?: { runtime?: string } }).ok).toBe(true);
      expect((rpcResB.json as { result?: { runtime?: string } }).result?.runtime).toBe("rust");

      const [statusA, statusB] = await Promise.all([
        connectStatusClient(gwA),
        connectStatusClient(gwB),
      ]);
      statusA.stop();
      statusB.stop();
    },
  );

  it(
    "handles session RPCs for feishu-shaped session keys over Rust WS",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      const gw = await spawnGatewayInstance("chat-feishu-fixture");
      instances.push(gw);

      const chatClient = await connectTestGatewayWsClient({
        url: `ws://127.0.0.1:${gw.port}`,
        token: gw.gatewayToken,
        clientName: GATEWAY_CLIENT_NAMES.CLI,
        clientDisplayName: "chat-e2e-cli",
        clientVersion: "1.0.0",
        platform: "test",
        mode: GATEWAY_CLIENT_MODES.CLI,
      });
      chatClients.push(chatClient);

      const sessionKey = "agent:main:feishu:direct:123456";
      const createRes = await chatClient.request<{ ok?: boolean; key?: string }>(
        "sessions.create",
        {
          key: sessionKey,
          label: "Feishu fixture",
        },
      );
      expect(createRes.ok).toBe(true);
      expect(createRes.key).toBe(sessionKey);

      const patchRes = await chatClient.request<{ ok?: boolean; key?: string }>("sessions.patch", {
        key: sessionKey,
        label: "Feishu fixture updated",
      });
      expect(patchRes.ok).toBe(true);
      expect(patchRes.key).toBe(sessionKey);

      const resetRes = await chatClient.request<{ ok?: boolean; key?: string }>("sessions.reset", {
        key: sessionKey,
      });
      expect(resetRes.ok).toBe(true);
      expect(resetRes.key).toBe(sessionKey);
    },
  );
});
