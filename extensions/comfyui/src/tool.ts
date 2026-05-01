import { Type } from "@sinclair/typebox";
import {
  jsonResult,
  readStringParam,
  ToolInputError,
  type AnyAgentTool,
  type CrawClawPluginToolContext,
} from "../runtime-api.js";
import { normalizeNodeCatalog } from "./catalog.js";
import { ComfyUiClient } from "./client.js";
import { compileGraphIrToPrompt } from "./compiler.js";
import { resolveComfyUiConfig, type ComfyUiResolvedConfig } from "./config.js";
import { isRecord, parseGraphIr, type ComfyGraphIr } from "./graph-ir.js";
import { collectOutputArtifacts, downloadOutputArtifacts } from "./outputs.js";
import { createGraphPlan } from "./planner.js";
import { repairGraphIr } from "./repair.js";
import {
  appendWorkflowRunRecord,
  loadWorkflowArtifacts,
  saveWorkflowArtifacts,
  type ComfyRunStatus,
} from "./store.js";
import { validateGraphIr } from "./validator.js";

type ToolDeps = {
  pluginConfig?: Record<string, unknown>;
  createClient?: (config: ComfyUiResolvedConfig) => ComfyUiClient;
};

const ActionSchema = Type.Object({
  action: Type.String(),
  refresh: Type.Optional(Type.Boolean()),
  query: Type.Optional(Type.String()),
  mediaKind: Type.Optional(Type.String()),
  intent: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
  goal: Type.Optional(Type.String()),
  candidateIr: Type.Optional(Type.Unknown()),
  inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  save: Type.Optional(Type.Boolean()),
  workflowId: Type.Optional(Type.String()),
  ir: Type.Optional(Type.Unknown()),
  diagnostics: Type.Optional(Type.Array(Type.Unknown())),
  waitForCompletion: Type.Optional(Type.Boolean()),
  downloadOutputs: Type.Optional(Type.Boolean()),
  promptId: Type.Optional(Type.String()),
  download: Type.Optional(Type.Boolean()),
  prompt: Type.Optional(Type.Unknown()),
});

function createClient(config: ComfyUiResolvedConfig, deps?: ToolDeps): ComfyUiClient {
  return (
    deps?.createClient?.(config) ??
    new ComfyUiClient({ baseUrl: config.baseUrl, requestTimeoutMs: config.requestTimeoutMs })
  );
}

async function loadCatalog(client: Pick<ComfyUiClient, "getObjectInfo">) {
  return normalizeNodeCatalog(await client.getObjectInfo());
}

function requireIr(value: unknown): ComfyGraphIr {
  const ir = parseGraphIr(value);
  if (!ir) {
    throw new ToolInputError("Valid ComfyUI graph IR required.");
  }
  return ir;
}

async function resolveIrForRun(
  params: Record<string, unknown>,
  config: ComfyUiResolvedConfig,
): Promise<{ ir: ComfyGraphIr; workflowId?: string }> {
  if (Object.hasOwn(params, "prompt")) {
    throw new ToolInputError(
      "Raw prompt JSON is not accepted for run; use workflowId or validated graph IR.",
    );
  }
  const workflowId = readStringParam(params, "workflowId");
  if (workflowId) {
    return {
      ir: (await loadWorkflowArtifacts({ workflowsDir: config.workflowsDir, workflowId })).ir,
      workflowId,
    };
  }
  return { ir: requireIr(params.ir) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function promptHistoryEntry(
  promptId: string,
  history: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(history)) {
    return undefined;
  }
  const entry = history[promptId] ?? history;
  return isRecord(entry) ? entry : undefined;
}

function promptStatus(entry: Record<string, unknown> | undefined): string | undefined {
  const status = entry?.status;
  return isRecord(status) && typeof status.status_str === "string" ? status.status_str : undefined;
}

async function waitForPromptHistory(params: {
  client: Pick<ComfyUiClient, "getHistory">;
  promptId: string;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<unknown> {
  const deadline = Date.now() + params.timeoutMs;
  let lastHistory: unknown = {};
  while (Date.now() <= deadline) {
    lastHistory = await params.client.getHistory(params.promptId);
    const entry = promptHistoryEntry(params.promptId, lastHistory);
    const status = promptStatus(entry);
    if (status === "success") {
      return lastHistory;
    }
    if (status && status !== "running") {
      throw new Error(`ComfyUI prompt ${params.promptId} failed with status: ${status}`);
    }
    await sleep(Math.min(params.pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`Timed out waiting for ComfyUI prompt ${params.promptId}`);
}

function runStatusForError(error: unknown): ComfyRunStatus {
  return error instanceof Error && /timed out/i.test(error.message) ? "timed_out" : "failed";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function appendWorkflowRunRecordBestEffort(
  params: Parameters<typeof appendWorkflowRunRecord>[0],
): Promise<void> {
  try {
    await appendWorkflowRunRecord(params);
  } catch {
    // Workflow history is advisory; persistence failures must not mask run results.
  }
}

export function createComfyUiWorkflowTool(
  ctx: CrawClawPluginToolContext = {},
  deps?: ToolDeps,
): AnyAgentTool {
  return {
    label: "ComfyUI Workflow",
    name: "comfyui_workflow",
    description:
      "Inspect local ComfyUI nodes, create validated image/video workflow IR, run approved prompts, and download outputs.",
    parameters: ActionSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const config = resolveComfyUiConfig({
        workspaceDir: ctx.workspaceDir,
        pluginConfig: deps?.pluginConfig,
      });
      const client = createClient(config, deps);
      switch (action) {
        case "inspect": {
          const [catalog, systemStats] = await Promise.all([
            loadCatalog(client),
            "getSystemStats" in client ? client.getSystemStats().catch(() => undefined) : undefined,
          ]);
          const query = readStringParam(params, "query");
          const limit =
            typeof params.limit === "number" ? Math.max(1, Math.trunc(params.limit)) : 20;
          const nodes = catalog.nodes
            .filter((node) => !query || node.classType.toLowerCase().includes(query.toLowerCase()))
            .slice(0, limit)
            .map((node) => ({
              classType: node.classType,
              category: node.category,
              outputs: node.outputs,
            }));
          return jsonResult({
            ok: true,
            action,
            baseUrl: config.baseUrl,
            fingerprint: catalog.fingerprint,
            nodeCount: catalog.nodes.length,
            videoOutputNodes: catalog.findVideoOutputNodes().map((node) => node.classType),
            nodes,
            systemStats,
          });
        }
        case "create": {
          const goal = readStringParam(params, "goal", { required: true });
          const catalog = await loadCatalog(client);
          const plan = createGraphPlan({
            goal,
            catalog,
            mediaKind: readStringParam(params, "mediaKind") as never,
            intent: readStringParam(params, "intent") as never,
            candidateIr: params.candidateIr,
          });
          if (!plan.ok) {
            return jsonResult({ ok: false, action, diagnostics: plan.diagnostics });
          }
          const prompt = compileGraphIrToPrompt(plan.ir);
          const saved =
            params.save === true
              ? await saveWorkflowArtifacts({
                  workflowsDir: config.workflowsDir,
                  ir: plan.ir,
                  prompt,
                  meta: {
                    goal,
                    baseUrl: config.baseUrl,
                    catalogFingerprint: catalog.fingerprint,
                    mediaKind: plan.ir.mediaKind,
                    diagnostics: plan.diagnostics,
                  },
                })
              : undefined;
          return jsonResult({
            ok: true,
            action,
            workflowId: saved?.workflowId,
            ir: plan.ir,
            prompt,
            diagnostics: plan.diagnostics,
          });
        }
        case "validate": {
          const catalog = await loadCatalog(client);
          const ir = params.workflowId
            ? (
                await loadWorkflowArtifacts({
                  workflowsDir: config.workflowsDir,
                  workflowId: readStringParam(params, "workflowId", { required: true }),
                })
              ).ir
            : requireIr(params.ir);
          const validation = validateGraphIr(ir, catalog);
          return jsonResult({ ok: validation.ok, action, diagnostics: validation.diagnostics });
        }
        case "repair": {
          const catalog = await loadCatalog(client);
          const ir = requireIr(params.ir);
          const diagnostics = validateGraphIr(ir, catalog).diagnostics;
          const repaired = repairGraphIr({ ir, catalog, diagnostics });
          return jsonResult({
            ok: validateGraphIr(repaired.ir, catalog).ok,
            action,
            ir: repaired.ir,
            repairs: repaired.repairs,
          });
        }
        case "run": {
          const { ir, workflowId } = await resolveIrForRun(params, config);
          const catalog = await loadCatalog(client);
          const validation = validateGraphIr(ir, catalog);
          if (!validation.ok) {
            return jsonResult({ ok: false, action, diagnostics: validation.diagnostics });
          }
          const startedAtDate = new Date();
          const startedAt = startedAtDate.toISOString();
          const started = await client.submitPrompt(compileGraphIrToPrompt(ir));
          let history: unknown;
          let outputs;
          if (params.waitForCompletion === true || params.downloadOutputs === true) {
            try {
              history = await waitForPromptHistory({
                client,
                promptId: started.prompt_id,
                timeoutMs: config.runTimeoutMs,
                pollIntervalMs: config.runPollIntervalMs,
              });
              outputs = collectOutputArtifacts(started.prompt_id, history);
              if (params.downloadOutputs === true) {
                outputs = await downloadOutputArtifacts({
                  client,
                  outputDir: config.outputDir,
                  promptId: started.prompt_id,
                  artifacts: outputs,
                });
              }
              if (workflowId) {
                const completedAtDate = new Date();
                await appendWorkflowRunRecordBestEffort({
                  workflowsDir: config.workflowsDir,
                  workflowId,
                  record: {
                    workflowId,
                    promptId: started.prompt_id,
                    status: "success",
                    startedAt,
                    completedAt: completedAtDate.toISOString(),
                    durationMs: completedAtDate.getTime() - startedAtDate.getTime(),
                    outputs,
                  },
                });
              }
            } catch (error) {
              if (workflowId) {
                const completedAtDate = new Date();
                await appendWorkflowRunRecordBestEffort({
                  workflowsDir: config.workflowsDir,
                  workflowId,
                  record: {
                    workflowId,
                    promptId: started.prompt_id,
                    status: runStatusForError(error),
                    startedAt,
                    completedAt: completedAtDate.toISOString(),
                    durationMs: completedAtDate.getTime() - startedAtDate.getTime(),
                    error: errorMessage(error),
                  },
                });
              }
              throw error;
            }
          } else if (workflowId) {
            await appendWorkflowRunRecordBestEffort({
              workflowsDir: config.workflowsDir,
              workflowId,
              record: {
                workflowId,
                promptId: started.prompt_id,
                status: "queued",
                startedAt,
              },
            });
          }
          return jsonResult({
            ok: true,
            action,
            promptId: started.prompt_id,
            queueNumber: started.number,
            outputs,
          });
        }
        case "status": {
          const promptId = readStringParam(params, "promptId", { required: true });
          return jsonResult({
            ok: true,
            action,
            promptId,
            history: await client.getHistory(promptId),
          });
        }
        case "outputs": {
          const promptId = readStringParam(params, "promptId", { required: true });
          const artifacts = collectOutputArtifacts(promptId, await client.getHistory(promptId));
          const outputs =
            params.download === true
              ? await downloadOutputArtifacts({
                  client,
                  outputDir: config.outputDir,
                  promptId,
                  artifacts,
                })
              : artifacts;
          return jsonResult({ ok: true, action, promptId, outputs });
        }
        default:
          throw new ToolInputError(`Unsupported comfyui_workflow action: ${action}`);
      }
    },
  };
}
