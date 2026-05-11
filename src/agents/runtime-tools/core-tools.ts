import path from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { ExecToolDefaults, ExecToolDetails } from "../bash-tools.exec-types.js";
import type { ProcessToolDefaults } from "../bash-tools.process.js";
import { runCrawClawRuntimeTool } from "./native.js";

type RuntimeTextResult = {
  text?: string;
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
  host: Type.Optional(Type.String({ description: "Execution host: auto, gateway, or node" })),
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
      const result = await runCrawClawRuntimeTool<RuntimeTextResult>("grep", {
        root,
        pattern: params.pattern,
        path: params.path,
        max_matches: params.maxMatches,
      });
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
      const result = await runCrawClawRuntimeTool<RuntimeTextResult>("find", {
        root,
        path: params.path,
        name: params.name,
        max_results: params.maxResults,
      });
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
      const result = await runCrawClawRuntimeTool<RuntimeTextResult>("ls", {
        root,
        path: params.path,
      });
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
        { timeoutMs: background ? 30_000 : runtimeRequestTimeoutMs(timeoutMs) },
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
  defaults?: ProcessToolDefaults,
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
      const result = await runCrawClawRuntimeTool<RuntimeProcessResult>("process", {
        action: params.action === "clear" ? "remove" : params.action,
        sessionId: params.sessionId,
        data: params.data,
        text: params.text,
        eof: params.eof,
        timeoutMs: params.timeout,
        scopeKey: defaults?.scopeKey,
      });
      return textResult(processResultText(result), result as Record<string, unknown>);
    },
  };
}
