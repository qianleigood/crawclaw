import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  payloadTextResult,
  ToolAuthorizationError,
  ToolInputError,
  type AnyAgentTool,
  type CrawClawPluginToolContext,
} from "../runtime-api.js";
import { resolveTurixConfig } from "./config.js";
import {
  inspectTurixRuntime,
  runTurixDesktopTask,
  type TurixRunRequest,
  type TurixRunResult,
} from "./runner.js";

export const TURIX_DESKTOP_TOOL_NAME = "turix_desktop_run";

export type TurixDesktopToolOptions = {
  pluginConfig?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
  runner?: (request: TurixRunRequest) => Promise<TurixRunResult>;
};

type TurixToolMode = "plan" | "run";

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readTask(params: Record<string, unknown>): string {
  const task = typeof params.task === "string" ? params.task.trim() : "";
  if (!task) {
    throw new ToolInputError("task required");
  }
  return task;
}

function readMode(params: Record<string, unknown>): TurixToolMode {
  const value = params.mode;
  if (value === undefined || value === null || value === "") {
    return "run";
  }
  if (value === "plan" || value === "run") {
    return value;
  }
  throw new ToolInputError("mode must be plan or run");
}

function readPositiveInteger(
  params: Record<string, unknown>,
  key: string,
  fallback: number,
  max: number,
): number {
  const value = params[key];
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ToolInputError(`${key} must be a positive number`);
  }
  return Math.min(Math.trunc(parsed), max);
}

function sanitizeRunId(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || `turix-${Date.now()}`;
}

function readResumeRunId(params: Record<string, unknown>): string | undefined {
  const value = params.resumeRunId;
  return typeof value === "string" && value.trim() ? sanitizeRunId(value) : undefined;
}

function isChannelOriginated(context: CrawClawPluginToolContext): boolean {
  return (
    typeof context.deliveryContext?.channel === "string" && context.deliveryContext.channel !== ""
  );
}

export function createTurixDesktopTool(
  context: CrawClawPluginToolContext,
  options: TurixDesktopToolOptions = {},
): AnyAgentTool {
  const config = resolveTurixConfig({
    workspaceDir: context.workspaceDir,
    pluginConfig: options.pluginConfig,
    env: options.env,
  });
  const runner = options.runner ?? runTurixDesktopTask;
  return {
    name: TURIX_DESKTOP_TOOL_NAME,
    label: "TuriX Desktop",
    ownerOnly: true,
    displaySummary: "Run a local TuriX-CUA desktop automation task",
    description:
      "Plan or run a high-risk local macOS desktop automation task through TuriX-CUA. Use mode='plan' first for setup checks. Use mode='run' only when the user explicitly wants desktop control and no safer API, file, CLI, or browser route can satisfy the task. Screenshots may be sent to the configured TuriX model provider.",
    parameters: Type.Object({
      task: Type.String({
        minLength: 1,
        description: "Concrete desktop task for TuriX-CUA to execute.",
      }),
      mode: Type.Optional(
        Type.Union([Type.Literal("plan"), Type.Literal("run")], {
          description: "plan checks setup without controlling the desktop; run starts TuriX.",
        }),
      ),
      maxSteps: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 200,
          description: "Maximum TuriX agent steps for this run.",
        }),
      ),
      timeoutMs: Type.Optional(
        Type.Number({
          minimum: 1000,
          maximum: 3_600_000,
          description: "Maximum wall-clock time before CrawClaw stops the TuriX process.",
        }),
      ),
      resumeRunId: Type.Optional(
        Type.String({
          description: "Existing TuriX run id to resume.",
        }),
      ),
      riskAcknowledged: Type.Optional(
        Type.Boolean({
          description:
            "Caller acknowledgment for high-risk desktop automation. Approval is still required.",
        }),
      ),
    }),
    async execute(callId, rawParams) {
      const params = readRecord(rawParams);
      const task = readTask(params);
      const mode = readMode(params);
      const runId = sanitizeRunId(callId);
      const maxSteps = readPositiveInteger(params, "maxSteps", config.defaultMaxSteps, 200);
      const timeoutMs = readPositiveInteger(
        params,
        "timeoutMs",
        config.defaultTimeoutMs,
        3_600_000,
      );
      const resumeRunId = readResumeRunId(params);

      if (context.senderIsOwner !== true) {
        throw new ToolAuthorizationError(
          "TuriX desktop automation is restricted to owner senders.",
        );
      }
      if (mode === "run" && isChannelOriginated(context) && !config.allowRemoteRequests) {
        throw new ToolAuthorizationError(
          "TuriX local desktop runs from chat channels require allowRemoteRequests: true.",
        );
      }
      if (mode === "plan") {
        const inspection = await inspectTurixRuntime(config);
        return payloadTextResult({
          status: "planned",
          mode,
          task,
          runId,
          runtime: {
            mode: config.runtime.mode,
            projectDir: config.runtime.projectDir,
            pythonPath: config.runtime.pythonPath,
          },
          artifactRoot: path.join(config.outputRoot, "runs", runId),
          warnings: inspection.warnings,
          setupHints: inspection.setupHints,
        });
      }

      const result = await runner({
        config,
        task,
        runId,
        maxSteps,
        timeoutMs,
        resumeRunId,
        env: options.env,
      });
      return payloadTextResult(result);
    },
  };
}
