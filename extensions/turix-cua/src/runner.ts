import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { TurixModelConfig, TurixModelRole, TurixResolvedConfig } from "./config.js";

export type TurixRunStatus = "completed" | "failed" | "blocked" | "timeout" | "needs_setup";

export type TurixArtifactRefs = {
  config?: string;
  log?: string;
  stdout?: string;
  stderr?: string;
  screenshotsDir?: string;
  brainLog?: string;
  actorLog?: string;
  plannerLog?: string;
};

export type TurixRunResult = {
  status: TurixRunStatus;
  runId: string;
  summary: string;
  artifactRefs: TurixArtifactRefs;
  warnings: string[];
  setupHints?: string[];
};

export type TurixRunRequest = {
  config: TurixResolvedConfig;
  task: string;
  runId: string;
  maxSteps: number;
  timeoutMs: number;
  resumeRunId?: string;
  env?: Record<string, string | undefined>;
};

export type TurixRuntimeInspection = {
  ok: boolean;
  warnings: string[];
  setupHints: string[];
};

type TurixMainModelConfig = {
  provider: string;
  model_name: string;
  base_url?: string;
  max_tokens?: number;
  timeout?: number;
};

export type TurixMainConfig = {
  logging_level: string;
  output_dir: string;
  brain_enable_thinking: boolean;
  brain_llm: TurixMainModelConfig;
  actor_llm: TurixMainModelConfig;
  planner_llm: TurixMainModelConfig;
  memory_llm: TurixMainModelConfig;
  agent: {
    task: string;
    memory_budget_tokens: number;
    summary_memory_budget_tokens: number;
    use_ui: boolean;
    use_search: boolean;
    use_skills: boolean;
    skills_dir?: string;
    skills_max_chars: number;
    use_plan: boolean;
    max_actions_per_step: number;
    max_steps: number;
    force_stop_hotkey: string;
    resume: boolean;
    agent_id: string;
    save_brain_conversation_path: string;
    save_actor_conversation_path: string;
    save_planner_conversation_path: string;
    save_actor_conversation_path_encoding: string;
    save_brain_conversation_path_encoding: string;
    save_planner_conversation_path_encoding: string;
  };
};

const MODEL_ROLES: TurixModelRole[] = ["brain", "actor", "planner", "memory"];
let activeRunId: string | undefined;

const REASONING_TAG_STRIPPING_SHIM = String.raw`
import os

if os.getenv("CRAWCLAW_TURIX_STRIP_REASONING_TAGS") == "1":
    import re

    _LEADING_REASONING_TAG_RE = re.compile(r"^\s*(?:<think>.*?</think>\s*)+", re.IGNORECASE | re.DOTALL)

    def _strip_leading_reasoning_tags(value):
        if not isinstance(value, str):
            return value
        return _LEADING_REASONING_TAG_RE.sub("", value).lstrip()

    def _with_clean_content(response):
        content = getattr(response, "content", None)
        cleaned = _strip_leading_reasoning_tags(content)
        if cleaned == content:
            return response
        model_copy = getattr(response, "model_copy", None)
        if callable(model_copy):
            return model_copy(update={"content": cleaned})
        copy = getattr(response, "copy", None)
        if callable(copy):
            return copy(update={"content": cleaned})
        try:
            response.content = cleaned
        except Exception:
            return response
        return response

    try:
        import langchain_openai
        from langchain_openai import ChatOpenAI as _OriginalChatOpenAI

        class CrawClawReasoningTagStrippingChatOpenAI(_OriginalChatOpenAI):
            def invoke(self, *args, **kwargs):
                return _with_clean_content(super().invoke(*args, **kwargs))

            async def ainvoke(self, *args, **kwargs):
                return _with_clean_content(await super().ainvoke(*args, **kwargs))

        langchain_openai.ChatOpenAI = CrawClawReasoningTagStrippingChatOpenAI
        try:
            import langchain_openai.chat_models as _chat_models
            _chat_models.ChatOpenAI = CrawClawReasoningTagStrippingChatOpenAI
        except Exception:
            pass
        try:
            import langchain_openai.chat_models.base as _chat_models_base
            _chat_models_base.ChatOpenAI = CrawClawReasoningTagStrippingChatOpenAI
        except Exception:
            pass
    except Exception:
        pass
`;

function usesReasoningTagStrippingShim(config: TurixResolvedConfig): boolean {
  return config.stripReasoningTags;
}

function toTurixModelConfig(model: TurixModelConfig): TurixMainModelConfig {
  return {
    provider: model.provider,
    model_name: model.modelName,
    ...(model.baseUrl ? { base_url: model.baseUrl } : {}),
    ...(model.maxTokens ? { max_tokens: model.maxTokens } : {}),
    ...(model.timeout ? { timeout: model.timeout } : {}),
  };
}

export function buildTurixMainConfig(params: {
  config: TurixResolvedConfig;
  request: {
    task: string;
    runId: string;
    runDir: string;
    maxSteps: number;
    resumeRunId?: string;
  };
}): TurixMainConfig {
  const agentId = params.request.resumeRunId ?? params.request.runId;
  return {
    logging_level: "INFO",
    output_dir: params.request.runDir,
    brain_enable_thinking: false,
    brain_llm: toTurixModelConfig(params.config.models.brain),
    actor_llm: toTurixModelConfig(params.config.models.actor),
    planner_llm: toTurixModelConfig(params.config.models.planner),
    memory_llm: toTurixModelConfig(params.config.models.memory),
    agent: {
      task: params.request.task,
      memory_budget_tokens: 2000,
      summary_memory_budget_tokens: 8000,
      use_ui: false,
      use_search: false,
      use_skills: params.config.useSkills,
      ...(params.config.skillsDir ? { skills_dir: params.config.skillsDir } : {}),
      skills_max_chars: 4000,
      use_plan: params.config.usePlan,
      max_actions_per_step: params.config.maxActionsPerStep,
      max_steps: params.request.maxSteps,
      force_stop_hotkey: params.config.forceStopHotkey,
      resume: Boolean(params.request.resumeRunId),
      agent_id: agentId,
      save_brain_conversation_path: path.join("logs", "brain_llm_interactions.log"),
      save_actor_conversation_path: path.join("logs", "actor_llm_interactions.log"),
      save_planner_conversation_path: path.join("logs", "planner_llm_interactions.log"),
      save_actor_conversation_path_encoding: "utf-8",
      save_brain_conversation_path_encoding: "utf-8",
      save_planner_conversation_path_encoding: "utf-8",
    },
  };
}

function firstConfiguredApiKey(params: {
  config: TurixResolvedConfig;
  baseEnv: Record<string, string | undefined>;
}): string | undefined {
  for (const role of MODEL_ROLES) {
    const envName = params.config.models[role].apiKeyEnv;
    if (!envName) {
      continue;
    }
    const value = params.baseEnv[envName]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function buildTurixChildEnv(params: {
  config: TurixResolvedConfig;
  baseEnv?: Record<string, string | undefined>;
  shimDir?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(params.baseEnv ?? process.env) };
  const apiKey = firstConfiguredApiKey({ config: params.config, baseEnv: env });
  if (apiKey) {
    env.API_KEY = apiKey;
    env.OPENAI_API_KEY = apiKey;
  }
  if (params.shimDir && usesReasoningTagStrippingShim(params.config)) {
    env.CRAWCLAW_TURIX_STRIP_REASONING_TAGS = "1";
    env.PYTHONPATH = env.PYTHONPATH
      ? [params.shimDir, env.PYTHONPATH].join(path.delimiter)
      : params.shimDir;
  }
  delete env.TURIX_OUTPUT_DIR;
  return env;
}

async function writeTurixPythonShims(params: {
  config: TurixResolvedConfig;
  runDir: string;
}): Promise<string | undefined> {
  if (!usesReasoningTagStrippingShim(params.config)) {
    return undefined;
  }
  const shimDir = path.join(params.runDir, "python-shims");
  await fs.mkdir(shimDir, { recursive: true });
  await fs.writeFile(path.join(shimDir, "sitecustomize.py"), REASONING_TAG_STRIPPING_SHIM, "utf8");
  return shimDir;
}

async function canAccess(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function inspectTurixRuntime(
  config: TurixResolvedConfig,
): Promise<TurixRuntimeInspection> {
  const warnings: string[] = [];
  const setupHints: string[] = [];
  if (process.platform !== "darwin") {
    warnings.push("TuriX-CUA desktop automation is only enabled for macOS in this MVP.");
  }
  const mainPath = path.join(config.runtime.projectDir, "examples", "main.py");
  if (!(await canAccess(mainPath))) {
    warnings.push(`TuriX main script not found: ${mainPath}`);
    setupHints.push(
      config.runtime.mode === "managed"
        ? "Run the future managed TuriX installer, or configure runtime.mode=external with an existing TuriX-CUA checkout."
        : "Set plugins.entries.turix-cua.config.runtime.projectDir to an existing TuriX-CUA checkout.",
    );
  }
  if (path.isAbsolute(config.runtime.pythonPath) && !(await canAccess(config.runtime.pythonPath))) {
    warnings.push(`TuriX Python executable not found: ${config.runtime.pythonPath}`);
    setupHints.push("Create the TuriX Python environment and set runtime.pythonPath.");
  }
  return { ok: warnings.length === 0, warnings, setupHints };
}

function appendTail(previous: string, chunk: Buffer): string {
  return `${previous}${chunk.toString("utf8")}`.slice(-4000);
}

function summarizeFailure(status: TurixRunStatus, stderrTail: string): string {
  if (status === "timeout") {
    return "TuriX run timed out and was stopped.";
  }
  const cleanTail = stderrTail.trim();
  return cleanTail ? `TuriX run failed: ${cleanTail}` : "TuriX run failed.";
}

async function readTail(filePath: string, maxChars: number): Promise<string> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text.slice(-maxChars);
  } catch {
    return "";
  }
}

export function summarizeTurixInternalFailure(logTail: string): string | undefined {
  const successIndex = logTail.lastIndexOf("Task completed successfully");
  const failurePatterns = [
    "Failed to complete task in maximum steps",
    "Unexpected error in brain_step",
    "Unexpected error in step",
  ];
  const failureIndex = Math.max(...failurePatterns.map((pattern) => logTail.lastIndexOf(pattern)));
  if (failureIndex < 0 || failureIndex < successIndex) {
    return undefined;
  }
  const failedLine = logTail
    .slice(failureIndex)
    .split(/\r?\n/u)
    .find((line) => line.trim());
  return failedLine
    ? `TuriX reported an internal task failure: ${failedLine.trim()}`
    : "TuriX reported an internal task failure.";
}

export async function runTurixDesktopTask(request: TurixRunRequest): Promise<TurixRunResult> {
  if (activeRunId) {
    return {
      status: "blocked",
      runId: request.runId,
      summary: `Another TuriX desktop run is already active: ${activeRunId}`,
      artifactRefs: {},
      warnings: [],
    };
  }

  activeRunId = request.runId;
  try {
    const inspection = await inspectTurixRuntime(request.config);
    if (!inspection.ok) {
      return {
        status: "needs_setup",
        runId: request.runId,
        summary: "TuriX runtime is not ready.",
        artifactRefs: {},
        warnings: inspection.warnings,
        setupHints: inspection.setupHints,
      };
    }

    const runDir = path.join(request.config.outputRoot, "runs", request.runId);
    const logsDir = path.join(runDir, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    const configPath = path.join(runDir, "config.json");
    const stdoutPath = path.join(logsDir, "stdout.log");
    const stderrPath = path.join(logsDir, "stderr.log");
    const shimDir = await writeTurixPythonShims({ config: request.config, runDir });
    const mainConfig = buildTurixMainConfig({
      config: request.config,
      request: {
        task: request.task,
        runId: request.runId,
        runDir,
        maxSteps: request.maxSteps,
        resumeRunId: request.resumeRunId,
      },
    });
    await fs.writeFile(configPath, `${JSON.stringify(mainConfig, null, 2)}\n`, "utf8");

    const mainPath = path.join(request.config.runtime.projectDir, "examples", "main.py");
    const stdout = createWriteStream(stdoutPath, { flags: "a" });
    const stderr = createWriteStream(stderrPath, { flags: "a" });
    let stdoutTail = "";
    let stderrTail = "";
    let timedOut = false;
    const child = spawn(request.config.runtime.pythonPath, [mainPath, "--config", configPath], {
      cwd: request.config.runtime.projectDir,
      env: buildTurixChildEnv({ config: request.config, baseEnv: request.env, shimDir }),
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutTail = appendTail(stdoutTail, chunk);
      stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = appendTail(stderrTail, chunk);
      stderr.write(chunk);
    });

    const exit = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2000).unref();
      }, request.timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        resolve({ code: null, error });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code });
      });
    });
    stdout.end();
    stderr.end();

    const artifactRefs: TurixArtifactRefs = {
      config: configPath,
      log: path.join(runDir, "logging.log"),
      stdout: stdoutPath,
      stderr: stderrPath,
      screenshotsDir: path.join(runDir, "images", request.resumeRunId ?? request.runId),
      brainLog: path.join(runDir, "logs", "brain_llm_interactions.log"),
      actorLog: path.join(runDir, "logs", "actor_llm_interactions.log"),
      plannerLog: path.join(runDir, "logs", "planner_llm_interactions.log"),
    };
    if (timedOut) {
      return {
        status: "timeout",
        runId: request.runId,
        summary: summarizeFailure("timeout", stderrTail),
        artifactRefs,
        warnings: [],
      };
    }
    if (exit.error || exit.code !== 0) {
      return {
        status: "failed",
        runId: request.runId,
        summary: exit.error?.message ?? summarizeFailure("failed", stderrTail),
        artifactRefs,
        warnings: stdoutTail.trim() ? [`stdout tail: ${stdoutTail.trim()}`] : [],
      };
    }
    const logTail = await readTail(path.join(runDir, "logging.log"), 8000);
    const internalFailure = summarizeTurixInternalFailure(logTail);
    if (internalFailure) {
      return {
        status: "failed",
        runId: request.runId,
        summary: internalFailure,
        artifactRefs,
        warnings: stdoutTail.trim() ? [`stdout tail: ${stdoutTail.trim()}`] : [],
      };
    }
    return {
      status: "completed",
      runId: request.runId,
      summary: "TuriX run completed.",
      artifactRefs,
      warnings: [],
    };
  } finally {
    activeRunId = undefined;
  }
}
