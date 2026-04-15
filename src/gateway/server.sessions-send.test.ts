import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, type Mock } from "vitest";
import { __testing as agentStepTesting } from "../agents/tools/agent-step.js";
import { __testing as sessionsSendA2ATesting } from "../agents/tools/sessions-send-tool.a2a.js";
import { createSessionsSendTool } from "../agents/tools/sessions-send-tool.js";
import { resolveSessionTranscriptPath } from "../config/sessions.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import { captureEnv } from "../test-utils/env.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { __testing as gatewayCallTesting, callGateway } from "./call.js";
import { GatewayClient } from "./client.js";
import {
  agentCommand,
  getFreePort,
  installGatewayTestHooks,
  startGatewayServer,
  testState,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startGatewayServer>>;
let gatewayPort: number;
let envSnapshot: ReturnType<typeof captureEnv>;
let pairedDeviceToken = "";
let pairedDeviceIdentityPath = "";

type SessionSendTool = ReturnType<typeof createSessionsSendTool>;
const SESSION_SEND_E2E_TIMEOUT_MS = 10_000;
let cachedSessionsSendTool: SessionSendTool | null = null;

function callGatewayCliLike<T = Record<string, unknown>>(opts: {
  method: string;
  params?: unknown;
  timeoutMs?: number;
}) {
  return callGateway<T>({
    ...opts,
    token: process.env.CRAWCLAW_GATEWAY_TOKEN,
    clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
    mode: GATEWAY_CLIENT_MODES.BACKEND,
  });
}

function getSessionsSendTool(): SessionSendTool {
  if (cachedSessionsSendTool) {
    return cachedSessionsSendTool;
  }
  cachedSessionsSendTool = createSessionsSendTool({
    callGateway: callGatewayCliLike,
  });
  return cachedSessionsSendTool;
}

async function emitLifecycleAssistantReply(params: {
  opts: unknown;
  defaultSessionId: string;
  includeTimestamp?: boolean;
  resolveText: (extraSystemPrompt?: string) => string;
}) {
  const commandParams = params.opts as {
    sessionId?: string;
    runId?: string;
    extraSystemPrompt?: string;
  };
  const sessionId = commandParams.sessionId ?? params.defaultSessionId;
  const runId = commandParams.runId ?? sessionId;
  const sessionFile = resolveSessionTranscriptPath(sessionId);
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });

  const startedAt = Date.now();
  emitAgentEvent({
    runId,
    stream: "lifecycle",
    data: { phase: "start", startedAt },
  });

  const text = params.resolveText(commandParams.extraSystemPrompt);
  const message = {
    role: "assistant",
    content: [{ type: "text", text }],
    ...(params.includeTimestamp ? { timestamp: Date.now() } : {}),
  };
  await fs.appendFile(sessionFile, `${JSON.stringify({ message })}\n`, "utf8");

  emitAgentEvent({
    runId,
    stream: "lifecycle",
    data: { phase: "end", startedAt, endedAt: Date.now() },
  });
}

beforeAll(async () => {
  envSnapshot = captureEnv(["CRAWCLAW_GATEWAY_PORT", "CRAWCLAW_GATEWAY_TOKEN"]);
  gatewayPort = await getFreePort();
  testState.gatewayAuth = { mode: "token", token: "secret" };
  process.env.CRAWCLAW_GATEWAY_PORT = String(gatewayPort);
  process.env.CRAWCLAW_GATEWAY_TOKEN = "secret";
  agentStepTesting.setDepsForTest({ callGateway: callGatewayCliLike });
  sessionsSendA2ATesting.setDepsForTest({ callGateway: callGatewayCliLike });
  server = await startGatewayServer(gatewayPort);

  const { loadOrCreateDeviceIdentity, publicKeyRawBase64UrlFromPem } =
    await import("../infra/device-identity.js");
  const { getPairedDevice, requestDevicePairing, approveDevicePairing } =
    await import("../infra/device-pairing.js");
  pairedDeviceIdentityPath = path.join(
    process.env.CRAWCLAW_STATE_DIR ?? process.cwd(),
    "test-device-identities",
    "sessions-send-backend.json",
  );
  const identity = loadOrCreateDeviceIdentity(pairedDeviceIdentityPath);
  const pending = await requestDevicePairing({
    deviceId: identity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
    clientId: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
    clientMode: GATEWAY_CLIENT_MODES.BACKEND,
    role: "operator",
    scopes: ["operator.admin"],
  });
  await approveDevicePairing(pending.request.requestId, {
    callerScopes: ["operator.admin"],
  });
  pairedDeviceToken = (await getPairedDevice(identity.deviceId))?.tokens?.operator?.token ?? "";
  gatewayCallTesting.setDepsForTests({
    createGatewayClient: (opts) =>
      new GatewayClient({
        ...opts,
        deviceToken: pairedDeviceToken,
        deviceIdentity: loadOrCreateDeviceIdentity(pairedDeviceIdentityPath),
      }),
  });
});

afterAll(async () => {
  gatewayCallTesting.resetDepsForTests();
  agentStepTesting.setDepsForTest();
  sessionsSendA2ATesting.setDepsForTest();
  await server.close();
  envSnapshot.restore();
});

describe("sessions_send gateway loopback", () => {
  it("returns reply when lifecycle ends before agent.wait", async () => {
    const spy = agentCommand as unknown as Mock<(opts: unknown) => Promise<void>>;
    spy.mockImplementation(async (opts: unknown) =>
      emitLifecycleAssistantReply({
        opts,
        defaultSessionId: "main",
        includeTimestamp: true,
        resolveText: (extraSystemPrompt) => {
          if (extraSystemPrompt?.includes("Agent-to-agent reply step")) {
            return "REPLY_SKIP";
          }
          if (extraSystemPrompt?.includes("Agent-to-agent announce step")) {
            return "ANNOUNCE_SKIP";
          }
          return "pong";
        },
      }),
    );

    const tool = getSessionsSendTool();

    const result = await tool.execute("call-loopback", {
      sessionKey: "main",
      message: "ping",
      timeoutSeconds: 5,
    });
    const details = result.details as {
      status?: string;
      reply?: string;
      sessionKey?: string;
    };
    expect(details.status).toBe("ok");
    expect(details.reply).toBe("pong");
    expect(details.sessionKey).toBe("main");

    const firstCall = spy.mock.calls[0]?.[0] as
      | { lane?: string; inputProvenance?: { kind?: string; sourceTool?: string } }
      | undefined;
    expect(firstCall?.lane).toBe("nested");
    expect(firstCall?.inputProvenance).toMatchObject({
      kind: "inter_session",
      sourceTool: "sessions_send",
    });
  });
});

describe("sessions_send label lookup", () => {
  it(
    "finds session by label and sends message",
    { timeout: SESSION_SEND_E2E_TIMEOUT_MS },
    async () => {
      // This is an operator feature; enable broader session tool targeting for this test.
      const configPath = process.env.CRAWCLAW_CONFIG_PATH;
      if (!configPath) {
        throw new Error("CRAWCLAW_CONFIG_PATH missing in gateway test environment");
      }
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ tools: { sessions: { visibility: "all" } } }, null, 2) + "\n",
        "utf-8",
      );

      const spy = agentCommand as unknown as Mock<(opts: unknown) => Promise<void>>;
      spy.mockImplementation(async (opts: unknown) =>
        emitLifecycleAssistantReply({
          opts,
          defaultSessionId: "test-labeled",
          resolveText: () => "labeled response",
        }),
      );

      // First, create a session with a label via sessions.patch
      await callGatewayCliLike({
        method: "sessions.patch",
        params: { key: "test-labeled-session", label: "my-test-worker" },
        timeoutMs: 5000,
      });

      const tool = createSessionsSendTool({
        config: {
          tools: {
            sessions: {
              visibility: "all",
            },
          },
        },
        callGateway: callGatewayCliLike,
      });

      // Send using label instead of sessionKey
      const result = await tool.execute("call-by-label", {
        label: "my-test-worker",
        message: "hello labeled session",
        timeoutSeconds: 5,
      });
      const details = result.details as {
        status?: string;
        reply?: string;
        sessionKey?: string;
      };
      expect(details.status).toBe("ok");
      expect(details.reply).toBe("labeled response");
      expect(details.sessionKey).toBe("agent:main:test-labeled-session");
    },
  );
});
