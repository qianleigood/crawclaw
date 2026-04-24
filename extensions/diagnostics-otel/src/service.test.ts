import { beforeEach, describe, expect, test, vi } from "vitest";

const registerLogTransportMock = vi.hoisted(() => vi.fn());

const telemetryState = vi.hoisted(() => {
  const counters = new Map<string, { add: ReturnType<typeof vi.fn> }>();
  const histograms = new Map<string, { record: ReturnType<typeof vi.fn> }>();
  const tracer = {
    startSpan: vi.fn((_name: string, _opts?: unknown, _ctx?: unknown) => ({
      end: vi.fn(),
      setStatus: vi.fn(),
    })),
    setSpanContext: vi.fn((ctx: Record<string, unknown>, spanContext: Record<string, unknown>) => ({
      ...ctx,
      spanContext,
    })),
  };
  const meter = {
    createCounter: vi.fn((name: string) => {
      const counter = { add: vi.fn() };
      counters.set(name, counter);
      return counter;
    }),
    createHistogram: vi.fn((name: string) => {
      const histogram = { record: vi.fn() };
      histograms.set(name, histogram);
      return histogram;
    }),
  };
  return { counters, histograms, tracer, meter };
});

const sdkStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const sdkShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const logEmit = vi.hoisted(() => vi.fn());
const logShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const traceExporterCtor = vi.hoisted(() => vi.fn());

vi.mock("@opentelemetry/api", () => ({
  context: {
    active: () => ({ active: true }),
  },
  metrics: {
    getMeter: () => telemetryState.meter,
  },
  trace: {
    getTracer: () => telemetryState.tracer,
    setSpanContext: telemetryState.tracer.setSpanContext,
  },
  SpanStatusCode: {
    ERROR: 2,
  },
  TraceFlags: {
    SAMPLED: 1,
  },
}));

vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    start = sdkStart;
    shutdown = sdkShutdown;
  },
}));

vi.mock("@opentelemetry/exporter-metrics-otlp-proto", () => ({
  OTLPMetricExporter: class {},
}));

vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: class {
    constructor(options?: unknown) {
      traceExporterCtor(options);
    }
  },
}));

vi.mock("@opentelemetry/exporter-logs-otlp-proto", () => ({
  OTLPLogExporter: class {},
}));

vi.mock("@opentelemetry/sdk-logs", () => ({
  BatchLogRecordProcessor: class {},
  LoggerProvider: class {
    getLogger = vi.fn(() => ({
      emit: logEmit,
    }));
    shutdown = logShutdown;
  },
}));

vi.mock("@opentelemetry/sdk-metrics", () => ({
  PeriodicExportingMetricReader: class {},
}));

vi.mock("@opentelemetry/sdk-trace-base", () => ({
  ParentBasedSampler: class {},
  TraceIdRatioBasedSampler: class {},
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: vi.fn((attrs: Record<string, unknown>) => attrs),
  Resource: class {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(_value?: unknown) {}
  },
}));

vi.mock("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
}));

vi.mock("../api.js", async () => {
  const actual = await vi.importActual<typeof import("../api.js")>("../api.js");
  return {
    ...actual,
    registerLogTransport: registerLogTransportMock,
  };
});

import type { CrawClawPluginServiceContext } from "../api.js";
import { createObservationRoot, emitDiagnosticEvent } from "../api.js";
import { createDiagnosticsOtelService } from "./service.js";

const OTEL_TEST_STATE_DIR = "/tmp/crawclaw-diagnostics-otel-test";
const OTEL_TEST_ENDPOINT = "http://otel-collector:4318";
const OTEL_TEST_PROTOCOL = "http/protobuf";

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

type OtelContextFlags = {
  traces?: boolean;
  metrics?: boolean;
  logs?: boolean;
};
function createOtelContext(
  endpoint: string,
  { traces = false, metrics = false, logs = false }: OtelContextFlags = {},
): CrawClawPluginServiceContext {
  return {
    config: {
      diagnostics: {
        enabled: true,
        otel: {
          enabled: true,
          endpoint,
          protocol: OTEL_TEST_PROTOCOL,
          traces,
          metrics,
          logs,
        },
      },
    },
    logger: createLogger(),
    stateDir: OTEL_TEST_STATE_DIR,
  };
}

function createTraceOnlyContext(endpoint: string): CrawClawPluginServiceContext {
  return createOtelContext(endpoint, { traces: true });
}

function testObservation(
  input: Parameters<typeof createObservationRoot>[0] = {
    source: "diagnostics-otel-test",
    runtime: { sessionId: "session-1" },
  },
) {
  return createObservationRoot(input);
}

type RegisteredLogTransport = (logObj: Record<string, unknown>) => void;
function setupRegisteredTransports() {
  const registeredTransports: RegisteredLogTransport[] = [];
  const stopTransport = vi.fn();
  registerLogTransportMock.mockImplementation((transport) => {
    registeredTransports.push(transport);
    return stopTransport;
  });
  return { registeredTransports, stopTransport };
}

async function emitAndCaptureLog(logObj: Record<string, unknown>) {
  const { registeredTransports } = setupRegisteredTransports();
  const service = createDiagnosticsOtelService();
  const ctx = createOtelContext(OTEL_TEST_ENDPOINT, { logs: true });
  await service.start(ctx);
  expect(registeredTransports).toHaveLength(1);
  registeredTransports[0]?.(logObj);
  expect(logEmit).toHaveBeenCalled();
  const emitCall = logEmit.mock.calls[0]?.[0];
  await service.stop?.(ctx);
  return emitCall;
}

describe("diagnostics-otel service", () => {
  beforeEach(() => {
    telemetryState.counters.clear();
    telemetryState.histograms.clear();
    telemetryState.tracer.startSpan.mockClear();
    telemetryState.tracer.setSpanContext.mockClear();
    telemetryState.meter.createCounter.mockClear();
    telemetryState.meter.createHistogram.mockClear();
    sdkStart.mockClear();
    sdkShutdown.mockClear();
    logEmit.mockClear();
    logShutdown.mockClear();
    traceExporterCtor.mockClear();
    registerLogTransportMock.mockReset();
  });

  test("records message-flow metrics and spans", async () => {
    const { registeredTransports } = setupRegisteredTransports();

    const service = createDiagnosticsOtelService();
    const ctx = createOtelContext(OTEL_TEST_ENDPOINT, { traces: true, metrics: true, logs: true });
    await service.start(ctx);

    emitDiagnosticEvent({
      type: "webhook.received",
      observation: testObservation({ source: "webhook", runtime: { sessionId: "session-1" } }),
      channel: "telegram",
      updateType: "telegram-post",
    });
    emitDiagnosticEvent({
      type: "webhook.processed",
      observation: testObservation({ source: "webhook", runtime: { sessionId: "session-1" } }),
      channel: "telegram",
      updateType: "telegram-post",
      durationMs: 120,
    });
    emitDiagnosticEvent({
      type: "message.queued",
      observation: testObservation({ source: "message", runtime: { sessionId: "session-1" } }),
      channel: "telegram",
      source: "telegram",
      queueDepth: 2,
    });
    emitDiagnosticEvent({
      type: "message.processed",
      observation: testObservation({
        source: "message",
        runtime: {
          runId: "run-1",
          sessionId: "session-1",
          sessionKey: "session-key-1",
          agentId: "agent-1",
        },
        trace: {
          traceId: "run-loop:run-1",
          spanId: "span-message-1",
          parentSpanId: "root:run-loop:run-1",
        },
      }),
      channel: "telegram",
      outcome: "completed",
      durationMs: 55,
    });
    emitDiagnosticEvent({
      type: "queue.lane.dequeue",
      observation: testObservation({ source: "queue", runtime: { sessionId: "session-1" } }),
      lane: "main",
      queueSize: 3,
      waitMs: 10,
    });
    emitDiagnosticEvent({
      type: "session.stuck",
      observation: testObservation({ source: "session", runtime: { sessionId: "session-1" } }),
      state: "processing",
      ageMs: 125_000,
    });
    emitDiagnosticEvent({
      type: "run.attempt",
      observation: testObservation({
        source: "run",
        runtime: { runId: "run-1", sessionId: "session-1" },
      }),
      runId: "run-1",
      attempt: 2,
    });

    expect(telemetryState.counters.get("crawclaw.webhook.received")?.add).toHaveBeenCalled();
    expect(
      telemetryState.histograms.get("crawclaw.webhook.duration_ms")?.record,
    ).toHaveBeenCalled();
    expect(telemetryState.counters.get("crawclaw.message.queued")?.add).toHaveBeenCalled();
    expect(telemetryState.counters.get("crawclaw.message.processed")?.add).toHaveBeenCalled();
    expect(
      telemetryState.histograms.get("crawclaw.message.duration_ms")?.record,
    ).toHaveBeenCalled();
    expect(telemetryState.histograms.get("crawclaw.queue.wait_ms")?.record).toHaveBeenCalled();
    expect(telemetryState.counters.get("crawclaw.session.stuck")?.add).toHaveBeenCalled();
    expect(
      telemetryState.histograms.get("crawclaw.session.stuck_age_ms")?.record,
    ).toHaveBeenCalled();
    expect(telemetryState.counters.get("crawclaw.run.attempt")?.add).toHaveBeenCalled();

    const spanNames = telemetryState.tracer.startSpan.mock.calls.map((call) => call[0]);
    expect(spanNames).toContain("crawclaw.webhook.processed");
    expect(spanNames).toContain("crawclaw.message.processed");
    expect(spanNames).toContain("crawclaw.session.stuck");
    const messageSpanCall = telemetryState.tracer.startSpan.mock.calls.find(
      (call) => call[0] === "crawclaw.message.processed",
    );
    expect(messageSpanCall?.[1]).toEqual(
      expect.objectContaining({
        attributes: expect.objectContaining({
          "crawclaw.traceId": "run-loop:run-1",
          "crawclaw.spanId": "span-message-1",
          "crawclaw.parentSpanId": "root:run-loop:run-1",
          "crawclaw.runId": "run-1",
          "crawclaw.sessionId": "session-1",
          "crawclaw.sessionKey": "session-key-1",
          "crawclaw.agentId": "agent-1",
        }),
      }),
    );
    expect(messageSpanCall?.[2]).toEqual(
      expect.objectContaining({
        spanContext: expect.objectContaining({
          traceId: "5f00af73e8c20a4c4fd1f85efc4ce7a8",
          spanId: "215ea94ab6e4d36f",
          traceFlags: 1,
          isRemote: false,
        }),
      }),
    );

    expect(registerLogTransportMock).toHaveBeenCalledTimes(1);
    expect(registeredTransports).toHaveLength(1);
    registeredTransports[0]?.({
      0: '{"subsystem":"diagnostic"}',
      1: "hello",
      _meta: { logLevelName: "INFO", date: new Date() },
    });
    expect(logEmit).toHaveBeenCalled();

    await service.stop?.(ctx);
  });

  test("records run lifecycle spans with shared trace attributes", async () => {
    const service = createDiagnosticsOtelService();
    const ctx = createOtelContext(OTEL_TEST_ENDPOINT, { traces: true, metrics: true });
    await service.start(ctx);

    emitDiagnosticEvent({
      type: "run.lifecycle",
      phase: "provider_request_start",
      observation: testObservation({
        source: "run-loop",
        runtime: {
          runId: "run-1",
          sessionId: "session-1",
          sessionKey: "session-key-1",
          agentId: "agent-1",
        },
        phase: "provider_request_start",
        decisionCode: "provider_request",
        trace: {
          traceId: "run-loop:run-1",
          spanId: "span-provider-1",
          parentSpanId: "root:run-loop:run-1",
        },
      }),
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "session-key-1",
      agentId: "agent-1",
      isTopLevel: true,
      decision: { code: "provider_request" },
      metrics: { durationMs: 17 },
      refs: { provider: "openai" },
    });

    expect(telemetryState.tracer.startSpan).toHaveBeenCalledWith(
      "crawclaw.run.lifecycle.provider_request_start",
      expect.objectContaining({
        attributes: expect.objectContaining({
          "crawclaw.traceId": "run-loop:run-1",
          "crawclaw.spanId": "span-provider-1",
          "crawclaw.parentSpanId": "root:run-loop:run-1",
          "crawclaw.runId": "run-1",
          "crawclaw.sessionId": "session-1",
          "crawclaw.sessionKey": "session-key-1",
          "crawclaw.agentId": "agent-1",
          "crawclaw.lifecycle.phase": "provider_request_start",
          "crawclaw.decisionCode": "provider_request",
          "crawclaw.refs.provider": "openai",
        }),
        startTime: expect.any(Number),
      }),
      expect.objectContaining({
        spanContext: expect.objectContaining({
          traceId: "5f00af73e8c20a4c4fd1f85efc4ce7a8",
          spanId: "215ea94ab6e4d36f",
          traceFlags: 1,
        }),
      }),
    );

    await service.stop?.(ctx);
  });

  test("records channel streaming decision metrics and spans", async () => {
    const service = createDiagnosticsOtelService();
    const ctx = createOtelContext(OTEL_TEST_ENDPOINT, { traces: true, metrics: true });
    await service.start(ctx);

    emitDiagnosticEvent({
      type: "channel.streaming.decision",
      observation: testObservation({
        source: "channel.feishu",
        runtime: {
          sessionId: "session-1",
          sessionKey: "session-key-1",
        },
      }),
      channel: "feishu",
      accountId: "account-1",
      sessionKey: "session-key-1",
      sessionId: "session-1",
      chatId: "chat-1",
      enabled: true,
      surface: "card_stream",
      reason: "enabled",
    });

    expect(
      telemetryState.counters.get("crawclaw.channel.streaming.decision")?.add,
    ).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        "crawclaw.channel": "feishu",
        "crawclaw.streaming.surface": "card_stream",
        "crawclaw.streaming.reason": "enabled",
        "crawclaw.streaming.enabled": "true",
      }),
    );

    expect(telemetryState.tracer.startSpan).toHaveBeenCalledWith(
      "crawclaw.channel.streaming.decision",
      expect.objectContaining({
        attributes: expect.objectContaining({
          "crawclaw.channel": "feishu",
          "crawclaw.streaming.surface": "card_stream",
          "crawclaw.streaming.reason": "enabled",
          "crawclaw.streaming.enabled": "true",
          "crawclaw.accountId": "account-1",
          "crawclaw.sessionKey": "session-key-1",
          "crawclaw.sessionId": "session-1",
          "crawclaw.chatId": "chat-1",
        }),
      }),
      expect.objectContaining({
        spanContext: expect.objectContaining({
          traceFlags: 1,
        }),
      }),
    );

    await service.stop?.(ctx);
  });

  test("appends signal path when endpoint contains non-signal /v1 segment", async () => {
    const service = createDiagnosticsOtelService();
    const ctx = createTraceOnlyContext("https://www.comet.com/opik/api/v1/private/otel");
    await service.start(ctx);

    const options = traceExporterCtor.mock.calls[0]?.[0] as { url?: string } | undefined;
    expect(options?.url).toBe("https://www.comet.com/opik/api/v1/private/otel/v1/traces");
    await service.stop?.(ctx);
  });

  test("keeps already signal-qualified endpoint unchanged", async () => {
    const service = createDiagnosticsOtelService();
    const ctx = createTraceOnlyContext("https://collector.example.com/v1/traces");
    await service.start(ctx);

    const options = traceExporterCtor.mock.calls[0]?.[0] as { url?: string } | undefined;
    expect(options?.url).toBe("https://collector.example.com/v1/traces");
    await service.stop?.(ctx);
  });

  test("keeps signal-qualified endpoint unchanged when it has query params", async () => {
    const service = createDiagnosticsOtelService();
    const ctx = createTraceOnlyContext("https://collector.example.com/v1/traces?timeout=30s");
    await service.start(ctx);

    const options = traceExporterCtor.mock.calls[0]?.[0] as { url?: string } | undefined;
    expect(options?.url).toBe("https://collector.example.com/v1/traces?timeout=30s");
    await service.stop?.(ctx);
  });

  test("keeps signal-qualified endpoint unchanged when signal path casing differs", async () => {
    const service = createDiagnosticsOtelService();
    const ctx = createTraceOnlyContext("https://collector.example.com/v1/Traces");
    await service.start(ctx);

    const options = traceExporterCtor.mock.calls[0]?.[0] as { url?: string } | undefined;
    expect(options?.url).toBe("https://collector.example.com/v1/Traces");
    await service.stop?.(ctx);
  });

  test("redacts sensitive data from log messages before export", async () => {
    const emitCall = await emitAndCaptureLog({
      0: "Using API key sk-1234567890abcdef1234567890abcdef",
      _meta: { logLevelName: "INFO", date: new Date() },
    });

    expect(emitCall?.body).not.toContain("sk-1234567890abcdef1234567890abcdef");
    expect(emitCall?.body).toContain("sk-123");
    expect(emitCall?.body).toContain("…");
  });

  test("redacts sensitive data from log attributes before export", async () => {
    const emitCall = await emitAndCaptureLog({
      0: '{"token":"ghp_abcdefghijklmnopqrstuvwxyz123456"}', // pragma: allowlist secret
      1: "auth configured",
      _meta: { logLevelName: "DEBUG", date: new Date() },
    });

    const tokenAttr = emitCall?.attributes?.["crawclaw.token"];
    expect(tokenAttr).not.toBe("ghp_abcdefghijklmnopqrstuvwxyz123456"); // pragma: allowlist secret
    if (typeof tokenAttr === "string") {
      expect(tokenAttr).toContain("…");
    }
  });

  test("redacts sensitive reason in session.state metric attributes", async () => {
    const service = createDiagnosticsOtelService();
    const ctx = createOtelContext(OTEL_TEST_ENDPOINT, { metrics: true });
    await service.start(ctx);

    emitDiagnosticEvent({
      type: "session.state",
      observation: testObservation({ source: "session", runtime: { sessionId: "session-1" } }),
      state: "waiting",
      reason: "token=ghp_abcdefghijklmnopqrstuvwxyz123456", // pragma: allowlist secret
    });

    const sessionCounter = telemetryState.counters.get("crawclaw.session.state");
    expect(sessionCounter?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        "crawclaw.reason": expect.stringContaining("…"),
      }),
    );
    const attrs = sessionCounter?.add.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(typeof attrs?.["crawclaw.reason"]).toBe("string");
    expect(String(attrs?.["crawclaw.reason"])).not.toContain(
      "ghp_abcdefghijklmnopqrstuvwxyz123456", // pragma: allowlist secret
    );
    await service.stop?.(ctx);
  });

  test("keeps high-cardinality observation ids out of metric attributes", async () => {
    const service = createDiagnosticsOtelService();
    const ctx = createOtelContext(OTEL_TEST_ENDPOINT, { metrics: true });
    await service.start(ctx);

    emitDiagnosticEvent({
      type: "message.processed",
      observation: testObservation({
        source: "message",
        runtime: {
          runId: "run-metric-1",
          sessionId: "session-metric-1",
          sessionKey: "session-key-metric-1",
        },
        trace: {
          traceId: "run-loop:run-metric-1",
          spanId: "span-metric-1",
          parentSpanId: "root:run-loop:run-metric-1",
        },
      }),
      channel: "telegram",
      outcome: "completed",
      durationMs: 12,
    });

    const attrs = telemetryState.counters.get("crawclaw.message.processed")?.add.mock
      .calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(attrs).toBeDefined();
    expect(attrs).not.toHaveProperty("crawclaw.traceId");
    expect(attrs).not.toHaveProperty("crawclaw.spanId");
    expect(attrs).not.toHaveProperty("crawclaw.parentSpanId");
    expect(attrs).not.toHaveProperty("crawclaw.runId");
    expect(attrs).not.toHaveProperty("crawclaw.sessionId");
    expect(attrs).not.toHaveProperty("crawclaw.sessionKey");

    await service.stop?.(ctx);
  });
});
