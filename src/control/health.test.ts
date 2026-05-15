import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripAnsi } from "../terminal/ansi.js";
import { formatHealthCheckFailure } from "./health-format.js";
import type { HealthSummary } from "./health.js";
import { formatHealthChannelLines, healthCommand } from "./health.js";

const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

const defaultSessions: HealthSummary["sessions"] = {
  path: "/tmp/sessions.json",
  count: 0,
  recent: [],
};

const createMainAgentSummary = (sessions = defaultSessions) => ({
  agentId: "main",
  isDefault: true,
  mainSessionWake: {
    enabled: true,
    prompt: "hi",
    target: "last",
    ackMaxChars: 160,
  },
  sessions,
});

const createHealthSummary = (params: {
  channels: HealthSummary["channels"];
  channelOrder: string[];
  channelLabels: HealthSummary["channelLabels"];
  sessions?: HealthSummary["sessions"];
}): HealthSummary => {
  const sessions = params.sessions ?? defaultSessions;
  return {
    ok: true,
    ts: Date.now(),
    durationMs: 5,
    channels: params.channels,
    channelOrder: params.channelOrder,
    channelLabels: params.channelLabels,
    defaultAgentId: "main",
    agents: [createMainAgentSummary(sessions)],
    sessions,
  };
};

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGatewayMock(...args),
}));

describe("healthCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("outputs JSON from gateway", async () => {
    const agentSessions = {
      path: "/tmp/sessions.json",
      count: 1,
      recent: [{ key: "+1555", updatedAt: Date.now(), age: 0 }],
    };
    const snapshot = createHealthSummary({
      channels: {
        weixin: { accountId: "default", linked: true, authAgeMs: 5000 },
        feishu: {
          accountId: "default",
          configured: true,
          probe: { ok: true, elapsedMs: 1 },
        },
        qqbot: { accountId: "default", configured: false },
      },
      channelOrder: ["weixin", "feishu", "qqbot"],
      channelLabels: {
        weixin: "Weixin",
        feishu: "Feishu",
        qqbot: "QQBot",
      },
      sessions: agentSessions,
    });
    callGatewayMock.mockResolvedValueOnce(snapshot);

    await healthCommand({ json: true, timeoutMs: 5000 }, runtime as never);

    expect(runtime.exit).not.toHaveBeenCalled();
    const logged = runtime.log.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(logged) as HealthSummary;
    expect(parsed.channels.weixin?.linked).toBe(true);
    expect(parsed.channels.feishu?.configured).toBe(true);
    expect(parsed.sessions.count).toBe(1);
  });

  it("prints text summary when not json", async () => {
    callGatewayMock.mockResolvedValueOnce(
      createHealthSummary({
        channels: {
          weixin: { accountId: "default", linked: false, authAgeMs: null },
          feishu: { accountId: "default", configured: false },
          qqbot: { accountId: "default", configured: false },
        },
        channelOrder: ["weixin", "feishu", "qqbot"],
        channelLabels: {
          weixin: "Weixin",
          feishu: "Feishu",
          qqbot: "QQBot",
        },
      }),
    );

    await healthCommand({ json: false }, runtime as never);

    expect(runtime.exit).not.toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalled();
  });

  it("formats per-account probe timings", () => {
    const summary = createHealthSummary({
      channels: {
        feishu: {
          accountId: "main",
          configured: true,
          probe: { ok: true, elapsedMs: 196, bot: { username: "pinguini_ugi_bot" } },
          accounts: {
            main: {
              accountId: "main",
              configured: true,
              probe: { ok: true, elapsedMs: 196, bot: { username: "pinguini_ugi_bot" } },
            },
            flurry: {
              accountId: "flurry",
              configured: true,
              probe: { ok: true, elapsedMs: 190, bot: { username: "flurry_ugi_bot" } },
            },
            poe: {
              accountId: "poe",
              configured: true,
              probe: { ok: true, elapsedMs: 188, bot: { username: "poe_ugi_bot" } },
            },
          },
        },
      },
      channelOrder: ["feishu"],
      channelLabels: { feishu: "Feishu" },
    });

    const lines = formatHealthChannelLines(summary, { accountMode: "all" });
    expect(lines).toContain(
      "Feishu: ok (@pinguini_ugi_bot:main:196ms, @flurry_ugi_bot:flurry:190ms, @poe_ugi_bot:poe:188ms)",
    );
  });
});

describe("formatHealthCheckFailure", () => {
  it("keeps non-rich output stable", () => {
    const err = new Error("gateway closed (1006 abnormal closure): no close reason");
    expect(formatHealthCheckFailure(err, { rich: false })).toBe(
      `Health check failed: ${String(err)}`,
    );
  });

  it("formats gateway connection details as indented key/value lines", () => {
    const err = new Error(
      [
        "gateway closed (1006 abnormal closure (no close frame)): no close reason",
        "Gateway target: ws://127.0.0.1:19001",
        "Source: local loopback",
        "Config: /Users/steipete/.crawclaw-dev/crawclaw.json",
        "Bind: loopback",
      ].join("\n"),
    );

    expect(stripAnsi(formatHealthCheckFailure(err, { rich: true }))).toBe(
      [
        "Health check failed: gateway closed (1006 abnormal closure (no close frame)): no close reason",
        "  Gateway target: ws://127.0.0.1:19001",
        "  Source: local loopback",
        "  Config: /Users/steipete/.crawclaw-dev/crawclaw.json",
        "  Bind: loopback",
      ].join("\n"),
    );
  });
});
