import { isPlainObject } from "../../utils.js";
import type { ToolLoopCategory } from "./types.js";

export type ToolLoopBehavior = {
  category: ToolLoopCategory;
  idempotent: boolean;
  supportsExactRetry: boolean;
  isPollingTool: boolean;
  expectedProgress: "content_change" | "status_change" | "artifact_change" | "none";
  defaultNoProgressBudget: number;
  softBlockAfter: number;
  hardBlockAfter?: number;
};

const WRITE_TOOL_NAMES = new Set([
  "apply_patch",
  "create_file",
  "delete_file",
  "edit",
  "multi_edit",
  "patch",
  "rename_file",
  "replace",
  "str_replace_editor",
  "write",
]);

const SEARCH_TOOL_NAMES = new Set(["search", "web_search", "x_search"]);

const FETCH_TOOL_NAMES = new Set(["fetch", "web_fetch"]);

const READ_TOOL_NAMES = new Set(["read", "list", "glob", "grep", "find", "open", "image", "pdf"]);

function isKnownPollTool(toolName: string, params: unknown): boolean {
  if (toolName === "command_status") {
    return true;
  }
  if (toolName !== "process" || !isPlainObject(params)) {
    return false;
  }
  const action = params.action;
  return action === "poll" || action === "log";
}

export function resolveToolLoopCategory(toolName: string, params: unknown): ToolLoopCategory {
  if (isKnownPollTool(toolName, params)) {
    return "poll";
  }
  if (toolName === "exec" || toolName === "bash" || toolName === "shell") {
    return "exec";
  }
  if (WRITE_TOOL_NAMES.has(toolName)) {
    return "write";
  }
  if (SEARCH_TOOL_NAMES.has(toolName)) {
    return "search";
  }
  if (FETCH_TOOL_NAMES.has(toolName)) {
    return "fetch";
  }
  if (READ_TOOL_NAMES.has(toolName)) {
    return "read";
  }
  if (toolName === "ask" || toolName === "request_user_input") {
    return "ask";
  }
  if (toolName === "plan" || toolName === "update_plan") {
    return "plan";
  }
  return "other";
}

export function resolveToolLoopBehavior(toolName: string, params: unknown): ToolLoopBehavior {
  const category = resolveToolLoopCategory(toolName, params);
  switch (category) {
    case "poll":
      return {
        category,
        idempotent: true,
        supportsExactRetry: true,
        isPollingTool: true,
        expectedProgress: "status_change",
        defaultNoProgressBudget: 8,
        softBlockAfter: 12,
        hardBlockAfter: 20,
      };
    case "write":
      return {
        category,
        idempotent: false,
        supportsExactRetry: false,
        isPollingTool: false,
        expectedProgress: "artifact_change",
        defaultNoProgressBudget: 3,
        softBlockAfter: 5,
        hardBlockAfter: 8,
      };
    case "exec":
      return {
        category,
        idempotent: false,
        supportsExactRetry: false,
        isPollingTool: false,
        expectedProgress: "artifact_change",
        defaultNoProgressBudget: 3,
        softBlockAfter: 5,
        hardBlockAfter: 8,
      };
    case "search":
    case "fetch":
    case "read":
      return {
        category,
        idempotent: true,
        supportsExactRetry: true,
        isPollingTool: false,
        expectedProgress: "content_change",
        defaultNoProgressBudget: 4,
        softBlockAfter: 6,
        hardBlockAfter: 10,
      };
    case "ask":
    case "plan":
    case "other":
    default:
      return {
        category,
        idempotent: true,
        supportsExactRetry: true,
        isPollingTool: false,
        expectedProgress: "none",
        defaultNoProgressBudget: 4,
        softBlockAfter: 6,
        hardBlockAfter: 10,
      };
  }
}
