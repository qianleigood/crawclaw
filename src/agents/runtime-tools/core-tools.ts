import path from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { ExecToolDefaults, ExecToolDetails } from "../bash-tools.exec-types.js";
import type { ProcessToolDefaults } from "../bash-tools.process.js";
import {
  CLAUDE_PARAM_GROUPS,
  assertRequiredParams,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
} from "../pi-tools.params.js";
import type { AnyAgentTool } from "../pi-tools.types.js";
import { runCrawClawRuntimeTool } from "./native.js";

type RuntimeTextResult = {
  text?: string;
};

type RuntimeToolResult = {
  content?: AgentToolResult<unknown>["content"];
  text?: string;
  details?: unknown;
  isError?: boolean;
};

type RuntimeBashResult = {
  status: "running" | "completed" | "failed";
  sessionId?: string;
  pid?: number;
  startedAt?: number;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  aggregated?: string;
  cwd?: string;
  timedOut?: boolean;
};

type RuntimeProcessResult = {
  status?: "running" | "completed" | "failed" | "killed";
  sessionId?: string;
  sessions?: RuntimeProcessResult[];
  pid?: number;
  startedAt?: number;
  endedAt?: number | null;
  command?: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  aggregated?: string;
  exitCode?: number | null;
  bytes?: number;
  removed?: boolean;
};

function textResult(text: string, details?: Record<string, unknown>): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    details,
  };
}

function runtimeResult(result: RuntimeToolResult): AgentToolResult<unknown> {
  if (Array.isArray(result.content)) {
    return {
      content: result.content,
      details: result.details,
      ...(result.isError ? { isError: true } : {}),
    } as AgentToolResult<unknown>;
  }
  return textResult(result.text || JSON.stringify(result.details ?? result, null, 2), {
    ...(result.details && typeof result.details === "object"
      ? (result.details as Record<string, unknown>)
      : {}),
    ...(result.isError ? { isError: true } : {}),
  });
}

function runtimeOptions(root?: string) {
  return root ? { runtimeRoot: root } : undefined;
}

function unsupportedRustTool(_value: never, label: string): never {
  throw new Error(`Unsupported ${label}`);
}

function normalizeRecord(args: unknown): Record<string, unknown> {
  return (
    normalizeToolParams(args) ??
    (args && typeof args === "object" ? { ...(args as Record<string, unknown>) } : {})
  );
}

function createRustRuntimeTool(params: {
  name: string;
  label?: string;
  description: string;
  parameters: AnyAgentTool["parameters"];
  defaults?: Record<string, unknown>;
  runtimeRoot?: string;
  normalize?: (args: unknown) => Record<string, unknown>;
  afterExecute?: (args: Record<string, unknown>) => Promise<void> | void;
}): AnyAgentTool {
  return {
    name: params.name,
    label: params.label ?? params.name,
    description: params.description,
    parameters: params.parameters,
    execute: async (_toolCallId, args) => {
      const input = {
        ...params.defaults,
        ...(params.normalize ? params.normalize(args) : normalizeRecord(args)),
      };
      const result = await runCrawClawRuntimeTool<RuntimeToolResult>(
        params.name,
        input,
        runtimeOptions(params.runtimeRoot),
      );
      await params.afterExecute?.(input);
      return runtimeResult(result);
    },
  };
}

const readSchema = Type.Object({
  path: Type.String({ description: "File path, relative to the workspace." }),
  offset: Type.Optional(Type.Number({ description: "1-based line offset." })),
  limit: Type.Optional(Type.Number({ description: "Maximum lines to read." })),
});

const writeSchema = Type.Object({
  path: Type.String({ description: "File path, relative to the workspace." }),
  content: Type.String({ description: "File content to write." }),
});

const editSchema = Type.Object({
  path: Type.String({ description: "File path, relative to the workspace." }),
  oldText: Type.Optional(Type.String({ description: "Exact text to replace." })),
  newText: Type.Optional(Type.String({ description: "Replacement text." })),
  edits: Type.Optional(
    Type.Array(
      Type.Object({
        oldText: Type.String({ description: "Exact text to replace." }),
        newText: Type.String({ description: "Replacement text." }),
      }),
    ),
  ),
});

const applyPatchSchema = Type.Object({
  input: Type.String({
    description: "Patch content using the *** Begin Patch/End Patch format.",
  }),
  patch: Type.Optional(
    Type.String({
      description: "Alias for input.",
    }),
  ),
});

const sessionStatusSchema = Type.Object({
  sessionKey: Type.Optional(Type.String({ description: "Session key. Defaults to main." })),
});

const sessionsListSchema = Type.Object({
  parentSessionKey: Type.Optional(
    Type.String({ description: "Optional parent session key for subagent filtering." }),
  ),
});

const sessionsHistorySchema = Type.Object({
  sessionKey: Type.Optional(Type.String({ description: "Session key." })),
});

const sessionsSendSchema = Type.Object({
  sessionKey: Type.String({ description: "Target session key." }),
  message: Type.String({ description: "Message to send into the target session." }),
});

const sessionsSpawnSchema = Type.Object({
  task: Type.String({ description: "Task for the child subagent session." }),
  label: Type.Optional(Type.String({ description: "Optional child session label." })),
  parentSessionKey: Type.Optional(Type.String({ description: "Optional parent session key." })),
});

const sessionsYieldSchema = Type.Object({
  sessionKey: Type.Optional(Type.String({ description: "Session key. Defaults to main." })),
  message: Type.Optional(Type.String({ description: "Yield message." })),
});

const cronSchema = Type.Object(
  {
    action: Type.Union([
      Type.Literal("status"),
      Type.Literal("list"),
      Type.Literal("add"),
      Type.Literal("update"),
      Type.Literal("remove"),
      Type.Literal("run"),
      Type.Literal("runs"),
      Type.Literal("wake"),
    ]),
    id: Type.Optional(Type.String()),
    jobId: Type.Optional(Type.String()),
    job: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    patch: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    mode: Type.Optional(
      Type.Union([Type.Literal("due"), Type.Literal("force"), Type.Literal("now")]),
    ),
    includeDisabled: Type.Optional(Type.Boolean()),
    text: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const reviewTaskSchema = Type.Object({
  task: Type.String({ description: "Review task." }),
  stage: Type.Optional(Type.Union([Type.Literal("spec"), Type.Literal("quality")])),
});

const memoryManifestSchema = Type.Object({
  scope: Type.Optional(Type.String({ description: "Memory scope." })),
});

const memoryNoteReadSchema = Type.Object({
  scope: Type.Optional(Type.String({ description: "Memory scope." })),
  notePath: Type.String({ description: "Relative note path." }),
  path: Type.Optional(Type.String({ description: "Alias for notePath." })),
});

const memoryNoteWriteSchema = Type.Object({
  scope: Type.Optional(Type.String({ description: "Memory scope." })),
  notePath: Type.String({ description: "Relative note path." }),
  path: Type.Optional(Type.String({ description: "Alias for notePath." })),
  content: Type.String({ description: "Note content." }),
});

const memoryNoteEditSchema = Type.Object({
  scope: Type.Optional(Type.String({ description: "Memory scope." })),
  notePath: Type.String({ description: "Relative note path." }),
  path: Type.Optional(Type.String({ description: "Alias for notePath." })),
  search: Type.String({ description: "Exact text to replace." }),
  replace: Type.String({ description: "Replacement text." }),
});

const writeExperienceNoteSchema = Type.Object({
  scope: Type.Optional(Type.String({ description: "Experience scope." })),
  title: Type.Optional(Type.String({ description: "Experience title." })),
  body: Type.Optional(Type.String({ description: "Experience body." })),
  content: Type.Optional(Type.String({ description: "Alias for body." })),
  source: Type.Optional(Type.String({ description: "Experience source." })),
});

const sessionSummaryReadSchema = Type.Object({
  scope: Type.Optional(Type.String({ description: "Session summary scope." })),
});

const sessionSummaryEditSchema = Type.Object({
  scope: Type.Optional(Type.String({ description: "Session summary scope." })),
  content: Type.String({ description: "Complete replacement summary file content." }),
});

function normalizePatchInput(args: unknown): Record<string, unknown> {
  const record = normalizeRecord(args);
  if (typeof record.input !== "string" && typeof record.patch === "string") {
    record.input = record.patch;
  }
  delete record.patch;
  return record;
}

function normalizeEditInput(args: unknown): Record<string, unknown> {
  const record = args && typeof args === "object" ? { ...(args as Record<string, unknown>) } : {};
  if (typeof record.oldText === "string" && typeof record.newText === "string") {
    delete record.edits;
    return record;
  }
  return normalizeRecord(args);
}

function normalizeMemoryNoteInput(args: unknown): Record<string, unknown> {
  const record = normalizeRecord(args);
  if (typeof record.notePath !== "string" && typeof record.path === "string") {
    record.notePath = record.path;
  }
  return record;
}

function requiredTool(tool: AnyAgentTool, groups: Parameters<typeof assertRequiredParams>[1]) {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const normalized = normalizeToolParams(params);
      const record =
        normalized ??
        (params && typeof params === "object" ? (params as Record<string, unknown>) : undefined);
      assertRequiredParams(record, groups, tool.name);
      return tool.execute(toolCallId, normalized ?? params, signal, onUpdate);
    },
  } satisfies AnyAgentTool;
}

export function createRustReadTool(root: string): AnyAgentTool {
  return wrapToolParamNormalization(
    createRustRuntimeTool({
      name: "read",
      description: "Read file contents through CrawClaw's Rust runtime.",
      parameters: readSchema,
      runtimeRoot: root,
    }),
    CLAUDE_PARAM_GROUPS.read,
  );
}

export function createRustWriteTool(root: string): AnyAgentTool {
  return wrapToolParamNormalization(
    createRustRuntimeTool({
      name: "write",
      description: "Create or overwrite files through CrawClaw's Rust runtime.",
      parameters: writeSchema,
      runtimeRoot: root,
    }),
    CLAUDE_PARAM_GROUPS.write,
  );
}

export function createRustEditTool(root: string): AnyAgentTool {
  return wrapToolParamNormalization(
    createRustRuntimeTool({
      name: "edit",
      description: "Make precise file edits through CrawClaw's Rust runtime.",
      parameters: editSchema,
      runtimeRoot: root,
      normalize: normalizeEditInput,
    }),
    CLAUDE_PARAM_GROUPS.edit,
  );
}

export function createRustApplyPatchTool(root: string): AnyAgentTool {
  const tool = createRustRuntimeTool({
    name: "apply_patch",
    description:
      "Apply a patch to one or more files through CrawClaw's Rust runtime. The input should include *** Begin Patch and *** End Patch markers.",
    parameters: applyPatchSchema,
    runtimeRoot: root,
    normalize: normalizePatchInput,
  });
  return requiredTool(patchToolSchemaForClaudeCompatibility(tool), [
    { keys: ["input", "patch"], label: "patch input" },
  ]);
}

export type RustSessionToolName =
  | "session_status"
  | "sessions_list"
  | "sessions_history"
  | "sessions_send"
  | "sessions_spawn"
  | "sessions_yield"
  | "subagents";

export function createRustSessionTool(
  name: RustSessionToolName,
  defaults?: {
    sessionKey?: string;
    parentSessionKey?: string;
    sessionId?: string;
    onYield?: (message: string) => Promise<void> | void;
  },
): AnyAgentTool {
  const parameters = (() => {
    switch (name) {
      case "session_status":
        return sessionStatusSchema;
      case "sessions_list":
      case "subagents":
        return sessionsListSchema;
      case "sessions_history":
        return sessionsHistorySchema;
      case "sessions_send":
        return sessionsSendSchema;
      case "sessions_spawn":
        return sessionsSpawnSchema;
      case "sessions_yield":
        return sessionsYieldSchema;
      default:
        return unsupportedRustTool(name, "Rust session tool");
    }
  })();
  return createRustRuntimeTool({
    name,
    description: `Run ${name} through CrawClaw's Rust runtime.`,
    parameters,
    defaults: {
      ...(defaults?.sessionKey ? { sessionKey: defaults.sessionKey } : {}),
      ...(defaults?.parentSessionKey ? { parentSessionKey: defaults.parentSessionKey } : {}),
    },
    afterExecute:
      name === "sessions_yield" && defaults?.sessionId && defaults.onYield
        ? async (args) => {
            const message =
              typeof args.message === "string" && args.message.trim()
                ? args.message.trim()
                : "Turn yielded.";
            await defaults.onYield?.(message);
          }
        : undefined,
  });
}

export function createRustCronTool(defaults?: { sessionKey?: string }): AnyAgentTool {
  return createRustRuntimeTool({
    name: "cron",
    description: "Manage Rust-native CrawClaw cron jobs and wake scheduled agent sessions.",
    parameters: cronSchema,
    defaults: defaults?.sessionKey ? { sessionKey: defaults.sessionKey } : undefined,
  });
}

export type RustSpecialAgentToolName =
  | "review_task"
  | "memory_manifest_read"
  | "memory_note_read"
  | "memory_note_write"
  | "memory_note_edit"
  | "memory_note_delete"
  | "write_experience_note"
  | "session_summary_file_read"
  | "session_summary_file_edit";

export function createRustSpecialAgentTool(
  name: RustSpecialAgentToolName,
  defaults?: { scope?: string; sessionKey?: string },
): AnyAgentTool {
  const parameters = (() => {
    switch (name) {
      case "review_task":
        return reviewTaskSchema;
      case "memory_manifest_read":
        return memoryManifestSchema;
      case "memory_note_read":
      case "memory_note_delete":
        return memoryNoteReadSchema;
      case "memory_note_write":
        return memoryNoteWriteSchema;
      case "memory_note_edit":
        return memoryNoteEditSchema;
      case "write_experience_note":
        return writeExperienceNoteSchema;
      case "session_summary_file_read":
        return sessionSummaryReadSchema;
      case "session_summary_file_edit":
        return sessionSummaryEditSchema;
      default:
        return unsupportedRustTool(name, "Rust special agent tool");
    }
  })();
  return createRustRuntimeTool({
    name,
    description: `Run ${name} through CrawClaw's Rust runtime.`,
    parameters,
    defaults: {
      ...(defaults?.scope ? { scope: defaults.scope } : {}),
      ...(defaults?.sessionKey ? { sessionKey: defaults.sessionKey } : {}),
    },
    normalize: name.startsWith("memory_note_") ? normalizeMemoryNoteInput : undefined,
  });
}

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Literal text pattern to search for" }),
  path: Type.Optional(
    Type.String({ description: "File or directory path, relative to workspace" }),
  ),
  maxMatches: Type.Optional(Type.Number({ description: "Maximum matches to return" })),
});

const findSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory path, relative to workspace" })),
  name: Type.Optional(
    Type.String({ description: "Substring to match in file or directory names" }),
  ),
  maxResults: Type.Optional(Type.Number({ description: "Maximum paths to return" })),
});

const lsSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory path, relative to workspace" })),
});

const bashSchema = Type.Object({
  command: Type.String({ description: "Shell command to run" }),
  workdir: Type.Optional(Type.String({ description: "Working directory, relative to workspace" })),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  yieldMs: Type.Optional(
    Type.Number({
      description: "Return a running session if the command is still active after this many ms",
    }),
  ),
  background: Type.Optional(Type.Boolean({ description: "Start the command in the background" })),
  timeout: Type.Optional(Type.Number({ description: "Foreground command timeout in seconds" })),
  host: Type.Optional(Type.String({ description: "Execution host: auto or gateway" })),
  security: Type.Optional(
    Type.String({ description: "Execution security policy: full, allowlist, or deny" }),
  ),
  ask: Type.Optional(Type.String({ description: "Approval behavior: off, on-miss, or always" })),
});

const processSchema = Type.Object({
  action: Type.String({
    description: "Process action: list, poll, log, write, submit, paste, kill, remove",
  }),
  sessionId: Type.Optional(Type.String({ description: "Session id for actions other than list" })),
  data: Type.Optional(Type.String({ description: "Data to write for write" })),
  text: Type.Optional(Type.String({ description: "Text to paste for paste" })),
  eof: Type.Optional(Type.Boolean({ description: "Close stdin after write" })),
  timeout: Type.Optional(
    Type.Number({
      description: "For poll: wait up to this many milliseconds before returning",
      minimum: 0,
    }),
  ),
});

export function createRustGrepTool(root: string): AgentTool<typeof grepSchema, unknown> {
  return {
    name: "grep",
    label: "grep",
    description: "Search workspace file contents with CrawClaw's Rust runtime.",
    parameters: grepSchema,
    execute: async (_toolCallId, args) => {
      const params = args as { pattern?: string; path?: string; maxMatches?: number };
      const result = await runCrawClawRuntimeTool<RuntimeTextResult>(
        "grep",
        {
          root,
          pattern: params.pattern,
          path: params.path,
          max_matches: params.maxMatches,
        },
        runtimeOptions(root),
      );
      return textResult(result.text || "(no matches)", result as Record<string, unknown>);
    },
  };
}

export function createRustFindTool(root: string): AgentTool<typeof findSchema, unknown> {
  return {
    name: "find",
    label: "find",
    description: "Find workspace files and directories with CrawClaw's Rust runtime.",
    parameters: findSchema,
    execute: async (_toolCallId, args) => {
      const params = args as { path?: string; name?: string; maxResults?: number };
      const result = await runCrawClawRuntimeTool<RuntimeTextResult>(
        "find",
        {
          root,
          path: params.path,
          name: params.name,
          max_results: params.maxResults,
        },
        runtimeOptions(root),
      );
      return textResult(result.text || "(no results)", result as Record<string, unknown>);
    },
  };
}

export function createRustLsTool(root: string): AgentTool<typeof lsSchema, unknown> {
  return {
    name: "ls",
    label: "ls",
    description: "List workspace directory contents with CrawClaw's Rust runtime.",
    parameters: lsSchema,
    execute: async (_toolCallId, args) => {
      const params = args as { path?: string };
      const result = await runCrawClawRuntimeTool<RuntimeTextResult>(
        "ls",
        {
          root,
          path: params.path,
        },
        runtimeOptions(root),
      );
      return textResult(result.text || "(empty)", result as Record<string, unknown>);
    },
  };
}

function clampSecondsToMs(value: unknown, fallbackSec: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value * 1000);
  }
  return Math.floor(fallbackSec * 1000);
}

function runtimeRequestTimeoutMs(commandTimeoutMs: number): number {
  return Math.min(commandTimeoutMs + 5000, 2_147_000_000);
}

function resolveRuntimeCwd(root: string, cwd?: string): string {
  if (!cwd) {
    return root;
  }
  return path.isAbsolute(cwd) ? cwd : path.resolve(root, cwd);
}

function resolveProfiledSafeBins(defaults?: ExecToolDefaults): string[] | undefined {
  const safeBins = defaults?.safeBins ?? [];
  const profiles = defaults?.safeBinProfiles ?? {};
  const profiled = safeBins.filter((bin) => Boolean(profiles[bin]));
  return profiled.length > 0 ? profiled : undefined;
}

function bashResultText(result: RuntimeBashResult) {
  if (result.status === "running") {
    return `Command still running (session ${result.sessionId ?? "unknown"}, pid ${result.pid ?? "n/a"}). Use process (list/poll/log/write/kill/remove) for follow-up.`;
  }
  const output = result.aggregated || result.stdout || result.stderr || "(no output)";
  if (result.timedOut) {
    return `${output}\n\nCommand timed out.`;
  }
  return output;
}

export function createRustBashTool(
  root: string,
  defaults?: ExecToolDefaults,
): AgentTool<typeof bashSchema, ExecToolDetails> {
  const defaultTimeoutSec =
    typeof defaults?.timeoutSec === "number" && defaults.timeoutSec > 0
      ? defaults.timeoutSec
      : 1800;
  const defaultYieldMs =
    typeof defaults?.backgroundMs === "number" && defaults.backgroundMs >= 0
      ? defaults.backgroundMs
      : 10_000;
  const allowBackground = defaults?.allowBackground ?? true;
  const safeBins = resolveProfiledSafeBins(defaults);

  return {
    name: "bash",
    label: "bash",
    description:
      "Execute shell commands through CrawClaw's Rust runtime. Use background/yieldMs to continue later via process.",
    parameters: bashSchema,
    execute: async (_toolCallId, args) => {
      const params = args as {
        command?: string;
        workdir?: string;
        env?: Record<string, string>;
        yieldMs?: number;
        background?: boolean;
        timeout?: number;
        host?: string;
        security?: string;
        ask?: string;
        pty?: boolean;
      };
      if (!params.command) {
        throw new Error("Provide a command to start.");
      }
      if (params.pty === true) {
        throw new Error("pty=true is not supported by the Rust runtime bash tool yet.");
      }

      const timeoutMs = clampSecondsToMs(params.timeout, defaultTimeoutSec);
      const background = allowBackground && params.background === true;
      const yieldMs = !allowBackground
        ? undefined
        : background
          ? 0
          : typeof params.yieldMs === "number" && Number.isFinite(params.yieldMs)
            ? Math.max(0, Math.floor(params.yieldMs))
            : defaultYieldMs;
      const result = await runCrawClawRuntimeTool<RuntimeBashResult>(
        "bash",
        {
          root,
          command: params.command,
          workdir: params.workdir,
          env: params.env,
          timeoutMs,
          background,
          yieldMs,
          host: params.host ?? defaults?.host,
          security: params.security ?? defaults?.security,
          ask: params.ask ?? defaults?.ask,
          safeBins,
          pathPrepend: defaults?.pathPrepend,
          scopeKey: defaults?.scopeKey,
        },
        {
          runtimeRoot: root,
          timeoutMs: background ? 30_000 : runtimeRequestTimeoutMs(timeoutMs),
        },
      );
      return textResult(bashResultText(result), {
        status: result.status,
        sessionId: result.sessionId,
        pid: result.pid,
        startedAt: result.startedAt,
        exitCode: result.exitCode ?? undefined,
        aggregated: result.aggregated ?? "",
        timedOut: result.timedOut,
        cwd: resolveRuntimeCwd(root, result.cwd),
      }) as AgentToolResult<ExecToolDetails>;
    },
  };
}

function processResultText(result: RuntimeProcessResult) {
  if (Array.isArray(result.sessions)) {
    if (result.sessions.length === 0) {
      return "No running or recent sessions.";
    }
    return result.sessions
      .map((session) => {
        const label = session.command || session.sessionId || "process";
        return `${session.sessionId ?? "unknown"} ${session.status ?? "unknown"} :: ${label}`;
      })
      .join("\n");
  }
  if (typeof result.bytes === "number") {
    return `Wrote ${result.bytes} bytes to session ${result.sessionId ?? "unknown"}.`;
  }
  if (result.removed) {
    return `Removed session ${result.sessionId ?? "unknown"}.`;
  }
  const output = result.aggregated || result.stdout || result.stderr || "(no output)";
  const suffix =
    result.status && result.status !== "running"
      ? `\n\nProcess exited with code ${result.exitCode ?? 0}.`
      : result.status === "running"
        ? "\n\nProcess still running."
        : "";
  return `${output}${suffix}`;
}

export function createRustProcessTool(
  defaults?: ProcessToolDefaults & { runtimeRoot?: string },
): AgentTool<typeof processSchema, unknown> {
  return {
    name: "process",
    label: "process",
    description:
      "Manage running Rust runtime bash sessions: list, poll, log, write, submit, paste, kill, remove.",
    parameters: processSchema,
    execute: async (_toolCallId, args) => {
      const params = args as {
        action?: string;
        sessionId?: string;
        data?: string;
        text?: string;
        eof?: boolean;
        timeout?: number;
      };
      if (!params.action) {
        return textResult("action is required.", { status: "failed" });
      }
      const result = await runCrawClawRuntimeTool<RuntimeProcessResult>(
        "process",
        {
          action: params.action === "clear" ? "remove" : params.action,
          sessionId: params.sessionId,
          data: params.data,
          text: params.text,
          eof: params.eof,
          timeoutMs: params.timeout,
          scopeKey: defaults?.scopeKey,
        },
        runtimeOptions(defaults?.runtimeRoot),
      );
      return textResult(processResultText(result), result as Record<string, unknown>);
    },
  };
}
