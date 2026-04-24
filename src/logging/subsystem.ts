import { Chalk } from "chalk";
import type { Logger as TsLogger } from "tslog";
import { isVerbose } from "../global-state.js";
import { observationRef } from "../infra/observation/context.js";
import { getCurrentObservationContext } from "../infra/observation/scope.js";
import { defaultRuntime, type OutputRuntimeEnv, type RuntimeEnv } from "../runtime.js";
import { clearActiveProgressLine } from "../terminal/progress-line.js";
import {
  formatConsoleTimestamp,
  getConsoleSettings,
  shouldLogSubsystemToConsole,
} from "./console.js";
import { type LogLevel, levelToMinLevel } from "./levels.js";
import { getChildLogger, isFileLogLevelEnabled } from "./logger.js";
import { loggingState } from "./state.js";

type LogObj = { date?: Date } & Record<string, unknown>;
type SubsystemLogMeta = Record<string, unknown>;

export type SubsystemLogger = {
  subsystem: string;
  isEnabled: (level: LogLevel, target?: "any" | "console" | "file") => boolean;
  trace: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  fatal: (message: string, meta?: Record<string, unknown>) => void;
  raw: (message: string) => void;
  child: (name: string) => SubsystemLogger;
  withContext: (meta: Record<string, unknown>) => SubsystemLogger;
};

function shouldLogToConsole(level: LogLevel, settings: { level: LogLevel }): boolean {
  if (settings.level === "silent") {
    return false;
  }
  const current = levelToMinLevel(level);
  const min = levelToMinLevel(settings.level);
  return current <= min;
}

type ChalkInstance = InstanceType<typeof Chalk>;

const inspectValue: ((value: unknown) => string) | null = (() => {
  const getBuiltinModule = (
    process as NodeJS.Process & {
      getBuiltinModule?: (id: string) => unknown;
    }
  ).getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    return null;
  }
  try {
    const utilNamespace = getBuiltinModule("util") as {
      inspect?: (value: unknown) => string;
    };
    return typeof utilNamespace.inspect === "function" ? utilNamespace.inspect : null;
  } catch {
    return null;
  }
})();

function formatRuntimeArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }
  if (inspectValue) {
    return inspectValue(arg);
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function isRichConsoleEnv(): boolean {
  const term = (process.env.TERM ?? "").toLowerCase();
  if (process.env.COLORTERM || process.env.TERM_PROGRAM) {
    return true;
  }
  return term.length > 0 && term !== "dumb";
}

function getColorForConsole(): ChalkInstance {
  const hasForceColor =
    typeof process.env.FORCE_COLOR === "string" &&
    process.env.FORCE_COLOR.trim().length > 0 &&
    process.env.FORCE_COLOR.trim() !== "0";
  if (process.env.NO_COLOR && !hasForceColor) {
    return new Chalk({ level: 0 });
  }
  const hasTty = process.stdout.isTTY || process.stderr.isTTY;
  return hasTty || isRichConsoleEnv() ? new Chalk({ level: 1 }) : new Chalk({ level: 0 });
}

const SUBSYSTEM_COLORS = ["cyan", "green", "yellow", "blue", "magenta", "red"] as const;
const SUBSYSTEM_COLOR_OVERRIDES: Record<string, (typeof SUBSYSTEM_COLORS)[number]> = {
  "gmail-watcher": "blue",
};
const SUBSYSTEM_PREFIXES_TO_DROP = ["gateway", "channels", "providers"] as const;
const SUBSYSTEM_MAX_SEGMENTS = 2;
// Keep local to avoid importing channel registry into hot logging paths.
const CHANNEL_SUBSYSTEM_PREFIXES = new Set<string>([
  "telegram",
  "whatsapp",
  "discord",
  "irc",
  "googlechat",
  "slack",
  "signal",
  "imessage",
]);

function pickSubsystemColor(color: ChalkInstance, subsystem: string): ChalkInstance {
  const override = SUBSYSTEM_COLOR_OVERRIDES[subsystem];
  if (override) {
    return color[override];
  }
  let hash = 0;
  for (let i = 0; i < subsystem.length; i += 1) {
    hash = (hash * 31 + subsystem.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % SUBSYSTEM_COLORS.length;
  const name = SUBSYSTEM_COLORS[idx];
  return color[name];
}

function formatSubsystemForConsole(subsystem: string): string {
  const parts = subsystem.split("/").filter(Boolean);
  const original = parts.join("/") || subsystem;
  while (
    parts.length > 0 &&
    SUBSYSTEM_PREFIXES_TO_DROP.includes(parts[0] as (typeof SUBSYSTEM_PREFIXES_TO_DROP)[number])
  ) {
    parts.shift();
  }
  if (parts.length === 0) {
    return original;
  }
  if (CHANNEL_SUBSYSTEM_PREFIXES.has(parts[0])) {
    return parts[0];
  }
  if (parts.length > SUBSYSTEM_MAX_SEGMENTS) {
    return parts.slice(-SUBSYSTEM_MAX_SEGMENTS).join("/");
  }
  return parts.join("/");
}

export function stripRedundantSubsystemPrefixForConsole(
  message: string,
  displaySubsystem: string,
): string {
  if (!displaySubsystem) {
    return message;
  }

  // Common duplication: "[discord] discord: ..." (when a message manually includes the subsystem tag).
  if (message.startsWith("[")) {
    const closeIdx = message.indexOf("]");
    if (closeIdx > 1) {
      const bracketTag = message.slice(1, closeIdx);
      if (bracketTag.toLowerCase() === displaySubsystem.toLowerCase()) {
        let i = closeIdx + 1;
        while (message[i] === " ") {
          i += 1;
        }
        return message.slice(i);
      }
    }
  }

  const prefix = message.slice(0, displaySubsystem.length);
  if (prefix.toLowerCase() !== displaySubsystem.toLowerCase()) {
    return message;
  }

  const next = message.slice(displaySubsystem.length, displaySubsystem.length + 1);
  if (next !== ":" && next !== " ") {
    return message;
  }

  let i = displaySubsystem.length;
  while (message[i] === " ") {
    i += 1;
  }
  if (message[i] === ":") {
    i += 1;
  }
  while (message[i] === " ") {
    i += 1;
  }
  return message.slice(i);
}

function formatConsoleLine(opts: {
  level: LogLevel;
  subsystem: string;
  message: string;
  style: "pretty" | "compact" | "json";
  meta?: Record<string, unknown>;
}): string {
  const displaySubsystem =
    opts.style === "json" ? opts.subsystem : formatSubsystemForConsole(opts.subsystem);
  if (opts.style === "json") {
    return JSON.stringify({
      time: formatConsoleTimestamp("json"),
      level: opts.level,
      subsystem: displaySubsystem,
      message: opts.message,
      ...opts.meta,
    });
  }
  const color = getColorForConsole();
  const prefix = `[${displaySubsystem}]`;
  const prefixColor = pickSubsystemColor(color, displaySubsystem);
  const levelColor =
    opts.level === "error" || opts.level === "fatal"
      ? color.red
      : opts.level === "warn"
        ? color.yellow
        : opts.level === "debug" || opts.level === "trace"
          ? color.gray
          : color.cyan;
  const baseDisplayMessage = stripRedundantSubsystemPrefixForConsole(
    opts.message,
    displaySubsystem,
  );
  const displayMessage = appendOperatorMetaForConsole(baseDisplayMessage, opts.meta);
  const time = (() => {
    if (opts.style === "pretty") {
      return color.gray(formatConsoleTimestamp("pretty"));
    }
    if (loggingState.consoleTimestampPrefix) {
      return color.gray(formatConsoleTimestamp(opts.style));
    }
    return "";
  })();
  const prefixToken = prefixColor(prefix);
  const head = [time, prefixToken].filter(Boolean).join(" ");
  return `${head} ${levelColor(displayMessage)}`;
}

function mergeSubsystemLogMeta(
  baseMeta: SubsystemLogMeta | undefined,
  meta: SubsystemLogMeta | undefined,
): SubsystemLogMeta | undefined {
  const observation = getCurrentObservationContext();
  if (!baseMeta && !meta && !observation) {
    return undefined;
  }
  const merged = {
    ...baseMeta,
    ...meta,
  };
  if (!observation) {
    return merged;
  }
  const ref = observationRef(observation);
  return {
    ...merged,
    traceId: ref.traceId,
    spanId: ref.spanId,
    parentSpanId: ref.parentSpanId,
    ...(ref.runId ? { runId: ref.runId } : {}),
    ...(ref.sessionId ? { sessionId: ref.sessionId } : {}),
    ...(ref.sessionKey ? { sessionKey: ref.sessionKey } : {}),
    ...(ref.agentId ? { agentId: ref.agentId } : {}),
    ...(ref.taskId ? { taskId: ref.taskId } : {}),
    phase: observation.phase ?? merged.phase,
    decisionCode: observation.decisionCode ?? merged.decisionCode,
  };
}

function normalizeConsoleMeta(meta: SubsystemLogMeta | undefined): {
  consoleMessage?: string;
  fileMeta?: SubsystemLogMeta;
} {
  if (!meta || Object.keys(meta).length === 0) {
    return {};
  }
  const { consoleMessage, ...rest } = meta as SubsystemLogMeta & {
    consoleMessage?: unknown;
  };
  return {
    ...(typeof consoleMessage === "string" ? { consoleMessage } : {}),
    ...(Object.keys(rest).length > 0 ? { fileMeta: rest } : {}),
  };
}

function messageAlreadyContainsOperatorField(message: string, aliases: string[]): boolean {
  const lowered = message.toLowerCase();
  return aliases.some((alias) => lowered.includes(`${alias.toLowerCase()}=`));
}

function appendOperatorMetaForConsole(message: string, meta: SubsystemLogMeta | undefined): string {
  if (!meta || Object.keys(meta).length === 0) {
    return message;
  }
  const fields: Array<{ key: string; value: unknown; aliases: string[] }> = [
    { key: "run", value: meta.runId, aliases: ["run", "runId"] },
    { key: "session", value: meta.sessionId, aliases: ["session", "sessionId"] },
    { key: "agent", value: meta.agentId, aliases: ["agent", "agentId"] },
    { key: "phase", value: meta.phase, aliases: ["phase"] },
    {
      key: "decision",
      value:
        typeof meta.decision === "string"
          ? meta.decision
          : typeof meta.decisionCode === "string"
            ? meta.decisionCode
            : undefined,
      aliases: ["decision", "decisionCode"],
    },
    { key: "status", value: meta.status, aliases: ["status"] },
    { key: "trace", value: meta.traceId, aliases: ["trace", "traceId"] },
    { key: "span", value: meta.spanId, aliases: ["span", "spanId"] },
  ];
  const tokens = fields
    .filter(
      ({ value, aliases }) =>
        value !== undefined && !messageAlreadyContainsOperatorField(message, aliases),
    )
    .map(({ key, value }) => `${key}=${String(value)}`);
  if (tokens.length === 0) {
    return message;
  }
  return `${message} [${tokens.join(" ")}]`;
}

function emitSubsystemLog(params: {
  subsystem: string;
  level: LogLevel;
  message: string;
  meta?: SubsystemLogMeta;
  getFileLogger: () => TsLogger<LogObj>;
}) {
  const consoleSettings = getConsoleSettings();
  const consoleEnabled =
    shouldLogToConsole(params.level, { level: consoleSettings.level }) &&
    shouldLogSubsystemToConsole(params.subsystem);
  const fileEnabled = isFileLogLevelEnabled(params.level);
  if (!consoleEnabled && !fileEnabled) {
    return;
  }

  const { consoleMessage, fileMeta } = normalizeConsoleMeta(params.meta);
  if (fileEnabled) {
    logToFile(params.getFileLogger(), params.level, params.message, fileMeta);
  }
  if (!consoleEnabled) {
    return;
  }
  const resolvedConsoleMessage = consoleMessage ?? params.message;
  if (
    shouldSuppressProbeConsoleLine({
      level: params.level,
      subsystem: params.subsystem,
      message: resolvedConsoleMessage,
      meta: fileMeta,
    })
  ) {
    return;
  }
  writeConsoleLine(
    params.level,
    formatConsoleLine({
      level: params.level,
      subsystem: params.subsystem,
      message: consoleSettings.style === "json" ? params.message : resolvedConsoleMessage,
      style: consoleSettings.style,
      meta: fileMeta,
    }),
  );
}

function writeConsoleLine(level: LogLevel, line: string) {
  clearActiveProgressLine();
  const sanitized =
    process.platform === "win32" && process.env.GITHUB_ACTIONS === "true"
      ? line.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "?").replace(/[\uD800-\uDFFF]/g, "?")
      : line;
  const sink = loggingState.rawConsole ?? console;
  if (loggingState.forceConsoleToStderr || level === "error" || level === "fatal") {
    (sink.error ?? console.error)(sanitized);
  } else if (level === "warn") {
    (sink.warn ?? console.warn)(sanitized);
  } else {
    (sink.log ?? console.log)(sanitized);
  }
}

function shouldSuppressProbeConsoleLine(params: {
  level: LogLevel;
  subsystem: string;
  message: string;
  meta?: Record<string, unknown>;
}): boolean {
  if (isVerbose()) {
    return false;
  }
  if (params.level === "error" || params.level === "fatal") {
    return false;
  }
  const isProbeSuppressedSubsystem =
    params.subsystem === "agent/embedded" ||
    params.subsystem.startsWith("agent/embedded/") ||
    params.subsystem === "model-fallback" ||
    params.subsystem.startsWith("model-fallback/");
  if (!isProbeSuppressedSubsystem) {
    return false;
  }
  const runLikeId =
    typeof params.meta?.runId === "string"
      ? params.meta.runId
      : typeof params.meta?.sessionId === "string"
        ? params.meta.sessionId
        : undefined;
  if (runLikeId?.startsWith("probe-")) {
    return true;
  }
  return /(sessionId|runId)=probe-/.test(params.message);
}

function logToFile(
  fileLogger: TsLogger<LogObj>,
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
) {
  if (level === "silent") {
    return;
  }
  const safeLevel = level;
  const method = (fileLogger as unknown as Record<string, unknown>)[safeLevel] as
    | ((...args: unknown[]) => void)
    | undefined;
  if (typeof method !== "function") {
    return;
  }
  if (meta && Object.keys(meta).length > 0) {
    method.call(fileLogger, meta, message);
  } else {
    method.call(fileLogger, message);
  }
}

function createSubsystemLoggerInternal(
  subsystem: string,
  boundMeta?: SubsystemLogMeta,
): SubsystemLogger {
  let fileLogger: TsLogger<LogObj> | null = null;
  const getFileLogger = () => {
    if (!fileLogger) {
      fileLogger = getChildLogger({ subsystem });
    }
    return fileLogger;
  };

  const logger: SubsystemLogger = {
    subsystem,
    isEnabled(level, target = "any") {
      const isConsoleEnabled =
        shouldLogToConsole(level, { level: getConsoleSettings().level }) &&
        shouldLogSubsystemToConsole(subsystem);
      const isFileEnabled = isFileLogLevelEnabled(level);
      if (target === "console") {
        return isConsoleEnabled;
      }
      if (target === "file") {
        return isFileEnabled;
      }
      return isConsoleEnabled || isFileEnabled;
    },
    trace(message, meta) {
      emitSubsystemLog({
        subsystem,
        level: "trace",
        message,
        meta: mergeSubsystemLogMeta(boundMeta, meta),
        getFileLogger,
      });
    },
    debug(message, meta) {
      emitSubsystemLog({
        subsystem,
        level: "debug",
        message,
        meta: mergeSubsystemLogMeta(boundMeta, meta),
        getFileLogger,
      });
    },
    info(message, meta) {
      emitSubsystemLog({
        subsystem,
        level: "info",
        message,
        meta: mergeSubsystemLogMeta(boundMeta, meta),
        getFileLogger,
      });
    },
    warn(message, meta) {
      emitSubsystemLog({
        subsystem,
        level: "warn",
        message,
        meta: mergeSubsystemLogMeta(boundMeta, meta),
        getFileLogger,
      });
    },
    error(message, meta) {
      emitSubsystemLog({
        subsystem,
        level: "error",
        message,
        meta: mergeSubsystemLogMeta(boundMeta, meta),
        getFileLogger,
      });
    },
    fatal(message, meta) {
      emitSubsystemLog({
        subsystem,
        level: "fatal",
        message,
        meta: mergeSubsystemLogMeta(boundMeta, meta),
        getFileLogger,
      });
    },
    raw(message) {
      if (isFileLogLevelEnabled("info")) {
        if (!fileLogger) {
          fileLogger = getChildLogger({ subsystem });
        }
        logToFile(fileLogger, "info", message, { raw: true });
      }
      if (
        shouldLogToConsole("info", { level: getConsoleSettings().level }) &&
        shouldLogSubsystemToConsole(subsystem)
      ) {
        if (shouldSuppressProbeConsoleLine({ level: "info", subsystem, message })) {
          return;
        }
        writeConsoleLine("info", message);
      }
    },
    child(name) {
      return createSubsystemLoggerInternal(`${subsystem}/${name}`, boundMeta);
    },
    withContext(meta) {
      return createSubsystemLoggerInternal(subsystem, mergeSubsystemLogMeta(boundMeta, meta));
    },
  };
  return logger;
}

export function createSubsystemLogger(subsystem: string): SubsystemLogger {
  return createSubsystemLoggerInternal(subsystem);
}

export function runtimeForLogger(
  logger: SubsystemLogger,
  exit: RuntimeEnv["exit"] = defaultRuntime.exit,
): OutputRuntimeEnv {
  return {
    log(...args) {
      logger.info(
        args
          .map((arg) => formatRuntimeArg(arg))
          .join(" ")
          .trim(),
      );
    },
    error(...args) {
      logger.error(
        args
          .map((arg) => formatRuntimeArg(arg))
          .join(" ")
          .trim(),
      );
    },
    writeStdout(value) {
      logger.info(value);
    },
    writeJson(value: unknown, space = 2) {
      logger.info(JSON.stringify(value, null, space > 0 ? space : undefined));
    },
    exit,
  };
}

export function createSubsystemRuntime(
  subsystem: string,
  exit: RuntimeEnv["exit"] = defaultRuntime.exit,
): OutputRuntimeEnv {
  return runtimeForLogger(createSubsystemLogger(subsystem), exit);
}
