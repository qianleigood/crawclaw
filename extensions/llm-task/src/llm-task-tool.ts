import fs from "node:fs/promises";
import path from "node:path";
import { runNativePluginOperation } from "crawclaw/plugin-sdk/native-plugin-runtime";
import { resolvePreferredCrawClawTmpDir } from "../api.js";
import type { CrawClawPluginApi } from "../api.js";

type PreparedLlmTask = {
  provider: string;
  model: string;
  authProfileId?: string;
  thinkLevel?: EmbeddedPiRunParams["thinkLevel"];
  timeoutMs: number;
  fullPrompt: string;
  workspaceDir: string;
  streamParams: Record<string, unknown>;
};

type LlmTaskResult = {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
};

type EmbeddedRunResult = {
  payloads?: Array<{ text?: string; isError?: boolean }>;
};

type EmbeddedPiRunParams = Parameters<
  CrawClawPluginApi["runtime"]["agent"]["runEmbeddedPiAgent"]
>[0];

const LlmTaskSchema = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "Task instruction for the LLM." },
    input: { description: "Optional input payload for the task." },
    schema: { description: "Optional JSON Schema to validate the returned JSON." },
    provider: { type: "string", description: "Provider override (e.g. openai-codex, anthropic)." },
    model: { type: "string", description: "Model id override." },
    thinking: { type: "string", description: "Thinking level override." },
    authProfileId: { type: "string", description: "Auth profile override." },
    temperature: { type: "number", description: "Best-effort temperature override." },
    maxTokens: { type: "number", description: "Best-effort maxTokens override." },
    timeoutMs: { type: "number", description: "Timeout for the LLM run." },
  },
  required: ["prompt"],
  additionalProperties: true,
};

function defaultModelFromConfig(api: CrawClawPluginApi): string | undefined {
  const defaultsModel = api.config?.agents?.defaults?.model;
  if (typeof defaultsModel === "string") {
    return defaultsModel.trim() || undefined;
  }
  const primary = defaultsModel?.primary;
  return typeof primary === "string" && primary.trim() ? primary.trim() : undefined;
}

function workspaceDirFromConfig(api: CrawClawPluginApi): string {
  const workspace = api.config?.agents?.defaults?.workspace;
  return typeof workspace === "string" && workspace.trim() ? workspace : process.cwd();
}

function stripNullishStreamParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== null && value !== undefined),
  );
}

export function createLlmTaskTool(api: CrawClawPluginApi) {
  return {
    name: "llm-task",
    label: "LLM Task",
    description:
      "Run a generic JSON-only LLM task and return schema-validated JSON. Designed for orchestration from Lobster workflows via crawclaw.invoke.",
    parameters: LlmTaskSchema,

    async execute(_id: string, params: Record<string, unknown>) {
      const prepared = await runNativePluginOperation<PreparedLlmTask>({
        plugin: "llm-task",
        operation: "prepare",
        input: {
          params,
          pluginConfig: api.pluginConfig ?? {},
          defaultModel: defaultModelFromConfig(api),
          workspaceDir: workspaceDirFromConfig(api),
        },
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      });

      let tmpDir: string | null = null;
      try {
        tmpDir = await fs.mkdtemp(
          path.join(resolvePreferredCrawClawTmpDir(), "crawclaw-llm-task-"),
        );
        const sessionId = `llm-task-${Date.now()}`;
        const sessionFile = path.join(tmpDir, "session.json");

        const result = (await api.runtime.agent.runEmbeddedPiAgent({
          sessionId,
          sessionFile,
          workspaceDir: prepared.workspaceDir,
          config: api.config,
          prompt: prepared.fullPrompt,
          timeoutMs: prepared.timeoutMs,
          runId: `llm-task-${Date.now()}`,
          provider: prepared.provider,
          model: prepared.model,
          authProfileId: prepared.authProfileId,
          authProfileIdSource: prepared.authProfileId ? "user" : "auto",
          thinkLevel: prepared.thinkLevel,
          streamParams: stripNullishStreamParams(prepared.streamParams),
          disableTools: true,
        })) as EmbeddedRunResult;

        return await runNativePluginOperation<LlmTaskResult>({
          plugin: "llm-task",
          operation: "complete",
          input: {
            payloads: result.payloads,
            schema: params.schema,
            provider: prepared.provider,
            model: prepared.model,
          },
          timeoutMs: prepared.timeoutMs,
        });
      } finally {
        if (tmpDir) {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    },
  };
}
