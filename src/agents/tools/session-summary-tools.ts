import { Type } from "@sinclair/typebox";
import {
  ensureSessionSummaryFile,
  ensureSessionSummaryTemplateContent,
  editSessionSummaryFile,
} from "../../memory/session-summary/store.ts";
import { jsonResult, readStringParam, ToolInputError, type AnyAgentTool } from "./common.ts";

type SessionSummaryToolOptions = {
  agentId?: string | null;
  summarySessionId?: string | null;
  sessionId?: string | null;
  rootDir?: string | null;
};

type ResolvedTarget = {
  agentId: string;
  sessionId: string;
  rootDir?: string | null;
};

function resolveTarget(options?: SessionSummaryToolOptions): ResolvedTarget | null {
  const agentId = options?.agentId?.trim();
  const sessionId = options?.summarySessionId?.trim() ?? options?.sessionId?.trim();
  if (!agentId || !sessionId) {
    return null;
  }
  return {
    agentId,
    sessionId,
    ...(options?.rootDir?.trim() ? { rootDir: options.rootDir.trim() } : {}),
  };
}

const SessionSummaryEditSchema = Type.Object({
  findText: Type.String({
    description: "Exact text to replace in the current summary.md file.",
  }),
  replaceText: Type.String({
    description: "Replacement text.",
  }),
  replaceAll: Type.Optional(
    Type.Boolean({
      description: "Replace all occurrences instead of only the first occurrence.",
    }),
  ),
});

export function createSessionSummaryReadTool(
  options?: SessionSummaryToolOptions,
): AnyAgentTool | null {
  const target = resolveTarget(options);
  if (!target) {
    return null;
  }
  return {
    label: "Read Session Summary",
    name: "session_summary_file_read",
    description:
      "Read the current structured session summary.md file for this session. Use this first before editing.",
    parameters: Type.Object({}),
    execute: async () => {
      const snapshot = await ensureSessionSummaryFile(target);
      return jsonResult({
        status: snapshot.exists ? "ok" : "missing",
        sessionId: snapshot.sessionId,
        agentId: snapshot.agentId,
        summaryPath: snapshot.summaryPath,
        exists: snapshot.exists,
        content: snapshot.content,
        templateContent: ensureSessionSummaryTemplateContent({
          sessionId: target.sessionId,
        }),
        updatedAt: snapshot.updatedAt,
        sections: snapshot.document?.sections ?? null,
      });
    },
  };
}

export function createSessionSummaryEditTool(
  options?: SessionSummaryToolOptions,
): AnyAgentTool | null {
  const target = resolveTarget(options);
  if (!target) {
    return null;
  }
  return {
    label: "Edit Session Summary File",
    name: "session_summary_file_edit",
    description:
      "Edit the current session summary.md file by replacing exact text. Read the file first, then keep replacements narrow.",
    parameters: SessionSummaryEditSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const findText = readStringParam(params, "findText", { required: true, trim: false });
      const replaceText = readStringParam(params, "replaceText", { required: true, trim: false });
      const replaceAll = typeof params.replaceAll === "boolean" ? params.replaceAll : false;
      const result = await editSessionSummaryFile({
        ...target,
        findText,
        replaceText,
        replaceAll,
      });
      if (result.replacements === 0) {
        throw new ToolInputError("findText not found in session summary file");
      }
      return jsonResult({
        status: "ok",
        sessionId: result.sessionId,
        agentId: result.agentId,
        summaryPath: result.summaryPath,
        replacements: result.replacements,
        bytesWritten: result.bytes,
        content: result.content,
        sections: result.document?.sections ?? null,
      });
    },
  };
}

export function createSessionSummaryTools(options?: SessionSummaryToolOptions): AnyAgentTool[] {
  return [createSessionSummaryReadTool(options), createSessionSummaryEditTool(options)].filter(
    (tool): tool is AnyAgentTool => Boolean(tool),
  );
}
