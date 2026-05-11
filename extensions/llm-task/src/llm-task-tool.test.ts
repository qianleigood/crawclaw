import { describe, it, expect, vi, beforeEach } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  runNativePluginOperation: vi.fn(),
}));

vi.mock("crawclaw/plugin-sdk/native-plugin-runtime", () => ({
  runNativePluginOperation: nativeMocks.runNativePluginOperation,
}));

vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return {
    ...actual,
    resolvePreferredCrawClawTmpDir: () => "/tmp",
  };
});

import type { CrawClawPluginApi } from "../api.js";
import { createLlmTaskTool } from "./llm-task-tool.js";

type EmbeddedRunParams = Parameters<CrawClawPluginApi["runtime"]["agent"]["runEmbeddedPiAgent"]>[0];
type EmbeddedRunResult = Awaited<
  ReturnType<CrawClawPluginApi["runtime"]["agent"]["runEmbeddedPiAgent"]>
>;

const runEmbeddedPiAgent = vi.fn(
  async (_params: EmbeddedRunParams): Promise<EmbeddedRunResult> => ({
    meta: { durationMs: 0 },
    payloads: [{ text: "{}" }],
  }),
);

type FakeApiOverrides = {
  config?: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
};

function normalizeThinkLevel(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "on") {
    return "low";
  }
  return ["off", "minimal", "low", "medium", "high", "adaptive", "xhigh"].includes(normalized)
    ? normalized
    : undefined;
}

function defaultModelPair(defaultModel: unknown) {
  const raw =
    typeof defaultModel === "string"
      ? defaultModel
      : typeof (defaultModel as { primary?: unknown } | undefined)?.primary === "string"
        ? (defaultModel as { primary: string }).primary
        : "";
  const [provider, ...modelParts] = raw.split("/");
  const model = modelParts.join("/");
  return provider && model ? { provider, model } : {};
}

function configureNativeMock() {
  nativeMocks.runNativePluginOperation.mockImplementation(
    async (options: { operation: string; input: Record<string, unknown> }) => {
      if (options.operation === "prepare") {
        const params = options.input.params as Record<string, unknown>;
        const pluginConfig = options.input.pluginConfig as Record<string, unknown>;
        const defaults = defaultModelPair(options.input.defaultModel);
        const provider =
          (typeof params.provider === "string" && params.provider.trim()) ||
          (typeof pluginConfig.defaultProvider === "string" &&
            pluginConfig.defaultProvider.trim()) ||
          defaults.provider;
        const model =
          (typeof params.model === "string" && params.model.trim()) ||
          (typeof pluginConfig.defaultModel === "string" && pluginConfig.defaultModel.trim()) ||
          defaults.model;
        if (!provider || !model) {
          throw new Error("provider/model could not be resolved");
        }
        if (typeof params.prompt !== "string" || !params.prompt.trim()) {
          throw new Error("prompt required");
        }
        const allowedModels = Array.isArray(pluginConfig.allowedModels)
          ? pluginConfig.allowedModels
          : [];
        const modelKey = `${provider}/${model}`;
        if (allowedModels.length > 0 && !allowedModels.includes(modelKey)) {
          throw new Error(`Model not allowed by llm-task plugin config: ${modelKey}`);
        }
        const thinkLevel =
          typeof params.thinking === "string" && params.thinking.trim()
            ? normalizeThinkLevel(params.thinking)
            : undefined;
        if (typeof params.thinking === "string" && params.thinking.trim() && !thinkLevel) {
          throw new Error(`Invalid thinking level "${params.thinking}".`);
        }
        if (thinkLevel === "xhigh") {
          throw new Error(
            'Thinking level "xhigh" is only supported for xhigh-capable OpenAI models.',
          );
        }
        return {
          provider,
          model,
          thinkLevel,
          timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : 30_000,
          fullPrompt: `TASK:\n${params.prompt}`,
          workspaceDir: options.input.workspaceDir,
          streamParams: {
            temperature: params.temperature ?? null,
            maxTokens: params.maxTokens ?? pluginConfig.maxTokens ?? null,
          },
        };
      }
      if (options.operation === "complete") {
        const input = options.input as {
          payloads?: Array<{ text?: string; isError?: boolean }>;
          schema?: unknown;
          provider?: string;
          model?: string;
        };
        const text = (input.payloads ?? [])
          .filter((payload) => payload.isError !== true)
          .map((payload) => payload.text ?? "")
          .join("\n")
          .trim();
        const raw = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error("LLM returned invalid JSON");
        }
        if (
          input.schema &&
          typeof input.schema === "object" &&
          !Array.isArray(input.schema) &&
          (input.schema as { properties?: Record<string, { type?: string }> }).properties?.foo
            ?.type === "string" &&
          typeof (parsed as { foo?: unknown }).foo !== "string"
        ) {
          throw new Error("LLM JSON did not match schema: /foo must be string");
        }
        return {
          content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }],
          details: { json: parsed, provider: input.provider, model: input.model },
        };
      }
      throw new Error(`unexpected native operation ${options.operation}`);
    },
  );
}

function fakeApi(overrides: FakeApiOverrides = {}): CrawClawPluginApi {
  return {
    id: "llm-task",
    name: "llm-task",
    source: "test",
    config: {
      agents: { defaults: { workspace: "/tmp", model: { primary: "openai-codex/gpt-5.2" } } },
    },
    pluginConfig: {},
    runtime: {
      version: "test",
      agent: {
        runEmbeddedPiAgent,
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registerTool() {},
    ...overrides,
  } as unknown as CrawClawPluginApi;
}

function mockEmbeddedRunJson(payload: unknown) {
  runEmbeddedPiAgent.mockResolvedValueOnce({
    meta: { durationMs: 0 },
    payloads: [{ text: JSON.stringify(payload) }],
  });
}

async function executeEmbeddedRun(input: Record<string, unknown>) {
  const tool = createLlmTaskTool(fakeApi());
  await tool.execute("id", input);
  return runEmbeddedPiAgent.mock.calls[0]?.[0];
}

describe("llm-task tool (json-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureNativeMock();
  });

  it("returns parsed json from the native completion path", async () => {
    runEmbeddedPiAgent.mockResolvedValueOnce({
      meta: { durationMs: 0 },
      payloads: [{ text: JSON.stringify({ foo: "bar" }) }],
    });
    const tool = createLlmTaskTool(fakeApi());
    const res = await tool.execute("id", { prompt: "return foo" });
    expect(res.details.json).toEqual({ foo: "bar" });
    expect(nativeMocks.runNativePluginOperation).toHaveBeenCalledWith(
      expect.objectContaining({ plugin: "llm-task", operation: "prepare" }),
    );
    expect(nativeMocks.runNativePluginOperation).toHaveBeenCalledWith(
      expect.objectContaining({ plugin: "llm-task", operation: "complete" }),
    );
  });

  it("strips fenced json", async () => {
    runEmbeddedPiAgent.mockResolvedValueOnce({
      meta: { durationMs: 0 },
      payloads: [{ text: '```json\n{"ok":true}\n```' }],
    });
    const tool = createLlmTaskTool(fakeApi());
    const res = await tool.execute("id", { prompt: "return ok" });
    expect(res.details.json).toEqual({ ok: true });
  });

  it("validates schema", async () => {
    runEmbeddedPiAgent.mockResolvedValueOnce({
      meta: { durationMs: 0 },
      payloads: [{ text: JSON.stringify({ foo: "bar" }) }],
    });
    const tool = createLlmTaskTool(fakeApi());
    const schema = {
      type: "object",
      properties: { foo: { type: "string" } },
      required: ["foo"],
      additionalProperties: false,
    };
    const res = await tool.execute("id", { prompt: "return foo", schema });
    expect(res.details.json).toEqual({ foo: "bar" });
  });

  it("throws on invalid json", async () => {
    runEmbeddedPiAgent.mockResolvedValueOnce({
      meta: { durationMs: 0 },
      payloads: [{ text: "not-json" }],
    });
    const tool = createLlmTaskTool(fakeApi());
    await expect(tool.execute("id", { prompt: "x" })).rejects.toThrow(/invalid json/i);
  });

  it("throws on schema mismatch", async () => {
    runEmbeddedPiAgent.mockResolvedValueOnce({
      meta: { durationMs: 0 },
      payloads: [{ text: JSON.stringify({ foo: 1 }) }],
    });
    const tool = createLlmTaskTool(fakeApi());
    const schema = { type: "object", properties: { foo: { type: "string" } }, required: ["foo"] };
    await expect(tool.execute("id", { prompt: "x", schema })).rejects.toThrow(/match schema/i);
  });

  it("passes provider/model overrides to embedded runner", async () => {
    mockEmbeddedRunJson({ ok: true });
    const call = await executeEmbeddedRun({
      prompt: "x",
      provider: "anthropic",
      model: "claude-4-sonnet",
    });
    expect(call?.provider).toBe("anthropic");
    expect(call?.model).toBe("claude-4-sonnet");
  });

  it("passes thinking override to embedded runner", async () => {
    mockEmbeddedRunJson({ ok: true });
    const call = await executeEmbeddedRun({ prompt: "x", thinking: "high" });
    expect(call?.thinkLevel).toBe("high");
  });

  it("normalizes thinking aliases", async () => {
    mockEmbeddedRunJson({ ok: true });
    const call = await executeEmbeddedRun({ prompt: "x", thinking: "on" });
    expect(call?.thinkLevel).toBe("low");
  });

  it("throws on invalid thinking level", async () => {
    const tool = createLlmTaskTool(fakeApi());
    await expect(tool.execute("id", { prompt: "x", thinking: "banana" })).rejects.toThrow(
      /invalid thinking level/i,
    );
    expect(runEmbeddedPiAgent).not.toHaveBeenCalled();
  });

  it("throws on unsupported xhigh thinking level", async () => {
    const tool = createLlmTaskTool(fakeApi());
    await expect(tool.execute("id", { prompt: "x", thinking: "xhigh" })).rejects.toThrow(
      /only supported/i,
    );
  });

  it("does not pass thinkLevel when thinking is omitted", async () => {
    mockEmbeddedRunJson({ ok: true });
    const call = await executeEmbeddedRun({ prompt: "x" });
    expect(call?.thinkLevel).toBeUndefined();
  });

  it("enforces allowedModels", async () => {
    mockEmbeddedRunJson({ ok: true });
    const tool = createLlmTaskTool(
      fakeApi({ pluginConfig: { allowedModels: ["openai-codex/gpt-5.2"] } }),
    );
    await expect(
      tool.execute("id", { prompt: "x", provider: "anthropic", model: "claude-4-sonnet" }),
    ).rejects.toThrow(/not allowed/i);
  });

  it("disables tools for embedded run", async () => {
    mockEmbeddedRunJson({ ok: true });
    const call = await executeEmbeddedRun({ prompt: "x" });
    expect(call?.disableTools).toBe(true);
  });
});
